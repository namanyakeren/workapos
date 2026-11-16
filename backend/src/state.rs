use crate::config::Config;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::MySqlPool;
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub pool: MySqlPool,
    pub events: broadcast::Sender<ServerEvent>,
}

impl AppState {
    pub fn new(cfg: Config, pool: MySqlPool) -> Self {
        let (events, _) = broadcast::channel(512);
        Self {
            cfg: Arc::new(cfg),
            pool,
            events,
        }
    }

    pub fn publish(&self, event: ServerEvent) {
        let _ = self.events.send(event);
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ServerEvent {
    pub kind: String,
    pub client_id: Option<String>,
    pub data: Value,
    pub at: DateTime<Utc>,
}

impl ServerEvent {
    pub fn new(kind: impl Into<String>, client_id: Option<String>, data: Value) -> Self {
        Self {
            kind: kind.into(),
            client_id,
            data,
            at: Utc::now(),
        }
    }
}
