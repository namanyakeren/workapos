use crate::auth::{
    require_client_by_token, token_from_headers, touch_client, ClientContext,
};
use crate::error::{ApiError, ApiResult};
use crate::state::{AppState, ServerEvent};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use chrono::{NaiveDateTime, Utc};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

/// MySQL DATETIME columns do not accept the ISO-8601 strings (`...T...Z`)
/// produced by JavaScript's `toISOString()`. Normalise every timestamp coming
/// from a terminal into a MySQL-compatible UTC datetime.
fn mysql_datetime(value: &str) -> String {
    let value = value.trim();
    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(value) {
        return parsed
            .with_timezone(&Utc)
            .format("%Y-%m-%d %H:%M:%S%.6f")
            .to_string();
    }
    if NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.6f").is_ok()
        || NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").is_ok()
    {
        return value.to_string();
    }
    if let Ok(parsed) = NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f") {
        return parsed.format("%Y-%m-%d %H:%M:%S%.6f").to_string();
    }
    Utc::now()
        .format("%Y-%m-%d %H:%M:%S%.6f")
        .to_string()
}

async fn query_json_array(
    state: &AppState,
    sql: &str,
    binds: &[&str],
) -> ApiResult<Vec<Value>> {
    let mut query = sqlx::query(sql);
    for value in binds {
        query = query.bind(*value);
    }
    let rows = query.fetch_all(&state.pool).await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let raw: String = row.try_get("data")?;
        out.push(serde_json::from_str(&raw).unwrap_or(Value::Null));
    }
    Ok(out)
}

async fn query_json_optional(
    state: &AppState,
    sql: &str,
    binds: &[&str],
) -> ApiResult<Option<Value>> {
    let mut query = sqlx::query(sql);
    for value in binds {
        query = query.bind(*value);
    }
    let row = query.fetch_optional(&state.pool).await?;
    match row {
        Some(row) => {
            let raw: String = row.try_get("data")?;
            Ok(Some(serde_json::from_str(&raw).unwrap_or(Value::Null)))
        }
        None => Ok(None),
    }
}

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

async fn display_assets_for(state: &AppState, client: &ClientContext) -> ApiResult<Vec<Value>> {
    query_json_array(
        state,
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', id, 'name', name, 'file_path', file_path, 'mime_type', mime_type,
          'size_bytes', size_bytes, 'checksum', checksum, 'sort_order', sort_order,
          'url', CONCAT('/uploads/', file_path)
        ) AS CHAR) AS data
        FROM display_assets
        WHERE active = 1 AND brand_id = ?
          AND (outlet_id IS NULL OR outlet_id = ?)
        ORDER BY sort_order ASC, uploaded_at ASC
        "#,
        &[&client.brand_id, &client.outlet_id],
    )
    .await
}

