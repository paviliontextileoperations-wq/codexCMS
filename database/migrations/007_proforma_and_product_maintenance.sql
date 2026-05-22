-- Add proforma document workflow and product maintenance records.

SET search_path = cms, public;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_document_type_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_document_type_check
  CHECK (document_type IN ('INVOICE', 'DELIVERY_NOTE', 'RECEIPT', 'PROFORMA'));

ALTER TABLE order_documents
  DROP CONSTRAINT IF EXISTS order_documents_document_type_check;

ALTER TABLE order_documents
  ADD CONSTRAINT order_documents_document_type_check
  CHECK (document_type IN ('INVOICE', 'DELIVERY_NOTE', 'RECEIPT', 'PROFORMA'));

CREATE TABLE IF NOT EXISTS product_maintenance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  reason text NOT NULL CHECK (reason IN ('cannot_find_product', 'missing_physical_barcode', 'wrong_price', 'other')),
  reason_other text,
  associated_sku text,
  note text,
  photo_data_url text,
  diagnostics text,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_maintenance_resolved
  ON product_maintenance_items(resolved, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_maintenance_sku
  ON product_maintenance_items(associated_sku);

DROP TRIGGER IF EXISTS trg_product_maintenance_items_updated_at ON product_maintenance_items;
CREATE TRIGGER trg_product_maintenance_items_updated_at
BEFORE UPDATE ON product_maintenance_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
