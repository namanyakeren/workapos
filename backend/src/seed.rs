use anyhow::Result;
use serde_json::json;
use sqlx::MySqlPool;

const ROLE_ADMIN: &str = "f0000000-0000-4000-8000-000000000001";
const ROLE_MANAGER: &str = "f0000000-0000-4000-8000-000000000002";
const ROLE_CASHIER: &str = "f0000000-0000-4000-8000-000000000003";
const ROLE_ORDER: &str = "f0000000-0000-4000-8000-000000000004";

const BRAND_1: &str = "a0000000-0000-4000-8000-000000000001";
const BRAND_2: &str = "a0000000-0000-4000-8000-000000000002";

const OUTLET_1: &str = "b0000000-0000-4000-8000-000000000001";
const OUTLET_2: &str = "b0000000-0000-4000-8000-000000000002";
const OUTLET_3: &str = "b0000000-0000-4000-8000-000000000003";
const OUTLET_4: &str = "b0000000-0000-4000-8000-000000000004";

const CLIENT_1: &str = "c0000000-0000-4000-8000-000000000001";
const CLIENT_2: &str = "c0000000-0000-4000-8000-000000000002";
const CLIENT_3: &str = "c0000000-0000-4000-8000-000000000003";
const CLIENT_4: &str = "c0000000-0000-4000-8000-000000000004";
const CLIENT_5: &str = "c0000000-0000-4000-8000-000000000005";

const GROUP_FOOD: &str = "d0000000-0000-4000-8000-000000000001";
const GROUP_STARTER: &str = "d0000000-0000-4000-8000-000000000002";
const GROUP_DRINK: &str = "d0000000-0000-4000-8000-000000000003";
const GROUP_DESSERT: &str = "d0000000-0000-4000-8000-000000000004";
const GROUP_PACKAGE: &str = "d0000000-0000-4000-8000-000000000005";
const GROUP_COFFEE: &str = "d0000000-0000-4000-8000-000000000006";
const GROUP_NONCOFFEE: &str = "d0000000-0000-4000-8000-000000000007";
const GROUP_PASTRY: &str = "d0000000-0000-4000-8000-000000000008";
const GROUP_BEANS: &str = "d0000000-0000-4000-8000-000000000009";

const MODE_DINEIN_1: &str = "e0000000-0000-4000-8000-000000000001";
const MODE_TAKEAWAY_1: &str = "e0000000-0000-4000-8000-000000000002";
const MODE_DELIVERY_1: &str = "e0000000-0000-4000-8000-000000000003";
const MODE_DINEIN_2: &str = "e0000000-0000-4000-8000-000000000004";
const MODE_TAKEAWAY_2: &str = "e0000000-0000-4000-8000-000000000005";

const PAYGROUP_CASH_1: &str = "f1000000-0000-4000-8000-000000000001";
const PAYGROUP_CASHLESS_1: &str = "f1000000-0000-4000-8000-000000000002";
const PAYGROUP_CASH_2: &str = "f1000000-0000-4000-8000-000000000003";
const PAYGROUP_CASHLESS_2: &str = "f1000000-0000-4000-8000-000000000004";

const USERS: [(&str, &str, &str, &str, &str, Option<&str>, Option<&str>, &str, &str); 6] = [
    ("f2000000-0000-4000-8000-000000000001", "1000", "Raka Admin", "1234", ROLE_ADMIN, None, None, "#F59E0B", "R"),
    ("f2000000-0000-4000-8000-000000000002", "2000", "Maya Manager", "2222", ROLE_MANAGER, Some(BRAND_1), Some(OUTLET_1), "#8B5CF6", "M"),
    ("f2000000-0000-4000-8000-000000000003", "2001", "Dina Kasir", "1111", ROLE_CASHIER, Some(BRAND_1), Some(OUTLET_1), "#10B981", "D"),
    ("f2000000-0000-4000-8000-000000000004", "2002", "Bima Kasir", "1212", ROLE_CASHIER, Some(BRAND_1), Some(OUTLET_2), "#3B82F6", "B"),
    ("f2000000-0000-4000-8000-000000000005", "2003", "Sari Barista", "5555", ROLE_CASHIER, Some(BRAND_2), Some(OUTLET_3), "#EC4899", "S"),
    ("f2000000-0000-4000-8000-000000000006", "3001", "Order Station", "3333", ROLE_ORDER, Some(BRAND_1), Some(OUTLET_1), "#F97316", "O"),
];

