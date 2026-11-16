# WORKAPOS

Sistem POS multi-brand dan multi-outlet: backend **Rust + MySQL** di HQ, **HQ Admin** berbasis browser, dan **terminal POS layar sentuh** Linux (React + Tauri) yang tetap bisa melayani saat jaringan putus.

```
                       ┌──────────────────────────────────────────┐
                       │              HQ / SERVER                 │
                       │  Rust + Axum + SQLx + MySQL 8            │
                       │  • Admin UI statis (browser)             │
                       │  • REST API + SSE live events            │
                       │  • WebSocket kasir & perintah remote     │
                       └───────────────┬──────────────────────────┘
                                       │ LAN / VPN
             ┌─────────────────────────┼─────────────────────────┐
             │                         │                         │
      ┌──────▼───────┐          ┌──────▼───────┐          ┌──────▼───────┐
      │ Kasir outlet │          │ Order station│          │ Kasir outlet │
      │  Tauri POS   │          │  Tauri POS   │          │  Tauri POS   │
      │ MySQL lokal  │          │ MySQL lokal  │          │ MySQL lokal  │
      └──────┬───────┘          └──────────────┘          └──────────────┘
             │ HDMI / VGA
      ┌──────▼───────┐
      │ Layar kedua  │  slideshow + rincian pembayaran
      └──────────────┘
```

## Fitur

| Area | Kemampuan |
| --- | --- |
| Multi-brand / outlet | Brand, outlet, klien POS, user per brand/outlet, laporan per outlet |
| Kasir | Login NIK/PIN, pindah user tanpa logout (permission langsung berubah), lock, shift-friendly UI |
| Order | Mode penjualan (dine-in/takeaway/delivery), meja, katalog grup/produk, catatan item, promo, diskon |
| Order station | Hanya membuat/mengirim order — tanpa pembayaran/diskon; kasir mengklaim tiket dan menutupnya saat bayar |
| Pembayaran | Grup/tipe pembayaran, tunai, non-tunai + referensi, split payment, service charge, pajak, pembulatan, kembalian |
| Struk & dapur | Printer jaringan ESC/POS (TCP 9100), cetak struk, tiket dapur, tes printer, buka laci kasir |
| Layar kedua | Slideshow media dari HQ (cache lokal), hilang otomatis saat media dinonaktifkan; panel order saat pembayaran |
| Offline-first | Setiap penjualan/tiket masuk antrean IndexedDB + mirror MySQL lokal; sinkron otomatis ke HQ |
| Realtime | WebSocket presence, perintah remote (refresh/menu/restart/display), SSE live sales di admin |
| HQ Admin | Dashboard, live sales, laporan, CRUD seluruh master data, user & role, media display, perintah remote |
| Keamanan | JWT, bcrypt PIN, permission per role, pembatasan user per outlet, admin-only settings |

## Struktur Repo

```
backend/                 HQ server Rust
  migrations/            skema MySQL (sqlx migrate, otomatis saat start)
  src/                   API, auth, seed, route
  web/                   HQ Admin UI (tanpa build step)
  deploy/                systemd install script
  Dockerfile
frontend/                terminal POS
  src/                   React + TypeScript + Zustand
  src-tauri/             shell Tauri, MySQL lokal, ESC/POS, layar kedua
  deploy/                build .deb + setup Debian touchscreen
  .env.example
docker-compose.yml       MySQL 8.4 + HQ siap jalan
```

## Mulai Cepat (Docker)

Prasyarat: Docker/Podman dengan Compose.

```bash
cd D:/workapos
cp .env.example .env      # ganti MYSQL_ROOT_PASSWORD + JWT_SECRET
docker compose up -d --build
```

- Admin UI: <http://localhost:8080/>
- Health: <http://localhost:8080/health>
- MySQL: `127.0.0.1:3307`, user `root`, password dari `MYSQL_ROOT_PASSWORD` (default `workapos_root`)

Buka Admin UI, login **NIK `1000` / PIN `1234`**, lalu ganti PIN melalui menu Pengguna.

> `SEED_DEMO=1` membuat 2 brand, 4 outlet, katalog contoh, printer, promo, dan user demo pada database kosong. Untuk produksi set `SEED_DEMO=0` dan ganti `JWT_SECRET`.

### Tanpa Compose (Podman langsung)

