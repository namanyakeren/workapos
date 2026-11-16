use crate::auth::AdminUser;
use crate::error::{ApiError, ApiResult};
use crate::resources::{find, Resource};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde_json::{json, Value};
use sqlx::{MySql, QueryBuilder, Row};
use std::collections::HashMap;
use uuid::Uuid;

fn resource_or_404(key: &str) -> ApiResult<&'static Resource> {
    find(key).ok_or_else(|| ApiError::not_found("Jenis data tidak dikenal."))
}

fn normalize(field: &str, value: &Value) -> Value {
    if let Some(s) = value.as_str() {
        if s.is_empty()
            && (field.ends_with("_id")
                || field.ends_with("_at")
                || field == "max_discount_cents"
                || field == "image_url"
                || field == "logo_url")
        {
            return Value::Null;
        }
    }
    value.clone()
}

fn push_json_bind(qb: &mut QueryBuilder<'_, MySql>, value: &Value) {
    match value {
        Value::Null => {
            qb.push_bind(Option::<String>::None);
        }
        Value::Bool(v) => {
            qb.push_bind(if *v { 1_i64 } else { 0_i64 });
        }
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                qb.push_bind(i);
            } else if let Some(f) = n.as_f64() {
                qb.push_bind(f);
            } else {
                qb.push_bind(n.to_string());
            }
        }
        Value::String(s) => {
            qb.push_bind(s.clone());
        }
        other => {
            qb.push_bind(other.to_string());
        }
    }
}

async fn fetch_one(state: &AppState, resource: &Resource, id: &str) -> ApiResult<Value> {
    let mut qb = QueryBuilder::<MySql>::new("SELECT CAST(JSON_OBJECT(");
    for (i, col) in resource.columns.iter().enumerate() {
        if i > 0 {
            qb.push(", ");
        }
        qb.push("'").push(*col).push("', ").push(*col);
    }
    qb.push(") AS CHAR) AS data FROM ")
        .push(resource.table)
        .push(" WHERE id = ")
        .push_bind(id.to_string())
        .push(" LIMIT 1");

    let row = qb
        .build()
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("Data tidak ditemukan."))?;
    let raw: String = row.try_get("data")?;
    serde_json::from_str(&raw)
        .map_err(|_| ApiError::internal("Format data tidak dapat dibaca."))
}

pub async fn list(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let resource = resource_or_404(&key)?;

    let mut qb = QueryBuilder::<MySql>::new("SELECT CAST(JSON_OBJECT(");
    for (i, col) in resource.columns.iter().enumerate() {
        if i > 0 {
            qb.push(", ");
        }
        qb.push("'").push(*col).push("', ").push(*col);
    }
    qb.push(") AS CHAR) AS data FROM ")
        .push(resource.table)
        .push(" WHERE 1=1");

    for (key, value) in &params {
        if key == "q" {
            if value.trim().is_empty() {
                continue;
            }
            qb.push(" AND (");
            for (i, field) in resource.search.iter().enumerate() {
                if i > 0 {
                    qb.push(" OR ");
                }
                qb.push(*field).push(" LIKE ");
                qb.push_bind(format!("%{}%", value.trim()));
            }
            qb.push(")");
        } else if key == "from" && resource.columns.contains(&"created_at") {
            qb.push(" AND created_at >= ").push_bind(value.clone());
        } else if key == "to" && resource.columns.contains(&"created_at") {
            qb.push(" AND created_at <= ").push_bind(value.clone());
        } else if key != "limit" && resource.columns.contains(&key.as_str()) {
            if value == "null" {
                qb.push(" AND ").push(key.as_str()).push(" IS NULL");
            } else {
                qb.push(" AND ").push(key.as_str()).push(" = ").push_bind(value.clone());
            }
        }
    }

    qb.push(" ORDER BY ").push(resource.order).push(" LIMIT 1000");

    let rows = qb.build().fetch_all(&state.pool).await?;
    let mut data = Vec::with_capacity(rows.len());
    for row in rows {
        let raw: String = row.try_get("data")?;
        let value: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        data.push(value);
    }

    if resource.key == "printers" && !data.is_empty() {
        let assignments = sqlx::query(
            r#"
            SELECT po.printer_id, o.id AS outlet_id, o.name AS outlet_name
            FROM printer_outlets po
            JOIN outlets o ON o.id = po.outlet_id
            ORDER BY o.name ASC
            "#,
        )
        .fetch_all(&state.pool)
        .await?;

        let mut by_printer: HashMap<String, Vec<Value>> = HashMap::new();
        for row in assignments {
            let printer_id: String = row.try_get("printer_id")?;
            let outlet_id: String = row.try_get("outlet_id")?;
            let outlet_name: String = row.try_get("outlet_name")?;
            by_printer
                .entry(printer_id)
                .or_default()
                .push(json!({ "id": outlet_id, "name": outlet_name }));
        }

        for item in data.iter_mut() {
            if let Some(obj) = item.as_object_mut() {
                let id = obj
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let outlets = by_printer.remove(&id).unwrap_or_default();
                obj.insert("outlets".to_string(), Value::Array(outlets));
            }
        }
    }

    Ok(Json(json!({ "data": data })))
}

