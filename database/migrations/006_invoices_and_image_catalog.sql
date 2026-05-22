SET search_path = cms, public;

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  invoice_number text NOT NULL UNIQUE,
  invoice_type text NOT NULL CHECK (
    invoice_type IN ('B2B_INVOICE', 'B2C_RECEIPT', 'DELIVERY_NOTE', 'NO_INVOICE', 'PROFORMA')
  ),
  fiscal_status text NOT NULL DEFAULT 'draft' CHECK (fiscal_status IN ('draft', 'issued', 'void', 'cancelled')),
  editable boolean NOT NULL DEFAULT true,
  client_type text REFERENCES lookup_client_types(code),
  tax_profile text NOT NULL DEFAULT 'standard' CHECK (
    tax_profile IN ('standard', 'b2b_spain', 'b2b_eu_vat', 'b2b_international', 'b2c', 'no_tax', 'custom')
  ),
  tax_rate numeric(8, 6) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  vat_rate numeric(8, 6) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0),
  surcharge_rate numeric(8, 6) NOT NULL DEFAULT 0 CHECK (surcharge_rate >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  surcharge_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (surcharge_amount >= 0),
  transport_fee numeric(12, 2) NOT NULL DEFAULT 0 CHECK (transport_fee >= 0),
  total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  amount_paid numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  amount_due numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  preview_html text,
  pdf_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  voided_at timestamptz,
  void_reason text
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_type_status ON invoices(invoice_type, fiscal_status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_tax_profile ON invoices(tax_profile);

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sku_id uuid REFERENCES skus(id) ON DELETE SET NULL,
  line_no integer NOT NULL DEFAULT 1,
  sku_code_snapshot text,
  product_name_snapshot text NOT NULL,
  colour_snapshot text,
  size_snapshot text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  discount_percent numeric(7, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  tax_rate numeric(8, 6) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  line_subtotal numeric(12, 2)
    GENERATED ALWAYS AS (round(unit_price * quantity * (1 - discount_percent / 100), 2)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_sku ON invoice_lines(sku_id);

DROP TRIGGER IF EXISTS trg_invoice_lines_updated_at ON invoice_lines;
CREATE TRIGGER trg_invoice_lines_updated_at
BEFORE UPDATE ON invoice_lines
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS invoice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  document_role text NOT NULL DEFAULT 'pdf' CHECK (document_role IN ('pdf', 'html_preview', 'xml', 'attachment')),
  file_name text NOT NULL,
  cloud_key text,
  url text,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, document_role, file_name)
);

CREATE INDEX IF NOT EXISTS idx_invoice_documents_invoice ON invoice_documents(invoice_id);

CREATE OR REPLACE VIEW v_invoice_export AS
SELECT
  i.id AS invoice_id,
  i.invoice_number,
  i.invoice_type,
  i.fiscal_status,
  i.editable,
  i.client_type,
  i.tax_profile,
  i.tax_rate,
  i.vat_rate,
  i.surcharge_rate,
  c.customer_code,
  COALESCE(c.business_name, trim(c.name || ' ' || COALESCE(c.surname, ''))) AS customer_display_name,
  i.issue_date,
  i.due_date,
  i.subtotal,
  i.tax_amount,
  i.surcharge_amount,
  i.transport_fee,
  i.total,
  i.amount_paid,
  i.amount_due,
  i.pdf_url,
  i.created_at,
  i.updated_at
FROM invoices i
LEFT JOIN customers c ON c.id = i.customer_id;

CREATE OR REPLACE VIEW v_invoice_line_export AS
SELECT
  i.invoice_number,
  i.invoice_type,
  i.fiscal_status,
  il.line_no,
  il.sku_code_snapshot,
  il.product_name_snapshot,
  il.colour_snapshot,
  il.size_snapshot,
  il.quantity,
  il.unit_price,
  il.discount_percent,
  il.tax_rate,
  il.line_subtotal
FROM invoice_lines il
JOIN invoices i ON i.id = il.invoice_id;

CREATE TABLE IF NOT EXISTS image_directories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  directory_key text NOT NULL UNIQUE,
  category text NOT NULL,
  fine_category text,
  model_code text,
  sku_code text,
  cloud_provider text NOT NULL DEFAULT 'aws_s3',
  bucket_name text,
  base_prefix text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_image_directories_updated_at ON image_directories;
CREATE TRIGGER trg_image_directories_updated_at
BEFORE UPDATE ON image_directories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS product_image_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  sku_id uuid REFERENCES skus(id) ON DELETE CASCADE,
  directory_id uuid REFERENCES image_directories(id) ON DELETE SET NULL,
  model_code text NOT NULL,
  sku_code text,
  image_code text NOT NULL,
  image_role text NOT NULL CHECK (
    image_role IN ('front', 'back', 'detail', 'model_front', 'model_back', 'model_extra', 'shein', 'other')
  ),
  file_name text NOT NULL,
  cloud_key text NOT NULL UNIQUE,
  url text,
  mime_type text NOT NULL DEFAULT 'image/jpeg',
  sort_order integer NOT NULL DEFAULT 100,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_image_assets_product ON product_image_assets(product_id);
CREATE INDEX IF NOT EXISTS idx_product_image_assets_sku ON product_image_assets(sku_id);
CREATE INDEX IF NOT EXISTS idx_product_image_assets_model_sku ON product_image_assets(model_code, sku_code);
CREATE INDEX IF NOT EXISTS idx_product_image_assets_role ON product_image_assets(image_role);

DROP TRIGGER IF EXISTS trg_product_image_assets_updated_at ON product_image_assets;
CREATE TRIGGER trg_product_image_assets_updated_at
BEFORE UPDATE ON product_image_assets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE VIEW v_product_image_asset_export AS
SELECT
  COALESCE(p.model_code, pia.model_code) AS model_code,
  COALESCE(s.sku_code, pia.sku_code) AS sku_code,
  pc.colour_code,
  pc.colour_name,
  ps.size_code,
  pia.image_code,
  pia.image_role,
  pia.file_name,
  idr.directory_key,
  pia.cloud_key,
  pia.url,
  pia.uploaded_at
FROM product_image_assets pia
LEFT JOIN products p ON p.id = pia.product_id
LEFT JOIN skus s ON s.id = pia.sku_id
LEFT JOIN product_colours pc ON s.colour_id = pc.id
LEFT JOIN product_sizes ps ON s.size_id = ps.id
LEFT JOIN image_directories idr ON idr.id = pia.directory_id;
