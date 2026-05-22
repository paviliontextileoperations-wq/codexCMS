SET search_path = cms, public;

CREATE OR REPLACE VIEW v_product_sku_export AS
SELECT
  p.id AS product_id,
  p.model_code,
  p.name AS product_name,
  p.description,
  p.category,
  p.fine_category,
  p.category2,
  p.category3,
  p.b2b_price,
  p.b2c_markup_percent,
  p.b2c_price,
  pc.colour_code,
  pc.colour_name,
  ps.size_code,
  ps.weight_grams,
  s.id AS sku_id,
  s.sku_code,
  s.barcode,
  s.other_sku,
  s.stock_qty,
  s.low_stock_threshold,
  s.status AS sku_status,
  COALESCE(s.image_url, pc.image_url, p.main_picture_url) AS image_url,
  (
    SELECT string_agg(c.material || ' ' || trim(to_char(c.percentage, 'FM999990.00')) || '%', ', ' ORDER BY c.sort_order, c.material)
    FROM product_compositions c
    WHERE c.product_id = p.id
  ) AS composition,
  p.created_at,
  p.updated_at
FROM skus s
JOIN products p ON p.id = s.product_id
JOIN product_colours pc ON pc.id = s.colour_id
JOIN product_sizes ps ON ps.id = s.size_id;

CREATE OR REPLACE VIEW v_product_measurement_export AS
SELECT
  p.model_code,
  p.name AS product_name,
  p.fine_category,
  ps.size_code,
  m.measurement_code,
  m.measurement_name,
  m.value,
  m.unit,
  mt.is_required,
  mt.sort_order
FROM product_size_measurements m
JOIN products p ON p.id = m.product_id
JOIN product_sizes ps ON ps.id = m.size_id
LEFT JOIN measurement_templates mt ON mt.id = m.measurement_template_id;

CREATE OR REPLACE VIEW v_customer_export AS
SELECT
  c.id AS customer_id,
  c.customer_code,
  c.client_type,
  c.name,
  c.surname,
  c.business_type,
  c.business_name,
  c.email,
  c.vat_number,
  c.tax_rate_percent,
  c.status,
  cp.country_code AS primary_phone_country_code,
  cp.phone_number AS primary_phone_number,
  cp.full_phone AS primary_phone,
  fiscal.address_line_1 AS fiscal_address_line_1,
  fiscal.address_line_2 AS fiscal_address_line_2,
  fiscal.additional_info AS fiscal_additional_info,
  fiscal.postal_code AS fiscal_postal_code,
  fiscal.province_state AS fiscal_province_state,
  fiscal.country AS fiscal_country,
  logistics.address_line_1 AS logistics_address_line_1,
  logistics.address_line_2 AS logistics_address_line_2,
  logistics.additional_info AS logistics_additional_info,
  logistics.postal_code AS logistics_postal_code,
  logistics.province_state AS logistics_province_state,
  logistics.country AS logistics_country,
  c.notes,
  c.created_at,
  c.updated_at
FROM customers c
LEFT JOIN customer_phones cp
  ON cp.customer_id = c.id AND cp.is_primary
LEFT JOIN customer_addresses fiscal
  ON fiscal.customer_id = c.id AND fiscal.address_type = 'Fiscal' AND fiscal.is_default
LEFT JOIN customer_addresses logistics
  ON logistics.customer_id = c.id AND logistics.address_type = 'Logistics' AND logistics.is_default;

CREATE OR REPLACE VIEW v_order_export AS
SELECT
  o.id AS order_id,
  o.order_number,
  o.document_type,
  o.document_status,
  o.delivery_status,
  o.sales_channel,
  c.customer_code,
  COALESCE(c.business_name, trim(c.name || ' ' || COALESCE(c.surname, ''))) AS customer_display_name,
  c.client_type,
  o.subtotal,
  o.tax_rate,
  o.tax_amount,
  o.transport_method,
  o.transport_label,
  o.transport_fee,
  o.total,
  o.payment_status,
  o.amount_paid,
  o.amount_due,
  o.created_at,
  o.updated_at
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id;

CREATE OR REPLACE VIEW v_order_line_export AS
SELECT
  o.order_number,
  o.document_type,
  o.created_at AS order_created_at,
  ol.id AS order_line_id,
  ol.sku_code_snapshot,
  ol.product_name_snapshot,
  ol.size_snapshot,
  ol.colour_snapshot,
  ol.unit_price,
  ol.quantity,
  ol.discount_percent,
  ol.line_subtotal
FROM order_lines ol
JOIN orders o ON o.id = ol.order_id;

CREATE OR REPLACE VIEW v_inventory_export AS
SELECT
  im.id AS inventory_movement_id,
  im.created_at,
  im.movement_type,
  p.model_code,
  s.sku_code,
  pc.colour_code,
  pc.colour_name,
  ps.size_code,
  im.quantity_change,
  im.notes,
  im.document_id,
  im.created_by
FROM inventory_movements im
JOIN skus s ON s.id = im.sku_id
JOIN products p ON p.id = s.product_id
JOIN product_colours pc ON pc.id = s.colour_id
JOIN product_sizes ps ON ps.id = s.size_id;