pub async fn bootstrap(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let client = client_from_headers(&state, &headers).await?;

    let brand = query_json_optional(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', id, 'name', name, 'code', code, 'logo_url', logo_url, 'color', color,
          'currency', currency, 'timezone', timezone, 'tax_rate', tax_rate,
          'service_charge_rate', service_charge_rate
        ) AS CHAR) AS data FROM brands WHERE id = ? LIMIT 1
        "#,
        &[&client.brand_id],
    )
    .await?
    .unwrap_or(Value::Null);

    let outlet = query_json_optional(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', id, 'name', name, 'code', code, 'address', address, 'phone', phone,
          'timezone', timezone
        ) AS CHAR) AS data FROM outlets WHERE id = ? LIMIT 1
        "#,
        &[&client.outlet_id],
    )
    .await?
    .unwrap_or(Value::Null);

    let client_json = query_json_optional(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', id, 'code', code, 'name', name, 'kind', kind, 'second_display', second_display,
          'slideshow_interval_seconds', slideshow_interval_seconds,
          'settings', COALESCE(CAST(settings AS CHAR), JSON_OBJECT()), 'app_version', app_version
        ) AS CHAR) AS data FROM clients WHERE id = ? LIMIT 1
        "#,
        &[&client.id],
    )
    .await?
    .unwrap_or(Value::Null);

    let product_groups = query_json_array(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT('id', id, 'name', name, 'color', color, 'icon', icon,
          'sort_order', sort_order) AS CHAR) AS data
        FROM product_groups
        WHERE active = 1 AND brand_id = ? AND (outlet_id IS NULL OR outlet_id = ?)
        ORDER BY sort_order ASC, name ASC
        "#,
        &[&client.brand_id, &client.outlet_id],
    )
    .await?;

    let products = query_json_array(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT('id', id, 'group_id', group_id, 'sku', sku, 'name', name,
          'description', description, 'price_cents', price_cents, 'image_url', image_url,
          'color', color, 'emoji', emoji, 'sort_order', sort_order) AS CHAR) AS data
        FROM products
        WHERE active = 1 AND brand_id = ? AND (outlet_id IS NULL OR outlet_id = ?)
        ORDER BY sort_order ASC, name ASC
        "#,
        &[&client.brand_id, &client.outlet_id],
    )
    .await?;

    let sales_modes = query_json_array(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT('id', id, 'name', name, 'code', code, 'icon', icon,
          'color', color, 'template', template, 'sort_order', sort_order) AS CHAR) AS data
        FROM sales_modes
        WHERE active = 1 AND brand_id = ? AND (outlet_id IS NULL OR outlet_id = ?)
        ORDER BY sort_order ASC, name ASC
        "#,
        &[&client.brand_id, &client.outlet_id],
    )
    .await?;

    let tables = query_json_array(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT('id', id, 'table_type', table_type, 'number', number,
          'name', name, 'seats', seats, 'zone', zone, 'sort_order', sort_order) AS CHAR) AS data
        FROM floor_tables
        WHERE active = 1 AND outlet_id = ?
        ORDER BY sort_order ASC, number ASC
        "#,
        &[&client.outlet_id],
    )
    .await?;

    let payment_types = query_json_array(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT('id', id, 'group_id', group_id, 'code', code, 'name', name,
          'method', method, 'icon', icon, 'requires_reference', requires_reference,
          'open_drawer', open_drawer, 'surcharge_rate', surcharge_rate,
          'sort_order', sort_order) AS CHAR) AS data
        FROM payment_types
        WHERE active = 1 AND brand_id = ? AND (outlet_id IS NULL OR outlet_id = ?)
        ORDER BY sort_order ASC, name ASC
        "#,
        &[&client.brand_id, &client.outlet_id],
    )
    .await?;

    let payment_groups = query_json_array(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT('id', id, 'name', name, 'sort_order', sort_order) AS CHAR) AS data
        FROM payment_groups
        WHERE active = 1 AND brand_id = ? AND (outlet_id IS NULL OR outlet_id = ?)
        ORDER BY sort_order ASC, name ASC
        "#,
        &[&client.brand_id, &client.outlet_id],
    )
    .await?;

    let printers = query_json_array(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT('id', id, 'name', name, 'purpose', purpose, 'ip', ip,
          'port', port, 'paper_width', paper_width, 'model', model) AS CHAR) AS data
        FROM printers p
        WHERE p.active = 1 AND p.brand_id = ?
          AND EXISTS (
            SELECT 1 FROM printer_outlets po
            WHERE po.printer_id = p.id AND po.outlet_id = ?
          )
        ORDER BY p.purpose ASC, p.name ASC
        "#,
        &[&client.brand_id, &client.outlet_id],
    )
    .await?;

    let promotions = query_json_array(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT('id', id, 'name', name, 'code', code, 'type', type,
          'scope', scope, 'target_ids', COALESCE(CAST(target_ids AS CHAR), JSON_ARRAY()),
          'value', value, 'min_subtotal_cents', min_subtotal_cents,
          'max_discount_cents', max_discount_cents, 'start_at', start_at, 'end_at', end_at,
          'auto_apply', auto_apply) AS CHAR) AS data
        FROM promotions
        WHERE active = 1 AND brand_id = ? AND (outlet_id IS NULL OR outlet_id = ?)
          AND (start_at IS NULL OR start_at <= NOW()) AND (end_at IS NULL OR end_at >= NOW())
        ORDER BY name ASC
        "#,
        &[&client.brand_id, &client.outlet_id],
    )
    .await?;

    let users = query_json_array(
        &state,
        r#"
        SELECT CAST(JSON_OBJECT('id', u.id, 'nik', u.nik, 'name', u.name,
          'pin_hash', u.pin_hash, 'role_id', u.role_id, 'role_name', r.name,
          'is_admin', r.is_admin, 'permissions', CAST(r.permissions AS CHAR),
          'avatar_color', u.avatar_color, 'brand_id', u.brand_id, 'outlet_id', u.outlet_id
        ) AS CHAR) AS data
        FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.active = 1
          AND (r.is_admin = 1 OR u.brand_id IS NULL OR u.brand_id = ?)
          AND (u.outlet_id IS NULL OR u.outlet_id = ?)
        ORDER BY r.is_admin DESC, u.name ASC
        "#,
        &[&client.brand_id, &client.outlet_id],
    )
    .await?;

    let assets = display_assets_for(&state, &client).await?;

    Ok(Json(json!({
        "client": client_json,
        "brand": brand,
        "outlet": outlet,
        "product_groups": product_groups,
        "products": products,
        "sales_modes": sales_modes,
        "tables": tables,
        "payment_groups": payment_groups,
        "payment_types": payment_types,
        "printers": printers,
        "promotions": promotions,
        "users": users,
        "display_assets": assets,
        "server_time": Utc::now(),
    })))
}

