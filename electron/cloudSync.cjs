const { createDatabaseClient, loadDotEnv } = require("./database.cjs");
const { importSnapshot } = require("../scripts/db/import-localstorage.cjs");
const zlib = require("node:zlib");

const CORE_KEYS = [
  "form.products.v1",
  "form.customers.v1",
  "form.sales.v1",
  "form.inventoryMovements.v1",
  "form.inventoryLocations.v1",
  "form.productMaintenance.v1",
  "form.imageGallery.v1",
  "app.products.defaultB2cMarkupPercent",
];

const MERGEABLE_ARRAY_KEYS = new Set([
  "form.products.v1",
  "form.customers.v1",
  "form.sales.v1",
  "form.inventoryMovements.v1",
  "form.inventoryLocations.v1",
  "form.productMaintenance.v1",
  "form.imageGallery.v1",
  "form.approvals.v1",
  "form.opLog.v1",
]);

const NORMALIZED_SYNC_KEYS = new Set([
  "form.products.v1",
  "form.customers.v1",
  "form.sales.v1",
  "form.inventoryMovements.v1",
  "form.imageGallery.v1",
  "form.productMaintenance.v1",
]);

const KEY_ALIASES = {
  "products.v1": "form.products.v1",
  "customers.v1": "form.customers.v1",
  "sales.v1": "form.sales.v1",
  "orders.v1": "form.sales.v1",
  "inventory.v1": "form.inventoryMovements.v1",
  "imageGallery.v1": "form.imageGallery.v1",
};

const DEFAULT_SERIALS = {
  INVOICE: { prefix: "INV", counter: 1 },
  RECEIPT: { prefix: "INVC", counter: 1 },
  DELIVERY_NOTE: { prefix: "A", counter: 1 },
  PROFORMA: { prefix: "PRO", counter: 1 },
};

const DOCUMENT_TYPES = new Set(["INVOICE", "DELIVERY_NOTE", "RECEIPT", "PROFORMA"]);
const DOCUMENT_STATUSES = new Set(["draft", "open", "cancelled", "converted"]);
const DELIVERY_STATUSES = new Set([
  "open",
  "preparing",
  "pending_pickup",
  "product_sent",
  "pending_reception",
  "completed",
  "pending_pickup_client",
  "picked_up_client",
  "not_prepared",
  "prepared",
  "delivered",
  "returned",
]);
const PAYMENT_STATUSES = new Set(["PAID", "PARTIAL", "OPEN"]);
const PAYMENT_METHODS = new Set(["CARD", "CASH", "TRANSFER", "OTHER"]);
const SYNC_COMPRESSION_THRESHOLD_BYTES = 256 * 1024;

function oneOf(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function normalizeSyncKeys(keys) {
  return keys.map((key) => KEY_ALIASES[key] || key);
}

function apiBaseUrl() {
  loadDotEnv();
  const value = process.env.API_BASE_URL;
  return value ? value.replace(/\/+$/, "") : "";
}

async function apiRequest(path, payload) {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) return null;
  const headers = { "content-type": "application/json" };
  if (process.env.API_KEY) {
    headers["x-api-key"] = process.env.API_KEY;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload ?? {}),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body.message || `API request failed with ${response.status}`);
  }
  return body;
}

function decodeLargeSyncRecords(result) {
  if (!Array.isArray(result?.records)) return result;
  return {
    ...result,
    records: result.records.map((record) => {
      if (record?.encoding !== "gzip-base64" || typeof record.raw !== "string") return record;
      return {
        ...record,
        raw: zlib.gunzipSync(Buffer.from(record.raw, "base64")).toString("utf8"),
        encoding: undefined,
      };
    }),
  };
}

function encodeLargeSyncRecords(payload) {
  if (!Array.isArray(payload?.records)) return payload;
  return {
    ...payload,
    records: payload.records.map((record) => {
      if (typeof record?.raw !== "string") return record;
      const rawBytes = Buffer.byteLength(record.raw);
      if (rawBytes < SYNC_COMPRESSION_THRESHOLD_BYTES) return record;
      const compressed = zlib.gzipSync(record.raw);
      return {
        ...record,
        raw: compressed.toString("base64"),
        encoding: "gzip-base64",
        rawBytes,
        encodedBytes: compressed.length,
      };
    }),
  };
}

