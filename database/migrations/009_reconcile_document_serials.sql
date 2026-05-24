-- Reconcile cloud document counters with existing documents.

SET search_path = cms, public;

WITH serial_max AS (
  SELECT
    ds.document_type,
    COALESCE(max(substring(o.order_number from length(ds.prefix) + 2)::integer), 0) + 1 AS next_counter
  FROM document_serials ds
  LEFT JOIN orders o
    ON o.document_type = ds.document_type
   AND o.order_number ~ ('^' || ds.prefix || '-[0-9]+$')
  GROUP BY ds.document_type
)
UPDATE document_serials ds
SET next_counter = greatest(ds.next_counter, serial_max.next_counter)
FROM serial_max
WHERE serial_max.document_type = ds.document_type;