pub async fn heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let client = client_from_headers(&state, &headers).await?;
    let version = body
        .get("app_version")
        .and_then(Value::as_str)
        .unwrap_or("");
    sqlx::query(
        "UPDATE clients SET last_seen_at = NOW(6), status = 'online', app_version = ? WHERE id = ?",
    )
    .bind(version)
    .bind(&client.id)
    .execute(&state.pool)
    .await?;
    Ok(Json(json!({ "ok": true, "server_time": Utc::now() })))
}

pub async fn assets(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let client = client_from_headers(&state, &headers).await?;
    Ok(Json(json!({
        "data": display_assets_for(&state, &client).await?,
        "server_time": Utc::now(),
    })))
}

pub async fn command_ack(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let client = client_from_headers(&state, &headers).await?;
    let ok = body.get("ok").and_then(Value::as_bool).unwrap_or(true);
    sqlx::query(
        "UPDATE client_commands SET status = ?, delivered_at = NOW(6) WHERE id = ? AND client_id = ?",
    )
    .bind(if ok { "done" } else { "failed" })
    .bind(&id)
    .bind(&client.id)
    .execute(&state.pool)
    .await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn submit_sale(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let client = client_from_headers(&state, &headers).await?;
    if client.kind == "order_station" {
        return Err(ApiError::forbidden(
            "Order station hanya dapat membuat order, bukan pembayaran.",
        ));
    }
    let sale = if let Some(inner) = body.get("sale") {
        inner
    } else {
        &body
    };
    // Accept both API shapes: `{ sale: { bill, items, payments } }` and the
    // flat CompletedSale object that the Tauri/browser terminal queues offline.
    let bill_value = sale.get("bill").unwrap_or(sale);
    let bill = bill_value
        .as_object()
        .ok_or_else(|| ApiError::bad_request("Data bill tidak ditemukan."))?;

    let client_bill_id = bill
        .get("client_bill_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("client_bill_id wajib diisi."))?;

    if let Some(existing) = sqlx::query_as::<_, (String, String)>(
        "SELECT id, bill_no FROM bills WHERE client_bill_id = ? LIMIT 1",
    )
    .bind(client_bill_id)
    .fetch_optional(&state.pool)
    .await?
    {
        return Ok(Json(json!({
            "ok": true,
            "duplicate": true,
            "id": existing.0,
            "bill_no": existing.1,
        })));
    }

    let id = Uuid::new_v4().to_string();
    let bill_no = bill
        .get("bill_no")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "{}-{}",
                Utc::now().format("%y%m%d"),
                &Uuid::new_v4().simple().to_string()[..6]
            )
        });

    let num = |key: &str| -> i64 {
        bill.get(key)
            .and_then(Value::as_i64)
            .unwrap_or(0)
    };
    let text = |key: &str| -> String {
        bill.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let optional = |key: &str| -> Option<String> {
        bill.get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };

    let created_at = mysql_datetime(
        &optional("created_at").unwrap_or_else(|| Utc::now().to_rfc3339()),
    );
    let paid_at = mysql_datetime(&optional("paid_at").unwrap_or_else(|| created_at.clone()));
    let user_id = optional("user_id").or_else(|| {
        sale.get("user")
            .and_then(|user| user.get("id"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    });
    let user_name = {
        let direct = text("user_name");
        if !direct.is_empty() {
            direct
        } else {
            sale.get("user")
                .and_then(|user| user.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
        }
    };

    let mut tx = state.pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO bills (
          id, client_bill_id, bill_no, brand_id, outlet_id, client_id, user_id, user_name,
          table_id, table_name, sales_mode_id, sales_mode_name, status, subtotal_cents,
          discount_cents, service_cents, tax_cents, rounding_cents, total_cents, paid_cents,
          change_cents, payment_summary, note, customer_name, created_at, paid_at, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(6))
        "#,
    )
    .bind(&id)
    .bind(client_bill_id)
    .bind(&bill_no)
    .bind(&client.brand_id)
    .bind(&client.outlet_id)
    .bind(&client.id)
    .bind(user_id)
    .bind(&user_name)
    .bind(optional("table_id"))
    .bind(text("table_name"))
    .bind(optional("sales_mode_id"))
    .bind(text("sales_mode_name"))
    .bind({
        let status = text("status");
        if status.is_empty() { "paid".to_string() } else { status }
    })
    .bind(num("subtotal_cents"))
    .bind(num("discount_cents"))
    .bind(num("service_cents"))
    .bind(num("tax_cents"))
    .bind(num("rounding_cents"))
    .bind(num("total_cents"))
    .bind(num("paid_cents"))
    .bind(num("change_cents"))
    .bind(text("payment_summary"))
    .bind(text("note"))
    .bind(text("customer_name"))
    .bind(created_at)
    .bind(&paid_at)
    .execute(&mut *tx)
    .await?;

    let items = sale
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for item in &items {
        let item_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO bill_items (id, bill_id, product_id, sku, name, qty,
              unit_price_cents, discount_cents, total_cents, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(item_id)
        .bind(&id)
        .bind(item.get("product_id").and_then(Value::as_str).filter(|s| !s.is_empty()))
        .bind(item.get("sku").and_then(Value::as_str).unwrap_or(""))
        .bind(item.get("name").and_then(Value::as_str).unwrap_or("Item"))
        .bind(item.get("qty").and_then(Value::as_i64).unwrap_or(1))
        .bind(item.get("unit_price_cents").and_then(Value::as_i64).unwrap_or(0))
        .bind(item.get("discount_cents").and_then(Value::as_i64).unwrap_or(0))
        .bind(item.get("total_cents").and_then(Value::as_i64).unwrap_or(0))
        .bind(item.get("note").and_then(Value::as_str).unwrap_or(""))
        .execute(&mut *tx)
        .await?;
    }

    let payments = sale
        .get("payments")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for payment in &payments {
        let payment_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO payments (id, bill_id, payment_type_id, method, name, amount_cents, reference)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(payment_id)
        .bind(&id)
        .bind(payment.get("payment_type_id").and_then(Value::as_str).filter(|s| !s.is_empty()))
        .bind(payment.get("method").and_then(Value::as_str).unwrap_or("cash"))
        .bind(payment.get("name").and_then(Value::as_str).unwrap_or("Payment"))
        .bind(payment.get("amount_cents").and_then(Value::as_i64).unwrap_or(0))
        .bind(payment.get("reference").and_then(Value::as_str).unwrap_or(""))
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    // If this sale originated from an order-station ticket, close the ticket.
    let ticket_id = sale
        .get("ticket_id")
        .and_then(Value::as_str)
        .or_else(|| bill.get("ticket_id").and_then(Value::as_str));
    if let Some(ticket_id) = ticket_id.filter(|value| !value.is_empty()) {
        let _ = sqlx::query(
            "UPDATE pos_tickets SET status='paid', bill_id=? WHERE id=? AND outlet_id=? AND status IN ('open','claimed')",
        )
        .bind(&id)
        .bind(ticket_id)
        .bind(&client.outlet_id)
        .execute(&state.pool)
        .await;
        state.publish(ServerEvent::new(
            "ticket.paid",
            None,
            json!({
                "ticket_id": ticket_id,
                "bill_id": id,
                "outlet_id": client.outlet_id,
                "bill_no": bill_no,
            }),
        ));
    }

    let event_data = json!({
        "id": id,
        "bill_no": bill_no,
        "brand_id": client.brand_id,
        "outlet_id": client.outlet_id,
        "client_id": client.id,
        "client_name": client.name,
        "total_cents": num("total_cents"),
        "status": "paid",
        "paid_at": paid_at,
        "bill": sale,
    });
    state.publish(ServerEvent::new(
        "sale.created",
        Some(client.id.clone()),
        event_data,
    ));

    Ok(Json(json!({
        "ok": true,
        "duplicate": false,
        "id": id,
        "bill_no": bill_no,
    })))
}

pub async fn sync_sales(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let _client = client_from_headers(&state, &headers).await?;
    let sales = body
        .get("sales")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut results = Vec::new();
    // Process one-by-one so a single malformed offline bill never blocks the queue.
    for sale in sales {
        let client_bill_id = sale
            .get("bill")
            .and_then(|b| b.get("client_bill_id"))
            .or_else(|| sale.get("client_bill_id"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let bill_no = sale
            .get("bill")
            .and_then(|b| b.get("bill_no"))
            .or_else(|| sale.get("bill_no"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let wrapped = Json(json!({ "sale": sale }));
        match submit_sale(State(state.clone()), headers.clone(), wrapped).await {
            Ok(Json(value)) => {
                let resolved = value
                    .get("bill_no")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(&bill_no)
                    .to_string();
                results.push(json!({
                    "client_bill_id": client_bill_id,
                    "bill_no": resolved,
                    "ok": true,
                    "result": value,
                }));
            }
            Err(error) => results.push(json!({
                "client_bill_id": client_bill_id,
                "bill_no": bill_no,
                "ok": false,
                "error": error.message,
            })),
        }
    }

    Ok(Json(json!({ "data": results })))
}
