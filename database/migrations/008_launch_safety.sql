-- Launch safety fixes for multi-desktop operation.
-- Keeps serial numbers and stock balances authoritative in PostgreSQL.

SET search_path = cms, public;

CREATE TABLE IF NOT EXISTS document_serials (
  document_type text PRIMARY KEY CHECK (document_type IN ('INVOICE', 'RECEIPT', 'DELIVERY_NOTE', 'PROFORMA')),
  prefix text NOT NULL,
  next_counter integer NOT NULL DEFAULT 1 CHECK (next_counter > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_document_serials_updated_at ON document_serials;
CREATE TRIGGER trg_document_serials_updated_at
BEFORE UPDATE ON document_serials
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO document_serials (document_type, prefix, next_counter)
VALUES
  ('INVOICE', 'INV', 1),
  ('RECEIPT', 'INVC', 1),
  ('DELIVERY_NOTE', 'A', 1),
  ('PROFORMA', 'PRO', 1)
ON CONFLICT (document_type) DO NOTHING;

WITH main_warehouse AS (
  SELECT id FROM warehouses WHERE code = 'MAIN'
),
main_location AS (
  SELECT wl.id
  FROM warehouse_locations wl
  JOIN main_warehouse mw ON mw.id = wl.warehouse_id
  WHERE wl.location_code = 'A-01-01'
)
INSERT INTO sku_inventory_balances (
  sku_id,
  warehouse_id,
  location_id,
  qty,
  min_qty,
  last_counted_at
)
SELECT
  s.id,
  mw.id,
  ml.id,
  s.stock_qty,
  s.low_stock_threshold,
  now()
FROM skus s
CROSS JOIN main_warehouse mw
CROSS JOIN main_location ml
WHERE NOT EXISTS (
  SELECT 1
  FROM sku_inventory_balances b
  WHERE b.sku_id = s.id
)
ON CONFLICT (sku_id, warehouse_id, location_id) DO NOTHING;
