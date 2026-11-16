#[derive(Clone, Copy)]
pub struct Resource {
    pub key: &'static str,
    pub table: &'static str,
    pub columns: &'static [&'static str],
    pub mutable: &'static [&'static str],
    pub required: &'static [&'static str],
    pub search: &'static [&'static str],
    pub order: &'static str,
    pub soft_delete: bool,
    pub auto_token: bool,
}

pub const RESOURCES: &[Resource] = &[
    Resource {
        key: "brands",
        table: "brands",
        columns: &[
            "id", "code", "name", "logo_url", "color", "currency", "timezone",
            "tax_rate", "service_charge_rate", "active", "created_at", "updated_at",
        ],
        mutable: &[
            "code", "name", "logo_url", "color", "currency", "timezone",
            "tax_rate", "service_charge_rate", "active",
        ],
        required: &["code", "name"],
        search: &["name", "code"],
        order: "name ASC",
        soft_delete: true,
        auto_token: false,
    },
    Resource {
        key: "outlets",
        table: "outlets",
        columns: &[
            "id", "brand_id", "code", "name", "address", "phone", "timezone",
            "active", "created_at", "updated_at",
        ],
        mutable: &[
            "brand_id", "code", "name", "address", "phone", "timezone", "active",
        ],
        required: &["brand_id", "code", "name"],
        search: &["name", "code", "address"],
        order: "name ASC",
        soft_delete: true,
        auto_token: false,
    },
    Resource {
        key: "clients",
        table: "clients",
        columns: &[
            "id", "outlet_id", "code", "name", "kind", "token", "second_display",
            "slideshow_interval_seconds", "settings", "app_version", "status",
            "last_seen_at", "active", "created_at", "updated_at",
        ],
        mutable: &[
            "outlet_id", "code", "name", "kind", "token", "second_display",
            "slideshow_interval_seconds", "settings", "app_version", "active",
        ],
        required: &["outlet_id", "code", "name"],
        search: &["name", "code", "kind"],
        order: "name ASC",
        soft_delete: true,
        auto_token: true,
    },
    Resource {
        key: "printers",
        table: "printers",
        columns: &[
            "id", "brand_id", "name", "purpose", "ip", "port",
            "paper_width", "model", "active", "created_at", "updated_at",
        ],
        mutable: &[
            "brand_id", "name", "purpose", "ip", "port",
            "paper_width", "model", "active",
        ],
        required: &["brand_id", "name", "ip"],
        search: &["name", "ip", "model"],
        order: "name ASC",
        soft_delete: true,
        auto_token: false,
    },
    Resource {
        key: "sales-modes",
        table: "sales_modes",
        columns: &[
            "id", "brand_id", "outlet_id", "name", "code", "icon", "color",
            "template", "sort_order", "active", "created_at", "updated_at",
        ],
        mutable: &[
            "brand_id", "outlet_id", "name", "code", "icon", "color",
            "template", "sort_order", "active",
        ],
        required: &["brand_id", "name", "template"],
        search: &["name", "code", "template"],
        order: "sort_order ASC, name ASC",
        soft_delete: true,
        auto_token: false,
    },
    Resource {
        key: "tables",
        table: "floor_tables",
        columns: &[
            "id", "brand_id", "outlet_id", "table_type", "number", "name", "seats",
            "zone", "sort_order", "active", "created_at", "updated_at",
        ],
        mutable: &[
            "brand_id", "outlet_id", "table_type", "number", "name", "seats",
            "zone", "sort_order", "active",
        ],
        required: &["brand_id", "outlet_id", "number", "name"],
        search: &["name", "number", "zone", "table_type"],
        order: "sort_order ASC, number ASC",
        soft_delete: true,
        auto_token: false,
    },
    Resource {
        key: "product-groups",
        table: "product_groups",
        columns: &[
            "id", "brand_id", "outlet_id", "name", "color", "icon", "sort_order",
            "active", "created_at", "updated_at",
        ],
        mutable: &[
            "brand_id", "outlet_id", "name", "color", "icon", "sort_order", "active",
        ],
        required: &["brand_id", "name"],
        search: &["name"],
        order: "sort_order ASC, name ASC",
        soft_delete: true,
        auto_token: false,
    },
    Resource {
        key: "products",
        table: "products",
        columns: &[
            "id", "brand_id", "outlet_id", "group_id", "sku", "name", "description",
            "price_cents", "image_url", "color", "emoji", "sort_order", "active",
            "created_at", "updated_at",
        ],
        mutable: &[
            "brand_id", "outlet_id", "group_id", "sku", "name", "description",
            "price_cents", "image_url", "color", "emoji", "sort_order", "active",
        ],
        required: &["brand_id", "group_id", "sku", "name", "price_cents"],
        search: &["name", "sku", "description"],
        order: "sort_order ASC, name ASC",
        soft_delete: true,
        auto_token: false,
    },
    Resource {
        key: "payment-groups",
        table: "payment_groups",
        columns: &[
            "id", "brand_id", "outlet_id", "name", "sort_order", "active",
            "created_at", "updated_at",
        ],
        mutable: &[
            "brand_id", "outlet_id", "name", "sort_order", "active",
        ],
        required: &["brand_id", "name"],
        search: &["name"],
        order: "sort_order ASC, name ASC",
        soft_delete: true,
        auto_token: false,
    },
    Resource {
        key: "payment-types",
        table: "payment_types",
        columns: &[
            "id", "brand_id", "outlet_id", "group_id", "code", "name", "method",
            "icon", "requires_reference", "open_drawer", "surcharge_rate",
            "sort_order", "active", "created_at", "updated_at",
        ],
        mutable: &[
            "brand_id", "outlet_id", "group_id", "code", "name", "method", "icon",
            "requires_reference", "open_drawer", "surcharge_rate",
            "sort_order", "active",
        ],
        required: &["brand_id", "group_id", "name", "method"],
        search: &["name", "code", "method"],
        order: "sort_order ASC, name ASC",
        soft_delete: true,
        auto_token: false,
    },
    Resource {
        key: "promotions",
        table: "promotions",
        columns: &[
            "id", "brand_id", "outlet_id", "name", "code", "type", "scope",
            "target_ids", "value", "min_subtotal_cents", "max_discount_cents",
            "start_at", "end_at", "auto_apply", "active", "created_at", "updated_at",
        ],
        mutable: &[
            "brand_id", "outlet_id", "name", "code", "type", "scope", "target_ids",
            "value", "min_subtotal_cents", "max_discount_cents", "start_at", "end_at",
            "auto_apply", "active",
        ],
        required: &["brand_id", "name", "type", "scope"],
        search: &["name", "code"],
        order: "created_at DESC",
        soft_delete: true,
        auto_token: false,
    },
    Resource {
        key: "roles",
        table: "roles",
        columns: &[
            "id", "name", "description", "is_admin", "permissions", "active",
            "created_at", "updated_at",
        ],
        mutable: &["name", "description", "is_admin", "permissions", "active"],
        required: &["name", "permissions"],
        search: &["name", "description"],
        order: "name ASC",
        soft_delete: true,
        auto_token: false,
    },
];

pub fn find(key: &str) -> Option<&'static Resource> {
    RESOURCES.iter().find(|r| r.key == key)
}
