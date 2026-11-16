use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::mysql::{MySqlPool, MySqlPoolOptions};
use std::time::Duration;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use url::Url;

#[derive(Default)]
struct AppState {
    pool: Mutex<Option<MySqlPool>>,
    url: Mutex<String>,
}

#[derive(Serialize)]
struct DbStatus {
    ok: bool,
    message: String,
}

#[derive(Serialize)]
struct DbInfo {
    ok: bool,
    error: String,
    pending: i64,
}

#[derive(Serialize)]
struct PrintOutcome {
    ok: bool,
    message: String,
}

#[derive(Deserialize)]
struct PrinterTarget {
    ip: String,
    #[serde(default = "default_printer_port")]
    port: u16,
}

fn default_printer_port() -> u16 {
    9100
}

const SCHEMA: [&str; 3] = [
    r#"
    CREATE TABLE IF NOT EXISTS pos_cache (
        cache_key VARCHAR(64) NOT NULL PRIMARY KEY,
        payload LONGTEXT NOT NULL,
        updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    "#,
    r#"
    CREATE TABLE IF NOT EXISTS local_sales (
        client_bill_id VARCHAR(80) NOT NULL PRIMARY KEY,
        bill_no VARCHAR(80) NOT NULL,
        total_cents BIGINT NOT NULL DEFAULT 0,
        payload LONGTEXT NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        synced_at DATETIME(6) NULL,
        KEY idx_local_sales_synced (synced_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    "#,
    r#"
    CREATE TABLE IF NOT EXISTS local_tickets (
        ticket_no VARCHAR(80) NOT NULL PRIMARY KEY,
        table_name VARCHAR(120) NOT NULL DEFAULT '',
        payload LONGTEXT NOT NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        synced_at DATETIME(6) NULL,
        KEY idx_local_tickets_synced (synced_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    "#,
];

fn ok_status(message: impl Into<String>) -> DbStatus {
    DbStatus {
        ok: true,
        message: message.into(),
    }
}

fn err_status(message: impl Into<String>) -> DbStatus {
    DbStatus {
        ok: false,
        message: message.into(),
    }
}

fn friendly_db_error(error: sqlx::Error) -> String {
    let text = error.to_string();
    if text.contains("Access denied") {
        return "Akses MySQL ditolak. Periksa pengguna dan kata sandi basis data lokal.".into();
    }
    if text.contains("Connection refused") || text.contains("tcp connect error") {
        return "MySQL lokal tidak dapat dihubungi. Pastikan layanan MySQL berjalan dan port benar.".into();
    }
    if text.contains("Unknown database") {
        return "Basis data lokal belum tersedia dan gagal dibuat otomatis.".into();
    }
    format!("Basis data lokal bermasalah: {text}")
}

async fn prepare_pool(url_str: &str) -> Result<MySqlPool, String> {
    let parsed = Url::parse(url_str).map_err(|_| {
        "URL MySQL tidak valid. Contoh: mysql://root:sandi@127.0.0.1:3307/workapos_pos".to_string()
    })?;
    if parsed.scheme() != "mysql" {
        return Err("URL basis data lokal harus memakai skema mysql://".into());
    }
    if parsed.path().trim_matches('/').is_empty() {
        return Err("URL MySQL harus menyertakan nama basis data, misalnya /workapos_pos.".into());
    }

    // Make the local replica database self-provisioning: create it when the
    // operator only supplied credentials and a database name.
    let mut server = parsed.clone();
    server.set_path("/");
    server.set_query(None);
    let db_name = parsed.path().trim_matches('/').replace('`', "");
    let server_pool = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect(server.as_str())
        .await
        .map_err(friendly_db_error)?;
    let create = format!(
        "CREATE DATABASE IF NOT EXISTS `{db_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    );
    sqlx::query(&create)
        .execute(&server_pool)
        .await
        .map_err(friendly_db_error)?;
    server_pool.close().await;

    let pool = MySqlPoolOptions::new()
        .max_connections(6)
        .acquire_timeout(Duration::from_secs(5))
        .connect(url_str)
        .await
        .map_err(friendly_db_error)?;

    for statement in SCHEMA {
        sqlx::query(statement)
            .execute(&pool)
            .await
            .map_err(friendly_db_error)?;
    }

    Ok(pool)
}

async fn current_pool(state: &State<'_, AppState>) -> Result<MySqlPool, String> {
    state
        .pool
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Basis data lokal belum terhubung.".to_string())
}

#[tauri::command]
async fn local_db_init(url: String, state: State<'_, AppState>) -> Result<DbStatus, String> {
    if url.trim().is_empty() {
        return Ok(err_status("URL MySQL lokal belum diatur di Pengaturan."));
    }

    match prepare_pool(url.trim()).await {
        Ok(pool) => {
            let old = state.pool.lock().await.replace(pool);
            if let Some(old) = old {
                old.close().await;
            }
            *state.url.lock().await = url;
            Ok(ok_status("Basis data lokal siap. Penjualan dicadangkan otomatis."))
        }
        Err(message) => Ok(err_status(message)),
    }
}

#[tauri::command]
async fn local_db_save_bootstrap(payload: String, state: State<'_, AppState>) -> Result<DbStatus, String> {
    let pool = current_pool(&state).await?;
    let parsed: Value = serde_json::from_str(&payload)
        .map_err(|error| format!("Data bootstrap tidak valid: {error}"))?;
    if parsed.get("client").is_none() || parsed.get("brand").is_none() {
        return Err("Data bootstrap tidak memuat informasi klien/merek.".into());
    }

    sqlx::query(
        "INSERT INTO pos_cache (cache_key, payload) VALUES ('bootstrap', ?)
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP(6)",
    )
    .bind(&payload)
    .execute(&pool)
    .await
    .map_err(friendly_db_error)?;

    Ok(ok_status("Bootstrap tersimpan di basis data lokal."))
}

#[tauri::command]
async fn local_db_upsert_sale(payload: String, state: State<'_, AppState>) -> Result<DbStatus, String> {
    let pool = current_pool(&state).await?;
    let parsed: Value = serde_json::from_str(&payload)
        .map_err(|error| format!("Data penjualan tidak valid: {error}"))?;

    let client_bill_id = parsed
        .get("client_bill_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Penjualan tidak memiliki client_bill_id.".to_string())?;
    let bill_no = parsed
        .get("bill_no")
        .and_then(Value::as_str)
        .unwrap_or("-");
    let total_cents = parsed
        .get("total_cents")
        .and_then(Value::as_i64)
        .unwrap_or(0);

    sqlx::query(
        "INSERT INTO local_sales (client_bill_id, bill_no, total_cents, payload, synced_at)
         VALUES (?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
            bill_no = VALUES(bill_no),
            total_cents = VALUES(total_cents),
            payload = VALUES(payload),
            synced_at = NULL",
    )
    .bind(client_bill_id)
    .bind(bill_no)
    .bind(total_cents)
    .bind(&payload)
    .execute(&pool)
    .await
    .map_err(friendly_db_error)?;

    Ok(ok_status("Penjualan tersimpan lokal."))
}

#[tauri::command]
async fn local_db_mark_synced(
    client_bill_id: String,
    state: State<'_, AppState>,
) -> Result<DbStatus, String> {
    let pool = current_pool(&state).await?;
    sqlx::query(
        "UPDATE local_sales SET synced_at = CURRENT_TIMESTAMP(6) WHERE client_bill_id = ?",
    )
    .bind(&client_bill_id)
    .execute(&pool)
    .await
    .map_err(friendly_db_error)?;
    Ok(ok_status("Penjualan ditandai tersinkron."))
}

#[tauri::command]
async fn local_db_upsert_ticket(payload: String, state: State<'_, AppState>) -> Result<DbStatus, String> {
    let pool = current_pool(&state).await?;
    let parsed: Value = serde_json::from_str(&payload)
        .map_err(|error| format!("Data tiket tidak valid: {error}"))?;
    let ticket_no = parsed
        .get("ticket_no")
        .and_then(Value::as_str)
        .ok_or_else(|| "Tiket tidak memiliki ticket_no.".to_string())?;
    let table_name = parsed
        .get("table_name")
        .and_then(Value::as_str)
        .unwrap_or("");

    sqlx::query(
        "INSERT INTO local_tickets (ticket_no, table_name, payload, synced_at)
         VALUES (?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE
            table_name = VALUES(table_name),
            payload = VALUES(payload),
            synced_at = NULL",
    )
    .bind(ticket_no)
    .bind(table_name)
    .bind(&payload)
    .execute(&pool)
    .await
    .map_err(friendly_db_error)?;

    Ok(ok_status("Tiket tersimpan lokal."))
}

#[tauri::command]
async fn local_db_mark_ticket_synced(
    ticket_no: String,
    state: State<'_, AppState>,
) -> Result<DbStatus, String> {
    let pool = current_pool(&state).await?;
    sqlx::query("UPDATE local_tickets SET synced_at = CURRENT_TIMESTAMP(6) WHERE ticket_no = ?")
        .bind(&ticket_no)
        .execute(&pool)
        .await
        .map_err(friendly_db_error)?;
    Ok(ok_status("Tiket ditandai tersinkron."))
}

#[tauri::command]
async fn local_db_info(state: State<'_, AppState>) -> Result<DbInfo, String> {
    let Some(pool) = state.pool.lock().await.clone() else {
        return Ok(DbInfo {
            ok: false,
            error: "Basis data lokal belum terhubung.".into(),
            pending: 0,
        });
    };

    let pending: i64 = sqlx::query_scalar(
        "SELECT CAST((SELECT COUNT(*) FROM local_sales WHERE synced_at IS NULL)
              + (SELECT COUNT(*) FROM local_tickets WHERE synced_at IS NULL) AS SIGNED)",
    )
    .fetch_one(&pool)
    .await
    .map_err(friendly_db_error)?;

    Ok(DbInfo {
        ok: true,
        error: String::new(),
        pending,
    })
}

// ---------------------------------------------------------------------------
// ESC/POS printing
// ---------------------------------------------------------------------------

struct Ticket {
    buffer: Vec<u8>,
    width: usize,
}

impl Ticket {
    fn new(paper_width: u64) -> Self {
        let width = if paper_width >= 80 { 42 } else { 32 };
        let mut buffer = Vec::with_capacity(2048);
        buffer.extend_from_slice(&[0x1B, 0x40]); // initialize
        Self { buffer, width }
    }

    fn raw(&mut self, bytes: &[u8]) {
        self.buffer.extend_from_slice(bytes);
    }

    fn align(&mut self, alignment: u8) {
        self.raw(&[0x1B, 0x61, alignment]);
    }

    fn emphasis(&mut self, enabled: bool) {
        self.raw(&[0x1B, 0x45, if enabled { 1 } else { 0 }]);
    }

    fn double(&mut self, enabled: bool) {
        self.raw(&[0x1B, 0x21, if enabled { 0x38 } else { 0x00 }]);
    }

    fn line(&mut self, text: &str) {
        let clean = clean_text(text);
        self.buffer.extend_from_slice(clean.as_bytes());
        self.buffer.push(b'\n');
    }

    fn spaced(&mut self, left: &str, right: &str) {
        let left = clean_text(left);
        let right = clean_text(right);
        let gap = self
            .width
            .saturating_sub(char_len(&left) + char_len(&right))
            .max(1);
        self.line(&format!("{left}{}{right}", " ".repeat(gap)));
    }

    fn center(&mut self, text: &str) {
        for line in wrap_text(&clean_text(text), self.width) {
            let pad = self.width.saturating_sub(char_len(&line)) / 2;
            self.line(&format!("{}{}", " ".repeat(pad), line));
        }
    }

    fn wrapped(&mut self, text: &str) {
        for line in wrap_text(&clean_text(text), self.width) {
            self.line(&line);
        }
    }

    fn divider(&mut self) {
        self.line(&"-".repeat(self.width));
    }

    fn feed(&mut self, lines: usize) {
        self.raw(&[0x1B, 0x64, lines.min(8) as u8]);
    }

    fn cut(&mut self) {
        self.raw(&[0x1D, 0x56, 0x42, 0x00]);
    }
}

fn clean_text(value: &str) -> String {
    value
        .chars()
        .filter(|character| *character == '\n' || !character.is_control())
        .collect::<String>()
        .replace('\r', "")
}

fn char_len(value: &str) -> usize {
    value.chars().count()
}

fn wrap_text(value: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    for raw_line in value.split('\n') {
        let mut current = String::new();
        for word in raw_line.split_whitespace() {
            if current.is_empty() {
                current = word.to_string();
            } else if char_len(&current) + 1 + char_len(word) <= width {
                current.push(' ');
                current.push_str(word);
            } else {
                lines.push(current);
                current = word.to_string();
            }
        }
        lines.push(current);
    }
    lines
}

fn json_str<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn json_u64(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn friendly_datetime(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    value
        .replace('T', " ")
        .split('.')
        .next()
        .unwrap_or(value)
        .chars()
        .take(19)
        .collect()
}

fn money_text(job: &Value, key: &str) -> String {
    json_str(job, key).to_string()
}

fn build_receipt(job: &Value) -> Ticket {
    let mut ticket = Ticket::new(json_u64(job, "paper_width"));

    ticket.align(1);
    ticket.double(true);
    ticket.line(&json_str(job, "brand").to_uppercase());
    ticket.double(false);
    ticket.line(json_str(job, "outlet"));
    if !json_str(job, "address").is_empty() {
        ticket.wrapped(json_str(job, "address"));
    }
    if !json_str(job, "phone").is_empty() {
        ticket.line(json_str(job, "phone"));
    }
    ticket.line("");
    ticket.emphasis(true);
    ticket.line(json_str(job, "title"));
    ticket.emphasis(false);
    ticket.align(0);
    ticket.divider();
    ticket.spaced("No", json_str(job, "bill_no"));
    ticket.spaced("Meja", default_dash(json_str(job, "table_name")));
    ticket.spaced("Mode", default_dash(json_str(job, "sales_mode")));
    ticket.spaced("Kasir", json_str(job, "cashier"));
    ticket.spaced("Waktu", &friendly_datetime(json_str(job, "created_at")));
    if !json_str(job, "customer_name").is_empty() {
        ticket.spaced("Pelanggan", json_str(job, "customer_name"));
    }
    ticket.divider();

    if let Some(items) = job.get("items").and_then(Value::as_array) {
        for item in items {
            let qty = json_u64(item, "qty");
            let name = json_str(item, "name");
            ticket.spaced(&format!("{qty}x {name}"), json_str(item, "total"));
            ticket.line(&format!("   @ {}", json_str(item, "price")));
            let note = json_str(item, "note");
            if !note.is_empty() {
                ticket.wrapped(&format!("   * {note}"));
            }
        }
    }
    ticket.divider();
    ticket.spaced("Subtotal", &money_text(job, "subtotal"));
    let discount = money_text(job, "discount");
    if !discount.is_empty() && discount != "0" {
        ticket.spaced("Diskon", &format!("-{discount}"));
    }
    for (label, key) in [("Service", "service"), ("Pajak", "tax"), ("Pembulatan", "rounding")] {
        let value = money_text(job, key);
        if !value.is_empty() && value != "0" {
            ticket.spaced(label, &value);
        }
    }
    ticket.emphasis(true);
    ticket.spaced("TOTAL", &money_text(job, "total"));
    ticket.emphasis(false);
    ticket.spaced("Dibayar", &money_text(job, "paid"));
    ticket.spaced("Kembali", &money_text(job, "change"));
    if let Some(payments) = job.get("payments").and_then(Value::as_array) {
        for payment in payments {
            if let Some(text) = payment.as_str() {
                ticket.wrapped(text);
            }
        }
    }
    let note = json_str(job, "note");
    if !note.is_empty() {
        ticket.wrapped(&format!("Catatan: {note}"));
    }
    ticket.line("");
    ticket.align(1);
    ticket.center(json_str(job, "footer"));
    ticket.align(0);
    ticket.feed(3);
    ticket.cut();
    ticket
}

fn build_kitchen(job: &Value) -> Ticket {
    let mut ticket = Ticket::new(json_u64(job, "paper_width"));
    ticket.align(1);
    ticket.double(true);
    ticket.line(json_str(job, "title"));
    ticket.double(false);
    ticket.line(&json_str(job, "brand").to_uppercase());
    ticket.line(json_str(job, "outlet"));
    ticket.align(0);
    ticket.line("");
    ticket.spaced("Ref", json_str(job, "reference"));
    ticket.spaced("Meja", default_dash(json_str(job, "table_name")));
    ticket.spaced("Mode", default_dash(json_str(job, "sales_mode")));
    ticket.spaced("Waktu", &friendly_datetime(json_str(job, "created_at")));
    ticket.divider();
    if let Some(items) = job.get("items").and_then(Value::as_array) {
        for item in items {
            let qty = json_u64(item, "qty");
            ticket.emphasis(true);
            ticket.wrapped(&format!("{qty}x {}", json_str(item, "name")));
            ticket.emphasis(false);
            let note = json_str(item, "note");
            if !note.is_empty() {
                ticket.wrapped(&format!("   * {note}"));
            }
        }
    }
    ticket.divider();
    let note = json_str(job, "note");
    if !note.is_empty() {
        ticket.wrapped(&format!("Catatan: {note}"));
    }
    ticket.align(1);
    ticket.line("-- DAPUR --");
    ticket.align(0);
    ticket.feed(3);
    ticket.cut();
    ticket
}

fn build_test(job: &Value) -> Ticket {
    let mut ticket = Ticket::new(json_u64(job, "paper_width"));
    ticket.align(1);
    ticket.double(true);
    ticket.line("WORKAPOS PRINT TEST");
    ticket.double(false);
    ticket.line(json_str(job, "brand"));
    ticket.line(json_str(job, "outlet"));
    ticket.line("");
    ticket.align(0);
    ticket.spaced("Printer", json_str(job, "printer"));
    ticket.spaced("Waktu", &friendly_datetime(json_str(job, "time")));
    ticket.line("");
    ticket.align(1);
    ticket.line("Printer siap digunakan.");
    ticket.align(0);
    ticket.feed(3);
    ticket.cut();
    ticket
}

fn default_dash(value: &str) -> &str {
    if value.is_empty() {
        "-"
    } else {
        value
    }
}

fn build_escpos(job: &Value) -> Result<Vec<u8>, String> {
    let kind = json_str(job, "kind");
    let mut ticket = match kind {
        "receipt" => build_receipt(job),
        "kitchen" => build_kitchen(job),
        "test" => build_test(job),
        "drawer" => {
            let mut ticket = Ticket::new(80);
            ticket.raw(&[0x1B, 0x70, 0x00, 0x19, 0xFA]);
            ticket
        }
        other => return Err(format!("Jenis pekerjaan cetak tidak dikenal: {other}")),
    };
    if kind == "drawer" {
        return Ok(ticket.buffer);
    }
    // Small safety feed so the last line is never clipped by the cutter.
    ticket.feed(1);
    Ok(ticket.buffer)
}

#[tauri::command]
async fn print_escpos(printer: PrinterTarget, job: Value) -> Result<PrintOutcome, String> {
    let bytes = build_escpos(&job)?;
    if printer.ip.trim().is_empty() {
        return Ok(PrintOutcome {
            ok: false,
            message: "Alamat IP printer belum diatur.".into(),
        });
    }

    let address = format!("{}:{}", printer.ip.trim(), printer.port);
    let connect = tokio::time::timeout(
        Duration::from_secs(4),
        TcpStream::connect(address.as_str()),
    )
    .await;

    let mut stream = match connect {
        Ok(Ok(stream)) => stream,
        Ok(Err(error)) => {
            return Ok(PrintOutcome {
                ok: false,
                message: format!("Gagal terhubung ke printer {address}: {error}"),
            })
        }
        Err(_) => {
            return Ok(PrintOutcome {
                ok: false,
                message: format!("Printer {address} tidak merespons (timeout)."),
            })
        }
    };

    match tokio::time::timeout(Duration::from_secs(5), stream.write_all(&bytes)).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            return Ok(PrintOutcome {
                ok: false,
                message: format!("Gagal mengirim data ke printer: {error}"),
            })
        }
        Err(_) => {
            return Ok(PrintOutcome {
                ok: false,
                message: "Printer terlalu lama menerima data (timeout).".into(),
            })
        }
    }
    let _ = stream.flush().await;
    let _ = stream.shutdown().await;

    Ok(PrintOutcome {
        ok: true,
        message: format!("Pekerjaan cetak terkirim ke {address}."),
    })
}

// ---------------------------------------------------------------------------
// Customer-facing second display
// ---------------------------------------------------------------------------

#[tauri::command]
async fn open_second_display(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("second-display") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "second-display",
        WebviewUrl::App("index.html?display=1".into()),
    )
    .title("WORKAPOS Customer Display")
    .inner_size(1280.0, 720.0)
    .min_inner_size(800.0, 480.0)
    .decorations(false)
    .resizable(true)
    .background_color(tauri::utils::config::Color(4, 6, 10, 255))
    .build()
    .map_err(|error| format!("Gagal membuka layar kedua: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn close_second_display(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("second-display") {
        window
            .close()
            .map_err(|error| format!("Gagal menutup layar kedua: {error}"))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            local_db_init,
            local_db_save_bootstrap,
            local_db_upsert_sale,
            local_db_mark_synced,
            local_db_upsert_ticket,
            local_db_mark_ticket_synced,
            local_db_info,
            print_escpos,
            open_second_display,
            close_second_display,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WORKAPOS terminal");
}
