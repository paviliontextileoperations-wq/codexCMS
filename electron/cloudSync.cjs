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
  const inventoryMovements = await loadInventoryMovementsFromNormalized(client);
  const inventoryLocations = await loadInventoryLocationsFromNormalized(client);
  const images = await loadImagesFromNormalized(client);
  const maintenance = await loadMaintenanceFromNormalized(client);

  return {
    "form.products.v1": JSON.stringify(products),
    "form.customers.v1": JSON.stringify(customers),
    "form.sales.v1": "[]",
    "form.inventoryMovements.v1": JSON.stringify(inventoryMovements),
    "form.inventoryLocations.v1": JSON.stringify(inventoryLocations),
    "form.productMaintenance.v1": JSON.stringify(maintenance),
    "form.imageGallery.v1": JSON.stringify(images),
    "form.products.wiped.v1": "1",
  };
}

async function upsertRawRecord(client, key, raw, clientId) {
  let nextRaw = raw ?? null;
  if (MERGEABLE_ARRAY_KEYS.has(key) && typeof raw === "string") {
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
    const result = await client.query(
      "SELECT key, value, updated_at FROM cms.app_settings WHERE key = ANY($1::text[]) ORDER BY key",
      [keys],
    );

    const present = new Set(result.rows.map((row) => row.key));
    const missingCore = CORE_KEYS.some((key) => keys.includes(key) && !present.has(key));
    if (missingCore) {
      const hydrated = await hydrateFromNormalized(client);
      for (const [key, raw] of Object.entries(hydrated)) {
        if (keys.includes(key) || key === "form.products.wiped.v1") {
          await upsertRawRecord(client, key, raw, "normalized-hydration");
        }
      }
    }

    const next = await client.query(
      "SELECT key, value, updated_at FROM cms.app_settings WHERE key = ANY($1::text[]) ORDER BY key",
      [keys],
    );

    return {
      ok: true,
      records: next.rows.map(rowToRecord),
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

module.exports = {
  apiRequest,
  cloudPull,
  cloudPush,
};
