use crate::auth::{
    claims_for_user, issue_token, require_client_by_token, token_from_headers, touch_client,
    AdminUser, AuthUser,
};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub nik: String,
    pub pin: String,
}

#[derive(Debug, FromRow)]
pub struct UserAuthRow {
    pub id: String,
    pub nik: String,
    pub name: String,
    pub pin_hash: String,
    pub role_id: String,
    pub role_name: String,
    pub is_admin: bool,
    pub permissions: String,
    pub brand_id: Option<String>,
    pub outlet_id: Option<String>,
    pub avatar_color: String,
    pub active: bool,
}

fn permissions(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value).unwrap_or_default()
}

fn user_json(user: &UserAuthRow) -> Value {
    json!({
        "id": user.id,
        "nik": user.nik,
        "name": user.name,
        "role_id": user.role_id,
        "role_name": user.role_name,
        "is_admin": user.is_admin,
        "permissions": permissions(&user.permissions),
        "brand_id": user.brand_id,
        "outlet_id": user.outlet_id,
        "avatar_color": user.avatar_color,
    })
}

async fn find_user(state: &AppState, nik: &str) -> ApiResult<UserAuthRow> {
    sqlx::query_as::<_, UserAuthRow>(
        r#"
        SELECT u.id, u.nik, u.name, u.pin_hash, u.role_id, r.name AS role_name,
               r.is_admin, CAST(r.permissions AS CHAR) AS permissions,
               u.brand_id, u.outlet_id, u.avatar_color, u.active
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.nik = ?
        LIMIT 1
        "#,
    )
    .bind(nik)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::unauthorized("NIK atau PIN tidak sesuai."))
}

fn verify_pin(pin: &str, hash: &str) -> bool {
    bcrypt::verify(pin, hash).unwrap_or(false)
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> ApiResult<Json<Value>> {
    let user = find_user(&state, body.nik.trim()).await?;
    if !user.active {
        return Err(ApiError::forbidden("User tidak aktif."));
    }
    if !verify_pin(&body.pin, &user.pin_hash) {
        return Err(ApiError::unauthorized("NIK atau PIN tidak sesuai."));
    }

    let perms = permissions(&user.permissions);
    let claims = claims_for_user(
        &user.id,
        &user.nik,
        &user.name,
        &user.role_id,
        user.is_admin,
        &perms,
        user.brand_id.clone(),
        user.outlet_id.clone(),
    );
    let token = issue_token(&state.cfg, &claims)?;

    sqlx::query("UPDATE users SET last_login_at = NOW(6) WHERE id = ?")
        .bind(&user.id)
        .execute(&state.pool)
        .await?;

    Ok(Json(json!({
        "token": token,
        "user": user_json(&user),
        "expires_in": 16 * 60 * 60,
    })))
}

pub async fn me(State(state): State<AppState>, auth: AuthUser) -> ApiResult<Json<Value>> {
    let user = sqlx::query_as::<_, UserAuthRow>(
        r#"
        SELECT u.id, u.nik, u.name, u.pin_hash, u.role_id, r.name AS role_name,
               r.is_admin, CAST(r.permissions AS CHAR) AS permissions,
               u.brand_id, u.outlet_id, u.avatar_color, u.active
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = ? AND u.active = 1
        "#,
    )
    .bind(auth.id())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::unauthorized("User tidak aktif."))?;

    Ok(Json(json!({ "user": user_json(&user) })))
}

pub async fn pos_login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> ApiResult<Json<Value>> {
    let token = token_from_headers(&headers)
        .ok_or_else(|| ApiError::unauthorized("Client token wajib dikirim."))?;
    let client = require_client_by_token(&state, &token).await?;
    touch_client(&state, &client.id).await;

    let user = find_user(&state, body.nik.trim()).await?;
    if !user.active {
        return Err(ApiError::forbidden("User tidak aktif."));
    }

    let allowed = user.is_admin
        || (user.outlet_id.is_none() && user.brand_id.is_none())
        || user.outlet_id.as_deref() == Some(client.outlet_id.as_str())
        || (user.outlet_id.is_none()
            && user.brand_id.as_deref() == Some(client.brand_id.as_str()));
    if !allowed {
        return Err(ApiError::forbidden(
            "User ini tidak ditempatkan di outlet/client ini.",
        ));
    }

    if !verify_pin(&body.pin, &user.pin_hash) {
        return Err(ApiError::unauthorized("PIN tidak sesuai."));
    }

    sqlx::query("UPDATE users SET last_login_at = NOW(6) WHERE id = ?")
        .bind(&user.id)
        .execute(&state.pool)
        .await?;

    if client.kind == "order_station" && !user.is_admin {
        // Order stations can use the station, but operational permissions are
        // enforced again by the frontend and by the absence of payment APIs.
    }

    Ok(Json(json!({
        "user": user_json(&user),
        "client": {
            "id": client.id,
            "name": client.name,
            "kind": client.kind,
            "second_display": client.second_display,
            "slideshow_interval_seconds": client.slideshow_interval_seconds,
        },
    })))
}

pub async fn verify_admin(State(state): State<AppState>, admin: AdminUser) -> ApiResult<Json<Value>> {
    let cfg = &state.cfg;
    Ok(Json(json!({
        "ok": true,
        "user": admin.0.claims,
        "server_time": chrono::Utc::now(),
        "version": env!("CARGO_PKG_VERSION"),
        "seed_demo": cfg.seed_demo,
    })))
}
