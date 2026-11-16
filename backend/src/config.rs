use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub bind_addr: String,
    pub upload_dir: PathBuf,
    pub web_dir: PathBuf,
    pub seed_demo: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "mysql://root:root@127.0.0.1:3306/workapos".to_string());
        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "change-me-in-production-workapos".to_string());
        let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
        let upload_dir = std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".to_string());
        let web_dir = std::env::var("WEB_DIR").unwrap_or_else(|_| "./web".to_string());
        let seed_demo = std::env::var("SEED_DEMO")
            .map(|v| v != "0" && v.to_lowercase() != "false")
            .unwrap_or(true);

        if jwt_secret.contains("change-me") {
            tracing::warn!("JWT_SECRET is using the development default. Change it before production.");
        }

        Ok(Self {
            database_url,
            jwt_secret,
            bind_addr,
            upload_dir: PathBuf::from(upload_dir),
            web_dir: PathBuf::from(web_dir),
            seed_demo,
        })
    }
}
