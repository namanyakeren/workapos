use crate::auth::{require_client_by_token, token_from_headers, touch_client, ClientContext};
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, ServerEvent};
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::Json;
use chrono::Utc;
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::HashMap;
use uuid::Uuid;

async fn client_from_headers(
    state: &AppState,
    headers: &HeaderMap,
) -> ApiResult<ClientContext> {
    let token = token_from_headers(headers)
        .ok_or_else(|| ApiError::unauthorized("Client token wajib dikirim."))?;
    let client = require_client_by_token(state, &token).await?;
    touch_client(state, &client.id).await;
    Ok(client)
}

fn ticket_json(row: &sqlx::mysql::MySqlRow) -> Value {
    let raw: String = row.try_get("data").unwrap_or_else(|_| "{}".to_string());
    serde_json::from_str(&raw).unwrap_or(Value::Null)
}

async fn load_items(state: &AppState, ticket_id: &str) -> ApiResult<Vec<Value>> {
    let rows = sqlx::query(
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', id, 'product_id', product_id, 'sku', sku, 'name', name,
          'qty', qty, 'unit_price_cents', unit_price_cents,
          'total_cents', total_cents, 'note', note
        ) AS CHAR) AS data
        FROM pos_ticket_items WHERE ticket_id = ? ORDER BY name ASC
        "#,
    )
    .bind(ticket_id)
    .fetch_all(&state.pool)
    .await?;
    Ok(rows.iter().map(ticket_json).collect())
}

/// Order stations create tickets here. The cashier simply picks the ticket up
/// from the open-ticket list and continues to payment.
pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let client = client_from_headers(&state, &headers).await?;
    let items = body
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if items.is_empty() {
        return Err(ApiError::bad_request("Ticket tidak boleh kosong."));
    }

    let text = |key: &str| -> String {
        body.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let optional = |key: &str| -> Option<String> {
        body.get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };

    let id = Uuid::new_v4().to_string();
    let ticket_no = body
        .get("ticket_no")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "T-{}-{}",
                Utc::now().format("%y%m%d"),
                &Uuid::new_v4().simple().to_string()[..5].to_uppercase()
            )
        });

    let mut subtotal = 0i64;
    let mut clean_items = Vec::new();
    for item in &items {
        let qty = item.get("qty").and_then(Value::as_i64).unwrap_or(1).max(1);
        let price = item
            .get("unit_price_cents")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let total = item
            .get("total_cents")
            .and_then(Value::as_i64)
            .unwrap_or(price * qty);
        subtotal += total;
        clean_items.push((
            item.get("product_id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
            item.get("sku").and_then(Value::as_str).unwrap_or("").to_string(),
            item.get("name")
                .and_then(Value::as_str)
                .unwrap_or("Item")
                .to_string(),
            qty,
            price,
            total,
            item.get("note").and_then(Value::as_str).unwrap_or("").to_string(),
        ));
    }

    let mut tx = state.pool.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO pos_tickets (
          id, ticket_no, brand_id, outlet_id, client_id, created_by, created_by_name,
          table_id, table_name, sales_mode_id, sales_mode_name, customer_name, note,
          status, subtotal_cents
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
        "#,
    )
    .bind(&id)
    .bind(&ticket_no)
    .bind(&client.brand_id)
    .bind(&client.outlet_id)
    .bind(&client.id)
    .bind(optional("user_id"))
    .bind(text("user_name"))
    .bind(optional("table_id"))
    .bind(text("table_name"))
    .bind(optional("sales_mode_id"))
    .bind(text("sales_mode_name"))
    .bind(text("customer_name"))
    .bind(text("note"))
    .bind(subtotal)
    .execute(&mut *tx)
    .await?;

    for (product_id, sku, name, qty, price, total, note) in clean_items {
        sqlx::query(
            r#"
            INSERT INTO pos_ticket_items
              (id, ticket_id, product_id, sku, name, qty, unit_price_cents, total_cents, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&id)
        .bind(product_id)
        .bind(sku)
        .bind(name)
        .bind(qty)
        .bind(price)
        .bind(total)
        .bind(note)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    // Inform the whole outlet through the outbox-less realtime bus. POS clients
    // filter by outlet/table; order stations ignore their own event.
    state.publish(ServerEvent::new(
        "ticket.created",
        None,
        json!({
            "ticket_id": id,
            "ticket_no": ticket_no,
            "outlet_id": client.outlet_id,
            "table_name": text("table_name"),
            "subtotal_cents": subtotal,
        }),
    ));

    Ok(Json(json!({
        "ok": true,
        "id": id,
        "ticket_no": ticket_no,
        "subtotal_cents": subtotal,
        "items": items.len(),
    })))
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let client = client_from_headers(&state, &headers).await?;
    let status = params
        .get("status")
        .cloned()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "open".to_string());

    let rows = sqlx::query(
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', t.id, 'ticket_no', t.ticket_no, 'status', t.status,
          'brand_id', t.brand_id, 'outlet_id', t.outlet_id, 'client_id', t.client_id,
          'created_by', t.created_by, 'created_by_name', t.created_by_name,
          'table_id', t.table_id, 'table_name', t.table_name,
          'sales_mode_id', t.sales_mode_id, 'sales_mode_name', t.sales_mode_name,
          'customer_name', t.customer_name, 'note', t.note,
          'subtotal_cents', t.subtotal_cents, 'created_at', t.created_at,
          'claimed_by_name', t.claimed_by_name, 'bill_id', t.bill_id
        ) AS CHAR) AS data
        FROM pos_tickets t
        WHERE t.outlet_id = ? AND t.status = ?
        ORDER BY t.created_at ASC LIMIT 80
        "#,
    )
    .bind(&client.outlet_id)
    .bind(&status)
    .fetch_all(&state.pool)
    .await?;

    let mut data = Vec::new();
    for row in rows {
        let mut ticket = ticket_json(&row);
        let id = ticket
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let items = load_items(&state, &id).await?;
        if let Some(obj) = ticket.as_object_mut() {
            obj.insert("items".into(), Value::Array(items));
        }
        data.push(ticket);
    }

    Ok(Json(json!({ "data": data, "server_time": Utc::now() })))
}

