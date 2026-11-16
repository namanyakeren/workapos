use crate::config::Config;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::HeaderMap;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub nik: String,
    pub name: String,
    pub role_id: String,
    pub is_admin: bool,
    pub permissions: Vec<String>,
    pub brand_id: Option<String>,
    pub outlet_id: Option<String>,
    pub exp: usize,
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub claims: Claims,
}

impl AuthUser {
    pub fn id(&self) -> &str {
        &self.claims.sub
    }

    #[allow(dead_code)]
    pub fn can(&self, permission: &str) -> bool {
        self.claims.is_admin || self.claims.permissions.iter().any(|p| p == permission)
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| ApiError::unauthorized("Sesi tidak ditemukan. Silakan login."))?;

        let data = decode::<Claims>(
            auth,
            &DecodingKey::from_secret(state.cfg.jwt_secret.as_bytes()),
            &Validation::new(Algorithm::HS256),
        )
        .map_err(|_| ApiError::unauthorized("Sesi sudah berakhir. Silakan login kembali."))?;

        Ok(Self {
            claims: data.claims,
        })
    }
}

pub struct AdminUser(pub AuthUser);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let user = AuthUser::from_request_parts(parts, state).await?;
        if !user.claims.is_admin {
            return Err(ApiError::forbidden(
                "Halaman ini hanya untuk administrator.",
            ));
        }
        Ok(Self(user))
    }
}

pub fn issue_token(cfg: &Config, claims: &Claims) -> ApiResult<String> {
    encode(
        &Header::new(Algorithm::HS256),
        claims,
        &EncodingKey::from_secret(cfg.jwt_secret.as_bytes()),
    )
    .map_err(|_| ApiError::internal("Gagal membuat sesi login."))
}

pub fn claims_for_user(
    id: &str,
    nik: &str,
    name: &str,
    role_id: &str,
    is_admin: bool,
    permissions: &[String],
    brand_id: Option<String>,
    outlet_id: Option<String>,
) -> Claims {
    Claims {
        sub: id.to_string(),
        nik: nik.to_string(),
        name: name.to_string(),
        role_id: role_id.to_string(),
        is_admin,
        permissions: permissions.to_vec(),
        brand_id,
        outlet_id,
        exp: (Utc::now() + Duration::hours(16)).timestamp() as usize,
    }
}

pub fn token_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-client-token")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| {
            headers
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(str::to_string)
        })
}

#[derive(Debug, Clone, sqlx::FromRow)]
#[allow(dead_code)]
pub struct ClientContext {
    pub id: String,
    pub code: String,
    pub name: String,
    pub kind: String,
    pub token: String,
    pub second_display: bool,
    pub slideshow_interval_seconds: i64,
    pub outlet_id: String,
    pub brand_id: String,
    pub outlet_name: String,
    pub brand_name: String,
}

pub async fn require_client_by_token(
    state: &AppState,
    token: &str,
) -> ApiResult<ClientContext> {
    sqlx::query_as::<_, ClientContext>(
        r#"
        SELECT c.id, c.code, c.name, c.kind, c.token, c.second_display,
               c.slideshow_interval_seconds, c.outlet_id, o.brand_id,
               o.name AS outlet_name, b.name AS brand_name
        FROM clients c
        JOIN outlets o ON o.id = c.outlet_id
        JOIN brands b ON b.id = o.brand_id
        WHERE c.token = ? AND c.active = 1
        LIMIT 1
        "#,
    )
    .bind(token)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::unauthorized("Client token tidak valid atau client nonaktif."))
}

pub async fn touch_client(state: &AppState, client_id: &str) {
    let _ = sqlx::query(
        "UPDATE clients SET last_seen_at = NOW(6), status = 'online' WHERE id = ?",
    )
    .bind(client_id)
    .execute(&state.pool)
    .await;
}
