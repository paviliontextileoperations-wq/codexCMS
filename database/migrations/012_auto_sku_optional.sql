SET search_path = cms, public;

ALTER TABLE skus
  ALTER COLUMN sku_code DROP NOT NULL;

COMMENT ON COLUMN skus.sku_code IS 'Automatic SKU generated only when the source product ID can be parsed into model + colour + size.';
COMMENT ON COLUMN skus.other_sku IS 'Other SKU/source product ID kept when the source code should not be decomposed or when a legacy code needs search support.';

DROP VIEW IF EXISTS v_product_sku_export;

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
  p.updated_at,
  s.sku_code AS auto_sku,
  s.other_sku AS source_sku,
  s.sku_code AS new_sku,
  s.other_sku AS old_sku
FROM skus s
JOIN products p ON p.id = s.product_id
JOIN product_colours pc ON pc.id = s.colour_id
JOIN product_sizes ps ON ps.id = s.size_id;
