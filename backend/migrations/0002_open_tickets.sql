-- Open tickets let order-station terminals send an order to a cashier without
-- performing payment. A cashier claims the ticket, converts it into a bill and
-- the ticket is closed automatically by /api/pos/sales.

CREATE TABLE IF NOT EXISTS pos_tickets (
  id CHAR(36) PRIMARY KEY,
  ticket_no VARCHAR(64) NOT NULL,
  brand_id CHAR(36) NOT NULL,
  outlet_id CHAR(36) NOT NULL,
  client_id CHAR(36) NOT NULL,
  created_by CHAR(36) NULL,
  created_by_name VARCHAR(120) NOT NULL DEFAULT '',
  table_id CHAR(36) NULL,
  table_name VARCHAR(80) NOT NULL DEFAULT '',
  sales_mode_id CHAR(36) NULL,
  sales_mode_name VARCHAR(80) NOT NULL DEFAULT '',
  customer_name VARCHAR(120) NOT NULL DEFAULT '',
  note VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  subtotal_cents BIGINT NOT NULL DEFAULT 0,
  bill_id CHAR(36) NULL,
  claimed_by CHAR(36) NULL,
  claimed_by_name VARCHAR(120) NOT NULL DEFAULT '',
  claimed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uniq_ticket_no (ticket_no),
  KEY idx_ticket_outlet (outlet_id, status, created_at),
  CONSTRAINT fk_ticket_brand FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_outlet FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_ticket_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pos_ticket_items (
  id CHAR(36) PRIMARY KEY,
  ticket_id CHAR(36) NOT NULL,
  product_id CHAR(36) NULL,
  sku VARCHAR(64) NOT NULL DEFAULT '',
  name VARCHAR(160) NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  unit_price_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL DEFAULT 0,
  note VARCHAR(255) NOT NULL DEFAULT '',
  KEY idx_ticket_item (ticket_id),
  CONSTRAINT fk_ticket_item_ticket FOREIGN KEY (ticket_id) REFERENCES pos_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_item_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
