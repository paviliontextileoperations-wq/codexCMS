const fs = require("node:fs");
const path = require("node:path");
const { createClient, ROOT_DIR } = require("./common.cjs");

const EXECUTE = process.argv.includes("--yes");
const ORDER_NUMBERS = ["INV-008", "INV-009", "INV-016"];
const SETTINGS_KEYS = [
  "form.products.v1",
  "form.sales.v1",
  "form.inventoryMovements.v1",
  "form.inventoryLocations.v1",
  "form.imageGallery.v1",
];

const CLEANUP_CLIENT_ID = "cloud-cleanup-20260531";

const PRODUCT_CANDIDATE_WHERE = `
  upper(coalesce(product_name,'')) LIKE '%VENTAS%'
  OR upper(coalesce(product_name,'')) LIKE '%IMPORTE NEGATIVO%'
  OR upper(coalesce(product_name,'')) LIKE '%TRANSPORT%'
  OR upper(coalesce(product_name,'')) LIKE '%TRANSPORTE%'
  OR upper(coalesce(model_code,'')) IN ('1','CAJA20','MALLORCA','MENORCA','T123','T123456','T1234567','TENERIFETRANS','TRANSPORTE')
  OR upper(coalesce(sku_code,'')) IN ('1','CAJA20','MALLORCA','MENORCA','T123','T123456','T1234567','TENERIFETRANS','TRANSPORTE')
  OR upper(coalesce(other_sku,'')) IN ('1','CAJA20','MALLORCA','MENORCA','T123','T123456','T1234567','TENERIFETRANS','TRANSPORTE')
  OR upper(coalesce(model_code,'')) LIKE 'TRNS%'
  OR upper(coalesce(sku_code,'')) LIKE 'TRNS%'
  OR upper(coalesce(other_sku,'')) LIKE 'TRNS%'
  OR upper(coalesce(model_code,'')) LIKE 'TRANSPORTE%'
  OR upper(coalesce(sku_code,'')) LIKE 'TRANSPORTE%'
  OR upper(coalesce(other_sku,'')) LIKE 'TRANSPORTE%'
  OR upper(coalesce(sku_code,'')) ~ '^(00[1-9]|01[0-2])-202[45]$'
  OR upper(coalesce(model_code,'')) ~ '^(00[1-9]|01[0-2])-202[45]$'
  OR upper(coalesce(other_sku,'')) ~ '^(00[1-9]|01[0-2])-202[45]$'
`;

function unique(values) {
  return Array.from(new Set(values.filter(Boolean).map(String)));
}