pub async fn run(pool: &MySqlPool, seed_demo: bool) -> Result<()> {
    ensure_roles(pool).await?;
    ensure_admin(pool).await?;

    let brands: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM brands")
        .fetch_one(pool)
        .await?;
    if seed_demo && brands == 0 {
        seed_demo_data(pool).await?;
        tracing::info!("Demo catalog created.");
    }

    if seed_demo {
        for user in USERS {
            ensure_demo_user(pool, user).await?;
        }
    }

    Ok(())
}

async fn ensure_roles(pool: &MySqlPool) -> Result<()> {
    let roles = [
        (
            ROLE_ADMIN,
            "Administrator",
            "Akses penuh ke HQ, pengaturan, dan seluruh operasional.",
            true,
            json!([]),
        ),
        (
            ROLE_MANAGER,
            "Store Manager",
            "Operasional outlet, laporan, diskon, dan koreksi transaksi.",
            false,
            json!([
                "pos.order", "pos.payment", "pos.discount", "pos.void",
                "pos.reprint", "pos.cash_drawer", "pos.refund", "pos.price_override",
                "report.view"
            ]),
        ),
        (
            ROLE_CASHIER,
            "Cashier",
            "Order, pembayaran, cetak ulang, dan buka laci kasir.",
            false,
            json!(["pos.order", "pos.payment", "pos.reprint", "pos.cash_drawer"]),
        ),
        (
            ROLE_ORDER,
            "Order Station",
            "Hanya membuat dan mengirim order. Tidak dapat melakukan pembayaran.",
            false,
            json!(["pos.order", "pos.reprint"]),
        ),
    ];

    for (id, name, description, is_admin, permissions) in roles {
        sqlx::query(
            "INSERT IGNORE INTO roles (id, name, description, is_admin, permissions, active) VALUES (?, ?, ?, ?, ?, 1)",
        )
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(is_admin)
        .bind(permissions.to_string())
        .execute(pool)
        .await?;
    }
    Ok(())
}

async fn ensure_admin(pool: &MySqlPool) -> Result<()> {
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM users WHERE nik = '1000'")
        .fetch_optional(pool)
        .await?;
    if exists.is_some() {
        return Ok(());
    }

    let pin = std::env::var("SEED_ADMIN_PIN").unwrap_or_else(|_| "1234".to_string());
    let hash = bcrypt::hash(&pin, 10)?;
    sqlx::query(
        "INSERT INTO users (id, nik, name, pin_hash, role_id, avatar_color, active) VALUES (?, '1000', 'Raka Admin', ?, ?, '#F59E0B', 1)",
    )
    .bind("f2000000-0000-4000-8000-000000000001")
    .bind(hash)
    .bind(ROLE_ADMIN)
    .execute(pool)
    .await?;

    tracing::info!("Default administrator created — NIK 1000 / PIN {}", pin);
    Ok(())
}