Jika mesin hanya punya Podman tanpa provider `docker-compose`, jalankan tiap container secara langsung. Di PowerShell (Windows) maupun bash, isi variabel dari `.env` terlebih dahulu:

```bash
podman network create workapos-net
podman volume create workapos-mysql-data
podman volume create workapos-uploads

podman run -d --name workapos-mysql --network workapos-net --restart unless-stopped \
  -e MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" -e MYSQL_DATABASE=workapos \
  -v workapos-mysql-data:/var/lib/mysql \
  mysql:8.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci

podman build -t workapos-hq:local backend

podman run -d --name workapos-hq --network workapos-net --restart unless-stopped \
  -p 8080:8080 \
  -e DATABASE_URL="mysql://root:$MYSQL_ROOT_PASSWORD@workapos-mysql:3306/workapos" \
  -e JWT_SECRET="$JWT_SECRET" -e BIND_ADDR=0.0.0.0:8080 \
  -e WEB_DIR=/app/web -e UPLOAD_DIR=/app/uploads \
  -e SEED_DEMO=1 -e SEED_ADMIN_PIN=1234 \
  -v workapos-uploads:/app/uploads \
  workapos-hq:local
```

MySQL sengaja tidak mempublikasikan port host agar tidak bentrok dengan MySQL lain di mesin. Backend terhubung lewat DNS container `workapos-mysql:3306`. Perintah operasional:

```bash
podman logs -f workapos-hq          # log backend
podman restart workapos-hq          # restart HQ
podman stop workapos-hq workapos-mysql
podman rm -f workapos-hq workapos-mysql
podman volume rm workapos-mysql-data workapos-uploads   # hapus data permanen
```

## Instalasi Backend di Debian

Prasyarat: Debian 12/13, MySQL 8, Rust stable, build tools.

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev mysql-server
sudo mysql -e "CREATE DATABASE workapos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

