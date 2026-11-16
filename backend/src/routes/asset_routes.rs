use crate::auth::AdminUser;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::extract::{Multipart, Path, Query, State};
use axum::Json;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::Row;
use std::collections::HashMap;
use uuid::Uuid;

fn safe_ext(file_name: &str, mime: &str) -> String {
    let from_name = std::path::Path::new(file_name)
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_lowercase())
        .filter(|v| matches!(v.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif" | "avif"));
    if let Some(ext) = from_name {
        return ext;
    }
    match mime {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/avif" => "avif",
        _ => "jpg",
    }
    .to_string()
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let mut sql = String::from(
        r#"
        SELECT CAST(JSON_OBJECT(
          'id', a.id, 'brand_id', a.brand_id, 'outlet_id', a.outlet_id,
          'brand_name', b.name, 'outlet_name', o.name, 'name', a.name,
          'file_path', a.file_path, 'mime_type', a.mime_type, 'size_bytes', a.size_bytes,
          'checksum', a.checksum, 'sort_order', a.sort_order, 'active', a.active,
          'uploaded_at', a.uploaded_at, 'url', CONCAT('/uploads/', a.file_path)
        ) AS CHAR) AS data
        FROM display_assets a
        JOIN brands b ON b.id = a.brand_id
        LEFT JOIN outlets o ON o.id = a.outlet_id
        WHERE 1=1
        "#,
    );
    if params.contains_key("brand_id") {
        sql.push_str(" AND a.brand_id = ?");
    }
    if params.contains_key("outlet_id") {
        sql.push_str(" AND a.outlet_id = ?");
    }
    sql.push_str(" ORDER BY a.sort_order ASC, a.uploaded_at DESC");

    let mut q = sqlx::query(&sql);
    if let Some(value) = params.get("brand_id") {
        q = q.bind(value);
    }
    if let Some(value) = params.get("outlet_id") {
        q = q.bind(value);
    }
    let rows = q.fetch_all(&state.pool).await?;
    let mut data = Vec::new();
    for row in rows {
        let raw: String = row.try_get("data")?;
        data.push(serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null));
    }
    Ok(Json(json!({ "data": data })))
}

pub async fn upload(
    State(state): State<AppState>,
    _admin: AdminUser,
    mut multipart: Multipart,
) -> ApiResult<Json<Value>> {
    let mut brand_id: Option<String> = None;
    let mut outlet_id: Option<String> = None;
    let mut name: Option<String> = None;
    let mut sort_order: i64 = 0;
    let mut file_name = String::from("display.jpg");
    let mut mime = String::from("image/jpeg");
    let mut bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| ApiError::bad_request("Upload tidak valid."))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        match field_name.as_str() {
            "brand_id" => brand_id = Some(field.text().await.unwrap_or_default()),
            "outlet_id" => {
                let value = field.text().await.unwrap_or_default();
                if !value.is_empty() {
                    outlet_id = Some(value);
                }
            }
            "name" => name = Some(field.text().await.unwrap_or_default()),
            "sort_order" => {
                sort_order = field
                    .text()
                    .await
                    .unwrap_or_default()
                    .parse()
                    .unwrap_or(0)
            }
            "file" => {
                if let Some(value) = field.file_name() {
                    file_name = value.to_string();
                }
                if let Some(value) = field.content_type() {
                    mime = value.to_string();
                }
                let data = field
                    .bytes()
                    .await
                    .map_err(|_| ApiError::bad_request("File gagal dibaca."))?;
                bytes = Some(data.to_vec());
            }
            _ => {}
        }
    }

    let brand_id = brand_id
        .filter(|v| !v.is_empty())
        .ok_or_else(|| ApiError::bad_request("Brand wajib dipilih."))?;
    let bytes = bytes.ok_or_else(|| ApiError::bad_request("File gambar wajib diupload."))?;
    if bytes.is_empty() {
        return Err(ApiError::bad_request("File gambar kosong."));
    }
    if !mime.starts_with("image/") {
        return Err(ApiError::bad_request("File harus berupa gambar."));
    }

    let id = Uuid::new_v4().to_string();
    let ext = safe_ext(&file_name, &mime);
    let relative = format!("displays/{}.{}", id, ext);
    let target = state.cfg.upload_dir.join(&relative);
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|_| ApiError::internal("Folder upload tidak dapat dibuat."))?;
    }
    tokio::fs::write(&target, &bytes)
        .await
        .map_err(|_| ApiError::internal("File gagal disimpan."))?;

    let checksum = hex::encode(Sha256::digest(&bytes));
    let display_name = name
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "Display slide".to_string());

    sqlx::query(
        r#"
        INSERT INTO display_assets
          (id, brand_id, outlet_id, name, file_path, mime_type, size_bytes, checksum, sort_order, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        "#,
    )
    .bind(&id)
    .bind(&brand_id)
    .bind(&outlet_id)
    .bind(&display_name)
    .bind(&relative)
    .bind(&mime)
    .bind(bytes.len() as i64)
    .bind(&checksum)
    .bind(sort_order)
    .execute(&state.pool)
    .await?;

    Ok(Json(json!({
        "data": {
            "id": id,
            "brand_id": brand_id,
            "outlet_id": outlet_id,
            "name": display_name,
            "file_path": relative,
            "mime_type": mime,
            "size_bytes": bytes.len() as i64,
            "checksum": checksum,
            "sort_order": sort_order,
            "active": true,
            "url": format!("/uploads/{}", relative),
        }
    })))
}

pub async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
    _admin: AdminUser,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query_as::<_, (String,)>("SELECT file_path FROM display_assets WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("Asset tidak ditemukan."))?;

    sqlx::query("DELETE FROM display_assets WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;

    let path = state.cfg.upload_dir.join(&row.0);
    if let Err(error) = tokio::fs::remove_file(&path).await {
        tracing::warn!(?error, path = ?path, "display asset file removal skipped");
    }

    Ok(Json(json!({ "ok": true })))
}