pub async fn claim(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let client = client_from_headers(&state, &headers).await?;
    if client.kind == "order_station" {
        return Err(ApiError::forbidden(
            "Order station tidak dapat mengklaim tiket pembayaran.",
        ));
    }
    let name = body
        .get("user_name")
        .and_then(Value::as_str)
        .unwrap_or("Kasir");
    let user_id = body.get("user_id").and_then(Value::as_str);

    let result = sqlx::query(
        "UPDATE pos_tickets SET status='claimed', claimed_by=?, claimed_by_name=?, claimed_at=NOW(6) WHERE id=? AND outlet_id=? AND status='open'",
    )
    .bind(user_id)
    .bind(name)
    .bind(&id)
    .bind(&client.outlet_id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::bad_request("Ticket sudah diambil atau tidak ditemukan."));
    }

    Ok(Json(json!({ "ok": true })))
}

pub async fn cancel(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let client = client_from_headers(&state, &headers).await?;
    if client.kind == "order_station" {
        return Err(ApiError::forbidden(
            "Order station tidak dapat membatalkan tiket kasir.",
        ));
    }
    let result = sqlx::query(
        "UPDATE pos_tickets SET status='cancelled' WHERE id=? AND outlet_id=? AND status IN ('open','claimed')",
    )
    .bind(&id)
    .bind(&client.outlet_id)
    .execute(&state.pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::bad_request("Ticket tidak dapat dibatalkan."));
    }
    state.publish(ServerEvent::new(
        "ticket.cancelled",
        None,
        json!({ "ticket_id": id, "outlet_id": client.outlet_id }),
    ));
    Ok(Json(json!({ "ok": true })))
}
