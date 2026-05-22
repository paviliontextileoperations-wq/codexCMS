const { createDatabaseClient, loadDotEnv } = require("./database.cjs");
const { importSnapshot } = require("../scripts/db/import-localstorage.cjs");

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
  const apiResult = await apiRequest("/sync/pull", payload);
  if (apiResult) return apiResult;

  const keys = Array.isArray(payload.keys) && payload.keys.length > 0 ? payload.keys : CORE_KEYS;
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
  const apiResult = await apiRequest("/sync/push", payload);
  if (apiResult) return apiResult;

  const records = Array.isArray(payload.records) ? payload.records : [];
  const clientId = payload.clientId ?? "desktop";
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
    if (shouldSyncNormalized) {
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

module.exports = {
  adjustInventory,
  apiRequest,
  cloudPull,
  cloudPush,
};
