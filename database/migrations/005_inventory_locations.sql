SET search_path = cms, public;

CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  address_line_1 text,
  province_state text,
  country text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_warehouses_updated_at ON warehouses;
CREATE TRIGGER trg_warehouses_updated_at
BEFORE UPDATE ON warehouses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS warehouse_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  location_code text NOT NULL,
  location_label text,
  zone text,
  aisle text,
  shelf text,
  bin text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, location_code)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_locations_warehouse
  ON warehouse_locations(warehouse_id);

DROP TRIGGER IF EXISTS trg_warehouse_locations_updated_at ON warehouse_locations;
CREATE TRIGGER trg_warehouse_locations_updated_at
BEFORE UPDATE ON warehouse_locations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS sku_inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  qty integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  reserved_qty integer NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  min_qty integer NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  last_counted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sku_id, warehouse_id, location_id),
  CHECK (reserved_qty <= qty)
);

CREATE INDEX IF NOT EXISTS idx_sku_inventory_balances_sku
  ON sku_inventory_balances(sku_id);
CREATE INDEX IF NOT EXISTS idx_sku_inventory_balances_location
  ON sku_inventory_balances(warehouse_id, location_id);

DROP TRIGGER IF EXISTS trg_sku_inventory_balances_updated_at ON sku_inventory_balances;
CREATE TRIGGER trg_sku_inventory_balances_updated_at
BEFORE UPDATE ON sku_inventory_balances
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_qty integer,
  ADD COLUMN IF NOT EXISTS new_qty integer,
  ADD COLUMN IF NOT EXISTS reason_category text,
  ADD COLUMN IF NOT EXISTS external_reference text;

ALTER TABLE inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_movement_type_check
  CHECK (
    movement_type IN (
      'sale',
      'return',
      'cancel_restore',
      'adjustment',
      'initial_import',
      'inbound',
      'outbound',
      'stocktake',
      'transfer'
    )
  );

CREATE INDEX IF NOT EXISTS idx_inventory_movements_warehouse_location
  ON inventory_movements(warehouse_id, location_id);

INSERT INTO warehouses (code, name, country)
VALUES
  ('MAIN', 'Main Warehouse', 'Spain'),
  ('SHOP', 'Shop Floor', 'Spain'),
  ('RETURNS', 'Returns Area', 'Spain')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  country = EXCLUDED.country,
  updated_at = now();

WITH main_warehouse AS (
  SELECT id FROM warehouses WHERE code = 'MAIN'
)
INSERT INTO warehouse_locations (
  warehouse_id,
  location_code,
  location_label,
  zone,
  aisle,
  shelf,
  bin
)
SELECT
  main_warehouse.id,
  location.location_code,
  location.location_label,
  location.zone,
  location.aisle,
  location.shelf,
  location.bin
FROM main_warehouse
CROSS JOIN (
  VALUES
    ('A-01-01', 'Zone A / Aisle 01 / Shelf 01', 'A', '01', '01', null),
    ('A-01-02', 'Zone A / Aisle 01 / Shelf 02', 'A', '01', '02', null),
    ('B-01-01', 'Zone B / Aisle 01 / Shelf 01', 'B', '01', '01', null),
    ('RET-01', 'Returns inspection rack', 'RET', '01', null, null)
) AS location(location_code, location_label, zone, aisle, shelf, bin)
ON CONFLICT (warehouse_id, location_code) DO UPDATE SET
  location_label = EXCLUDED.location_label,
  zone = EXCLUDED.zone,
  aisle = EXCLUDED.aisle,
  shelf = EXCLUDED.shelf,
  bin = EXCLUDED.bin,
  updated_at = now();

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
  FROM sku_inventory_balances existing
  WHERE existing.sku_id = s.id
)
ON CONFLICT (sku_id, warehouse_id, location_id) DO UPDATE SET
  qty = EXCLUDED.qty,
  min_qty = EXCLUDED.min_qty,
  updated_at = now();

CREATE OR REPLACE FUNCTION sync_sku_stock_from_balances()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_sku_id uuid;
BEGIN
  target_sku_id := COALESCE(NEW.sku_id, OLD.sku_id);

  UPDATE cms.skus
  SET
    stock_qty = COALESCE((
      SELECT sum(qty)::integer
      FROM cms.sku_inventory_balances
      WHERE sku_id = target_sku_id
    ), 0),
    low_stock_threshold = COALESCE((
      SELECT max(min_qty)::integer
      FROM cms.sku_inventory_balances
      WHERE sku_id = target_sku_id
    ), low_stock_threshold),
    updated_at = now()
  WHERE id = target_sku_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sku_stock_from_balances ON sku_inventory_balances;
CREATE TRIGGER trg_sync_sku_stock_from_balances
AFTER INSERT OR UPDATE OR DELETE ON sku_inventory_balances
FOR EACH ROW EXECUTE FUNCTION sync_sku_stock_from_balances();

CREATE OR REPLACE VIEW v_inventory_balance_export AS
SELECT
  p.model_code,
  p.name AS product_name,
  s.sku_code,
  pc.colour_code,
  pc.colour_name,
  ps.size_code,
  w.code AS warehouse_code,
  w.name AS warehouse_name,
  wl.location_code,
  wl.location_label,
  b.qty,
  b.reserved_qty,
  b.qty - b.reserved_qty AS available_qty,
  b.min_qty,
  CASE
    WHEN b.qty = 0 THEN 'out_of_stock'
    WHEN b.qty <= b.min_qty THEN 'low_stock'
    ELSE 'in_stock'
  END AS stock_status,
  b.last_counted_at,
  b.updated_at
FROM sku_inventory_balances b
JOIN skus s ON s.id = b.sku_id
JOIN products p ON p.id = s.product_id
JOIN product_colours pc ON pc.id = s.colour_id
JOIN product_sizes ps ON ps.id = s.size_id
JOIN warehouses w ON w.id = b.warehouse_id
LEFT JOIN warehouse_locations wl ON wl.id = b.location_id;

DROP VIEW IF EXISTS v_inventory_export;

CREATE OR REPLACE VIEW v_inventory_export AS
SELECT
  im.id AS inventory_movement_id,
  im.created_at,
  im.movement_type,
  im.reason_category,
  p.model_code,
  s.sku_code,
  pc.colour_code,
  pc.colour_name,
  ps.size_code,
  w.code AS warehouse_code,
  w.name AS warehouse_name,
  wl.location_code,
  wl.location_label,
  im.previous_qty,
  im.quantity_change,
  im.new_qty,
  im.notes,
  im.document_id,
  im.external_reference,
  im.created_by
FROM inventory_movements im
JOIN skus s ON s.id = im.sku_id
JOIN products p ON p.id = s.product_id
JOIN product_colours pc ON pc.id = s.colour_id
JOIN product_sizes ps ON ps.id = s.size_id
LEFT JOIN warehouses w ON w.id = im.warehouse_id
LEFT JOIN warehouse_locations wl ON wl.id = im.location_id;