function timestampForPath() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseStoredRaw(value) {
  if (!value) return null;
  const raw = value.raw ?? value;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseStoredArray(row) {
  const parsed = parseStoredRaw(row?.value);
  return Array.isArray(parsed) ? parsed : [];
}

function rawRecord(raw) {
  return JSON.stringify({
    raw: JSON.stringify(raw),
    clientId: CLEANUP_CLIENT_ID,
    writtenAt: new Date().toISOString(),
  });
}

function matchesDemoImageAsset(asset) {
  const haystack = [
    asset?.bucket,
    asset?.bucketName,
    asset?.cloudKey,
    asset?.cloud_key,
    asset?.url,
    asset?.dataUrl,
    asset?.note,
    asset?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const prefix = String(asset?.prefix ?? asset?.modelCode ?? asset?.model_code ?? "").toUpperCase();
  return haystack.includes("pavilion-product-images-demo") || haystack.includes("demo image asset") || ["P001", "P002", "P003", "P004"].includes(prefix);
}

async function rows(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows;
}

async function candidateProducts(client) {
  return rows(
    client,
    `
      WITH joined AS (
        SELECT
          p.id AS product_id,
          p.model_code,
          p.name AS product_name,
          p.source,
          s.id AS sku_id,
          s.sku_code,
          s.other_sku,
          s.stock_qty,
          p.b2b_price,
          p.b2c_price
        FROM cms.products p
        JOIN cms.skus s ON s.product_id = p.id
      )
      SELECT *
      FROM joined
      WHERE ${PRODUCT_CANDIDATE_WHERE}
      ORDER BY model_code, sku_code, other_sku
    `,
  );
}

async function productDeletionScope(client, productIds, skuIds) {
  if (productIds.length === 0) return { productIdsToDelete: [], mixedProducts: [] };
  const counts = await rows(
    client,
    `
      SELECT
        p.id AS product_id,
        p.model_code,
        p.name,
        count(s.id)::int AS total_skus,
        count(s.id) FILTER (WHERE s.id = ANY($2::uuid[]))::int AS candidate_skus
      FROM cms.products p
      JOIN cms.skus s ON s.product_id = p.id
      WHERE p.id = ANY($1::uuid[])
      GROUP BY p.id, p.model_code, p.name
      ORDER BY p.model_code
    `,
    [productIds, skuIds],
  );
  return {
    productIdsToDelete: counts.filter((row) => row.total_skus === row.candidate_skus).map((row) => String(row.product_id)),
    mixedProducts: counts.filter((row) => row.total_skus !== row.candidate_skus),
  };
}

async function candidateOrders(client) {
  return rows(
    client,
    `
      SELECT *
      FROM cms.orders
      WHERE order_number = ANY($1::text[]) OR legacy_id = ANY($1::text[])
      ORDER BY order_number
    `,
    [ORDER_NUMBERS],
  );
}

async function backupDependents(client, scope) {
  const { productIds, productIdsToDelete, skuIds, orderIds, invoiceIds } = scope;
  return {
    products: productIdsToDelete.length
      ? await rows(client, "SELECT * FROM cms.products WHERE id = ANY($1::uuid[]) ORDER BY model_code", [productIdsToDelete])
      : [],
    product_colours: productIdsToDelete.length
      ? await rows(client, "SELECT * FROM cms.product_colours WHERE product_id = ANY($1::uuid[]) ORDER BY product_id, colour_name", [productIdsToDelete])
      : [],
    product_sizes: productIdsToDelete.length
      ? await rows(client, "SELECT * FROM cms.product_sizes WHERE product_id = ANY($1::uuid[]) ORDER BY product_id, size_code", [productIdsToDelete])
      : [],
    product_compositions: productIdsToDelete.length
      ? await rows(client, "SELECT * FROM cms.product_compositions WHERE product_id = ANY($1::uuid[]) ORDER BY product_id, material", [productIdsToDelete])
      : [],
    product_size_measurements: productIdsToDelete.length
      ? await rows(client, "SELECT * FROM cms.product_size_measurements WHERE product_id = ANY($1::uuid[]) ORDER BY product_id, size_id, measurement_code", [productIdsToDelete])
      : [],
    product_shein: productIdsToDelete.length
      ? await rows(client, "SELECT * FROM cms.product_shein WHERE product_id = ANY($1::uuid[]) ORDER BY product_id", [productIdsToDelete])
      : [],
    product_images: productIds.length || skuIds.length
      ? await rows(client, "SELECT * FROM cms.product_images WHERE product_id = ANY($1::uuid[]) OR sku_id = ANY($2::uuid[]) ORDER BY created_at", [productIds, skuIds])
      : [],
    skus: skuIds.length ? await rows(client, "SELECT * FROM cms.skus WHERE id = ANY($1::uuid[]) ORDER BY other_sku, sku_code", [skuIds]) : [],
    sku_inventory_balances: skuIds.length ? await rows(client, "SELECT * FROM cms.sku_inventory_balances WHERE sku_id = ANY($1::uuid[]) ORDER BY sku_id", [skuIds]) : [],
    inventory_movements_for_product_cleanup: skuIds.length
      ? await rows(client, "SELECT * FROM cms.inventory_movements WHERE sku_id = ANY($1::uuid[]) ORDER BY created_at", [skuIds])
      : [],
    order_lines_referencing_product_candidates: skuIds.length
      ? await rows(client, "SELECT * FROM cms.order_lines WHERE sku_id = ANY($1::uuid[]) ORDER BY created_at", [skuIds])
      : [],
    invoice_lines_referencing_product_candidates: skuIds.length
      ? await rows(client, "SELECT * FROM cms.invoice_lines WHERE sku_id = ANY($1::uuid[]) ORDER BY created_at", [skuIds])
      : [],
    orders: orderIds.length ? await rows(client, "SELECT * FROM cms.orders WHERE id = ANY($1::uuid[]) ORDER BY order_number", [orderIds]) : [],
    order_lines: orderIds.length ? await rows(client, "SELECT * FROM cms.order_lines WHERE order_id = ANY($1::uuid[]) ORDER BY created_at", [orderIds]) : [],
    order_payments: orderIds.length ? await rows(client, "SELECT * FROM cms.order_payments WHERE order_id = ANY($1::uuid[]) ORDER BY created_at", [orderIds]) : [],
    order_returns: orderIds.length ? await rows(client, "SELECT * FROM cms.order_returns WHERE order_id = ANY($1::uuid[]) ORDER BY created_at", [orderIds]) : [],
    order_documents: orderIds.length ? await rows(client, "SELECT * FROM cms.order_documents WHERE order_id = ANY($1::uuid[]) ORDER BY created_at", [orderIds]) : [],
    invoices: invoiceIds.length ? await rows(client, "SELECT * FROM cms.invoices WHERE id = ANY($1::uuid[]) ORDER BY invoice_number", [invoiceIds]) : [],
    invoice_lines: invoiceIds.length ? await rows(client, "SELECT * FROM cms.invoice_lines WHERE invoice_id = ANY($1::uuid[]) ORDER BY line_no", [invoiceIds]) : [],
    invoice_documents: invoiceIds.length ? await rows(client, "SELECT * FROM cms.invoice_documents WHERE invoice_id = ANY($1::uuid[]) ORDER BY created_at", [invoiceIds]) : [],
    order_inventory_movements: orderIds.length
      ? await rows(client, "SELECT * FROM cms.inventory_movements WHERE document_id = ANY($1::uuid[]) ORDER BY created_at", [orderIds])
      : [],
  };
}

async function settingsSnapshot(client) {
  const result = await client.query("SELECT key, value, updated_at FROM cms.app_settings WHERE key = ANY($1::text[]) ORDER BY key", [SETTINGS_KEYS]);
  return result.rows;
}

async function countRows(client) {
  const tables = ["products", "skus", "customers", "orders", "order_lines", "invoices", "invoice_lines", "product_image_assets"];
  const counts = {};
  for (const table of tables) {
    const result = await client.query(`SELECT count(*)::int AS count FROM cms.${table}`);
    counts[table] = result.rows[0].count;
  }
  return counts;
}

async function demoImageAssetCandidates(client, imageGallerySetting) {
  const normalized = await rows(
    client,
    `
      SELECT *
      FROM cms.product_image_assets
      WHERE cloud_key ILIKE '%pavilion-product-images-demo%'
         OR url ILIKE '%pavilion-product-images-demo%'
         OR cloud_key ILIKE '%demo%'
         OR url ILIKE '%demo%'
         OR model_code IN ('P001','P002','P003','P004')
      ORDER BY model_code, sku_code, file_name
    `,
  );
  const galleryRaw = parseStoredArray(imageGallerySetting);
  return {
    normalized,
    raw: galleryRaw.filter(matchesDemoImageAsset),
  };
}

async function updateSettingArray(client, key, nextArray) {
  await client.query(
    `
      INSERT INTO cms.app_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [key, rawRecord(nextArray)],
  );
}

function filterSettings(rawSettings, scope, restoredStockBySku) {
  const byKey = new Map(rawSettings.map((row) => [row.key, row]));
  const skuDeleteSet = new Set(scope.skuIds);
  const orderIdSet = new Set(scope.orderIds);
  const orderLegacySet = new Set(scope.orderLegacyIds);
  const orderNumberSet = new Set(scope.orderNumbers);
  const productMovementIdSet = new Set(scope.productInventoryMovementIds);
  const orderMovementIdSet = new Set(scope.orderInventoryMovementIds);
  const imageAssetIdSet = new Set(scope.imageAssetIds);
  const imageRawIdSet = new Set(scope.rawImageAssetIds);

  const products = parseStoredArray(byKey.get("form.products.v1"))
    .filter((product) => !skuDeleteSet.has(String(product.id)))
    .map((product) => {
      const stock = restoredStockBySku.get(String(product.id));
      return stock == null ? product : { ...product, stock };
    });

  const sales = parseStoredArray(byKey.get("form.sales.v1")).filter(
    (sale) =>
      !orderLegacySet.has(String(sale.id)) &&
      !orderNumberSet.has(String(sale.invoiceNumber)) &&
      !orderIdSet.has(String(sale.orderId ?? sale.normalizedOrderId ?? "")),
  );

  const movements = parseStoredArray(byKey.get("form.inventoryMovements.v1")).filter(
    (movement) =>
      !skuDeleteSet.has(String(movement.productId)) &&
      !orderIdSet.has(String(movement.documentId ?? "")) &&
      !productMovementIdSet.has(String(movement.id)) &&
      !orderMovementIdSet.has(String(movement.id)),
  );

  const locations = parseStoredArray(byKey.get("form.inventoryLocations.v1")).filter((location) => !skuDeleteSet.has(String(location.productId)));

  const images = parseStoredArray(byKey.get("form.imageGallery.v1")).filter((image) => {
    if (imageAssetIdSet.has(String(image.id)) || imageRawIdSet.has(String(image.id))) return false;
    return !matchesDemoImageAsset(image);
  });

  return {
    "form.products.v1": products,
    "form.sales.v1": sales,
    "form.inventoryMovements.v1": movements,
    "form.inventoryLocations.v1": locations,
    "form.imageGallery.v1": images,
  };
}

async function deleteRows(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rowCount;
}

async function executeCleanup(client, scope, backup) {
  const deleted = {};
  await client.query("BEGIN");
  try {
    const stockRestoreBySku = new Map();
    for (const movement of backup.order_inventory_movements) {
      const restoreDelta = -Number(movement.quantity_change || 0);
      if (!restoreDelta) continue;
      stockRestoreBySku.set(String(movement.sku_id), (stockRestoreBySku.get(String(movement.sku_id)) ?? 0) + restoreDelta);
      await client.query(
        `
          UPDATE cms.sku_inventory_balances
          SET qty = GREATEST(0, qty + $1::int), updated_at = now()
          WHERE sku_id = $2
            AND warehouse_id IS NOT DISTINCT FROM $3
            AND location_id IS NOT DISTINCT FROM $4
        `,
        [restoreDelta, movement.sku_id, movement.warehouse_id, movement.location_id],
      );
    }

    deleted.order_inventory_movements = scope.orderInventoryMovementIds.length
      ? await deleteRows(client, "DELETE FROM cms.inventory_movements WHERE id = ANY($1::uuid[])", [scope.orderInventoryMovementIds])
      : 0;
    deleted.invoices = scope.invoiceIds.length ? await deleteRows(client, "DELETE FROM cms.invoices WHERE id = ANY($1::uuid[])", [scope.invoiceIds]) : 0;
    deleted.orders = scope.orderIds.length ? await deleteRows(client, "DELETE FROM cms.orders WHERE id = ANY($1::uuid[])", [scope.orderIds]) : 0;

    deleted.product_inventory_movements = scope.productInventoryMovementIds.length
      ? await deleteRows(client, "DELETE FROM cms.inventory_movements WHERE id = ANY($1::uuid[])", [scope.productInventoryMovementIds])
      : 0;
    deleted.sku_inventory_balances = scope.skuIds.length ? await deleteRows(client, "DELETE FROM cms.sku_inventory_balances WHERE sku_id = ANY($1::uuid[])", [scope.skuIds]) : 0;
    deleted.product_images = scope.productIds.length || scope.skuIds.length
      ? await deleteRows(client, "DELETE FROM cms.product_images WHERE product_id = ANY($1::uuid[]) OR sku_id = ANY($2::uuid[])", [scope.productIds, scope.skuIds])
      : 0;
    deleted.product_image_assets = scope.imageAssetIds.length || scope.productIds.length || scope.skuIds.length
      ? await deleteRows(client, "DELETE FROM cms.product_image_assets WHERE id = ANY($1::uuid[]) OR product_id = ANY($2::uuid[]) OR sku_id = ANY($3::uuid[])", [
          scope.imageAssetIds,
          scope.productIds,
          scope.skuIds,
        ])
      : 0;
    deleted.skus = scope.skuIds.length ? await deleteRows(client, "DELETE FROM cms.skus WHERE id = ANY($1::uuid[])", [scope.skuIds]) : 0;
    deleted.products = scope.productIdsToDelete.length
      ? await deleteRows(client, "DELETE FROM cms.products WHERE id = ANY($1::uuid[])", [scope.productIdsToDelete])
      : 0;

    const restoredStockRows = stockRestoreBySku.size
      ? await rows(
          client,
          `
            WITH restored AS (
              SELECT
                s.id,
                COALESCE(SUM(b.qty), s.stock_qty)::int AS stock_qty
              FROM cms.skus s
              LEFT JOIN cms.sku_inventory_balances b ON b.sku_id = s.id
              WHERE s.id = ANY($1::uuid[])
              GROUP BY s.id, s.stock_qty
            )
            UPDATE cms.skus s
            SET stock_qty = restored.stock_qty,
                updated_at = now()
            FROM restored
            WHERE s.id = restored.id
            RETURNING s.id, s.stock_qty
          `,
          [Array.from(stockRestoreBySku.keys())],
        )
      : [];
    const restoredStockBySku = new Map(restoredStockRows.map((row) => [String(row.id), Number(row.stock_qty || 0)]));
    const filteredSettings = filterSettings(backup.app_settings, scope, restoredStockBySku);
    for (const [key, nextArray] of Object.entries(filteredSettings)) {
      await updateSettingArray(client, key, nextArray);
    }
    deleted.app_settings_refreshed = Object.keys(filteredSettings).length;

    await client.query(
      `
        INSERT INTO cms.audit_log (actor, action, entity_table, entity_id, before_data, after_data)
        VALUES ('codex', 'cloud.cleanup', 'cloud_cleanup', $1, $2::jsonb, $3::jsonb)
      `,
      [
        CLEANUP_CLIENT_ID,
        JSON.stringify({
          orderNumbers: scope.orderNumbers,
          productCandidateCount: scope.productCandidates.length,
          imageCandidateCount: scope.imageAssetIds.length + scope.rawImageAssetIds.length,
        }),
        JSON.stringify(deleted),
      ],
    );

    await client.query("COMMIT");
    return deleted;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function main() {
  const client = createClient();
  await client.connect();
  try {
    const beforeCounts = await countRows(client);
    const products = await candidateProducts(client);
    const productIds = unique(products.map((row) => row.product_id));
    const skuIds = unique(products.map((row) => row.sku_id));
    const deletionScope = await productDeletionScope(client, productIds, skuIds);
    const orders = await candidateOrders(client);
    const orderIds = unique(orders.map((row) => row.id));
    const orderLegacyIds = unique(orders.map((row) => row.legacy_id));
    const orderNumbers = unique(orders.map((row) => row.order_number));
    const invoices = orderIds.length
      ? await rows(
          client,
          "SELECT * FROM cms.invoices WHERE order_id = ANY($1::uuid[]) OR invoice_number = ANY($2::text[]) ORDER BY invoice_number",
          [orderIds, ORDER_NUMBERS],
        )
      : [];
    const invoiceIds = unique(invoices.map((row) => row.id));
    const appSettings = await settingsSnapshot(client);
    const imageSetting = appSettings.find((row) => row.key === "form.imageGallery.v1");
    const imageCandidates = await demoImageAssetCandidates(client, imageSetting);
    const imageAssetIds = unique(imageCandidates.normalized.map((row) => row.id));
    const rawImageAssetIds = unique(imageCandidates.raw.map((row) => row.id));

    const backup = await backupDependents(client, {
      productIds,
      productIdsToDelete: deletionScope.productIdsToDelete,
      skuIds,
      orderIds,
      invoiceIds,
    });
    backup.product_candidates = products;
    backup.mixed_products = deletionScope.mixedProducts;
    backup.demo_image_candidates = imageCandidates;
    backup.app_settings = appSettings;
    backup.counts_before = beforeCounts;

    const productInventoryMovementIds = unique(backup.inventory_movements_for_product_cleanup.map((row) => row.id));
    const orderInventoryMovementIds = unique(backup.order_inventory_movements.map((row) => row.id));
    const scope = {
      productCandidates: products,
      productIds,
      productIdsToDelete: deletionScope.productIdsToDelete,
      mixedProducts: deletionScope.mixedProducts,
      skuIds,
      orderIds,
      orderLegacyIds,
      orderNumbers,
      invoiceIds,
      imageAssetIds,
      rawImageAssetIds,
      productInventoryMovementIds,
      orderInventoryMovementIds,
    };

    const backupDir = path.join(ROOT_DIR, "exports", `cloud-cleanup-${timestampForPath()}`);
    const summary = {
      execute: EXECUTE,
      generatedAt: new Date().toISOString(),
      countsBefore: beforeCounts,
      candidates: {
        nonProductSkuRows: products.length,
        productsToDelete: scope.productIdsToDelete.length,
        mixedProductsSkippedForProductDelete: scope.mixedProducts.length,
        skuRowsToDelete: scope.skuIds.length,
        productInventoryMovementsToDelete: productInventoryMovementIds.length,
        ordersToDelete: orders.map((row) => row.order_number),
        invoicesToDelete: invoices.map((row) => row.invoice_number),
        orderInventoryMovementsToDeleteAndRestore: orderInventoryMovementIds.length,
        normalizedDemoImageAssetsToDelete: imageAssetIds.length,
        cachedDemoImageAssetsToRemove: rawImageAssetIds.length,
      },
      backupFiles: {
        fullBackup: path.join(backupDir, "backup.json"),
        summary: path.join(backupDir, "summary.json"),
      },
    };
    writeJson(path.join(backupDir, "backup.json"), backup);
    writeJson(path.join(backupDir, "summary.json"), summary);

    if (backup.order_lines_referencing_product_candidates.length || backup.invoice_lines_referencing_product_candidates.length) {
      throw new Error("Product cleanup candidates are referenced by existing order or invoice lines. Backup written; refusing to delete product candidates.");
    }

    console.log(JSON.stringify(summary, null, 2));
    if (!EXECUTE) {
      console.log("\nDry run only. Re-run with --yes to clean cloud data.");
      return;
    }

    const deleted = await executeCleanup(client, scope, backup);
    const afterCounts = await countRows(client);
    const result = { ...summary, deleted, countsAfter: afterCounts };
    writeJson(path.join(backupDir, "result.json"), result);
    console.log("\nCleanup complete.");
    console.log(JSON.stringify({ deleted, countsAfter: afterCounts, backupDir }, null, 2));
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
