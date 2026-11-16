use crate::auth::AdminUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{FromRow, MySql, QueryBuilder, Row};
use std::collections::HashMap;

#[derive(Debug, FromRow, Serialize)]
struct Totals {
    bills: i64,
    subtotal_cents: i64,
    discount_cents: i64,
    service_cents: i64,
    tax_cents: i64,
    total_cents: i64,
    paid_cents: i64,
}

#[derive(Debug, FromRow, Serialize)]
struct SeriesRow {
    label: String,
    sales_cents: i64,
    bills: i64,
}

fn range(params: &HashMap<String, String>) -> (String, String) {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let from = params
        .get("from")
        .cloned()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| today.clone());
    let to = params
        .get("to")
        .cloned()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| today);
    (from, to)
}

pub async fn dashboard(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let today: (i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), CAST(COALESCE(SUM(total_cents),0) AS SIGNED), COALESCE(CAST(AVG(total_cents) AS SIGNED),0) FROM bills WHERE status = 'paid' AND paid_at >= CURDATE()",
    )
    .fetch_one(&state.pool)
    .await?;
    let yesterday: (i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), CAST(COALESCE(SUM(total_cents),0) AS SIGNED), COALESCE(CAST(AVG(total_cents) AS SIGNED),0) FROM bills WHERE status = 'paid' AND paid_at >= CURDATE() - INTERVAL 1 DAY AND paid_at < CURDATE()",
    )
    .fetch_one(&state.pool)
    .await?;
    let growth = if yesterday.1 > 0 {
        ((today.1 as f64 - yesterday.1 as f64) / yesterday.1 as f64) * 100.0
    } else {
        0.0
    };

    let brands: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM brands WHERE active = 1")
        .fetch_one(&state.pool)
        .await?;
    let outlets: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM outlets WHERE active = 1")
        .fetch_one(&state.pool)
        .await?;
    let products: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM products WHERE active = 1")
        .fetch_one(&state.pool)
        .await?;
    let users: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE active = 1")
        .fetch_one(&state.pool)
        .await?;
    let clients: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM clients WHERE active = 1")
        .fetch_one(&state.pool)
        .await?;
    let online: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM clients WHERE active = 1 AND last_seen_at >= NOW() - INTERVAL 2 MINUTE",
    )
    .fetch_one(&state.pool)
    .await?;
    let queued: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM client_commands WHERE status = 'queued'")
            .fetch_one(&state.pool)
            .await?;

    let hourly = sqlx::query_as::<_, SeriesRow>(
        r#"
        SELECT DATE_FORMAT(paid_at, '%H:00') AS label,
               CAST(COALESCE(SUM(total_cents),0) AS SIGNED) AS sales_cents, COUNT(*) AS bills
        FROM bills WHERE status='paid' AND paid_at >= CURDATE()
        GROUP BY DATE_FORMAT(paid_at, '%H:00') ORDER BY DATE_FORMAT(paid_at, '%H:00')
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    let daily = sqlx::query_as::<_, SeriesRow>(
        r#"
        SELECT DATE_FORMAT(paid_at, '%Y-%m-%d') AS label,
               CAST(COALESCE(SUM(total_cents),0) AS SIGNED) AS sales_cents, COUNT(*) AS bills
        FROM bills WHERE status='paid' AND paid_at >= CURDATE() - INTERVAL 6 DAY
        GROUP BY DATE_FORMAT(paid_at, '%Y-%m-%d') ORDER BY DATE_FORMAT(paid_at, '%Y-%m-%d')
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    let top_products = sqlx::query(
        r#"
        SELECT CAST(JSON_OBJECT('name', bi.name, 'qty', SUM(bi.qty),
          'sales_cents', SUM(bi.total_cents)) AS CHAR) AS data
        FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
        WHERE b.status='paid' AND b.paid_at >= CURDATE()
        GROUP BY bi.product_id, bi.name ORDER BY SUM(bi.total_cents) DESC LIMIT 8
        "#,
    )
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .filter_map(|row| row.try_get::<String, _>("data").ok())
    .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
    .collect::<Vec<_>>();

    let brand_perf = sqlx::query(
        r#"
        SELECT CAST(JSON_OBJECT('id', b.id, 'name', b.name, 'color', b.color,
          'sales_cents', COALESCE(SUM(bi.total_cents),0), 'bills', COUNT(bi.id)) AS CHAR) AS data
        FROM brands b
        LEFT JOIN bills bi ON bi.brand_id = b.id AND bi.status='paid' AND bi.paid_at >= CURDATE()
        WHERE b.active = 1
        GROUP BY b.id, b.name, b.color ORDER BY SUM(bi.total_cents) DESC
        "#,
    )
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .filter_map(|row| row.try_get::<String, _>("data").ok())
    .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
    .collect::<Vec<_>>();

    let outlet_perf = sqlx::query(
        r#"
        SELECT CAST(JSON_OBJECT('id', o.id, 'name', o.name, 'brand_id', o.brand_id,
          'brand_name', b.name, 'sales_cents', COALESCE(SUM(bi.total_cents),0),
          'bills', COUNT(bi.id)) AS CHAR) AS data
        FROM outlets o JOIN brands b ON b.id = o.brand_id
        LEFT JOIN bills bi ON bi.outlet_id = o.id AND bi.status='paid' AND bi.paid_at >= CURDATE()
        WHERE o.active = 1
        GROUP BY o.id, o.name, o.brand_id, b.name ORDER BY SUM(bi.total_cents) DESC LIMIT 10
        "#,
    )
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .filter_map(|row| row.try_get::<String, _>("data").ok())
    .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
    .collect::<Vec<_>>();

    let recent = sqlx::query(
        r#"
        SELECT CAST(JSON_OBJECT('id', b.id, 'bill_no', b.bill_no, 'total_cents', b.total_cents,
          'status', b.status, 'paid_at', b.paid_at, 'brand_name', br.name,
          'outlet_name', o.name, 'client_name', c.name, 'user_name', b.user_name,
          'table_name', b.table_name, 'sales_mode_name', b.sales_mode_name,
          'payment_summary', b.payment_summary) AS CHAR) AS data
        FROM bills b JOIN brands br ON br.id=b.brand_id JOIN outlets o ON o.id=b.outlet_id
        JOIN clients c ON c.id=b.client_id
        ORDER BY b.created_at DESC LIMIT 12
        "#,
    )
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .filter_map(|row| row.try_get::<String, _>("data").ok())
    .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
    .collect::<Vec<_>>();

    Ok(Json(json!({
        "today": {
            "sales_cents": today.1,
            "bills": today.0,
            "avg_cents": today.2,
            "growth_pct": (growth * 10.0).round() / 10.0,
        },
        "yesterday": { "sales_cents": yesterday.1, "bills": yesterday.0 },
        "counts": {
            "brands": brands.0, "outlets": outlets.0, "products": products.0,
            "users": users.0, "clients": clients.0, "online_clients": online.0,
            "queued_commands": queued.0
        },
        "hourly": hourly,
        "daily": daily,
        "top_products": top_products,
        "brands": brand_perf,
        "outlets": outlet_perf,
        "recent_bills": recent,
        "server_time": chrono::Utc::now(),
    })))
}

fn push_filters(
    qb: &mut QueryBuilder<'_, MySql>,
    params: &HashMap<String, String>,
) {
    if let Some(value) = params.get("brand_id").filter(|v| !v.is_empty()) {
        qb.push(" AND b.brand_id = ").push_bind(value.clone());
    }
    if let Some(value) = params.get("outlet_id").filter(|v| !v.is_empty()) {
        qb.push(" AND b.outlet_id = ").push_bind(value.clone());
    }
    if let Some(value) = params.get("client_id").filter(|v| !v.is_empty()) {
        qb.push(" AND b.client_id = ").push_bind(value.clone());
    }
}

pub async fn sales_report(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let (from, to) = range(&params);

    let mut totals_qb = QueryBuilder::<MySql>::new(
        "SELECT COUNT(*) AS bills, CAST(COALESCE(SUM(b.subtotal_cents),0) AS SIGNED) AS subtotal_cents, \
         CAST(COALESCE(SUM(b.discount_cents),0) AS SIGNED) AS discount_cents, CAST(COALESCE(SUM(b.service_cents),0) AS SIGNED) AS service_cents, \
         CAST(COALESCE(SUM(b.tax_cents),0) AS SIGNED) AS tax_cents, CAST(COALESCE(SUM(b.total_cents),0) AS SIGNED) AS total_cents, \
         CAST(COALESCE(SUM(b.paid_cents),0) AS SIGNED) AS paid_cents FROM bills b \
         WHERE b.status='paid' AND b.paid_at >= ",
    );
    totals_qb.push_bind(format!("{} 00:00:00", from));
    totals_qb.push(" AND b.paid_at < DATE_ADD(").push_bind(format!("{} 00:00:00", to)).push(", INTERVAL 1 DAY)");
    push_filters(&mut totals_qb, &params);
    let totals: Totals = totals_qb
        .build_query_as()
        .fetch_one(&state.pool)
        .await?;

    let group = params
        .get("group_by")
        .map(String::as_str)
        .unwrap_or("day");

    let mut qb = QueryBuilder::<MySql>::new("");
    match group {
        "hour" => {
            qb.push(
                "SELECT DATE_FORMAT(b.paid_at, '%H:00') AS label, CAST(COALESCE(SUM(b.total_cents),0) AS SIGNED) AS sales_cents, COUNT(*) AS bills FROM bills b WHERE b.status='paid' AND b.paid_at >= ",
            );
        }
        "brand" => {
            qb.push(
                "SELECT br.name AS label, CAST(COALESCE(SUM(b.total_cents),0) AS SIGNED) AS sales_cents, COUNT(*) AS bills FROM bills b JOIN brands br ON br.id=b.brand_id WHERE b.status='paid' AND b.paid_at >= ",
            );
        }
        "outlet" => {
            qb.push(
                "SELECT CONCAT(br.name, ' · ', o.name) AS label, CAST(COALESCE(SUM(b.total_cents),0) AS SIGNED) AS sales_cents, COUNT(*) AS bills FROM bills b JOIN brands br ON br.id=b.brand_id JOIN outlets o ON o.id=b.outlet_id WHERE b.status='paid' AND b.paid_at >= ",
            );
        }
        "product" => {
            qb.push(
                "SELECT bi.name AS label, CAST(COALESCE(SUM(bi.total_cents),0) AS SIGNED) AS sales_cents, CAST(COALESCE(SUM(bi.qty),0) AS SIGNED) AS bills FROM bill_items bi JOIN bills b ON b.id=bi.bill_id WHERE b.status='paid' AND b.paid_at >= ",
            );
        }
        "payment" => {
            qb.push(
                "SELECT p.name AS label, CAST(COALESCE(SUM(p.amount_cents),0) AS SIGNED) AS sales_cents, COUNT(DISTINCT p.bill_id) AS bills FROM payments p JOIN bills b ON b.id=p.bill_id WHERE b.status='paid' AND b.paid_at >= ",
            );
        }
        _ => {
            qb.push(
                "SELECT DATE_FORMAT(b.paid_at, '%Y-%m-%d') AS label, CAST(COALESCE(SUM(b.total_cents),0) AS SIGNED) AS sales_cents, COUNT(*) AS bills FROM bills b WHERE b.status='paid' AND b.paid_at >= ",
            );
        }
    }
    qb.push_bind(format!("{} 00:00:00", from));
    qb.push(" AND b.paid_at < DATE_ADD(")
        .push_bind(format!("{} 00:00:00", to))
        .push(", INTERVAL 1 DAY)");
    push_filters(&mut qb, &params);
    if group == "hour" {
        qb.push(" GROUP BY DATE_FORMAT(b.paid_at, '%H:00') ORDER BY DATE_FORMAT(b.paid_at, '%H:00')");
    } else if group == "brand" {
        qb.push(" GROUP BY br.id, br.name ORDER BY SUM(b.total_cents) DESC");
    } else if group == "outlet" {
        qb.push(" GROUP BY o.id, br.name, o.name ORDER BY SUM(b.total_cents) DESC");
    } else if group == "product" {
        qb.push(" GROUP BY bi.name ORDER BY SUM(bi.total_cents) DESC LIMIT 30");
    } else if group == "payment" {
        qb.push(" GROUP BY p.name ORDER BY SUM(p.amount_cents) DESC");
    } else {
        qb.push(" GROUP BY DATE_FORMAT(b.paid_at, '%Y-%m-%d') ORDER BY DATE_FORMAT(b.paid_at, '%Y-%m-%d')");
    }

    let series: Vec<SeriesRow> = qb
        .build_query_as()
        .fetch_all(&state.pool)
        .await?;

    Ok(Json(json!({
        "from": from,
        "to": to,
        "group_by": group,
        "totals": totals,
        "series": series,
    })))
}

pub async fn bills_report(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let (from, to) = range(&params);
    let mut qb = QueryBuilder::<MySql>::new(
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', b.id, 'bill_no', b.bill_no, 'total_cents', b.total_cents,
          'subtotal_cents', b.subtotal_cents, 'discount_cents', b.discount_cents,
          'tax_cents', b.tax_cents, 'service_cents', b.service_cents,
          'status', b.status, 'paid_at', b.paid_at, 'created_at', b.created_at,
          'brand_name', br.name, 'outlet_name', o.name, 'client_name', c.name,
          'user_name', b.user_name, 'table_name', b.table_name,
          'sales_mode_name', b.sales_mode_name, 'payment_summary', b.payment_summary,
          'items', (SELECT COALESCE(SUM(bi.qty),0) FROM bill_items bi WHERE bi.bill_id=b.id)
        ) AS CHAR) AS data
        FROM bills b
        JOIN brands br ON br.id=b.brand_id
        JOIN outlets o ON o.id=b.outlet_id
        JOIN clients c ON c.id=b.client_id
        WHERE b.paid_at >= 
        "#,
    );
    qb.push_bind(format!("{} 00:00:00", from));
    qb.push(" AND b.paid_at < DATE_ADD(")
        .push_bind(format!("{} 00:00:00", to))
        .push(", INTERVAL 1 DAY)");
    push_filters(&mut qb, &params);
    if let Some(search) = params.get("q").filter(|v| !v.trim().is_empty()) {
        qb.push(" AND (b.bill_no LIKE ").push_bind(format!("%{}%", search.trim()));
        qb.push(" OR c.name LIKE ").push_bind(format!("%{}%", search.trim()));
        qb.push(" OR b.user_name LIKE ").push_bind(format!("%{}%", search.trim()));
        qb.push(" OR b.table_name LIKE ").push_bind(format!("%{}%", search.trim())).push(")");
    }
    qb.push(" ORDER BY b.paid_at DESC LIMIT 500");

    let rows = qb.build().fetch_all(&state.pool).await?;
    let data: Vec<Value> = rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("data").ok())
        .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
        .collect();

    Ok(Json(json!({ "data": data, "from": from, "to": to })))
}

