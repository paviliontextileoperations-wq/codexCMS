SET search_path = cms, public;

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
    FROM cms.product_compositions
    WHERE product_id = target_product_id;

    IF row_count > 0 AND total <> 100 THEN
      RAISE EXCEPTION 'Product composition total must equal 100. Product %, current total %',
        target_product_id, total;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;
