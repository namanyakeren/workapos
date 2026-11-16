-- WORKAPOS HQ — printer outlet assignments
-- A single network printer can now be deployed to many outlets.
-- The legacy printers.outlet_id column is migrated into this join table.

CREATE TABLE IF NOT EXISTS printer_outlets (
  printer_id CHAR(36) NOT NULL,
  outlet_id CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (printer_id, outlet_id),
  KEY idx_printer_outlet_outlet (outlet_id),
  CONSTRAINT fk_po_printer FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_outlet FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO printer_outlets (printer_id, outlet_id)
SELECT id, outlet_id FROM printers WHERE outlet_id IS NOT NULL;

ALTER TABLE printers DROP FOREIGN KEY fk_printer_outlet;
ALTER TABLE printers DROP COLUMN outlet_id;
