-- CMS PostgreSQL schema.
-- Target: PostgreSQL 14+ / AWS RDS PostgreSQL.

CREATE SCHEMA IF NOT EXISTS cms;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

SET search_path = cms, public;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION normalize_blank(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(value), '')
$$;

CREATE TABLE IF NOT EXISTS lookup_client_types (
  code text PRIMARY KEY,
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS lookup_business_types (
  code text PRIMARY KEY,
  label text NOT NULL,
  requires_vat boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS lookup_customer_statuses (
  code text PRIMARY KEY,
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS lookup_address_types (
  code text PRIMARY KEY,
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS lookup_payment_methods (
  code text PRIMARY KEY,
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS lookup_countries (
  code text PRIMARY KEY,
  name text NOT NULL,
  calling_code text
);

CREATE TABLE IF NOT EXISTS product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  category_level text NOT NULL CHECK (category_level IN ('category', 'fine_category')),
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_id, name, category_level)
);

CREATE TRIGGER trg_product_categories_updated_at
BEFORE UPDATE ON product_categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  model_code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category_id uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  fine_category_id uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  category text NOT NULL,
  fine_category text NOT NULL,
  category2 text,
  category3 text,
  b2b_price numeric(12, 2) NOT NULL CHECK (b2b_price >= 0),
  b2c_markup_percent numeric(7, 2) NOT NULL DEFAULT 100 CHECK (b2c_markup_percent >= 0),
  b2c_price_override numeric(12, 2) CHECK (b2c_price_override IS NULL OR b2c_price_override >= 0),
  b2c_price numeric(12, 2)
    GENERATED ALWAYS AS (
      COALESCE(b2c_price_override, round(b2b_price * (1 + b2c_markup_percent / 100), 2))
    ) STORED,
  main_picture_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  source text NOT NULL DEFAULT 'desktop',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category, fine_category);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS product_compositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material text NOT NULL,
  percentage numeric(6, 2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, material)
);

CREATE TRIGGER trg_product_compositions_updated_at
BEFORE UPDATE ON product_compositions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION enforce_product_composition_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_product_id uuid;
  product_ids uuid[] := ARRAY[]::uuid[];
  row_count integer;
  total numeric(8, 2);
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    product_ids := array_append(product_ids, NEW.product_id);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND (TG_OP = 'DELETE' OR OLD.product_id IS DISTINCT FROM NEW.product_id) THEN
    product_ids := array_append(product_ids, OLD.product_id);
  END IF;

  FOREACH target_product_id IN ARRAY product_ids LOOP
    SELECT count(*), COALESCE(round(sum(percentage), 2), 0)
      INTO row_count, total
    FROM product_compositions
    WHERE product_id = target_product_id;

    IF row_count > 0 AND total <> 100 THEN
      RAISE EXCEPTION 'Product composition total must equal 100. Product %, current total %',
        target_product_id, total;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_composition_total ON product_compositions;
CREATE CONSTRAINT TRIGGER trg_product_composition_total
AFTER INSERT OR UPDATE OR DELETE ON product_compositions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_product_composition_total();

CREATE TABLE IF NOT EXISTS colour_palette (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colour_code text NOT NULL UNIQUE,
  colour_name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_colour_palette_updated_at
BEFORE UPDATE ON colour_palette
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS product_colours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  colour_palette_id uuid REFERENCES colour_palette(id) ON DELETE SET NULL,
  colour_name text NOT NULL,
  colour_code text NOT NULL,
  image_url text,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, colour_code),
  UNIQUE (product_id, colour_name)
);

CREATE INDEX IF NOT EXISTS idx_product_colours_product ON product_colours(product_id);

CREATE TRIGGER trg_product_colours_updated_at
BEFORE UPDATE ON product_colours
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS product_sizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_code text NOT NULL,
  size_label text,
  sort_order integer NOT NULL DEFAULT 100,
  weight_grams numeric(10, 2) CHECK (weight_grams IS NULL OR weight_grams >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, size_code)
);

CREATE INDEX IF NOT EXISTS idx_product_sizes_product ON product_sizes(product_id);

CREATE TRIGGER trg_product_sizes_updated_at
BEFORE UPDATE ON product_sizes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  colour_id uuid NOT NULL REFERENCES product_colours(id) ON DELETE RESTRICT,
  size_id uuid NOT NULL REFERENCES product_sizes(id) ON DELETE RESTRICT,
  sku_code text NOT NULL UNIQUE,
  barcode text UNIQUE,
  other_sku text,
  stock_qty integer NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  low_stock_threshold integer NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  image_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived', 'discontinued')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, colour_id, size_id)
);

CREATE INDEX IF NOT EXISTS idx_skus_product ON skus(product_id);
CREATE INDEX IF NOT EXISTS idx_skus_status ON skus(status);

