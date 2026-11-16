use crate::auth::AdminUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{MySql, QueryBuilder, Row};
use std::collections::HashSet;

#[derive(Debug, Deserialize)]
pub struct OutletSelection {
    #[serde(default)]
    pub outlet_ids: Vec<String>,
}

async fn printer_brand(state: &AppState, printer_id: &str) -> ApiResult<String> {
    sqlx::query_scalar::<_, String>("SELECT brand_id FROM printers WHERE id = ? LIMIT 1")
        .bind(printer_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("Printer tidak ditemukan."))
}

async fn selection_json(state: &AppState, printer_id: &str, brand_id: &str) -> ApiResult<Value> {
    let rows = sqlx::query(
        r#"
        SELECT o.id, o.name, o.code, o.active
        FROM printer_outlets po
        JOIN outlets o ON o.id = po.outlet_id
        WHERE po.printer_id = ?
        ORDER BY o.name ASC
        "#,
    )
    .bind(printer_id)
    .fetch_all(&state.pool)
    .await?;

    let mut outlets = Vec::with_capacity(rows.len());
    let mut outlet_ids = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.try_get("id")?;
        let name: String = row.try_get("name")?;
        let code: String = row.try_get("code")?;
        let active: bool = row.try_get("active")?;
        outlet_ids.push(id.clone());
        outlets.push(json!({
            "id": id,
            "name": name,
            "code": code,
            "active": active,
        }));
    }

    Ok(json!({
        "printer_id": printer_id,
        "brand_id": brand_id,
        "outlet_ids": outlet_ids,
        "outlets": outlets,
    }))
}

pub async fn get_outlets(
    State(state): State<AppState>,
    Path(printer_id): Path<String>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let brand_id = printer_brand(&state, &printer_id).await?;
    Ok(Json(json!({
        "data": selection_json(&state, &printer_id, &brand_id).await?
    })))
}

pub async fn set_outlets(
    State(state): State<AppState>,
    Path(printer_id): Path<String>,
    _admin: AdminUser,
    Json(body): Json<OutletSelection>,
) -> ApiResult<Json<Value>> {
    let brand_id = printer_brand(&state, &printer_id).await?;

    let mut seen = HashSet::new();
    let ids: Vec<String> = body
        .outlet_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .filter(|id| seen.insert(id.clone()))
        .collect();

    if !ids.is_empty() {
        let mut qb = QueryBuilder::<MySql>::new(
            "SELECT COUNT(*) FROM outlets WHERE brand_id = ",
        );
        qb.push_bind(brand_id.clone()).push(" AND id IN (");
        let mut separated = qb.separated(", ");
        for id in &ids {
            separated.push_bind(id.clone());
        }
        separated.push_unseparated(")");
        let valid: i64 = qb.build_query_scalar().fetch_one(&state.pool).await?;
        if valid != ids.len() as i64 {
            return Err(ApiError::bad_request(
                "Ada outlet yang tidak valid untuk brand printer ini.",
            ));
        }
    }

    let mut tx = state.pool.begin().await?;
    sqlx::query("DELETE FROM printer_outlets WHERE printer_id = ?")
        .bind(&printer_id)
        .execute(&mut *tx)
        .await?;
    for outlet_id in &ids {
        sqlx::query(
            "INSERT INTO printer_outlets (printer_id, outlet_id) VALUES (?, ?)",
        )
        .bind(&printer_id)
        .bind(outlet_id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("UPDATE printers SET updated_at = NOW(6) WHERE id = ?")
        .bind(&printer_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Json(json!({
        "data": selection_json(&state, &printer_id, &brand_id).await?
    })))
}
