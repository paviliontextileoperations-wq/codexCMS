SET search_path = cms, public;

ALTER TABLE order_documents
  DROP CONSTRAINT IF EXISTS order_documents_document_type_check;

ALTER TABLE order_documents
  ADD CONSTRAINT order_documents_document_type_check
  CHECK (document_type IN ('INVOICE', 'DELIVERY_NOTE', 'RECEIPT', 'PROFORMA', 'SHIPPING_LABEL'));

CREATE INDEX IF NOT EXISTS idx_order_documents_type
  ON order_documents(document_type, issued_at DESC);