CREATE TRIGGER trg_skus_updated_at
BEFORE UPDATE ON skus
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS measurement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fine_category text NOT NULL,
  measurement_code text NOT NULL,
  measurement_name text NOT NULL,
  unit text NOT NULL DEFAULT 'cm',
  sort_order integer NOT NULL DEFAULT 100,
  is_required boolean NOT NULL DEFAULT true,
  ui_label text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fine_category, measurement_code)
);

CREATE INDEX IF NOT EXISTS idx_measurement_templates_category ON measurement_templates(fine_category, sort_order);

CREATE TRIGGER trg_measurement_templates_updated_at
BEFORE UPDATE ON measurement_templates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS product_size_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_id uuid NOT NULL REFERENCES product_sizes(id) ON DELETE CASCADE,
  measurement_template_id uuid REFERENCES measurement_templates(id) ON DELETE SET NULL,
  measurement_code text NOT NULL,
  measurement_name text NOT NULL,
  value numeric(10, 2) NOT NULL CHECK (value >= 0),
  unit text NOT NULL DEFAULT 'cm',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, size_id, measurement_code)
);

CREATE INDEX IF NOT EXISTS idx_product_size_measurements_product_size
  ON product_size_measurements(product_id, size_id);

CREATE TRIGGER trg_product_size_measurements_updated_at
BEFORE UPDATE ON product_size_measurements
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  colour_id uuid REFERENCES product_colours(id) ON DELETE CASCADE,
  sku_id uuid REFERENCES skus(id) ON DELETE CASCADE,
  image_role text NOT NULL DEFAULT 'gallery',
  file_name text,
  url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_colour ON product_images(colour_id);
CREATE INDEX IF NOT EXISTS idx_product_images_sku ON product_images(sku_id);

CREATE TRIGGER trg_product_images_updated_at
BEFORE UPDATE ON product_images
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS product_shein (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  shein_name text,
  shein_price numeric(12, 2) CHECK (shein_price IS NULL OR shein_price >= 0),
  shein_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    enabled = false
    OR (normalize_blank(shein_name) IS NOT NULL AND shein_price IS NOT NULL AND normalize_blank(shein_description) IS NOT NULL)
  )
);

CREATE TRIGGER trg_product_shein_updated_at
BEFORE UPDATE ON product_shein
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  customer_code text NOT NULL UNIQUE,
  client_type text NOT NULL REFERENCES lookup_client_types(code),
  name text NOT NULL,
  surname text,
  business_type text REFERENCES lookup_business_types(code),
  business_name text,
  email citext,
  vat_number text,
  tax_rate_percent numeric(7, 2) CHECK (tax_rate_percent IS NULL OR (tax_rate_percent >= 0 AND tax_rate_percent <= 100)),
  status text NOT NULL DEFAULT 'Active' REFERENCES lookup_customer_statuses(code),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    client_type <> 'B2B'
    OR (
      normalize_blank(business_type) IS NOT NULL
      AND normalize_blank(business_name) IS NOT NULL
      AND (business_type = 'INTERNATIONAL' OR normalize_blank(vat_number) IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique
  ON customers(email)
  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name, surname);
CREATE INDEX IF NOT EXISTS idx_customers_client_type ON customers(client_type);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);

CREATE TRIGGER trg_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  address_code text UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  address_type text NOT NULL REFERENCES lookup_address_types(code),
  address_line_1 text NOT NULL,
  address_line_2 text,
  additional_info text,
  postal_code text NOT NULL,
  province_state text NOT NULL,
  country text NOT NULL,
  is_default boolean NOT NULL DEFAULT true,
  same_as_other_address boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_addresses_one_default_per_type
  ON customer_addresses(customer_id, address_type)
  WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);

CREATE TRIGGER trg_customer_addresses_updated_at
BEFORE UPDATE ON customer_addresses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS customer_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  phone_code text UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  country_code text NOT NULL,
  phone_number text NOT NULL,
  full_phone text GENERATED ALWAYS AS (btrim(country_code || ' ' || phone_number)) STORED,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_phones_one_primary
  ON customer_phones(customer_id)
  WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_customer_phones_customer ON customer_phones(customer_id);