pub async fn bill_detail(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query(
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', b.id, 'bill_no', b.bill_no, 'client_bill_id', b.client_bill_id,
          'subtotal_cents', b.subtotal_cents, 'discount_cents', b.discount_cents,
          'service_cents', b.service_cents, 'tax_cents', b.tax_cents,
          'rounding_cents', b.rounding_cents, 'total_cents', b.total_cents,
          'paid_cents', b.paid_cents, 'change_cents', b.change_cents,
          'status', b.status, 'paid_at', b.paid_at, 'created_at', b.created_at,
          'brand_name', br.name, 'outlet_name', o.name, 'client_name', c.name,
          'user_name', b.user_name, 'table_name', b.table_name,
          'sales_mode_name', b.sales_mode_name, 'payment_summary', b.payment_summary,
          'note', b.note, 'customer_name', b.customer_name
        ) AS CHAR) AS data
        FROM bills b JOIN brands br ON br.id=b.brand_id JOIN outlets o ON o.id=b.outlet_id
        JOIN clients c ON c.id=b.client_id WHERE b.id = ? LIMIT 1
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Bill tidak ditemukan."))?;

    let raw: String = row.try_get("data")?;
    let mut bill: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);

    let item_rows = sqlx::query(
        r#"
        SELECT CAST(JSON_OBJECT('id', id, 'sku', sku, 'name', name, 'qty', qty,
          'unit_price_cents', unit_price_cents, 'discount_cents', discount_cents,
          'total_cents', total_cents, 'note', note) AS CHAR) AS data
        FROM bill_items WHERE bill_id = ? ORDER BY name ASC
        "#,
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;
    let items: Vec<Value> = item_rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("data").ok())
        .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
        .collect();

    let payment_rows = sqlx::query(
        r#"
        SELECT CAST(JSON_OBJECT('id', id, 'method', method, 'name', name,
          'amount_cents', amount_cents, 'reference', reference, 'created_at', created_at)
          AS CHAR) AS data
        FROM payments WHERE bill_id = ? ORDER BY created_at ASC
        "#,
    )
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;
    let payments: Vec<Value> = payment_rows
        .into_iter()
        .filter_map(|row| row.try_get::<String, _>("data").ok())
        .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
        .collect();

    if let Some(obj) = bill.as_object_mut() {
        obj.insert("items".into(), Value::Array(items));
        obj.insert("payments".into(), Value::Array(payments));
    }

    Ok(Json(json!({ "data": bill })))
}