async fn ensure_demo_user(
    pool: &MySqlPool,
    user: (&str, &str, &str, &str, &str, Option<&str>, Option<&str>, &str, &str),
) -> Result<()> {
    let (id, nik, name, pin, role_id, brand_id, outlet_id, color, _initial) = user;
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM users WHERE nik = ?")
        .bind(nik)
        .fetch_optional(pool)
        .await?;
    if exists.is_some() {
        return Ok(());
    }
    let hash = bcrypt::hash(pin, 10)?;
    sqlx::query(
        "INSERT INTO users (id, nik, name, pin_hash, role_id, brand_id, outlet_id, avatar_color, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(id)
    .bind(nik)
    .bind(name)
    .bind(hash)
    .bind(role_id)
    .bind(brand_id)
    .bind(outlet_id)
    .bind(color)
    .execute(pool)
    .await?;
    Ok(())
}

async fn seed_demo_data(pool: &MySqlPool) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO brands (id, code, name, color, currency, timezone, tax_rate, service_charge_rate, active)
        VALUES
          (?, 'NK', 'Nusantara Kitchen', '#F59E0B', 'IDR', 'Asia/Jakarta', 0.1000, 0.0500, 1),
          (?, 'KS', 'Kopi Senja', '#14B8A6', 'IDR', 'Asia/Jakarta', 0.1100, 0.0000, 1)
        "#,
    )
    .bind(BRAND_1)
    .bind(BRAND_2)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO outlets (id, brand_id, code, name, address, phone, active) VALUES
          (?, ?, 'SNP', 'Senopati', 'Jl. Senopati No. 88, Jakarta Selatan', '+62 21 555 0101', 1),
          (?, ?, 'KMG', 'Kemang', 'Jl. Kemang Raya No. 21, Jakarta Selatan', '+62 21 555 0102', 1),
          (?, ?, 'MTG', 'Menteng', 'Jl. Cikini Raya No. 14, Jakarta Pusat', '+62 21 555 0201', 1),
          (?, ?, 'BSD', 'BSD Green Office', 'BSD Green Office Park, Tangerang', '+62 21 555 0202', 1)
        "#,
    )
    .bind(OUTLET_1)
    .bind(BRAND_1)
    .bind(OUTLET_2)
    .bind(BRAND_1)
    .bind(OUTLET_3)
    .bind(BRAND_2)
    .bind(OUTLET_4)
    .bind(BRAND_2)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO clients
          (id, outlet_id, code, name, kind, token, second_display, slideshow_interval_seconds, status, active)
        VALUES
          (?, ?, 'KASIR-SNP-01', 'Kasir Senopati 01', 'cashier', 'wpos_demo_kasir_senopati_8f2a4c6e1b9d', 1, 8, 'offline', 1),
          (?, ?, 'ORDER-SNP-01', 'Order Station Senopati', 'order_station', 'wpos_demo_order_senopati_3a7c9e2f5b1d', 0, 8, 'offline', 1),
          (?, ?, 'KASIR-KMG-01', 'Kasir Kemang 01', 'cashier', 'wpos_demo_kasir_kemang_6c1d8e4a2f7b', 0, 8, 'offline', 1),
          (?, ?, 'KASIR-MTG-01', 'Kasir Menteng 01', 'cashier', 'wpos_demo_kasir_menteng_9b4e2a7d5c1f', 1, 10, 'offline', 1),
          (?, ?, 'ORDER-MTG-01', 'Order Station Menteng', 'order_station', 'wpos_demo_order_menteng_2d8f6a4c9e3b', 0, 8, 'offline', 1)
        "#,
    )
    .bind(CLIENT_1)
    .bind(OUTLET_1)
    .bind(CLIENT_2)
    .bind(OUTLET_1)
    .bind(CLIENT_3)
    .bind(OUTLET_2)
    .bind(CLIENT_4)
    .bind(OUTLET_3)
    .bind(CLIENT_5)
    .bind(OUTLET_3)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO printers (id, brand_id, name, purpose, ip, port, paper_width, model, active) VALUES
          ('f3000000-0000-4000-8000-000000000001', ?, 'Receipt Counter', 'receipt', '192.168.1.50', 9100, 80, 'Epson TM-T82', 1),
          ('f3000000-0000-4000-8000-000000000002', ?, 'Kitchen Hot Line', 'kitchen', '192.168.1.51', 9100, 80, 'Xprinter XP-N160II', 1),
          ('f3000000-0000-4000-8000-000000000003', ?, 'Receipt Kemang', 'receipt', '192.168.2.50', 9100, 80, 'Epson TM-T82', 1),
          ('f3000000-0000-4000-8000-000000000004', ?, 'Bar Printer', 'receipt', '192.168.3.50', 9100, 80, 'Xprinter XP-Q200', 1)
        "#,
    )
    .bind(BRAND_1)
    .bind(BRAND_1)
    .bind(BRAND_1)
    .bind(BRAND_2)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO printer_outlets (printer_id, outlet_id) VALUES
          ('f3000000-0000-4000-8000-000000000001', ?),
          ('f3000000-0000-4000-8000-000000000002', ?),
          ('f3000000-0000-4000-8000-000000000003', ?),
          ('f3000000-0000-4000-8000-000000000004', ?)
        "#,
    )
    .bind(OUTLET_1)
    .bind(OUTLET_1)
    .bind(OUTLET_2)
    .bind(OUTLET_3)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO sales_modes (id, brand_id, outlet_id, name, code, icon, color, template, sort_order, active) VALUES
          (?, ?, NULL, 'Dine In', 'dine-in', 'utensils', '#F59E0B', 'table_service', 1, 1),
          (?, ?, NULL, 'Take Away', 'take-away', 'shopping-bag', '#3B82F6', 'fast_food', 2, 1),
          (?, ?, NULL, 'Delivery', 'delivery', 'bike', '#8B5CF6', 'fast_food', 3, 1),
          (?, ?, NULL, 'Dine In', 'dine-in', 'coffee', '#14B8A6', 'table_service', 1, 1),
          (?, ?, NULL, 'Take Away', 'take-away', 'shopping-bag', '#F97316', 'fast_food', 2, 1)
        "#,
    )
    .bind(MODE_DINEIN_1)
    .bind(BRAND_1)
    .bind(MODE_TAKEAWAY_1)
    .bind(BRAND_1)
    .bind(MODE_DELIVERY_1)
    .bind(BRAND_1)
    .bind(MODE_DINEIN_2)
    .bind(BRAND_2)
    .bind(MODE_TAKEAWAY_2)
    .bind(BRAND_2)
    .execute(pool)
    .await?;

    // 14 tables: the POS renders 10 across then wraps to the next row.
    for i in 1..=14 {
        let id = format!("da000000-0000-4000-8000-{:012}", i);
        let number = format!("T{:02}", i);
        let seats = if i <= 6 { 2 } else if i <= 12 { 4 } else { 8 };
        let table_type = if i >= 13 { "vip" } else if i <= 4 { "bar" } else { "regular" };
        let zone = if i >= 13 {
            "Private Room"
        } else if i <= 4 {
            "Window"
        } else {
            "Main"
        };
        sqlx::query(
            "INSERT INTO floor_tables (id, brand_id, outlet_id, table_type, number, name, seats, zone, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
        )
        .bind(&id)
        .bind(BRAND_1)
        .bind(OUTLET_1)
        .bind(table_type)
        .bind(&number)
        .bind(format!("Table {}", i))
        .bind(seats)
        .bind(zone)
        .bind(i)
        .execute(pool)
        .await?;
    }
    for i in 1..=8 {
        let id = format!("da000000-0000-4000-8000-{:012}", 100 + i);
        let number = format!("K{:02}", i);
        sqlx::query(
            "INSERT INTO floor_tables (id, brand_id, outlet_id, table_type, number, name, seats, zone, sort_order, active) VALUES (?, ?, ?, 'regular', ?, ?, 4, 'Main', ?, 1)",
        )
        .bind(&id)
        .bind(BRAND_2)
        .bind(OUTLET_3)
        .bind(&number)
        .bind(format!("Bar {}", i))
        .bind(i)
        .execute(pool)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO product_groups (id, brand_id, outlet_id, name, color, icon, sort_order, active) VALUES
          (?, ?, NULL, 'Makanan Utama', '#F59E0B', 'chef-hat', 1, 1),
          (?, ?, NULL, 'Pembuka', '#FB7185', 'soup', 2, 1),
          (?, ?, NULL, 'Minuman', '#38BDF8', 'cup-soda', 3, 1),
          (?, ?, NULL, 'Dessert', '#A78BFA', 'ice-cream', 4, 1),
          (?, ?, NULL, 'Paket Hemat', '#34D399', 'package', 5, 1),
          (?, ?, NULL, 'Coffee', '#14B8A6', 'coffee', 1, 1),
          (?, ?, NULL, 'Non Coffee', '#F472B6', 'cup-soda', 2, 1),
          (?, ?, NULL, 'Pastry', '#FBBF24', 'croissant', 3, 1),
          (?, ?, NULL, 'Beans', '#A3E635', 'bean', 4, 1)
        "#,
    )
    .bind(GROUP_FOOD)
    .bind(BRAND_1)
    .bind(GROUP_STARTER)
    .bind(BRAND_1)
    .bind(GROUP_DRINK)
    .bind(BRAND_1)
    .bind(GROUP_DESSERT)
    .bind(BRAND_1)
    .bind(GROUP_PACKAGE)
    .bind(BRAND_1)
    .bind(GROUP_COFFEE)
    .bind(BRAND_2)
    .bind(GROUP_NONCOFFEE)
    .bind(BRAND_2)
    .bind(GROUP_PASTRY)
    .bind(BRAND_2)
    .bind(GROUP_BEANS)
    .bind(BRAND_2)
    .execute(pool)
    .await?;

    let products = [
        (BRAND_1, GROUP_FOOD, "NK-001", "Nasi Goreng Kampung", "Nasi goreng dengan telur mata sapi, ayam suwir, dan sambal rumah.", 58000_i64, "🍛", "#F59E0B", 1),
        (BRAND_1, GROUP_FOOD, "NK-002", "Sate Ayam Madura", "10 tusuk sate ayam dengan bumbu kacang dan lontong.", 65000, "🍢", "#FB923C", 2),
        (BRAND_1, GROUP_FOOD, "NK-003", "Rendang Sapi", "Rendang empuk dengan nasi hangat dan daun singkong.", 78000, "🍖", "#D97706", 3),
        (BRAND_1, GROUP_FOOD, "NK-004", "Mie Goreng Spesial", "Mie goreng dengan seafood, sayur, dan telur.", 54000, "🍜", "#FBBF24", 4),
        (BRAND_1, GROUP_FOOD, "NK-005", "Ayam Bakar Jimbaran", "Ayam bakar dengan sambal matah dan plecing kangkung.", 72000, "🍗", "#F97316", 5),
        (BRAND_1, GROUP_FOOD, "NK-006", "Ikan Bakar Sambal Dabu", "Ikan kakap segar dengan sambal dabu-dabu.", 86000, "🐟", "#38BDF8", 6),
        (BRAND_1, GROUP_STARTER, "NK-011", "Tahu Crispy", "Tahu goreng renyah dengan saus kacang.", 28000, "🧆", "#FCD34D", 1),
        (BRAND_1, GROUP_STARTER, "NK-012", "Lumpia Sayur", "Empat lumpia sayur dengan saus asam manis.", 32000, "🥟", "#FDE68A", 2),
        (BRAND_1, GROUP_STARTER, "NK-013", "Sup Buntut", "Sup buntut sapi dengan wortel dan kentang.", 68000, "🍲", "#FCA5A5", 3),
        (BRAND_1, GROUP_DRINK, "NK-021", "Es Teh Manis", "Teh tubruk dingin dengan gula batu.", 18000, "🧋", "#60A5FA", 1),
        (BRAND_1, GROUP_DRINK, "NK-022", "Es Jeruk Segar", "Jeruk peras dingin tanpa pemanis buatan.", 24000, "🍊", "#FB923C", 2),
        (BRAND_1, GROUP_DRINK, "NK-023", "Mocktail Markisa", "Markisa, soda, dan mint segar.", 38000, "🍹", "#F472B6", 3),
        (BRAND_1, GROUP_DESSERT, "NK-031", "Es Pisang Ijo", "Pisang dalam balutan adonan pandan dan bubur sumsum.", 35000, "🍨", "#34D399", 1),
        (BRAND_1, GROUP_DESSERT, "NK-032", "Klepon Lava", "Klepon dengan isian gula aren cair.", 30000, "🍡", "#A3E635", 2),
        (BRAND_1, GROUP_PACKAGE, "NK-041", "Paket Hemat 1", "Nasi goreng kampung + es teh manis.", 68000, "🍱", "#34D399", 1),
        (BRAND_1, GROUP_PACKAGE, "NK-042", "Paket Keluarga", "Sate ayam, nasi goreng, ayam bakar, dan 4 minuman.", 245000, "🥘", "#10B981", 2),
        (BRAND_2, GROUP_COFFEE, "KS-001", "Senja Latte", "Espresso, susu segar, dan gula aren.", 32000, "☕", "#14B8A6", 1),
        (BRAND_2, GROUP_COFFEE, "KS-002", "Butterscotch Americano", "Americano dengan sirup butterscotch.", 34000, "☕", "#0EA5E9", 2),
        (BRAND_2, GROUP_COFFEE, "KS-003", "Pandan Cold Brew", "Cold brew 12 jam dengan pandan.", 38000, "🧊", "#22C55E", 3),
        (BRAND_2, GROUP_COFFEE, "KS-004", "Kopi Susu Senja", "Signature kopi susu dengan foam lembut.", 30000, "🥛", "#F59E0B", 4),
        (BRAND_2, GROUP_NONCOFFEE, "KS-011", "Matcha Latte", "Matcha Jepang dengan susu oat.", 36000, "🍵", "#84CC16", 1),
        (BRAND_2, GROUP_NONCOFFEE, "KS-012", "Cokelat Panas", "Dark chocolate 70% dengan marshmallow.", 34000, "🍫", "#A16207", 2),
        (BRAND_2, GROUP_NONCOFFEE, "KS-013", "Strawberry Tea", "Teh hitam dengan stroberi segar.", 32000, "🍓", "#FB7185", 3),
        (BRAND_2, GROUP_PASTRY, "KS-021", "Croissant Butter", "Croissant klasik dengan butter Prancis.", 28000, "🥐", "#FBBF24", 1),
        (BRAND_2, GROUP_PASTRY, "KS-022", "Pain au Chocolat", "Pastry berlapis dengan cokelat Belgia.", 32000, "🥖", "#D97706", 2),
        (BRAND_2, GROUP_PASTRY, "KS-023", "Banana Bread", "Roti pisang panggang dengan walnut.", 26000, "🍌", "#FDE047", 3),
        (BRAND_2, GROUP_BEANS, "KS-031", "House Blend 250g", "Biji kopi Arabika Gayo medium roast.", 85000, "🫘", "#A3E635", 1),
        (BRAND_2, GROUP_BEANS, "KS-032", "Ethiopia Guji 250g", "Natural process, notes of berry dan floral.", 125000, "🫘", "#65A30D", 2),
    ];
    for (idx, (brand, group, sku, name, description, price, emoji, color, sort)) in
        products.iter().enumerate()
    {
        let id = format!("eb000000-0000-4000-8000-{:012}", idx + 1);
        sqlx::query(
            r#"
            INSERT INTO products (id, brand_id, outlet_id, group_id, sku, name, description,
              price_cents, color, emoji, sort_order, active)
            VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            "#,
        )
        .bind(id)
        .bind(brand)
        .bind(group)
        .bind(sku)
        .bind(name)
        .bind(description)
        // The demo catalogue is authored in whole Rupiah; storage is cents.
        .bind(*price * 100)
        .bind(color)
        .bind(emoji)
        .bind(sort)
        .execute(pool)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO payment_groups (id, brand_id, outlet_id, name, sort_order, active) VALUES
          (?, ?, NULL, 'Tunai', 1, 1),
          (?, ?, NULL, 'Non Tunai', 2, 1),
          (?, ?, NULL, 'Tunai', 1, 1),
          (?, ?, NULL, 'Non Tunai', 2, 1)
        "#,
    )
    .bind(PAYGROUP_CASH_1)
    .bind(BRAND_1)
    .bind(PAYGROUP_CASHLESS_1)
    .bind(BRAND_1)
    .bind(PAYGROUP_CASH_2)
    .bind(BRAND_2)
    .bind(PAYGROUP_CASHLESS_2)
    .bind(BRAND_2)
    .execute(pool)
    .await?;

    let payments = [
        ("f4000000-0000-4000-8000-000000000001", BRAND_1, PAYGROUP_CASH_1, "CASH", "Tunai", "cash", "banknote", 0, 1, 1),
        ("f4000000-0000-4000-8000-000000000002", BRAND_1, PAYGROUP_CASHLESS_1, "QRIS", "QRIS", "qris", "qr-code", 0, 0, 2),
        ("f4000000-0000-4000-8000-000000000003", BRAND_1, PAYGROUP_CASHLESS_1, "CARD", "Debit / Kredit", "card", "credit-card", 1, 0, 3),
        ("f4000000-0000-4000-8000-000000000004", BRAND_1, PAYGROUP_CASHLESS_1, "EWALLET", "E-Wallet", "ewallet", "wallet", 1, 0, 4),
        ("f4000000-0000-4000-8000-000000000005", BRAND_2, PAYGROUP_CASH_2, "CASH", "Tunai", "cash", "banknote", 0, 1, 1),
        ("f4000000-0000-4000-8000-000000000006", BRAND_2, PAYGROUP_CASHLESS_2, "QRIS", "QRIS", "qris", "qr-code", 0, 0, 2),
        ("f4000000-0000-4000-8000-000000000007", BRAND_2, PAYGROUP_CASHLESS_2, "CARD", "Debit / Kredit", "card", "credit-card", 1, 0, 3),
    ];
    for (id, brand, group, code, name, method, icon, requires_ref, open_drawer, sort) in payments {
        sqlx::query(
            r#"
            INSERT INTO payment_types (id, brand_id, outlet_id, group_id, code, name, method,
              icon, requires_reference, open_drawer, surcharge_rate, sort_order, active)
            VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1)
            "#,
        )
        .bind(id)
        .bind(brand)
        .bind(group)
        .bind(code)
        .bind(name)
        .bind(method)
        .bind(icon)
        .bind(requires_ref)
        .bind(open_drawer)
        .bind(sort)
        .execute(pool)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO promotions (id, brand_id, outlet_id, name, code, type, scope, target_ids,
          value, min_subtotal_cents, max_discount_cents, auto_apply, active) VALUES
          ('f5000000-0000-4000-8000-000000000001', ?, NULL, 'Diskon Gajian 10%', 'GAJIAN10', 'percentage', 'bill', JSON_ARRAY(), 10, 15000000, 5000000, 1, 1),
          ('f5000000-0000-4000-8000-000000000002', ?, NULL, 'Senja Coffee Bundle', 'SENJA5', 'fixed', 'bill', JSON_ARRAY(), 5000, 7500000, 500000, 1, 1)
        "#,
    )
    .bind(BRAND_1)
    .bind(BRAND_2)
    .execute(pool)
    .await?;

    Ok(())
}
