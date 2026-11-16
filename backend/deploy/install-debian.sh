#!/usr/bin/env bash
# Install WORKAPOS HQ on Debian 12/13 from this repository.
# Build first on the server (or copy the binary from your build machine):
#   cd backend && cargo build --release
# Then run as root:
#   sudo backend/deploy/install-debian.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/target/release/workapos-hq"
APP_DIR="/opt/workapos"
ENV_DIR="/etc/workapos"
ENV_FILE="$ENV_DIR/hq.env"

if [[ $EUID -ne 0 ]]; then
  echo "Jalankan sebagai root: sudo $0" >&2
  exit 1
fi

if [[ ! -x "$BIN" ]]; then
  echo "Binary belum ada: $BIN" >&2
  echo "Jalankan 'cargo build --release' di folder backend terlebih dahulu." >&2
  exit 1
fi

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl mysql-client

if ! id workapos >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin workapos
fi

install -d -o workapos -g workapos "$APP_DIR" "$APP_DIR/uploads" "$ENV_DIR"
install -m 0755 "$BIN" "$APP_DIR/workapos-hq"
rm -rf "$APP_DIR/web" "$APP_DIR/migrations"
cp -r "$ROOT/web" "$APP_DIR/web"
cp -r "$ROOT/migrations" "$APP_DIR/migrations"
chown -R workapos:workapos "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  JWT_SECRET="$(openssl rand -hex 48 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat >"$ENV_FILE" <<EOF
DATABASE_URL=mysql://root:root@127.0.0.1:3306/workapos
JWT_SECRET=$JWT_SECRET
BIND_ADDR=0.0.0.0:8080
WEB_DIR=$APP_DIR/web
UPLOAD_DIR=$APP_DIR/uploads
SEED_DEMO=1
SEED_ADMIN_PIN=1234
EOF
  chmod 0600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
  echo "Environment ditulis ke $ENV_FILE (ubah DATABASE_URL sebelum produksi)."
fi

cat >/etc/systemd/system/workapos-hq.service <<EOF
[Unit]
Description=WORKAPOS Headquarters (multi-outlet POS backend)
After=network-online.target mysql.service
Wants=network-online.target

[Service]
Type=simple
User=workapos
Group=workapos
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$APP_DIR/workapos-hq
Restart=always
RestartSec=4
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$APP_DIR/uploads

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now workapos-hq.service
systemctl --no-pager --lines=0 status workapos-hq.service || true

cat <<EOF

WORKAPOS HQ terpasang.
  Admin UI : http://<alamat-server>:8080/
  Health   : http://<alamat-server>:8080/health
  Env      : $ENV_FILE

Jika database belum ada, buat dulu:
  sudo mysql -e "CREATE DATABASE workapos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  sudo systemctl restart workapos-hq

Login admin awal: NIK 1000 / PIN 1234 (ubah segera di HQ).
EOF