CREATE TRIGGER trg_customer_phones_updated_at
BEFORE UPDATE ON customer_phones
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  order_number text NOT NULL UNIQUE,
  document_type text NOT NULL CHECK (document_type IN ('INVOICE', 'DELIVERY_NOTE', 'RECEIPT')),
  document_status text NOT NULL DEFAULT 'open' CHECK (document_status IN ('draft', 'open', 'cancelled', 'converted')),
  delivery_status text NOT NULL DEFAULT 'open' CHECK (
    delivery_status IN (
      'open', 'preparing', 'pending_pickup', 'product_sent', 'pending_reception',
      'completed', 'pending_pickup_client', 'picked_up_client', 'not_prepared',
      'prepared', 'delivered', 'returned'
    )
  ),
  sales_channel text NOT NULL DEFAULT 'physical_store' CHECK (
    sales_channel IN ('physical_store', 'whatsapp', 'website', 'instagram', 'phone', 'b2b_direct', 'marketplace', 'other')
  ),
  source_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_rate numeric(8, 6) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  tax_breakdown jsonb,
  transport_method text CHECK (transport_method IS NULL OR transport_method IN ('PICKUP', 'DELIVERY')),
  transport_label text,
  transport_fee numeric(12, 2) NOT NULL DEFAULT 0 CHECK (transport_fee >= 0),
  total numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  payment_status text NOT NULL DEFAULT 'OPEN' CHECK (payment_status IN ('PAID', 'PARTIAL', 'OPEN')),
  amount_paid numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  amount_due numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  stock_movement_created boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  cancelled_by text,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders(delivery_status);

CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku_id uuid REFERENCES skus(id) ON DELETE SET NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  sku_code_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  size_snapshot text,
  colour_snapshot text,
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  discount_percent numeric(7, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  line_subtotal numeric(12, 2)
    GENERATED ALWAYS AS (round(unit_price * quantity * (1 - discount_percent / 100), 2)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_sku ON order_lines(sku_id);

CREATE TRIGGER trg_order_lines_updated_at
BEFORE UPDATE ON order_lines
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  method text NOT NULL REFERENCES lookup_payment_methods(code),
  note text,
  payment_date timestamptz NOT NULL DEFAULT now(),
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_payments_order ON order_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_date ON order_payments(payment_date DESC);

CREATE TRIGGER trg_order_payments_updated_at
BEFORE UPDATE ON order_payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_id uuid REFERENCES order_lines(id) ON DELETE SET NULL,
  sku_id uuid REFERENCES skus(id) ON DELETE SET NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  reason text CHECK (
    reason IS NULL OR reason IN ('customer_changed_mind', 'defective', 'wrong_size', 'wrong_item', 'damaged', 'other')
  ),
  condition text CHECK (condition IS NULL OR condition IN ('resellable', 'damaged', 'repair_needed')),
  refund_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  refund_method text REFERENCES lookup_payment_methods(code),
  stock_action text NOT NULL DEFAULT 'back_to_stock' CHECK (stock_action IN ('back_to_stock', 'repair', 'discard', 'no_stock_change')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_returns_order ON order_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_order_returns_sku ON order_returns(sku_id);

CREATE TRIGGER trg_order_returns_updated_at
BEFORE UPDATE ON order_returns
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS order_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('INVOICE', 'DELIVERY_NOTE', 'RECEIPT')),
  document_number text NOT NULL UNIQUE,
  file_url text,
  file_sha256 text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('draft', 'issued', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_documents_order ON order_documents(order_id);

CREATE TRIGGER trg_order_documents_updated_at
BEFORE UPDATE ON order_documents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  sku_id uuid NOT NULL REFERENCES skus(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('sale', 'return', 'cancel_restore', 'adjustment', 'initial_import')),
  document_id uuid,
  quantity_change integer NOT NULL,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_sku ON inventory_movements(sku_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements(created_at DESC);

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('developer', 'operator')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_app_settings_updated_at
BEFORE UPDATE ON app_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor text,
  action text NOT NULL,
  entity_table text NOT NULL,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_table, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

INSERT INTO lookup_client_types (code, label) VALUES
  ('B2B', 'Business'),
  ('B2C', 'Consumer')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label;

INSERT INTO lookup_business_types (code, label, requires_vat) VALUES
  ('ESP AUTONOMO', 'Spain self-employed', true),
  ('ESP EMPRESA', 'Spain company', true),
  ('EU VAT', 'EU VAT registered', true),
  ('EU LOCAL', 'EU local', true),
  ('INTERNATIONAL', 'International', false)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, requires_vat = EXCLUDED.requires_vat;

INSERT INTO lookup_customer_statuses (code, label) VALUES
  ('Active', 'Active'),
  ('Inactive', 'Inactive'),
  ('Lead', 'Lead'),
  ('Pending', 'Pending'),
  ('Blocked', 'Blocked')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label;

INSERT INTO lookup_address_types (code, label) VALUES
  ('Fiscal', 'Fiscal'),
  ('Logistics', 'Logistics')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label;

INSERT INTO lookup_payment_methods (code, label) VALUES
  ('CARD', 'Card'),
  ('CASH', 'Cash'),
  ('TRANSFER', 'Bank transfer'),
  ('OTHER', 'Other')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label;

INSERT INTO lookup_countries (code, name, calling_code) VALUES
  ('ES', 'Spain', '+34'),
  ('FR', 'France', '+33'),
  ('DE', 'Germany', '+49'),
  ('IT', 'Italy', '+39'),
  ('GB', 'United Kingdom', '+44')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, calling_code = EXCLUDED.calling_code;