pub async fn get(
    State(state): State<AppState>,
    Path((key, id)): Path<(String, String)>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let resource = resource_or_404(&key)?;
    Ok(Json(json!({ "data": fetch_one(&state, resource, &id).await? })))
}

pub async fn create(
    State(state): State<AppState>,
    Path(key): Path<String>,
    _admin: AdminUser,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let resource = resource_or_404(&key)?;
    let obj = body
        .as_object()
        .ok_or_else(|| ApiError::bad_request("Payload harus berupa object."))?;

    for required in resource.required {
        let missing = obj
            .get(*required)
            .map(|v| v.is_null() || v.as_str().map(str::is_empty).unwrap_or(false))
            .unwrap_or(true);
        if missing {
            return Err(ApiError::bad_request(format!(
                "Field '{}' wajib diisi.",
                required
            )));
        }
    }

    let id = obj
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let mut columns = vec!["id"];
    let mut values = vec![Value::String(id.clone())];

    for field in resource.mutable {
        if let Some(value) = obj.get(*field) {
            columns.push(*field);
            values.push(normalize(field, value));
        }
    }

    if resource.auto_token && !columns.contains(&"token") {
        columns.push("token");
        values.push(Value::String(format!(
            "{}{}",
            Uuid::new_v4().simple(),
            Uuid::new_v4().simple()
        )));
    }

    let mut qb = QueryBuilder::<MySql>::new("INSERT INTO ");
    qb.push(resource.table).push(" (");
    for (i, col) in columns.iter().enumerate() {
        if i > 0 {
            qb.push(", ");
        }
        qb.push(*col);
    }
    qb.push(") VALUES (");
    for (i, value) in values.iter().enumerate() {
        if i > 0 {
            qb.push(", ");
        }
        push_json_bind(&mut qb, value);
    }
    qb.push(")");
    qb.build().execute(&state.pool).await?;

    Ok(Json(json!({ "data": fetch_one(&state, resource, &id).await? })))
}

pub async fn update(
    State(state): State<AppState>,
    Path((key, id)): Path<(String, String)>,
    _admin: AdminUser,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let resource = resource_or_404(&key)?;
    let obj = body
        .as_object()
        .ok_or_else(|| ApiError::bad_request("Payload harus berupa object."))?;

    let mut sets: Vec<(&str, Value)> = Vec::new();
    for field in resource.mutable {
        if let Some(value) = obj.get(*field) {
            sets.push((*field, normalize(field, value)));
        }
    }
    if sets.is_empty() {
        return Err(ApiError::bad_request("Tidak ada field yang diubah."));
    }

    let mut qb = QueryBuilder::<MySql>::new("UPDATE ");
    qb.push(resource.table).push(" SET ");
    for (i, (col, value)) in sets.iter().enumerate() {
        if i > 0 {
            qb.push(", ");
        }
        qb.push(*col).push(" = ");
        push_json_bind(&mut qb, value);
    }
    qb.push(" WHERE id = ").push_bind(id.clone());

    let result = qb.build().execute(&state.pool).await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("Data tidak ditemukan."));
    }

    Ok(Json(json!({ "data": fetch_one(&state, resource, &id).await? })))
}

pub async fn delete(
    State(state): State<AppState>,
    Path((key, id)): Path<(String, String)>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let resource = resource_or_404(&key)?;
    let sql = if resource.soft_delete && resource.columns.contains(&"active") {
        format!("UPDATE {} SET active = 0 WHERE id = ?", resource.table)
    } else {
        format!("DELETE FROM {} WHERE id = ?", resource.table)
    };
    let result = sqlx::query(&sql).bind(&id).execute(&state.pool).await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("Data tidak ditemukan."));
    }
    Ok(Json(json!({ "ok": true })))
}