async function ensureAppSettings(client) {
  await client.query("CREATE SCHEMA IF NOT EXISTS cms");
  await client.query(`
    CREATE TABLE IF NOT EXISTS cms.app_settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

function parseRawArray(raw) {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function syncItemKey(item, index) {
  if (!item || typeof item !== "object") return `index:${index}`;
  return (
    item.id ??
    item.productId ??
    item.fileName ??
    item.invoiceNumber ??
    item.orderNumber ??
    `index:${index}`
  );
}

function syncItemTimestamp(item) {
  if (!item || typeof item !== "object") return 0;
  const raw =
    item.updatedAt ??
    item.deletedAt ??
    item.resolvedAt ??
    item.createdAt ??
    item.paymentDate ??
    0;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : 0;
}

function mergeArrayRaw(existingRaw, incomingRaw) {
  const existing = parseRawArray(existingRaw);
  const incoming = parseRawArray(incomingRaw);
  if (!existing || !incoming) return incomingRaw;

  const byKey = new Map();
  const order = [];
  const put = (item, index, preferIncoming = false) => {
    const key = String(syncItemKey(item, index));
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, item);
      order.push(key);
      return;
    }
    const currentTs = syncItemTimestamp(current);
    const nextTs = syncItemTimestamp(item);
    if (preferIncoming || nextTs >= currentTs) {
      byKey.set(key, item);
    }
  };

  existing.forEach((item, index) => put(item, index));
  incoming.forEach((item, index) => put(item, index, false));

  const incomingKeys = new Set(incoming.map((item, index) => String(syncItemKey(item, index))));
  const nextOrder = [
    ...incoming.map((item, index) => String(syncItemKey(item, index))),
    ...order.filter((key) => !incomingKeys.has(key)),
  ];
  return JSON.stringify(nextOrder.map((key) => byKey.get(key)).filter(Boolean));
}

function toMs(value) {
  if (!value) return Date.now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : Date.now();
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function uuidOrNull(value) {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function warehouseCodeFor(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "shop" || text === "shop floor" || text === "sala de ventas") return "SHOP";
  if (text === "returns" || text === "returns area" || text === "zona de devoluciones") return "RETURNS";
  if (/^[A-Z0-9_-]+$/.test(String(value || "").trim()) && String(value).trim().length <= 16) {
    return String(value).trim().toUpperCase();
  }
  return "MAIN";
}

function warehouseNameFor(code) {
  if (code === "SHOP") return "Shop Floor";
  if (code === "RETURNS") return "Returns Area";
  return "Main Warehouse";
}

async function ensureWarehouseAndLocation(client, warehouseInput, locationInput) {
  const warehouseCode = warehouseCodeFor(warehouseInput);
  const warehouse = await client.query(
    `
      INSERT INTO cms.warehouses (code, name, country)
      VALUES ($1, $2, 'Spain')
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
      RETURNING id, code
    `,
    [warehouseCode, warehouseNameFor(warehouseCode)],
  );
  const warehouseId = warehouse.rows[0].id;
  const locationCode = String(locationInput || "A-01-01").trim() || "A-01-01";
  const location = await client.query(
    `
      INSERT INTO cms.warehouse_locations (warehouse_id, location_code, location_label)
      VALUES ($1, $2, $2)
      ON CONFLICT (warehouse_id, location_code) DO UPDATE SET
        location_label = EXCLUDED.location_label,
        updated_at = now()
      RETURNING id, location_code
    `,
    [warehouseId, locationCode],
  );
  return {
    warehouseId,
    warehouseCode,
    locationId: location.rows[0].id,
    locationCode,
  };
}

async function ensureDocumentSerials(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cms.document_serials (
      document_type text PRIMARY KEY CHECK (document_type IN ('INVOICE', 'RECEIPT', 'DELIVERY_NOTE', 'PROFORMA')),
      prefix text NOT NULL,
      next_counter integer NOT NULL DEFAULT 1 CHECK (next_counter > 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  for (const [documentType, defaults] of Object.entries(DEFAULT_SERIALS)) {
    await client.query(
      `
        INSERT INTO cms.document_serials (document_type, prefix, next_counter)
        VALUES ($1, $2, $3)
        ON CONFLICT (document_type) DO NOTHING
      `,
      [documentType, defaults.prefix, defaults.counter],
    );
  }
  await client.query(`
    WITH serial_max AS (
      SELECT
        ds.document_type,
        COALESCE(max(substring(o.order_number from length(ds.prefix) + 2)::integer), 0) + 1 AS next_counter
      FROM cms.document_serials ds
      LEFT JOIN cms.orders o
        ON o.document_type = ds.document_type
       AND o.order_number ~ ('^' || ds.prefix || '-[0-9]+$')
      GROUP BY ds.document_type
    )
    UPDATE cms.document_serials ds
    SET next_counter = greatest(ds.next_counter, serial_max.next_counter)
    FROM serial_max
    WHERE serial_max.document_type = ds.document_type
  `);
}

function formatSerial(prefix, counter) {
  return `${prefix}-${String(counter).padStart(3, "0")}`;
}

async function allocateSerialInDatabase(client, payload = {}) {
  const documentType = oneOf(payload.documentType, DOCUMENT_TYPES, "INVOICE");
  const defaults = DEFAULT_SERIALS[documentType] ?? DEFAULT_SERIALS.INVOICE;
  await ensureDocumentSerials(client);
  await client.query("BEGIN");
  try {
    await client.query(
      `
        INSERT INTO cms.document_serials (document_type, prefix, next_counter)
        VALUES ($1, $2, $3)
        ON CONFLICT (document_type) DO NOTHING
      `,
      [documentType, payload.prefix || defaults.prefix, Math.max(1, Math.round(toNumber(payload.counter, defaults.counter)))],
    );
    const current = await client.query(
      `
        SELECT prefix, next_counter
        FROM cms.document_serials
        WHERE document_type = $1
        FOR UPDATE
      `,
      [documentType],
    );
    const row = current.rows[0] || defaults;
    const counter = Math.max(1, Math.round(toNumber(row.next_counter, defaults.counter)));
    const serial = formatSerial(row.prefix || defaults.prefix, counter);
    await client.query(
      `
        UPDATE cms.document_serials
        SET next_counter = $2, updated_at = now()
        WHERE document_type = $1
      `,
      [documentType, counter + 1],
    );
    await client.query("COMMIT");
    return { ok: true, documentType, serial, nextCounter: counter + 1 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function allocateSerial(payload = {}) {
  if (!payload.skipApi) {
    const apiResult = await apiRequest("/serial/next", payload);
    if (apiResult) return apiResult;
  }

  const client = createDatabaseClient();
  await client.connect();
  try {
    return await allocateSerialInDatabase(client, payload);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureInventoryBalancesForAllSkus(client) {
  const { warehouseId, locationId } = await ensureWarehouseAndLocation(client, "MAIN", "A-01-01");
  await client.query(
    `
      INSERT INTO cms.sku_inventory_balances (
        sku_id, warehouse_id, location_id, qty, min_qty, last_counted_at
      )
      SELECT
        s.id, $1, $2, s.stock_qty, s.low_stock_threshold, now()
      FROM cms.skus s
      WHERE NOT EXISTS (
        SELECT 1 FROM cms.sku_inventory_balances b WHERE b.sku_id = s.id
      )
      ON CONFLICT (sku_id, warehouse_id, location_id) DO NOTHING
    `,
    [warehouseId, locationId],
  );
}

function parseComposition(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => {
      const match = part.trim().match(/^(.+?)\s+([0-9]+(?:\.[0-9]+)?)%$/);
      if (!match) return null;
      return { material: match[1].trim(), percentage: Number(match[2]) };
    })
    .filter(Boolean);
}

async function loadProductsFromNormalized(client) {
  const productsResult = await client.query(
    "SELECT * FROM cms.v_product_sku_export ORDER BY model_code, colour_code, size_code",
  );
  const measurementResult = await client.query(
    "SELECT * FROM cms.v_product_measurement_export ORDER BY model_code, size_code, measurement_code",
  );
  const assetsResult = await client.query(`
    SELECT product_id, sku_id, url, image_role, uploaded_at
    FROM cms.product_image_assets
    WHERE url IS NOT NULL
    ORDER BY
      CASE image_role WHEN 'front' THEN 0 WHEN 'model_front' THEN 1 WHEN 'detail' THEN 2 ELSE 3 END,
      uploaded_at DESC
  `);

  const measurements = new Map();
  for (const row of measurementResult.rows) {
    const key = `${row.model_code}|${row.size_code}`;
    const current = measurements.get(key) ?? {};
    const code = String(row.measurement_code ?? "").toUpperCase();
    if (/^[A-H]$/.test(code)) {
      current[`length${code}`] = row.value == null ? "" : String(row.value);
    }
    measurements.set(key, current);
  }

  const imageBySku = new Map();
  const imageByProduct = new Map();
  for (const row of assetsResult.rows) {
    if (row.sku_id && !imageBySku.has(String(row.sku_id))) imageBySku.set(String(row.sku_id), row.url);
    if (row.product_id && !imageByProduct.has(String(row.product_id))) imageByProduct.set(String(row.product_id), row.url);
  }

  return productsResult.rows.map((row) => ({
    id: String(row.sku_id),
    barcode: row.model_code ?? "",
    name: row.product_name ?? "",
    sku: row.sku_code ?? "",
    category: row.category ?? "",
    fineCategory: row.fine_category ?? "",
    category2: row.category2 ?? "",
    category3: row.category3 ?? "",
    description: row.description ?? "",
    size: row.size_code ?? "",
    color: row.colour_name ?? "",
    price: toNumber(row.b2b_price, 0),
    cost: 0,
    b2cMarkup: toNumber(row.b2c_markup_percent, 100) / 100,
    b2cPrice: toNumber(row.b2c_price, 0),
    composition: parseComposition(row.composition),
    stock: Math.max(0, Math.round(toNumber(row.stock_qty, 0))),
    lowStockThreshold: Math.max(0, Math.round(toNumber(row.low_stock_threshold, 5))),
    otherSku: row.other_sku ?? "",
    weight: row.weight_grams == null ? "" : String(row.weight_grams),
    mainImage: row.image_url ?? imageBySku.get(String(row.sku_id)) ?? imageByProduct.get(String(row.product_id)) ?? "",
    image: row.image_url ?? imageBySku.get(String(row.sku_id)) ?? imageByProduct.get(String(row.product_id)) ?? "",
    updatedAt: toMs(row.updated_at),
    ...(measurements.get(`${row.model_code}|${row.size_code}`) ?? {}),
    createdAt: toMs(row.created_at),
  }));
}

async function loadCustomersFromNormalized(client) {
  const result = await client.query("SELECT * FROM cms.v_customer_export ORDER BY created_at DESC");
  return result.rows.map((row) => {
    const fiscalAddress = row.fiscal_address_line_1
      ? {
          line1: row.fiscal_address_line_1 ?? "",
          line2: row.fiscal_address_line_2 ?? "",
          additionalInfo: row.fiscal_additional_info ?? "",
          postalCode: row.fiscal_postal_code ?? "",
          provinceState: row.fiscal_province_state ?? "",
          country: row.fiscal_country ?? "",
        }
      : undefined;
    const logisticsAddress = row.logistics_address_line_1
      ? {
          line1: row.logistics_address_line_1 ?? "",
          line2: row.logistics_address_line_2 ?? "",
          additionalInfo: row.logistics_additional_info ?? "",
          postalCode: row.logistics_postal_code ?? "",
          provinceState: row.logistics_province_state ?? "",
          country: row.logistics_country ?? "",
        }
      : undefined;
    return {
      id: String(row.customer_id),
      clientType: row.client_type ?? "B2B",
      name: row.name ?? "",
      surname: row.surname ?? "",
      businessType: row.business_type ?? undefined,
      businessName: row.business_name ?? "",
      email: row.email ?? "",
      vatNumber: row.vat_number ?? "",
      phoneCountryCode: row.primary_phone_country_code ?? "",
      phoneNumber: row.primary_phone_number ?? "",
      phone: row.primary_phone ?? "",
      fiscalAddress,
      logisticsAddress,
      address: fiscalAddress
        ? [fiscalAddress.line1, fiscalAddress.postalCode, fiscalAddress.provinceState, fiscalAddress.country]
            .filter(Boolean)
            .join(", ")
        : "",
      taxRate: row.tax_rate_percent == null ? undefined : toNumber(row.tax_rate_percent, 0),
      createdAt: toMs(row.created_at),
      updatedAt: toMs(row.updated_at),
    };
  });
}

async function loadSalesFromNormalized(client) {
  const ordersResult = await client.query(`
    SELECT
      o.*,
      i.invoice_number AS normalized_invoice_number,
      i.tax_profile AS invoice_tax_profile,
      i.due_date AS invoice_due_date,
      i.notes AS invoice_notes,
      src.legacy_id AS source_legacy_id,
      src.id AS source_uuid
    FROM cms.orders o
    LEFT JOIN cms.invoices i ON i.order_id = o.id
    LEFT JOIN cms.orders src ON src.id = o.source_order_id
    ORDER BY o.created_at DESC
  `);
  if (ordersResult.rows.length === 0) return [];

  const orderIds = ordersResult.rows.map((row) => row.id);
  const linesResult = await client.query(
    `
      SELECT *
      FROM cms.order_lines
      WHERE order_id = ANY($1::uuid[])
      ORDER BY created_at, id
    `,
    [orderIds],
  );
  const paymentsResult = await client.query(
    `
      SELECT *
      FROM cms.order_payments
      WHERE order_id = ANY($1::uuid[])
      ORDER BY payment_date, created_at
    `,
    [orderIds],
  );
  const returnsResult = await client.query(
    `
      SELECT *
      FROM cms.order_returns
      WHERE order_id = ANY($1::uuid[])
      ORDER BY created_at, id
    `,
    [orderIds],
  );

  const byOrder = (rows) => {
    const grouped = new Map();
    for (const row of rows) {
      const key = String(row.order_id);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    return grouped;
  };
  const linesByOrder = byOrder(linesResult.rows);
  const paymentsByOrder = byOrder(paymentsResult.rows);
  const returnsByOrder = byOrder(returnsResult.rows);

  return ordersResult.rows.map((row) => {
    const orderId = String(row.id);
    const sourceDocumentId = row.source_legacy_id || (row.source_uuid ? String(row.source_uuid) : undefined);
    const taxBreakdown = asJson(row.tax_breakdown, undefined);
    const transport =
      row.transport_method || row.transport_label || Number(row.transport_fee ?? 0) > 0
        ? {
            method: row.transport_method ?? "PICKUP",
            label: row.transport_label ?? "",
            fee: toNumber(row.transport_fee, 0),
          }
        : undefined;

    return {
      id: row.legacy_id || orderId,
      invoiceNumber: row.normalized_invoice_number || row.order_number || "",
      documentType: row.document_type ?? "INVOICE",
      documentStatus: row.document_status ?? "open",
      deliveryStatus: row.delivery_status ?? "open",
      dueDate: row.invoice_due_date ? toMs(row.invoice_due_date) : undefined,
      invoiceNotes: row.invoice_notes ?? undefined,
      invoiceTaxProfile: row.invoice_tax_profile ?? undefined,
      salesChannel: row.sales_channel ?? "physical_store",
      sourceDocumentId,
      stockMovementCreated: Boolean(row.stock_movement_created),
      cancelledAt: row.cancelled_at ? toMs(row.cancelled_at) : undefined,
      cancelledBy: row.cancelled_by ?? undefined,
      cancellationReason: row.cancellation_reason ?? undefined,
      customerId: row.customer_id ? String(row.customer_id) : "",
      customerSnapshot: asJson(row.customer_snapshot, {}),
      lines: (linesByOrder.get(orderId) ?? []).map((line) => ({
        productId: line.sku_id ? String(line.sku_id) : line.product_id ? String(line.product_id) : "",
        barcode: line.sku_code_snapshot ?? "",
        name: line.product_name_snapshot ?? "",
        size: line.size_snapshot ?? undefined,
        color: line.colour_snapshot ?? undefined,
        unitPrice: toNumber(line.unit_price, 0),
        quantity: Math.max(1, Math.round(toNumber(line.quantity, 1))),
        discountPct: toNumber(line.discount_percent, 0),
      })),
      returns: (returnsByOrder.get(orderId) ?? []).map((entry) => ({
        id: entry.legacy_id || String(entry.id),
        productId: entry.sku_id ? String(entry.sku_id) : "",
        quantity: Math.max(1, Math.round(toNumber(entry.quantity, 1))),
        reason: entry.reason ?? undefined,
        condition: entry.condition ?? undefined,
        refundAmount: toNumber(entry.refund_amount, 0),
        refundMethod: entry.refund_method ?? undefined,
        stockAction: entry.stock_action ?? "back_to_stock",
        notes: entry.notes ?? undefined,
        createdAt: toMs(entry.created_at),
      })),
      subtotal: toNumber(row.subtotal, 0),
      taxRate: toNumber(row.tax_rate, 0),
      tax: toNumber(row.tax_amount, 0),
      taxBreakdown,
      transport,
      total: toNumber(row.total, 0),
      paymentStatus: row.payment_status ?? "OPEN",
      amountPaid: toNumber(row.amount_paid, 0),
      amountDue: toNumber(row.amount_due, 0),
      payments: (paymentsByOrder.get(orderId) ?? []).map((payment) => ({
        id: payment.legacy_id || String(payment.id),
        amount: toNumber(payment.amount, 0),
        method: payment.method ?? "OTHER",
        note: payment.note ?? undefined,
        paymentDate: payment.payment_date ? toMs(payment.payment_date) : undefined,
        reference: payment.reference ?? undefined,
        createdAt: toMs(payment.created_at),
      })),
      createdAt: toMs(row.created_at),
      updatedAt: toMs(row.updated_at),
    };
  });
}

async function loadInventoryMovementsFromNormalized(client) {
  const result = await client.query(`
    SELECT
      im.id,
      im.movement_type,
      im.document_id,
      s.id AS sku_id,
      s.sku_code,
      im.previous_qty,
      im.quantity_change,
      im.new_qty,
      im.reason_category,
      w.code AS warehouse_code,
      wl.location_code,
      im.notes,
      im.created_at
    FROM cms.inventory_movements im
    JOIN cms.skus s ON s.id = im.sku_id
    LEFT JOIN cms.warehouses w ON w.id = im.warehouse_id
    LEFT JOIN cms.warehouse_locations wl ON wl.id = im.location_id
    ORDER BY im.created_at DESC
  `);

  return result.rows.map((row) => ({
    id: String(row.id),
    movementType: row.movement_type,
    documentId: row.document_id ? String(row.document_id) : undefined,
    productId: String(row.sku_id),
    sku: row.sku_code ?? "",
    previousQty: row.previous_qty == null ? undefined : Number(row.previous_qty),
    quantityChange: Number(row.quantity_change ?? 0),
    newQty: row.new_qty == null ? undefined : Number(row.new_qty),
    reason: row.reason_category ?? undefined,
    warehouse: row.warehouse_code ?? undefined,
    location: row.location_code ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: toMs(row.created_at),
  }));
}

async function loadInventoryLocationsFromNormalized(client) {
  const result = await client.query(`
    SELECT
      s.id AS sku_id,
      w.code AS warehouse_code,
      wl.location_code,
      b.updated_at
    FROM cms.sku_inventory_balances b
    JOIN cms.skus s ON s.id = b.sku_id
    JOIN cms.warehouses w ON w.id = b.warehouse_id
    LEFT JOIN cms.warehouse_locations wl ON wl.id = b.location_id
    ORDER BY b.updated_at DESC
  `);

  const bySku = new Map();
  for (const row of result.rows) {
    const key = String(row.sku_id);
    if (bySku.has(key)) continue;
    bySku.set(key, {
      productId: key,
      warehouse: row.warehouse_code ?? "MAIN",
      location: row.location_code ?? "",
      updatedAt: toMs(row.updated_at),
    });
  }
  return Array.from(bySku.values());
}

async function loadImagesFromNormalized(client) {
  const result = await client.query(`
    SELECT
      pia.id,
      pia.product_id,
      pia.sku_id,
      pia.model_code,
      pia.sku_code,
      pia.image_code,
      pia.image_role,
      pia.file_name,
      pia.url,
      idr.directory_key,
      pia.uploaded_at
    FROM cms.product_image_assets pia
    LEFT JOIN cms.image_directories idr ON idr.id = pia.directory_id
    ORDER BY pia.uploaded_at DESC
  `);

  return result.rows.map((row) => ({
    id: String(row.id),
    prefix: row.sku_code ?? row.model_code ?? "",
    code: row.image_code ?? "",
    fileName: row.file_name ?? "",
    dataUrl: row.url ?? "",
    sku: row.sku_code ?? "",
    modelCode: row.model_code ?? "",
    productId: row.sku_id ? String(row.sku_id) : row.product_id ? String(row.product_id) : undefined,
    directory: row.directory_key ?? "",
    imageRole: row.image_role ?? "other",
    createdAt: toMs(row.uploaded_at),
  }));
}

async function loadMaintenanceFromNormalized(client) {
  const exists = await client.query("SELECT to_regclass('cms.product_maintenance_items') AS name");
  if (!exists.rows[0]?.name) return [];
  const result = await client.query(`
    SELECT *
    FROM cms.product_maintenance_items
    ORDER BY created_at DESC
  `);
  return result.rows.map((row) => ({
    id: row.legacy_id || String(row.id),
    reason: row.reason || "other",
    reasonOther: row.reason_other || undefined,
    associatedSku: row.associated_sku || undefined,
    note: row.note || undefined,
    photo: row.photo_data_url || undefined,
    diagnostics: row.diagnostics || undefined,
    resolved: Boolean(row.resolved),
    resolvedAt: row.resolved_at ? toMs(row.resolved_at) : undefined,
    createdBy: row.created_by || undefined,
    createdAt: toMs(row.created_at),
  }));
}

async function hydrateFromNormalized(client) {
  await ensureInventoryBalancesForAllSkus(client);
  const products = await loadProductsFromNormalized(client);
  const customers = await loadCustomersFromNormalized(client);
  const sales = await loadSalesFromNormalized(client);
  const inventoryMovements = await loadInventoryMovementsFromNormalized(client);
  const inventoryLocations = await loadInventoryLocationsFromNormalized(client);
  const images = await loadImagesFromNormalized(client);
  const maintenance = await loadMaintenanceFromNormalized(client);

  return {
    "form.products.v1": JSON.stringify(products),
    "form.customers.v1": JSON.stringify(customers),
    "form.sales.v1": JSON.stringify(sales),
    "form.inventoryMovements.v1": JSON.stringify(inventoryMovements),
    "form.inventoryLocations.v1": JSON.stringify(inventoryLocations),
    "form.productMaintenance.v1": JSON.stringify(maintenance),
    "form.imageGallery.v1": JSON.stringify(images),
    "form.products.wiped.v1": "1",
  };
}

async function upsertRawRecord(client, key, raw, clientId) {
  let nextRaw = raw ?? null;
  if (clientId !== "normalized-hydration" && MERGEABLE_ARRAY_KEYS.has(key) && typeof raw === "string") {
    const existing = await client.query("SELECT value FROM cms.app_settings WHERE key = $1", [key]);
    const value = existing.rows[0]?.value ?? {};
    const existingRaw = typeof value.raw === "string" ? value.raw : null;
    if (existingRaw) {
      nextRaw = mergeArrayRaw(existingRaw, raw);
    }
  }
  await client.query(
    `
      INSERT INTO cms.app_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
    `,
    [
      key,
      JSON.stringify({
        raw: nextRaw,
        clientId: clientId ?? "desktop",
        writtenAt: new Date().toISOString(),
      }),
    ],
  );
}

function parseStoredArrayFromRow(row) {
  const value = row?.value ?? {};
  return parseRawArray(typeof value.raw === "string" ? value.raw : null) ?? [];
}

async function syncNormalizedSnapshot(client) {
  const result = await client.query(
    "SELECT key, value FROM cms.app_settings WHERE key = ANY($1::text[])",
    [[...NORMALIZED_SYNC_KEYS]],
  );
  const byKey = new Map(result.rows.map((row) => [row.key, parseStoredArrayFromRow(row)]));
  await importSnapshot(client, {
    products: byKey.get("form.products.v1") ?? [],
    customers: byKey.get("form.customers.v1") ?? [],
    sales: byKey.get("form.sales.v1") ?? [],
    inventoryMovements: byKey.get("form.inventoryMovements.v1") ?? [],
    images: byKey.get("form.imageGallery.v1") ?? [],
    maintenance: byKey.get("form.productMaintenance.v1") ?? [],
  });
}

function rowToRecord(row) {
  const value = row.value ?? {};
  return {
    key: row.key,
    raw: typeof value.raw === "string" ? value.raw : value.raw == null ? null : String(value.raw),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    clientId: value.clientId ?? null,
  };
}

async function cloudPull(payload = {}) {
  const apiResult = await apiRequest("/sync/pull", { ...payload, acceptEncoding: ["gzip-base64"] });
  if (apiResult) return decodeLargeSyncRecords(apiResult);

  const keys = Array.isArray(payload.keys) && payload.keys.length > 0 ? normalizeSyncKeys(payload.keys) : CORE_KEYS;
  const client = createDatabaseClient();
  await client.connect();
  try {
    await ensureAppSettings(client);
    const shouldHydrate = CORE_KEYS.some((key) => keys.includes(key));
    if (shouldHydrate) {
      const hydrated = await hydrateFromNormalized(client);
      for (const [key, raw] of Object.entries(hydrated)) {
        if (keys.includes(key) || key === "form.products.wiped.v1") {
          await upsertRawRecord(client, key, raw, "normalized-hydration");
        }
      }
    }

    const result = await client.query(
      "SELECT key, value, updated_at FROM cms.app_settings WHERE key = ANY($1::text[]) ORDER BY key",
      [keys],
    );

    return {
      ok: true,
      records: result.rows.map(rowToRecord),
      serverTime: new Date().toISOString(),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function cloudPush(payload = {}) {
  const apiResult = await apiRequest("/sync/push", encodeLargeSyncRecords(payload));
  if (apiResult) return apiResult;

  const records = Array.isArray(payload.records) ? payload.records : [];
  const clientId = payload.clientId ?? "desktop";
  const skipNormalized = Boolean(payload.skipNormalized);
  const client = createDatabaseClient();
  await client.connect();
  try {
    await ensureAppSettings(client);
    await client.query("BEGIN");
    let shouldSyncNormalized = false;
    for (const record of records) {
      if (!record || typeof record.key !== "string") continue;
      await upsertRawRecord(client, record.key, record.raw ?? null, clientId);
      if (NORMALIZED_SYNC_KEYS.has(record.key)) shouldSyncNormalized = true;
    }
    await client.query("COMMIT");
    if (shouldSyncNormalized && !skipNormalized) {
      await syncNormalizedSnapshot(client);
    }
    return {
      ok: true,
      pushed: records.length,
      serverTime: new Date().toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function adjustInventory(payload = {}) {
  if (!payload.skipApi) {
    const apiResult = await apiRequest("/inventory/adjust", payload);
    if (apiResult) return apiResult;
  }
  const allowedTypes = new Set([
    "sale",
    "return",
    "cancel_restore",
    "adjustment",
    "initial_import",
    "inbound",
    "outbound",
    "stocktake",
    "transfer",
  ]);
  const movementType = allowedTypes.has(payload.movementType) ? payload.movementType : "adjustment";
  const skuText = String(payload.sku || payload.productId || "").trim();
  const productUuid = uuidOrNull(payload.productId);
  const client = createDatabaseClient();
  await client.connect();

  try {
    await client.query("BEGIN");
    const skuResult = await client.query(
      `
        SELECT id, sku_code, stock_qty, low_stock_threshold
        FROM cms.skus
        WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
           OR sku_code = $2
           OR legacy_id = $3
        LIMIT 1
      `,
      [productUuid, skuText, String(payload.productId || "")],
    );
    const sku = skuResult.rows[0];
    if (!sku) {
      const error = new Error(`SKU not found for inventory adjustment: ${skuText || payload.productId || "unknown"}`);
      error.statusCode = 404;
      throw error;
    }

    const { warehouseId, warehouseCode, locationId, locationCode } = await ensureWarehouseAndLocation(
      client,
      payload.warehouse,
      payload.location,
    );

    await client.query(
      `
        INSERT INTO cms.sku_inventory_balances (sku_id, warehouse_id, location_id, qty, min_qty, last_counted_at)
        VALUES ($1, $2, $3, 0, $4, CASE WHEN $5 THEN now() ELSE null END)
        ON CONFLICT (sku_id, warehouse_id, location_id) DO NOTHING
      `,
      [sku.id, warehouseId, locationId, Math.max(0, Math.round(toNumber(sku.low_stock_threshold, 0))), movementType === "stocktake"],
    );

    const balanceResult = await client.query(
      `
        SELECT id, qty
        FROM cms.sku_inventory_balances
        WHERE sku_id = $1
          AND warehouse_id = $2
          AND location_id = $3
        FOR UPDATE
      `,
      [sku.id, warehouseId, locationId],
    );
    const balance = balanceResult.rows[0];
    const previousQty = Math.max(0, Math.round(toNumber(balance?.qty, 0)));
    let newQty = payload.newQty === undefined || payload.newQty === null
      ? previousQty + Math.round(toNumber(payload.quantityChange, 0))
      : Math.round(toNumber(payload.newQty, previousQty));
    if (movementType === "transfer") {
      newQty = previousQty;
    }
    if (newQty < 0) {
      const error = new Error("Inventory adjustment would make stock negative.");
      error.statusCode = 400;
      throw error;
    }
    const quantityChange = newQty - previousQty;

    await client.query(
      `
        UPDATE cms.sku_inventory_balances
        SET
          qty = $1,
          last_counted_at = CASE WHEN $2 THEN now() ELSE last_counted_at END,
          updated_at = now()
        WHERE id = $3
      `,
      [newQty, movementType === "stocktake", balance.id],
    );

    const documentUuid = uuidOrNull(payload.documentId);
    const movement = await client.query(
      `
        INSERT INTO cms.inventory_movements (
          legacy_id, sku_id, movement_type, document_id, previous_qty,
          quantity_change, new_qty, reason_category, warehouse_id, location_id,
          external_reference, notes, created_by, created_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, now()
        )
        ON CONFLICT (legacy_id) DO UPDATE SET
          sku_id = EXCLUDED.sku_id,
          movement_type = EXCLUDED.movement_type,
          document_id = EXCLUDED.document_id,
          previous_qty = EXCLUDED.previous_qty,
          quantity_change = EXCLUDED.quantity_change,
          new_qty = EXCLUDED.new_qty,
          reason_category = EXCLUDED.reason_category,
          warehouse_id = EXCLUDED.warehouse_id,
          location_id = EXCLUDED.location_id,
          external_reference = EXCLUDED.external_reference,
          notes = EXCLUDED.notes,
          created_by = EXCLUDED.created_by
        RETURNING id, created_at
      `,
      [
        uuidOrNull(payload.id) ? null : payload.id || null,
        sku.id,
        movementType,
        documentUuid,
        previousQty,
        quantityChange,
        newQty,
        payload.reason || null,
        warehouseId,
        locationId,
        documentUuid ? null : payload.documentId || null,
        payload.notes || null,
        payload.actor || "desktop",
      ],
    );
    const movementId = movement.rows[0].id;

    await client.query(
      `
        INSERT INTO cms.audit_log (actor, action, entity_table, entity_id, before_data, after_data)
        VALUES ($1, $2, 'sku_inventory_balances', $3, $4::jsonb, $5::jsonb)
      `,
      [
        payload.actor || "desktop",
        `inventory.${movementType}`,
        String(sku.id),
        JSON.stringify({ qty: previousQty, warehouse: warehouseCode, location: locationCode }),
        JSON.stringify({
          qty: newQty,
          delta: quantityChange,
          warehouse: warehouseCode,
          location: locationCode,
          movementId: String(movementId),
        }),
      ],
    );

    await client.query("COMMIT");
    return {
      ok: true,
      previousQty,
      quantityChange,
      newQty,
      movement: {
        id: String(movementId),
        movementType,
        productId: String(sku.id),
        sku: sku.sku_code,
        previousQty,
        quantityChange,
        newQty,
        reason: payload.reason || undefined,
        warehouse: warehouseCode,
        location: locationCode,
        notes: payload.notes || undefined,
        createdAt: toMs(movement.rows[0].created_at),
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function dateOrNow(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function lineSubtotal(line) {
  const quantity = Math.max(1, Math.round(toNumber(line.quantity, 1)));
  const discount = Math.max(0, Math.min(100, toNumber(line.discountPct, 0)));
  return toNumber(line.unitPrice, 0) * quantity * (1 - discount / 100);
}

function invoiceTypeForDocument(documentType) {
  if (documentType === "PROFORMA") return "PROFORMA";
  if (documentType === "DELIVERY_NOTE") return "NO_INVOICE";
  if (documentType === "RECEIPT") return "B2C_RECEIPT";
  return "B2B_INVOICE";
}

function fiscalStatusForSalePayload(sale) {
  if (sale.documentStatus === "cancelled") return "cancelled";
  if (String(sale.invoiceNumber || "").startsWith("DRAFT-") || sale.paymentStatus !== "PAID") return "draft";
  return "issued";
}

function taxProfileForSalePayload(sale) {
  if (sale.invoiceTaxProfile) return sale.invoiceTaxProfile;
  if (sale.documentType === "DELIVERY_NOTE") return "no_tax";
  if (sale.documentType === "RECEIPT") return "b2c";
  if (toNumber(sale.taxRate, 0) <= 0) return "no_tax";
  return "standard";
}

async function findCustomerId(client, sale) {
  const customerUuid = uuidOrNull(sale.customerId);
  if (customerUuid) {
    const found = await client.query("SELECT id FROM cms.customers WHERE id = $1", [customerUuid]);
    if (found.rows[0]) return found.rows[0].id;
  }
  if (sale.customerId) {
    const found = await client.query(
      "SELECT id FROM cms.customers WHERE legacy_id = $1 OR customer_code = $1 LIMIT 1",
      [String(sale.customerId)],
    );
    if (found.rows[0]) return found.rows[0].id;
  }
  return null;
}

async function findSkuForLine(client, line) {
  const skuUuid = uuidOrNull(line.productId);
  const skuText = String(line.barcode || "").trim();
  const result = await client.query(
    `
      SELECT s.id, s.product_id, s.sku_code
      FROM cms.skus s
      WHERE ($1::uuid IS NOT NULL AND s.id = $1::uuid)
         OR s.legacy_id = $2
         OR s.sku_code = $3
         OR s.barcode = $3
      LIMIT 1
    `,
    [skuUuid, String(line.productId || ""), skuText],
  );
  return result.rows[0] || null;
}

function saleLineQtyMap(sale = {}) {
  const map = new Map();
  for (const line of sale.lines ?? []) {
    const key = String(line.productId || line.barcode || "");
    if (!key) continue;
    const current = map.get(key) || { line, qty: 0 };
    current.qty += Math.max(0, Math.round(toNumber(line.quantity, 0)));
    map.set(key, current);
  }
  return map;
}

function collectSaleInventoryDeltas(sale, previousSale, operation) {
  const deltas = [];
  if (operation === "create" && sale.stockMovementCreated && sale.documentStatus !== "cancelled") {
    for (const { line, qty } of saleLineQtyMap(sale).values()) {
      if (qty > 0) deltas.push({ line, quantityChange: -qty, movementType: "sale", legacyId: `sale:${sale.id}:create:${line.productId}` });
    }
  }

  if (operation === "cancel" && previousSale?.stockMovementCreated) {
    for (const { line, qty } of saleLineQtyMap(previousSale).values()) {
      if (qty > 0) deltas.push({ line, quantityChange: qty, movementType: "cancel_restore", legacyId: `sale:${sale.id}:cancel:${line.productId}` });
    }
  }

  if (operation === "update_lines" && previousSale?.stockMovementCreated && sale.stockMovementCreated) {
    const before = saleLineQtyMap(previousSale);
    const after = saleLineQtyMap(sale);
    const keys = new Set([...before.keys(), ...after.keys()]);
    for (const key of keys) {
      const oldItem = before.get(key);
      const newItem = after.get(key);
      const qtyDelta = (newItem?.qty ?? 0) - (oldItem?.qty ?? 0);
      if (qtyDelta !== 0) {
        const line = newItem?.line ?? oldItem?.line;
        deltas.push({
          line,
          quantityChange: -qtyDelta,
          movementType: qtyDelta > 0 ? "sale" : "cancel_restore",
          legacyId: `sale:${sale.id}:update:${sale.updatedAt || Date.now()}:${key}`,
        });
      }
    }
  }

  if (operation === "return") {
    const previousReturnIds = new Set((previousSale?.returns ?? []).map((entry) => String(entry.id)));
    for (const entry of sale.returns ?? []) {
      if (previousReturnIds.has(String(entry.id)) || entry.stockAction !== "back_to_stock") continue;
      const line = (sale.lines ?? []).find((item) => item.productId === entry.productId) || {
        productId: entry.productId,
        barcode: "",
        name: "Returned item",
      };
      deltas.push({
        line,
        quantityChange: Math.max(1, Math.round(toNumber(entry.quantity, 1))),
        movementType: "return",
        reason: entry.reason,
        legacyId: `sale:${sale.id}:return:${entry.id}`,
      });
    }
  }

  return deltas.filter((delta) => delta.quantityChange !== 0);
}

async function applySaleInventoryDelta(client, delta, sale, orderId, actor) {
  const sku = await findSkuForLine(client, delta.line);
  if (!sku) {
    const error = new Error(`SKU not found for sale inventory change: ${delta.line?.barcode || delta.line?.productId || "unknown"}`);
    error.statusCode = 404;
    throw error;
  }
  const { warehouseId, warehouseCode, locationId, locationCode } = await ensureWarehouseAndLocation(client, "MAIN", "A-01-01");
  await client.query(
    `
      INSERT INTO cms.sku_inventory_balances (sku_id, warehouse_id, location_id, qty, min_qty)
      SELECT id, $2, $3, stock_qty, low_stock_threshold
      FROM cms.skus
      WHERE id = $1
      ON CONFLICT (sku_id, warehouse_id, location_id) DO NOTHING
    `,
    [sku.id, warehouseId, locationId],
  );
  const balanceResult = await client.query(
    `
      SELECT id, qty
      FROM cms.sku_inventory_balances
      WHERE sku_id = $1 AND warehouse_id = $2 AND location_id = $3
      FOR UPDATE
    `,
    [sku.id, warehouseId, locationId],
  );
  const balance = balanceResult.rows[0];
  const previousQty = Math.max(0, Math.round(toNumber(balance?.qty, 0)));
  const quantityChange = Math.round(toNumber(delta.quantityChange, 0));
  const newQty = previousQty + quantityChange;
  if (newQty < 0) {
    const error = new Error(`Insufficient stock for ${sku.sku_code}. Current ${previousQty}, change ${quantityChange}.`);
    error.statusCode = 400;
    throw error;
  }

  const movement = await client.query(
    `
      INSERT INTO cms.inventory_movements (
        legacy_id, sku_id, movement_type, document_id, previous_qty,
        quantity_change, new_qty, reason_category, warehouse_id, location_id,
        external_reference, notes, created_by, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, now()
      )
      ON CONFLICT (legacy_id) DO NOTHING
      RETURNING id
    `,
    [
      delta.legacyId,
      sku.id,
      delta.movementType,
      orderId,
      previousQty,
      quantityChange,
      newQty,
      delta.reason || null,
      warehouseId,
      locationId,
      sale.invoiceNumber || sale.id,
      delta.notes || null,
      actor || "desktop",
    ],
  );
  if (!movement.rows[0]) return;

  await client.query(
    `
      UPDATE cms.sku_inventory_balances
      SET qty = $1, updated_at = now()
      WHERE id = $2
    `,
    [newQty, balance.id],
  );
  await client.query(
    `
      INSERT INTO cms.audit_log (actor, action, entity_table, entity_id, before_data, after_data)
      VALUES ($1, $2, 'sku_inventory_balances', $3, $4::jsonb, $5::jsonb)
    `,
    [
      actor || "desktop",
      `sale_inventory.${delta.movementType}`,
      String(sku.id),
      JSON.stringify({ qty: previousQty, warehouse: warehouseCode, location: locationCode }),
      JSON.stringify({ qty: newQty, delta: quantityChange, warehouse: warehouseCode, location: locationCode }),
    ],
  );
}

async function upsertSaleNormalized(client, sale, previousSale, operation, actor) {
  const documentType = oneOf(sale.documentType, DOCUMENT_TYPES, "INVOICE");
  const documentStatus = oneOf(sale.documentStatus, DOCUMENT_STATUSES, "open");
  const deliveryStatus = oneOf(sale.deliveryStatus, DELIVERY_STATUSES, documentType === "DELIVERY_NOTE" ? "not_prepared" : "open");
  const customerId = await findCustomerId(client, sale);
  const orderNumber = String(sale.invoiceNumber || `DRAFT-${sale.id}`).trim();
  const subtotal = (sale.lines ?? []).reduce((sum, line) => sum + lineSubtotal(line), 0);
  const taxBreakdown = sale.taxBreakdown || null;
  const taxAmount = toNumber(sale.tax, subtotal * toNumber(sale.taxRate, 0));
  const transportFee = toNumber(sale.transport?.fee, 0);
  const total = toNumber(sale.total, subtotal + taxAmount + transportFee);
  const amountPaid = toNumber(sale.amountPaid, 0);
  const amountDue = toNumber(sale.amountDue, Math.max(0, total - amountPaid));

  const order = await client.query(
    `
      INSERT INTO cms.orders (
        legacy_id, order_number, document_type, document_status, delivery_status,
        sales_channel, customer_id, customer_snapshot, subtotal, tax_rate,
        tax_amount, tax_breakdown, transport_method, transport_label,
        transport_fee, total, payment_status, amount_paid, amount_due,
        stock_movement_created, cancelled_at, cancelled_by, cancellation_reason,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, $23,
        $24
      )
      ON CONFLICT (legacy_id) DO UPDATE SET
        order_number = EXCLUDED.order_number,
        document_type = EXCLUDED.document_type,
        document_status = EXCLUDED.document_status,
        delivery_status = EXCLUDED.delivery_status,
        sales_channel = EXCLUDED.sales_channel,
        customer_id = EXCLUDED.customer_id,
        customer_snapshot = EXCLUDED.customer_snapshot,
        subtotal = EXCLUDED.subtotal,
        tax_rate = EXCLUDED.tax_rate,
        tax_amount = EXCLUDED.tax_amount,
        tax_breakdown = EXCLUDED.tax_breakdown,
        transport_method = EXCLUDED.transport_method,
        transport_label = EXCLUDED.transport_label,
        transport_fee = EXCLUDED.transport_fee,
        total = EXCLUDED.total,
        payment_status = EXCLUDED.payment_status,
        amount_paid = EXCLUDED.amount_paid,
        amount_due = EXCLUDED.amount_due,
        stock_movement_created = EXCLUDED.stock_movement_created,
        cancelled_at = EXCLUDED.cancelled_at,
        cancelled_by = EXCLUDED.cancelled_by,
        cancellation_reason = EXCLUDED.cancellation_reason,
        updated_at = now()
      RETURNING id
    `,
    [
      String(sale.id),
      orderNumber,
      documentType,
      documentStatus,
      deliveryStatus,
      sale.salesChannel || "physical_store",
      customerId,
      JSON.stringify(sale.customerSnapshot || {}),
      subtotal,
      toNumber(sale.taxRate, 0),
      taxAmount,
      taxBreakdown ? JSON.stringify(taxBreakdown) : null,
      sale.transport?.method || null,
      sale.transport?.label || null,
      transportFee,
      total,
      oneOf(sale.paymentStatus, PAYMENT_STATUSES, "OPEN"),
      amountPaid,
      amountDue,
      Boolean(sale.stockMovementCreated),
      sale.cancelledAt ? dateOrNow(sale.cancelledAt) : null,
      sale.cancelledBy || null,
      sale.cancellationReason || null,
      dateOrNow(sale.createdAt),
    ],
  );
  const orderId = order.rows[0].id;

  await client.query("DELETE FROM cms.order_returns WHERE order_id = $1", [orderId]);
  await client.query("DELETE FROM cms.order_payments WHERE order_id = $1", [orderId]);
  await client.query("DELETE FROM cms.order_lines WHERE order_id = $1", [orderId]);

  for (const line of sale.lines ?? []) {
    const sku = await findSkuForLine(client, line);
    await client.query(
      `
        INSERT INTO cms.order_lines (
          order_id, sku_id, product_id, sku_code_snapshot, product_name_snapshot,
          size_snapshot, colour_snapshot, unit_price, quantity, discount_percent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        orderId,
        sku?.id || null,
        sku?.product_id || null,
        sku?.sku_code || line.barcode || "UNKNOWN-SKU",
        line.name || "Item",
        line.size || null,
        line.color || null,
        toNumber(line.unitPrice, 0),
        Math.max(1, Math.round(toNumber(line.quantity, 1))),
        toNumber(line.discountPct, 0),
      ],
    );
  }

  for (const payment of sale.payments ?? []) {
    await client.query(
      `
        INSERT INTO cms.order_payments (
          legacy_id, order_id, amount, method, note, payment_date, reference, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        payment.id || null,
        orderId,
        toNumber(payment.amount, 0),
        oneOf(payment.method, PAYMENT_METHODS, "OTHER"),
        payment.note || null,
        dateOrNow(payment.paymentDate || payment.createdAt),
        payment.reference || null,
        dateOrNow(payment.createdAt),
      ],
    );
  }

  for (const entry of sale.returns ?? []) {
    const sku = await findSkuForLine(client, { productId: entry.productId });
    await client.query(
      `
        INSERT INTO cms.order_returns (
          legacy_id, order_id, sku_id, quantity, reason, condition, refund_amount,
          refund_method, stock_action, notes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        entry.id || null,
        orderId,
        sku?.id || null,
        Math.max(1, Math.round(toNumber(entry.quantity, 1))),
        entry.reason || null,
        entry.condition || null,
        toNumber(entry.refundAmount, 0),
        entry.refundMethod || null,
        entry.stockAction || "back_to_stock",
        entry.notes || null,
        dateOrNow(entry.createdAt),
      ],
    );
  }

  const fiscalStatus = fiscalStatusForSalePayload(sale);
  const invoice = await client.query(
    `
      INSERT INTO cms.invoices (
        order_id, customer_id, invoice_number, invoice_type, fiscal_status,
        editable, tax_profile, tax_rate, vat_rate, surcharge_rate, currency,
        issue_date, due_date, customer_snapshot, subtotal, tax_amount,
        surcharge_amount, transport_fee, total, amount_paid, amount_due,
        notes, issued_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, 'EUR',
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22
      )
      ON CONFLICT (order_id) DO UPDATE SET
        invoice_number = EXCLUDED.invoice_number,
        invoice_type = EXCLUDED.invoice_type,
        fiscal_status = EXCLUDED.fiscal_status,
        editable = EXCLUDED.editable,
        tax_profile = EXCLUDED.tax_profile,
        tax_rate = EXCLUDED.tax_rate,
        vat_rate = EXCLUDED.vat_rate,
        surcharge_rate = EXCLUDED.surcharge_rate,
        due_date = EXCLUDED.due_date,
        customer_snapshot = EXCLUDED.customer_snapshot,
        subtotal = EXCLUDED.subtotal,
        tax_amount = EXCLUDED.tax_amount,
        surcharge_amount = EXCLUDED.surcharge_amount,
        transport_fee = EXCLUDED.transport_fee,
        total = EXCLUDED.total,
        amount_paid = EXCLUDED.amount_paid,
        amount_due = EXCLUDED.amount_due,
        notes = EXCLUDED.notes,
        issued_at = COALESCE(cms.invoices.issued_at, EXCLUDED.issued_at),
        updated_at = now()
      RETURNING id
    `,
    [
      orderId,
      customerId,
      orderNumber,
      invoiceTypeForDocument(documentType),
      fiscalStatus,
      fiscalStatus === "draft",
      taxProfileForSalePayload(sale),
      toNumber(sale.taxRate, 0),
      toNumber(taxBreakdown?.vat, toNumber(sale.taxRate, 0)),
      toNumber(taxBreakdown?.surcharge, 0),
      dateOrNow(sale.createdAt),
      sale.dueDate ? dateOrNow(sale.dueDate) : null,
      JSON.stringify(sale.customerSnapshot || {}),
      subtotal,
      taxBreakdown?.vatAmount === undefined ? Math.max(0, taxAmount - toNumber(taxBreakdown?.surchargeAmount, 0)) : toNumber(taxBreakdown.vatAmount, 0),
      toNumber(taxBreakdown?.surchargeAmount, 0),
      transportFee,
      total,
      amountPaid,
      amountDue,
      sale.invoiceNotes || null,
      fiscalStatus === "issued" ? dateOrNow(sale.createdAt) : null,
    ],
  );
  const invoiceId = invoice.rows[0].id;
  await client.query("DELETE FROM cms.invoice_lines WHERE invoice_id = $1", [invoiceId]);
  let lineNo = 1;
  for (const line of sale.lines ?? []) {
    const sku = await findSkuForLine(client, line);
    await client.query(
      `
        INSERT INTO cms.invoice_lines (
          invoice_id, sku_id, line_no, sku_code_snapshot, product_name_snapshot,
          colour_snapshot, size_snapshot, quantity, unit_price, discount_percent, tax_rate
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        invoiceId,
        sku?.id || null,
        lineNo++,
        sku?.sku_code || line.barcode || "UNKNOWN-SKU",
        line.name || "Item",
        line.color || null,
        line.size || null,
        Math.max(1, Math.round(toNumber(line.quantity, 1))),
        toNumber(line.unitPrice, 0),
        toNumber(line.discountPct, 0),
        toNumber(sale.taxRate, 0),
      ],
    );
  }

  for (const delta of collectSaleInventoryDeltas(sale, previousSale, operation)) {
    await applySaleInventoryDelta(client, delta, sale, orderId, actor);
  }

  await client.query(
    `
      INSERT INTO cms.audit_log (actor, action, entity_table, entity_id, after_data)
      VALUES ($1, $2, 'orders', $3, $4::jsonb)
    `,
    [actor || "desktop", `sale.${operation || "save"}`, String(orderId), JSON.stringify({ legacyId: sale.id, invoiceNumber: orderNumber })],
  );
  return { orderId: String(orderId), invoiceId: String(invoiceId) };
}

async function saveSaleToDatabase(payload = {}) {
  const sale = payload.sale;
  if (!sale || !sale.id) {
    const error = new Error("Sale payload is required.");
    error.statusCode = 400;
    throw error;
  }
  if (!payload.skipApi) {
    const apiResult = await apiRequest("/sales/save", payload);
    if (apiResult) return apiResult;
  }

  const client = createDatabaseClient();
  await client.connect();
  try {
    await ensureInventoryBalancesForAllSkus(client);
    await client.query("BEGIN");
    const saved = await upsertSaleNormalized(
      client,
      sale,
      payload.previousSale || null,
      payload.operation || "save",
      payload.actor || "desktop",
    );
    await client.query("COMMIT");

    const hydrated = await hydrateFromNormalized(client);
    for (const [key, raw] of Object.entries(hydrated)) {
      await upsertRawRecord(client, key, raw, "normalized-hydration");
    }
    return { ok: true, sale, ...saved, serverTime: new Date().toISOString() };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function reconcileInventoryBalances(payload = {}) {
  if (!payload.skipApi) {
    const apiResult = await apiRequest("/inventory/reconcile", payload);
    if (apiResult) return apiResult;
  }

  const client = createDatabaseClient();
  await client.connect();
  try {
    await ensureInventoryBalancesForAllSkus(client);
    const result = await client.query("SELECT count(*)::int AS count FROM cms.sku_inventory_balances");
    return { ok: true, balances: result.rows[0]?.count ?? 0 };
  } finally {
    await client.end().catch(() => undefined);
  }
}

module.exports = {
  allocateSerial,
  adjustInventory,
  apiRequest,
  cloudPull,
  cloudPush,
  reconcileInventoryBalances,
  saveSaleToDatabase,
};