cd backend
cp .env.example .env
# edit .env: DATABASE_URL, JWT_SECRET
cargo build --release
```

Pilihan A — jalankan langsung:

```bash
./target/release/workapos-hq
```

Pilihan B — pasang sebagai service (disarankan):

```bash
sudo backend/deploy/install-debian.sh
```

Script membuat user sistem `workapos`, menyalin binary + web + migrations ke `/opt/workapos`, menulis `/etc/workapos/hq.env`, dan mengaktifkan `workapos-hq.service`.

Backend menjalankan migrasi database otomatis saat start. Semua endpoint API berada di `/api/*`, admin UI dilayani dari `/`, media dari `/uploads/*`.

### Environment Backend

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | `mysql://root:root@127.0.0.1:3306/workapos` | Koneksi MySQL 8 |
| `JWT_SECRET` | nilai dev | **Wajib diganti** di produksi |
| `BIND_ADDR` | `0.0.0.0:8080` | Alamat/port HTTP |
| `WEB_DIR` | `./web` | Folder admin UI |
| `UPLOAD_DIR` | `./uploads` | Media layar kedua |
| `SEED_DEMO` | `1` | Seed data demo pada DB kosong |
| `SEED_ADMIN_PIN` | `1234` | PIN admin pertama (hanya saat dibuat) |

## Terminal POS (Debian Touchscreen)

Prasyarat build (mesin developer/server build):

```bash
sudo apt install -y build-essential curl wget file libssl-dev \
  libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf
# Rust stable + Node.js 20+
```

Build paket `.deb`:

```bash
cd frontend
cp .env.example .env      # opsional: isi default API/token/MySQL
bash deploy/build-debian.sh

sudo apt install ./src-tauri/target/release/bundle/deb/workapos-terminal_*.deb
```

Siapkan PC kasir (MySQL lokal, runtime, autostart):

```bash
sudo bash frontend/deploy/setup-terminal-debian.sh
mkdir -p ~/.config/autostart
cp frontend/deploy/workapos-terminal.desktop ~/.config/autostart/
```

Di aplikasi, buka **Pengaturan** (admin):

- **URL backend**: `http://IP-HQ:8080`
- **Client token**: dari HQ → Klien POS (contoh kasir Senopati di bawah)
- **MySQL lokal**: `mysql://root:SANDI@127.0.0.1:3306/workapos_pos`
  Database `workapos_pos` dibuat otomatis oleh aplikasi saat pertama terhubung.
- Aktifkan **Layar kedua** dan **Cetak otomatis** sesuai perangkat.

Terminal juga berjalan sebagai web app di browser (mode tanpa MySQL/Tauri). Semua data tetap di IndexedDB dan sinkron ke HQ; cetak memakai dialog browser.

### Build & Jalankan Mode Dev

```bash
cd backend && cargo run
cd frontend && npm install && npm run tauri dev
```

`npm run build` hanya membangun aset web. `npm run tauri build` membangun aplikasi desktop.

## Akun & Token Demo

| Peran | NIK | PIN | Catatan |
| --- | --- | --- | --- |
| Administrator HQ | `1000` | `1234` | Akses penuh, hanya admin bisa membuka Settings |
| Manager Senopati | `2000` | `2222` | Diskon, void, laporan |
| Kasir Senopati | `2001` | `1111` | Order + pembayaran |
| Kasir Kemang | `2002` | `1212` | Outlet berbeda |
| Barista Menteng | `2003` | `5555` | Brand berbeda |
| Order Station Senopati | `3001` | `3333` | Hanya order, tidak bisa bayar |

Client token demo:

| Outlet | Tipe | Token |
| --- | --- | --- |
| Kasir Senopati 01 | cashier | `wpos_demo_kasir_senopati_8f2a4c6e1b9d` |
| Order Station Senopati | order_station | `wpos_demo_order_senopati_3a7c9e2f5b1d` |
| Kasir Kemang 01 | cashier | `wpos_demo_kasir_kemang_6c1d8e4a2f7b` |
| Kasir Menteng 01 | cashier | `wpos_demo_kasir_menteng_9b4e2a7d5c1f` |
| Order Station Menteng | order_station | `wpos_demo_order_menteng_2d8f6a4c9e3b` |

Token dikelola di HQ → **Klien POS**. Setiap terminal memakai satu token; jangan bagikan token antar-terminal.

## Alur Offline & Sinkronisasi

1. Sale selesai → ditulis ke IndexedDB (`workapos.sales.queue.v1`) **dan** MySQL lokal (`local_sales`).
2. UI langsung menampilkan struk; tidak menunggu jaringan.
3. Saat online, `POST /api/pos/sales/sync` mengirim antrean; item yang sukses ditandai `synced_at` dan dihapus dari antrean.
4. Order station menyimpan tiket ke `local_tickets` / IndexedDB dengan alur yang sama.
5. Refresh bootstrap (katalog, meja, promo, printer, media) disimpan sebagai cache sehingga terminal tetap bisa order saat HQ down.
6. Media layar kedua memakai Cache Storage `workapos-media-v1`; media yang dihapus/dinonaktifkan di HQ dibersihkan dari cache lokal.

Konflik penjualan dicegah dengan `client_bill_id` unik. Bila server menerima duplikat, respons tetap sukses dan antrean dibersihkan.

## Layar Kedua

- Buka dari tombol monitor di header. Di Tauri, jendela `second-display` dibuka; di browser, popup.
- Slideshow berjalan dari media HQ yang di-cache lokal, interval diatur per klien POS.
- Saat pembayaran, tampilan bergeser: gambar ke kanan, panel order/nominal di kiri.
- Komunikasi memakai `BroadcastChannel('workapos.display.v1')`, jadi tidak butuh server tambahan.

## Printer Jaringan

- Printer dikonfigurasi di HQ: IP, port (default 9100), lebar kertas 58/80 mm, tujuan `receipt`/`kitchen`.
- Satu printer dapat dipakai beberapa outlet. Buka menu **Printers**, simpan data printer, lalu klik tombol **Outlet Setting** pada baris printer untuk memilih outlet yang boleh memakainya.
- Outlet yang tidak dipilih tidak akan menerima konfigurasi printer tersebut pada bootstrap POS.
- Tauri merender ESC/POS dan mengirim TCP langsung; tidak butuh driver Linux.
- Tersedia tes printer dan perintah buka laci (`ESC p`).
- Bila printer tidak tersedia, transaksi tetap tersimpan; kasir bisa cetak ulang dari riwayat/struk.

## Order Station

- Login dengan token klien `order_station` dan akun dengan permission `pos.order`.
- Tidak ada tombol pembayaran/diskon; backend juga tidak menyediakan endpoint pembayaran untuk tipe klien ini.
- Setelah order dikirim, tiket masuk ke daftar kasir outlet yang sama.
- Kasir mengklaim tiket, menambah item bila perlu, lalu membayar; tiket ditutup otomatis saat sale diterima.
- Tombol Settings tetap hanya bisa dibuka oleh user admin (verifikasi PIN admin).

## Ringkasan API

| Method & path | Fungsi |
| --- | --- |
| `POST /api/auth/login` | Login admin HQ (NIK/PIN, JWT) |
| `GET /api/admin/*` | Dashboard, laporan, CRUD, user, asset, presence, command, SSE |
| `POST /api/pos/login` | Login user POS dengan `x-client-token` |
| `GET /api/pos/bootstrap` | Snapshot katalog/outlet/promo/printer/media untuk terminal |
| `POST /api/pos/sales` | Kirim satu penjualan |
| `POST /api/pos/sales/sync` | Sinkronisasi batch penjualan offline |
| `GET/POST /api/pos/tickets` | Daftar / buat tiket order station |
| `POST /api/pos/tickets/{id}/claim` | Kasir klaim tiket |
| `POST /api/pos/tickets/{id}/cancel` | Batalkan tiket |
| `GET /ws/pos?token=...` | WebSocket presence + perintah realtime |
| `GET /api/admin/events?token=...` | SSE live sales untuk dashboard |
| `GET /health` | Health check DB |

Semua nominal uang disimpan sebagai **integer sen** (1/100 Rupiah) agar tidak ada galat pembulatan floating point. Input harga di seed/admin dalam Rupiah dikonversi ke sen.

## Produksi: Checklist

- [ ] Ganti `JWT_SECRET` (mis. `openssl rand -hex 48`) dan `SEED_ADMIN_PIN`.
- [ ] Set `SEED_DEMO=0` setelah data demo tidak dipakai; hapus/ubah semua akun demo.
- [ ] Ganti semua client token demo di HQ.
- [ ] Batasi port `8080` ke LAN/VPN; pasang reverse proxy TLS (Caddy/Nginx) bila lewat internet.
- [ ] Backup MySQL HQ harian (`mysqldump --single-transaction`) dan folder `uploads`.
- [ ] Backup MySQL lokal terminal atau minimal pastikan antrean IndexedDB tersinkron.
- [ ] Gunakan UPS untuk PC kasir/printer; matikan autosuspend layar.
- [ ] Uji cetak, laci, layar kedua, dan skenario offline sebelum go-live.

## Troubleshooting

| Gejala | Perbaikan |
| --- | --- |
| HQ gagal start, `Unknown database` | Buat database `workapos` (lihat perintah di atas), lalu restart service |
| `Access denied` MySQL | Periksa user/password di `DATABASE_URL` dan izin host |
| Login admin ditolak | Pastikan `SEED_DEMO=1` atau user NIK 1000 sudah ada; cek PIN |
| Terminal offline terus | Cek URL backend dari terminal, firewall port 8080, dan token klien |
| MySQL lokal gagal | Cek service MySQL, port kustom, user/password; transaksi tetap aman di IndexedDB |
| Printer tidak mencetak | Cek IP/port 9100, satu jaringan, tes printer di Settings; firewall printer |
| Layar kedua kosong | Pastikan ada media aktif untuk brand/outlet; cek popup/display window dan Cache Storage |
| Media lama masih tampil | Nonaktifkan/hapus media di HQ lalu refresh bootstrap terminal; cache dibersihkan otomatis |
| Build Tauri gagal di Linux | Pastikan paket `libwebkit2gtk-4.1-dev` dkk. terpasang (lihat prasyarat) |

## Catatan Teknis

- Backend: Axum 0.8, SQLx 0.8 (MySQL, rustls), JWT, bcrypt, SSE + WebSocket.
- Frontend: React 19, TypeScript, Vite 6, Zustand, Tauri 2, `idb-keyval`.
- Database HQ: MySQL 8 (JSON, `DATETIME(6)`, `utf8mb4`).
- Database lokal terminal: MySQL 8, skema dibuat otomatis oleh command Tauri `local_db_init`.
- Admin UI sengaja tanpa framework/build step agar mudah dirawat dan tetap ringan untuk server 2 GB.
- Package `.deb` Tauri sudah memuat aset web; tidak perlu Node.js di PC kasir.
