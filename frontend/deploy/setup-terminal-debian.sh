#!/usr/bin/env bash
# Prepare a Debian touchscreen PC (cashier/order station) for WORKAPOS.
# Run as root on the POS machine: sudo frontend/deploy/setup-terminal-debian.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Jalankan sebagai root: sudo $0" >&2
  exit 1
fi

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  libwebkit2gtk-4.1-0 \
  libgtk-3-0 \
  libayatana-appindicator3-1 \
  librsvg2-2 \
  mysql-server \
  mysql-client

# Local, self-healing cache database for every completed sale.
systemctl enable --now mysql

cat <<'EOF'

Runtime terminal siap.

1) Pasang aplikasi POS:
   sudo apt install ./workapos-terminal_*.deb

2) Buka aplikasi, lalu isi Pengaturan:
   - URL backend HQ, misalnya http://192.168.1.10:8080
   - Client token outlet (dari HQ > Klien POS)
   - URL MySQL lokal, misalnya mysql://root:SANDI@127.0.0.1:3306/workapos_pos
     (basis data workapos_pos dibuat otomatis oleh aplikasi)

3) Login dengan NIK/PIN kasir. Untuk mode order station gunakan token
   order station dan akun ber-permission pos.order.

4) Autostart layar sentuh:
   cp deploy/workapos-terminal.desktop ~/.config/autostart/
   (edit Exec bila lokasi binary berbeda; paket .deb memasang di
    /usr/bin/workapos-terminal)

Catatan: aplikasi akan mencoba MySQL lokal; bila gagal, penjualan tetap
aman di antrean IndexedDB dan sinkron saat koneksi pulih.
EOF
