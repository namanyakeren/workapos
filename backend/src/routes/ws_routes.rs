use crate::auth::{require_client_by_token, AuthUser, Claims};
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, ServerEvent};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::HashMap;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;

pub async fn pos_ws(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> ApiResult<impl IntoResponse> {
    let token = params
        .get("token")
        .cloned()
        .or_else(|| {
            headers
                .get("x-client-token")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
        })
        .ok_or_else(|| ApiError::unauthorized("Client token wajib dikirim."))?;
    let client = require_client_by_token(&state, &token).await?;
    let client_id = client.id.clone();
    let client_name = client.name.clone();
    let handle = state.clone();

    state.publish(ServerEvent::new(
        "client.online",
        Some(client_id.clone()),
        json!({ "client_id": client_id, "client_name": client_name }),
    ));

    Ok(ws.on_upgrade(move |socket| async move {
        handle_pos_socket(handle, socket, client_id).await;
    }))
}

async fn handle_pos_socket(state: AppState, socket: WebSocket, client_id: String) {
    let _ = sqlx::query(
        "UPDATE clients SET status='online', last_seen_at=NOW(6) WHERE id = ?",
    )
    .bind(&client_id)
    .execute(&state.pool)
    .await;

    let mut events = state.events.subscribe();
    let (mut sender, mut receiver) = socket.split();

    let hello = json!({
        "kind": "hello",
        "data": { "server_time": Utc::now(), "message": "WORKAPOS realtime connected" }
    });
    if sender
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    // Deliver commands that were queued while the terminal was offline.
    if let Ok(rows) = sqlx::query(
        "SELECT id, action, CAST(payload AS CHAR) AS payload FROM client_commands WHERE client_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 20",
    )
    .bind(&client_id)
    .fetch_all(&state.pool)
    .await
    {
        for row in rows {
            let command_id: String = row.get("id");
            let action: String = row.get("action");
            let payload: Option<String> = row.get("payload");
            let message = json!({
                "kind": "command",
                "data": {
                    "command_id": command_id,
                    "action": action,
                    "payload": payload.and_then(|p| serde_json::from_str::<Value>(&p).ok()).unwrap_or(json!({})),
                }
            });
            let _ = sender.send(Message::Text(message.to_string().into())).await;
            let _ = sqlx::query(
                "UPDATE client_commands SET status='delivered', delivered_at=NOW(6) WHERE id = ?",
            )
            .bind(&command_id)
            .execute(&state.pool)
            .await;
        }
    }

    loop {
        tokio::select! {
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(value) = serde_json::from_str::<Value>(&text) {
                            let kind = value.get("kind").and_then(Value::as_str).unwrap_or("");
                            if kind == "heartbeat" {
                                let _ = sqlx::query("UPDATE clients SET status='online', last_seen_at=NOW(6) WHERE id = ?")
                                    .bind(&client_id)
                                    .execute(&state.pool)
                                    .await;
                            } else if kind == "command_ack" {
                                let command_id = value.get("command_id").and_then(Value::as_str).unwrap_or("");
                                let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(true);
                                let _ = sqlx::query("UPDATE client_commands SET status=?, delivered_at=NOW(6) WHERE id=? AND client_id=?")
                                    .bind(if ok { "done" } else { "failed" })
                                    .bind(command_id)
                                    .bind(&client_id)
                                    .execute(&state.pool)
                                    .await;
                                state.publish(ServerEvent::new(
                                    "command.ack",
                                    Some(client_id.clone()),
                                    json!({ "command_id": command_id, "ok": ok }),
                                ));
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        // Ticket events are outlet-wide notifications (client_id is
                        // None). Personal commands and this terminal's sale echo are
                        // delivered by id. Everything else stays private.
                        let broadcast_ticket = event.client_id.is_none()
                            && event.kind.starts_with("ticket.");
                        let personal =
                            event.client_id.as_deref() == Some(client_id.as_str());
                        if broadcast_ticket || personal {
                            if let Ok(text) = serde_json::to_string(&event) {
                                if sender.send(Message::Text(text.into())).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
        }
    }

    let _ = sqlx::query("UPDATE clients SET status='offline', last_seen_at=NOW(6) WHERE id = ?")
        .bind(&client_id)
        .execute(&state.pool)
        .await;
    state.publish(ServerEvent::new(
        "client.offline",
        Some(client_id.clone()),
        json!({ "client_id": client_id }),
    ));
}

pub async fn admin_events(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>> {
    let token = params
        .get("token")
        .ok_or_else(|| ApiError::unauthorized("Token wajib dikirim."))?;
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.cfg.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::unauthorized("Token tidak valid."))?;
    if !data.claims.is_admin {
        return Err(ApiError::forbidden("Hanya administrator."));
    }

    let rx = state.events.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|message| async move {
        match message {
            Ok(event) => {
                let payload = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
                Some(Ok(Event::default().event(event.kind).data(payload)))
            }
            Err(_) => None,
        }
    });

    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keepalive"),
    ))
}

pub async fn admin_me(State(state): State<AppState>, auth: AuthUser) -> ApiResult<impl IntoResponse> {
    let _ = &state;
    Ok(axum::Json(json!({ "user": auth.claims })))
}
