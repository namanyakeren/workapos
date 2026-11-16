use crate::auth::AdminUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::HashMap;
use uuid::Uuid;

async fn list_users(
    state: &AppState,
    brand_id: Option<&str>,
    outlet_id: Option<&str>,
) -> ApiResult<Vec<Value>> {
    let mut sql = String::from(
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', u.id, 'nik', u.nik, 'name', u.name, 'role_id', u.role_id,
          'role_name', r.name, 'is_admin', r.is_admin,
          'permissions', CAST(r.permissions AS CHAR),
          'brand_id', u.brand_id, 'outlet_id', u.outlet_id,
          'brand_name', b.name, 'outlet_name', o.name,
          'avatar_color', u.avatar_color, 'active', u.active,
          'last_login_at', u.last_login_at, 'created_at', u.created_at
        ) AS CHAR) AS data
        FROM users u
        JOIN roles r ON r.id = u.role_id
        LEFT JOIN brands b ON b.id = u.brand_id
        LEFT JOIN outlets o ON o.id = u.outlet_id
        WHERE 1=1
        "#,
    );
    if brand_id.is_some() {
        sql.push_str(" AND u.brand_id = ?");
    }
    if outlet_id.is_some() {
        sql.push_str(" AND u.outlet_id = ?");
    }
    sql.push_str(" ORDER BY r.is_admin DESC, u.name ASC");

    let mut q = sqlx::query(&sql);
    if let Some(value) = brand_id {
        q = q.bind(value);
    }
    if let Some(value) = outlet_id {
        q = q.bind(value);
    }
    let rows = q.fetch_all(&state.pool).await?;
    let mut out = Vec::new();
    for row in rows {
        let raw: String = row.try_get("data")?;
        out.push(serde_json::from_str(&raw).unwrap_or(Value::Null));
    }
    Ok(out)
}

fn required_text(body: &Value, key: &str) -> ApiResult<String> {
    body.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| ApiError::bad_request(format!("Field '{}' wajib diisi.", key)))
}

fn optional_id(body: &Value, key: &str) -> Option<String> {
    body.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let data = list_users(
        &state,
        params.get("brand_id").map(String::as_str),
        params.get("outlet_id").map(String::as_str),
    )
    .await?;
    Ok(Json(json!({ "data": data })))
}

pub async fn create(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let nik = required_text(&body, "nik")?;
    let name = required_text(&body, "name")?;
    let pin = required_text(&body, "pin")?;
    let role_id = required_text(&body, "role_id")?;
    if pin.len() < 4 {
        return Err(ApiError::bad_request("PIN minimal 4 digit."));
    }
    if !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(ApiError::bad_request("PIN harus berupa angka."));
    }

    let role_exists: Option<(String,)> = sqlx::query_as("SELECT id FROM roles WHERE id = ? AND active = 1")
        .bind(&role_id)
        .fetch_optional(&state.pool)
        .await?;
    if role_exists.is_none() {
        return Err(ApiError::bad_request("Role tidak ditemukan."));
    }

    let pin_hash = bcrypt::hash(&pin, 10)
        .map_err(|_| ApiError::internal("Gagal mengamankan PIN."))?;
    let id = Uuid::new_v4().to_string();
    let avatar_color = body
        .get("avatar_color")
        .and_then(Value::as_str)
        .unwrap_or("#F59E0B");

    sqlx::query(
        r#"
        INSERT INTO users (id, nik, name, pin_hash, role_id, brand_id, outlet_id, avatar_color, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(&nik)
    .bind(&name)
    .bind(pin_hash)
    .bind(&role_id)
    .bind(optional_id(&body, "brand_id"))
    .bind(optional_id(&body, "outlet_id"))
    .bind(avatar_color)
    .bind(body.get("active").and_then(Value::as_bool).unwrap_or(true))
    .execute(&state.pool)
    .await?;

    let data = list_users(&state, None, None)
        .await?
        .into_iter()
        .find(|u| u.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .unwrap_or(Value::Null);
    Ok(Json(json!({ "data": data })))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _admin: AdminUser,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let existing: Option<(String,)> = sqlx::query_as("SELECT pin_hash FROM users WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?;
    let (old_hash,) = existing.ok_or_else(|| ApiError::not_found("User tidak ditemukan."))?;

    let nik = required_text(&body, "nik")?;
    let name = required_text(&body, "name")?;
    let role_id = required_text(&body, "role_id")?;
    let pin = body
        .get("pin")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let pin_hash = match pin {
        Some(pin) => {
            if pin.len() < 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
                return Err(ApiError::bad_request("PIN minimal 4 digit angka."));
            }
            bcrypt::hash(pin, 10)
                .map_err(|_| ApiError::internal("Gagal mengamankan PIN."))?
        }
        None => old_hash,
    };

    sqlx::query(
        r#"
        UPDATE users SET nik = ?, name = ?, pin_hash = ?, role_id = ?, brand_id = ?,
          outlet_id = ?, avatar_color = ?, active = ? WHERE id = ?
        "#,
    )
    .bind(&nik)
    .bind(&name)
    .bind(pin_hash)
    .bind(&role_id)
    .bind(optional_id(&body, "brand_id"))
    .bind(optional_id(&body, "outlet_id"))
    .bind(body.get("avatar_color").and_then(Value::as_str).unwrap_or("#F59E0B"))
    .bind(body.get("active").and_then(Value::as_bool).unwrap_or(true))
    .bind(&id)
    .execute(&state.pool)
    .await?;

    let data = list_users(&state, None, None)
        .await?
        .into_iter()
        .find(|u| u.get("id").and_then(Value::as_str) == Some(id.as_str()))
        .unwrap_or(Value::Null);
    Ok(Json(json!({ "data": data })))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
    admin: AdminUser,
) -> ApiResult<Json<Value>> {
    if admin.0.id() == id {
        return Err(ApiError::bad_request("Tidak dapat menonaktifkan akun sendiri."));
    }
    let result = sqlx::query("UPDATE users SET active = 0 WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("User tidak ditemukan."));
    }
    Ok(Json(json!({ "ok": true })))
}
