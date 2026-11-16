use crate::auth::AdminUser;
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, ServerEvent};
use axum::extract::{Path, State};
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CommandRequest {
    pub action: String,
    #[serde(default)]
    pub payload: Value,
}

pub async fn send_command(
    State(state): State<AppState>,
    Path(client_id): Path<String>,
    admin: AdminUser,
    Json(body): Json<CommandRequest>,
) -> ApiResult<Json<Value>> {
    let action = body.action.trim();
    if action.is_empty() {
        return Err(ApiError::bad_request("Action wajib diisi."));
    }
    if !matches!(
        action,
        "sync"
            | "reload"
            | "show_message"
            | "test_print"
            | "open_drawer"
            | "lock"
            | "unlock"
            | "update_display"
            | "shutdown"
            | "restart_app"
            | "clear_cache"
    ) {
        return Err(ApiError::bad_request("Action tidak didukung."));
    }

    let client = sqlx::query_as::<_, (String, String)>(
        "SELECT code, status FROM clients WHERE id = ? AND active = 1",
    )
    .bind(&client_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Client tidak ditemukan."))?;

    let id = Uuid::new_v4().to_string();
    let payload = if body.payload.is_null() {
        json!({})
    } else {
        body.payload.clone()
    };

    sqlx::query(
        "INSERT INTO client_commands (id, client_id, action, payload, status, created_by) VALUES (?, ?, ?, ?, 'queued', ?)",
    )
    .bind(&id)
    .bind(&client_id)
    .bind(action)
    .bind(payload.to_string())
    .bind(admin.0.id())
    .execute(&state.pool)
    .await?;

    state.publish(ServerEvent::new(
        "command",
        Some(client_id.clone()),
        json!({
            "command_id": id,
            "action": action,
            "payload": payload,
        }),
    ));

    Ok(Json(json!({
        "ok": true,
        "command_id": id,
        "client_code": client.0,
        "online": client.1 == "online",
        "queued_at": Utc::now(),
    })))
}

pub async fn commands(
    State(state): State<AppState>,
    Path(client_id): Path<String>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let rows = sqlx::query(
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', id, 'client_id', client_id, 'action', action,
          'payload', COALESCE(CAST(payload AS CHAR), JSON_OBJECT()),
          'status', status, 'created_at', created_at, 'delivered_at', delivered_at
        ) AS CHAR) AS data
        FROM client_commands
        WHERE client_id = ?
        ORDER BY created_at DESC
        LIMIT 30
        "#,
    )
    .bind(&client_id)
    .fetch_all(&state.pool)
    .await?;

    let mut data = Vec::new();
    for row in rows {
        let raw: String = row.try_get("data")?;
        data.push(serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null));
    }
    Ok(Json(json!({ "data": data })))
}

pub async fn presence(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let rows = sqlx::query(
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', c.id, 'code', c.code, 'name', c.name, 'kind', c.kind,
          'outlet_id', c.outlet_id, 'outlet_name', o.name, 'brand_id', o.brand_id,
          'brand_name', b.name, 'status', c.status, 'last_seen_at', c.last_seen_at,
          'app_version', c.app_version, 'second_display', c.second_display
        ) AS CHAR) AS data
        FROM clients c
        JOIN outlets o ON o.id = c.outlet_id
        JOIN brands b ON b.id = o.brand_id
        WHERE c.active = 1
        ORDER BY c.status DESC, b.name ASC, o.name ASC, c.name ASC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    let data: Vec<Value> = rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("data").ok())
        .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
        .collect();

    Ok(Json(json!({ "data": data, "server_time": Utc::now() })))
}
