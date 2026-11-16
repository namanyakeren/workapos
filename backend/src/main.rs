mod auth;
mod config;
mod error;
mod resources;
mod routes;
mod seed;
mod state;

use axum::extract::DefaultBodyLimit;
use axum::http::StatusCode;
use axum::routing::{any, delete, get, post, put};
use axum::{Json, Router};
use config::Config;
use sqlx::mysql::MySqlPoolOptions;
use state::AppState;
use std::time::Duration;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "workapos_hq=info,tower_http=info,sqlx=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer().compact())
        .init();

    let cfg = Config::from_env()?;
    std::fs::create_dir_all(&cfg.upload_dir)?;

    // A fresh installation should not require a separate mysql-client step.
    // If the database is missing we create it using the same credentials. A
    // restricted MySQL user can still skip this and have the database created
    // by the operator before starting the service.
    if let Err(error) = ensure_database_exists(&cfg.database_url).await {
        tracing::warn!(%error, "database bootstrap skipped");
    }

    let pool = MySqlPoolOptions::new()
        .max_connections(12)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&cfg.database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;
    seed::run(&pool, cfg.seed_demo).await?;

    let bind_addr = cfg.bind_addr.clone();
    let web_dir = cfg.web_dir.clone();
    let upload_dir = cfg.upload_dir.clone();
    let state = AppState::new(cfg, pool);

    let index = web_dir.join("index.html");
    let static_files = ServeDir::new(web_dir)
        .append_index_html_on_directories(true)
        .not_found_service(ServeFile::new(index));

    let app = Router::new()
        .route("/health", get(health))
        .route("/ws/pos", get(routes::ws_routes::pos_ws))
        .route("/api/auth/login", post(routes::auth_routes::login))
        .route("/api/auth/me", get(routes::auth_routes::me))
        .route("/api/pos/login", post(routes::auth_routes::pos_login))
        .route("/api/pos/bootstrap", get(routes::pos_routes::bootstrap))
        .route("/api/pos/heartbeat", post(routes::pos_routes::heartbeat))
        .route("/api/pos/assets", get(routes::pos_routes::assets))
        .route("/api/pos/sales", post(routes::pos_routes::submit_sale))
        .route("/api/pos/sales/sync", post(routes::pos_routes::sync_sales))
        .route(
            "/api/pos/tickets",
            get(routes::ticket_routes::list).post(routes::ticket_routes::create),
        )
        .route(
            "/api/pos/tickets/{id}/claim",
            post(routes::ticket_routes::claim),
        )
        .route(
            "/api/pos/tickets/{id}/cancel",
            post(routes::ticket_routes::cancel),
        )
        .route(
            "/api/pos/commands/{id}/ack",
            post(routes::pos_routes::command_ack),
        )
        .route(
            "/api/admin/verify",
            get(routes::auth_routes::verify_admin),
        )
        .route(
            "/api/admin/me",
            get(routes::ws_routes::admin_me),
        )
        .route(
            "/api/admin/dashboard",
            get(routes::report_routes::dashboard),
        )
        .route(
            "/api/admin/entities/{resource}",
            get(routes::crud::list).post(routes::crud::create),
        )
        .route(
            "/api/admin/entities/{resource}/{id}",
            get(routes::crud::get)
                .put(routes::crud::update)
                .delete(routes::crud::delete),
        )
        .route(
            "/api/admin/users",
            get(routes::user_routes::list).post(routes::user_routes::create),
        )
        .route(
            "/api/admin/users/{id}",
            put(routes::user_routes::update).delete(routes::user_routes::delete),
        )
        .route(
            "/api/admin/assets",
            get(routes::asset_routes::list).post(routes::asset_routes::upload),
        )
        .route(
            "/api/admin/assets/{id}",
            delete(routes::asset_routes::remove),
        )
        .route(
            "/api/admin/clients/{id}/command",
            post(routes::client_routes::send_command),
        )
        .route(
            "/api/admin/clients/{id}/commands",
            get(routes::client_routes::commands),
        )
        .route(
            "/api/admin/printers/{id}/outlets",
            get(routes::printer_routes::get_outlets)
                .put(routes::printer_routes::set_outlets),
        )
        .route(
            "/api/admin/presence",
            get(routes::client_routes::presence),
        )
        .route(
            "/api/admin/reports/sales",
            get(routes::report_routes::sales_report),
        )
        .route(
            "/api/admin/reports/bills",
            get(routes::report_routes::bills_report),
        )
        .route(
            "/api/admin/reports/bills/{id}",
            get(routes::report_routes::bill_detail),
        )
        .route(
            "/api/admin/events",
            get(routes::ws_routes::admin_events),
        )
        .route("/api/{*rest}", any(api_not_found))
        .nest_service("/uploads", ServeDir::new(upload_dir))
        .fallback_service(static_files)
        .layer(DefaultBodyLimit::max(24 * 1024 * 1024))
        .layer(CompressionLayer::new())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("WORKAPOS HQ listening on http://{}", bind_addr);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn ensure_database_exists(database_url: &str) -> anyhow::Result<()> {
    let parsed = url::Url::parse(database_url)?;
    let database = parsed.path().trim_matches('/').to_string();
    if parsed.scheme() != "mysql" || database.is_empty() {
        return Ok(());
    }

    // Nothing to do when the database already accepts connections.
    if let Ok(pool) = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
    {
        pool.close().await;
        return Ok(());
    }

    let mut server = parsed;
    server.set_path("/");
    server.set_query(None);

    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect(server.as_str())
        .await?;
    let safe_name = database.replace('`', "");
    let statement = format!(
        "CREATE DATABASE IF NOT EXISTS `{safe_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    );
    sqlx::query(&statement).execute(&pool).await?;
    pool.close().await;
    Ok(())
}

async fn health(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> (StatusCode, Json<serde_json::Value>) {
    match sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.pool)
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "ok": true,
                "service": "workapos-hq",
                "version": env!("CARGO_PKG_VERSION"),
                "time": chrono::Utc::now(),
            })),
        ),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "ok": false, "error": "database unavailable" })),
        ),
    }
}

async fn api_not_found() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({ "ok": false, "error": "Endpoint tidak ditemukan." })),
    )
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
