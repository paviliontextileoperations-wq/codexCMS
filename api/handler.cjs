const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const {
  adjustInventory,
  allocateSerial,
  cloudPull,
  cloudPush,
  reconcileInventoryBalances,
  saveSaleToDatabase,
} = require("../electron/cloudSync.cjs");
const { createDatabaseClient, databaseHealth } = require("../electron/database.cjs");

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-south-2";
const S3_BUCKET = process.env.S3_BUCKET || "";
const S3_BASE_PREFIX = trimSlashes(process.env.S3_BASE_PREFIX || "products");
const S3_DOCUMENTS_PREFIX = trimSlashes(process.env.S3_DOCUMENTS_PREFIX || "documents");
const S3_PUBLIC_BASE_URL = (process.env.S3_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const SYNC_COMPRESSION_THRESHOLD_BYTES = 256 * 1024;

const DATASETS = {
  products: "form.products.v1",
  customers: "form.customers.v1",
  orders: "form.sales.v1",
  sales: "form.sales.v1",
  invoices: "form.sales.v1",
  maintenance: "form.productMaintenance.v1",
  "inventory/movements": "form.inventoryMovements.v1",
  "inventory/locations": "form.inventoryLocations.v1",
  "images/gallery": "form.imageGallery.v1",
  settings: null,
};

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function response(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": CORS_ORIGIN,
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,x-api-key",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function encodeLargeSyncRecords(result) {
  if (!Array.isArray(result?.records)) return result;
  return {
    ...result,
    records: result.records.map((record) => {
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

function decodeLargeSyncRecords(payload) {
  if (!Array.isArray(payload?.records)) return payload;
  return {
    ...payload,
    records: payload.records.map((record) => {
      if (record?.encoding !== "gzip-base64" || typeof record.raw !== "string") return record;
      return {
        ...record,
        raw: zlib.gunzipSync(Buffer.from(record.raw, "base64")).toString("utf8"),
        encoding: undefined,
      };
    }),
  };
}

function clientAcceptsSyncCompression(payload) {
  return Array.isArray(payload?.acceptEncoding) && payload.acceptEncoding.includes("gzip-base64");
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return raw ? JSON.parse(raw) : {};
}

function getHeader(event, key) {
  const target = key.toLowerCase();
  for (const [name, value] of Object.entries(event.headers || {})) {
    if (name.toLowerCase() === target) return value;
  }
  return undefined;
}

function requestPath(event) {
  const rawPath = event.rawPath || event.path || "/";
  return `/${trimSlashes(rawPath)}`;
}

function requestMethod(event) {
  return event.requestContext?.http?.method || event.httpMethod || "GET";
}

function assertAuthorized(event, path) {
  if (!API_KEY || path === "/health") return;
  const provided = getHeader(event, "x-api-key");
  if (provided !== API_KEY) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
}

function parseStoredArray(record) {
  if (!record?.raw) return [];
  try {
    const parsed = JSON.parse(record.raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readDataset(key) {
  const result = await cloudPull({ keys: [key] });
  return parseStoredArray(result.records[0]);
}

async function writeDataset(key, value, clientId = "api") {
  await cloudPush({ clientId, records: [{ key, raw: JSON.stringify(value ?? []) }] });
  return value ?? [];
}

function toImageRole(code) {
  if (code === "F") return "front";
  if (code === "B") return "back";
  if (code === "MF") return "model_front";
  if (code === "MB") return "model_back";
  if (code.startsWith("D")) return "detail";
  if (code.startsWith("MX")) return "model_extra";
  if (code.startsWith("S")) return "shein";
  return "other";
}

function parseImageFileName(fileName) {
  const upper = String(fileName || "").trim().toUpperCase();
  const match = upper.match(/^([A-Z0-9-]+)[_-](F|B|MF|MB|D\d+|MX\d+|S\d+)\.(JPG|JPEG|PNG|WEBP)$/);
  if (!match) {
    const error = new Error("Invalid image file name. Expected SKU-F.JPG, SKU-B.JPG, SKU-D1.JPG, SKU-MF.JPG, SKU-S1.JPG.");
    error.statusCode = 400;
    throw error;
  }
  return {
    fileName: upper.replace(/\.JPEG$/, ".JPG"),
    prefix: match[1],
    code: match[2],
    extension: match[3] === "JPEG" ? "JPG" : match[3],
  };
}

function normalizeImageKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function slugPart(value, fallback) {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || fallback;
}

async function findProductForImagePrefix(client, prefix) {
  const normalized = normalizeImageKey(prefix);
  const result = await client.query(
    `
      SELECT
        p.id AS product_id,
        s.id AS sku_id,
        p.model_code,
        s.sku_code,
        p.category,
        p.fine_category
      FROM cms.skus s
      JOIN cms.products p ON p.id = s.product_id
      WHERE regexp_replace(upper(s.sku_code), '[^A-Z0-9]', '', 'g') = $1
         OR regexp_replace(upper(COALESCE(s.other_sku, '')), '[^A-Z0-9]', '', 'g') = $1
         OR regexp_replace(upper(p.model_code), '[^A-Z0-9]', '', 'g') = $1
      ORDER BY CASE WHEN regexp_replace(upper(s.sku_code), '[^A-Z0-9]', '', 'g') = $1 THEN 0 ELSE 1 END
      LIMIT 1
    `,
    [normalized],
  );
  return result.rows[0] || null;
}

function imageUrlForKey(cloudKey) {
  const encodedKey = cloudKey.split("/").map(encodeURIComponent).join("/");
  if (S3_PUBLIC_BASE_URL) return `${S3_PUBLIC_BASE_URL}/${encodedKey}`;
  return `https://${S3_BUCKET}.s3.${REGION}.amazonaws.com/${encodedKey}`;
}

function contentTypeFor(extension, requested) {
  if (requested && /^image\/(jpeg|png|webp)$/i.test(requested)) return requested.toLowerCase();
  if (extension === "PNG") return "image/png";
  if (extension === "WEBP") return "image/webp";
  return "image/jpeg";
}

function cleanFilePart(value, fallback) {
  const clean = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRate(value, fallback = 0) {
  const parsed = toNumber(value, fallback);
  return parsed > 1 ? parsed / 100 : parsed;
}

function invoiceTypeForSale(sale = {}) {
  if (sale.documentType === "PROFORMA") return "PROFORMA";
  if (sale.documentType === "DELIVERY_NOTE") return "NO_INVOICE";
  if (sale.documentType === "RECEIPT") return "B2C_RECEIPT";
  return "B2B_INVOICE";
}

function fiscalStatusForSale(sale = {}) {
  if (sale.documentStatus === "cancelled") return "cancelled";
  if (String(sale.invoiceNumber || "").startsWith("DRAFT-") || sale.paymentStatus !== "PAID") return "draft";
  return "issued";
}

function taxProfileForSale(sale = {}) {
  if (sale.invoiceTaxProfile) return sale.invoiceTaxProfile;
  if (sale.documentType === "DELIVERY_NOTE") return "no_tax";
  if (sale.documentType === "RECEIPT") return "b2c";
  if (normalizeRate(sale.taxRate, 0) <= 0) return "no_tax";
  return "standard";
}

async function buildImageAsset(fileName, contentType) {
  if (!S3_BUCKET) {
    const error = new Error("S3_BUCKET is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const parsed = parseImageFileName(fileName);
  const client = createDatabaseClient();
  await client.connect();
  try {
    const target = await findProductForImagePrefix(client, parsed.prefix);
    const modelCode = (target?.model_code || parsed.prefix).toUpperCase();
    const skuCode = (target?.sku_code || parsed.prefix).toUpperCase();
    const category = slugPart(target?.category, "uncategorized");
    const fineCategory = slugPart(target?.fine_category, "general");
    const directoryKey = ["women", category, fineCategory, modelCode, skuCode].join("/");
    const cloudKey = [S3_BASE_PREFIX, directoryKey, parsed.fileName].filter(Boolean).join("/");
    const mimeType = contentTypeFor(parsed.extension, contentType);

    return {
      productId: target?.product_id || null,
      skuId: target?.sku_id || null,
      modelCode,
      skuCode,
      imageCode: parsed.code,
      imageRole: toImageRole(parsed.code),
      fileName: parsed.fileName,
      directoryKey,
      cloudKey,
      url: imageUrlForKey(cloudKey),
      mimeType,
      bucketName: S3_BUCKET,
      basePrefix: S3_BASE_PREFIX,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function createUploadUrl(payload) {
  const asset = await buildImageAsset(payload.fileName, payload.contentType);
  const s3 = new S3Client({ region: REGION });
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: asset.cloudKey,
    ContentType: asset.mimeType,
    Metadata: {
      sku: asset.skuCode,
      model: asset.modelCode,
      imageCode: asset.imageCode,
      imageRole: asset.imageRole,
    },
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  return {
    uploadUrl,
    method: "PUT",
    headers: { "content-type": asset.mimeType },
    expiresIn: 900,
    asset,
  };
}

async function registerImageAsset(payload) {
  const asset = payload.asset || payload;
  if (!asset.cloudKey || !asset.fileName) {
    const error = new Error("Image asset payload is incomplete.");
    error.statusCode = 400;
    throw error;
  }

  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query("BEGIN");
    const directory = await client.query(
      `
        INSERT INTO cms.image_directories
          (directory_key, category, fine_category, model_code, sku_code, bucket_name, base_prefix)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (directory_key) DO UPDATE SET
          category = EXCLUDED.category,
          fine_category = EXCLUDED.fine_category,
          model_code = EXCLUDED.model_code,
          sku_code = EXCLUDED.sku_code,
          bucket_name = EXCLUDED.bucket_name,
          base_prefix = EXCLUDED.base_prefix,
          updated_at = now()
        RETURNING id
      `,
      [
        asset.directoryKey,
        asset.directoryKey?.split("/")[1] || "uncategorized",
        asset.directoryKey?.split("/")[2] || "general",
        asset.modelCode,
        asset.skuCode,
        asset.bucketName || S3_BUCKET,
        asset.basePrefix || S3_BASE_PREFIX,
      ],
    );
    const directoryId = directory.rows[0].id;
    const upsert = await client.query(
      `
        INSERT INTO cms.product_image_assets
          (product_id, sku_id, directory_id, model_code, sku_code, image_code, image_role, file_name, cloud_key, url, mime_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (cloud_key) DO UPDATE SET
          product_id = EXCLUDED.product_id,
          sku_id = EXCLUDED.sku_id,
          directory_id = EXCLUDED.directory_id,
          model_code = EXCLUDED.model_code,
          sku_code = EXCLUDED.sku_code,
          image_code = EXCLUDED.image_code,
          image_role = EXCLUDED.image_role,
          file_name = EXCLUDED.file_name,
          url = EXCLUDED.url,
          mime_type = EXCLUDED.mime_type,
          uploaded_at = now(),
          updated_at = now()
        RETURNING *
      `,
      [
        asset.productId,
        asset.skuId,
        directoryId,
        asset.modelCode,
        asset.skuCode,
        asset.imageCode,
        asset.imageRole,
        asset.fileName,
        asset.cloudKey,
        asset.url || imageUrlForKey(asset.cloudKey),
        asset.mimeType || "image/jpeg",
      ],
    );
    const imageUrl = asset.url || imageUrlForKey(asset.cloudKey);
    const shouldUseAsMain = ["front", "model_front"].includes(asset.imageRole);
    if (imageUrl && asset.skuId) {
      await client.query(
        `
          UPDATE cms.skus
          SET image_url = $1, updated_at = now()
          WHERE id = $2
            AND ($3::boolean OR image_url IS NULL OR image_url = '')
        `,
        [imageUrl, asset.skuId, shouldUseAsMain],
      );
    }
    if (imageUrl && asset.productId) {
      await client.query(
        `
          UPDATE cms.products
          SET main_picture_url = $1, updated_at = now()
          WHERE id = $2
            AND ($3::boolean OR main_picture_url IS NULL OR main_picture_url = '')
        `,
        [imageUrl, asset.productId, shouldUseAsMain],
      );
    }
    await client.query(
      `
        INSERT INTO cms.audit_log (actor, action, entity_table, entity_id, after_data)
        VALUES ('api', 'image.register', 'product_image_assets', $1, $2::jsonb)
      `,
      [
        String(upsert.rows[0].id),
        JSON.stringify({
          sku: asset.skuCode,
          imageRole: asset.imageRole,
          url: imageUrl,
          cloudKey: asset.cloudKey,
        }),
      ],
    );
    await client.query("COMMIT");
    return upsert.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function listImageAssets() {
  const client = createDatabaseClient();
  await client.connect();
  try {
    const result = await client.query("SELECT * FROM cms.v_product_image_asset_export ORDER BY uploaded_at DESC");
    return result.rows;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function saveInvoiceDocument(payload) {
  if (!S3_BUCKET) {
    const error = new Error("S3_BUCKET is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const sale = payload.sale || {};
  const invoiceNumber = cleanFilePart(sale.invoiceNumber, "invoice");
  const fileName = cleanFilePart(payload.fileName, `${invoiceNumber}.pdf`);
  const pdfBase64 = String(payload.pdfBase64 || "");
  if (!pdfBase64) {
    const error = new Error("Missing PDF content.");
    error.statusCode = 400;
    throw error;
  }

  const pdfBuffer = Buffer.from(pdfBase64, "base64");
  const issueDate = sale.createdAt ? new Date(sale.createdAt) : new Date();
  const year = String(issueDate.getFullYear());
  const month = String(issueDate.getMonth() + 1).padStart(2, "0");
  const cloudKey = [S3_DOCUMENTS_PREFIX, "invoices", year, month, fileName].filter(Boolean).join("/");
  const url = imageUrlForKey(cloudKey);
  const sha256 = crypto.createHash("sha256").update(pdfBuffer).digest("hex");

  const s3 = new S3Client({ region: REGION });
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: cloudKey,
      Body: pdfBuffer,
      ContentType: "application/pdf",
      Metadata: {
        invoiceNumber,
        documentRole: "pdf",
      },
    }),
  );

  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query("BEGIN");
    const taxBreakdown = sale.taxBreakdown || {};
    const surchargeAmount = toNumber(taxBreakdown.surchargeAmount, 0);
    const taxAmount =
      taxBreakdown.vatAmount === undefined
        ? Math.max(0, toNumber(sale.tax, 0) - surchargeAmount)
        : toNumber(taxBreakdown.vatAmount, 0);
    const invoice = await client.query(
      `
        INSERT INTO cms.invoices (
          invoice_number, invoice_type, fiscal_status, editable,
          tax_profile, tax_rate, vat_rate, surcharge_rate, currency,
          issue_date, due_date, customer_snapshot, subtotal, tax_amount,
          surcharge_amount, transport_fee, total, amount_paid, amount_due,
          notes, pdf_url, issued_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, 'EUR',
          $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18,
          $19, $20, $21
        )
        ON CONFLICT (invoice_number) DO UPDATE SET
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
          pdf_url = EXCLUDED.pdf_url,
          issued_at = COALESCE(cms.invoices.issued_at, EXCLUDED.issued_at),
          updated_at = now()
        RETURNING id
      `,
      [
        invoiceNumber,
        invoiceTypeForSale(sale),
        fiscalStatusForSale(sale),
        fiscalStatusForSale(sale) === "draft",
        taxProfileForSale(sale),
        normalizeRate(sale.taxRate, 0),
        normalizeRate(taxBreakdown.vat, normalizeRate(sale.taxRate, 0)),
        normalizeRate(taxBreakdown.surcharge, 0),
        issueDate,
        sale.dueDate ? new Date(sale.dueDate) : null,
        JSON.stringify(sale.customerSnapshot || {}),
        toNumber(sale.subtotal, 0),
        taxAmount,
        surchargeAmount,
        toNumber(sale.transport?.fee, 0),
        toNumber(sale.total, 0),
        toNumber(sale.amountPaid, 0),
        toNumber(sale.amountDue, toNumber(sale.total, 0) - toNumber(sale.amountPaid, 0)),
        sale.invoiceNotes || null,
        url,
        fiscalStatusForSale(sale) === "issued" ? issueDate : null,
      ],
    );
    const invoiceId = invoice.rows[0].id;
    const document = await client.query(
      `
        INSERT INTO cms.invoice_documents (
          invoice_id, document_role, file_name, cloud_key, url, sha256
        ) VALUES ($1, 'pdf', $2, $3, $4, $5)
        ON CONFLICT (invoice_id, document_role, file_name) DO UPDATE SET
          cloud_key = EXCLUDED.cloud_key,
          url = EXCLUDED.url,
          sha256 = EXCLUDED.sha256,
          created_at = now()
        RETURNING *
      `,
      [invoiceId, fileName, cloudKey, url, sha256],
    );
    await client.query(
      `
        INSERT INTO cms.audit_log (actor, action, entity_table, entity_id, after_data)
        VALUES ('api', 'invoice.pdf_saved', 'invoice_documents', $1, $2::jsonb)
      `,
      [
        String(document.rows[0].id),
        JSON.stringify({
          invoiceNumber,
          fileName,
          cloudKey,
          url,
          sha256,
        }),
      ],
    );
    await client.query("COMMIT");
    return { ok: true, url, document: document.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function saveOrderDocument(payload) {
  if (!S3_BUCKET) {
    const error = new Error("S3_BUCKET is not configured.");
    error.statusCode = 500;
    throw error;
  }

  const sale = payload.sale || {};
  const documentType = String(payload.documentType || "SHIPPING_LABEL").toUpperCase();
  if (documentType !== "SHIPPING_LABEL") {
    const error = new Error("Unsupported order document type.");
    error.statusCode = 400;
    throw error;
  }

  const orderNumber = cleanFilePart(sale.invoiceNumber, "order");
  const documentNumber = cleanFilePart(payload.documentNumber, `${orderNumber}-LABEL`);
  const fileName = cleanFilePart(payload.fileName, `${documentNumber}.pdf`);
  const pdfBase64 = String(payload.pdfBase64 || "");
  if (!pdfBase64) {
    const error = new Error("Missing PDF content.");
    error.statusCode = 400;
    throw error;
  }

  const pdfBuffer = Buffer.from(pdfBase64, "base64");
  const issueDate = sale.createdAt ? new Date(sale.createdAt) : new Date();
  const year = String(issueDate.getFullYear());
  const month = String(issueDate.getMonth() + 1).padStart(2, "0");
  const cloudKey = [S3_DOCUMENTS_PREFIX, "shipping-labels", year, month, fileName].filter(Boolean).join("/");
  const url = imageUrlForKey(cloudKey);
  const sha256 = crypto.createHash("sha256").update(pdfBuffer).digest("hex");

  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query(
      `
        SELECT id
        FROM cms.orders
        WHERE legacy_id = $1 OR order_number = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [sale.id || null, sale.invoiceNumber || orderNumber],
    );
    if (order.rowCount === 0) {
      const error = new Error("Order not found for shipping label document.");
      error.statusCode = 404;
      throw error;
    }

    const s3 = new S3Client({ region: REGION });
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: cloudKey,
        Body: pdfBuffer,
        ContentType: "application/pdf",
        Metadata: {
          orderNumber,
          documentType,
        },
      }),
    );

    const document = await client.query(
      `
        INSERT INTO cms.order_documents (
          order_id, document_type, document_number, file_url, file_sha256, issued_at, status
        ) VALUES ($1, 'SHIPPING_LABEL', $2, $3, $4, $5, 'issued')
        ON CONFLICT (document_number) DO UPDATE SET
          file_url = EXCLUDED.file_url,
          file_sha256 = EXCLUDED.file_sha256,
          issued_at = EXCLUDED.issued_at,
          status = 'issued',
          updated_at = now()
        RETURNING *
      `,
      [order.rows[0].id, documentNumber, url, sha256, issueDate],
    );
    await client.query(
      `
        INSERT INTO cms.audit_log (actor, action, entity_table, entity_id, after_data)
        VALUES ('api', 'order.shipping_label_saved', 'order_documents', $1, $2::jsonb)
      `,
      [
        String(document.rows[0].id),
        JSON.stringify({
          orderNumber,
          documentNumber,
          fileName,
          cloudKey,
          url,
          sha256,
        }),
      ],
    );
    await client.query("COMMIT");
    return { ok: true, url, document: document.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function handle(event) {
  const path = requestPath(event);
  const method = requestMethod(event).toUpperCase();
  if (method === "OPTIONS") return response(204, {});

  assertAuthorized(event, path);

  if (method === "GET" && path === "/health") {
    const db = await databaseHealth();
    return response(200, {
      ok: db.ok,
      database: db,
      s3: { configured: Boolean(S3_BUCKET), bucket: S3_BUCKET || null, region: REGION },
    });
  }

  if (method === "POST" && path === "/sync/pull") {
    const body = parseBody(event);
    const result = await cloudPull(body);
    return response(200, clientAcceptsSyncCompression(body) ? encodeLargeSyncRecords(result) : result);
  }

  if (method === "POST" && path === "/sync/push") {
    return response(200, await cloudPush(decodeLargeSyncRecords(parseBody(event))));
  }

  if (method === "POST" && path === "/images/upload-url") {
    return response(200, await createUploadUrl(parseBody(event)));
  }

  if (method === "POST" && path === "/images/register") {
    return response(200, { ok: true, asset: await registerImageAsset(parseBody(event)) });
  }

  if (method === "GET" && path === "/images/assets") {
    return response(200, { ok: true, assets: await listImageAssets() });
  }

  if (method === "POST" && path === "/invoices/document") {
    return response(200, await saveInvoiceDocument(parseBody(event)));
  }

  if (method === "POST" && path === "/orders/document") {
    return response(200, await saveOrderDocument(parseBody(event)));
  }

  if (method === "POST" && path === "/inventory/adjust") {
    return response(200, await adjustInventory({ ...parseBody(event), skipApi: true }));
  }

  if (method === "POST" && path === "/inventory/reconcile") {
    return response(200, await reconcileInventoryBalances({ ...parseBody(event), skipApi: true }));
  }

  if (method === "POST" && path === "/serial/next") {
    return response(200, await allocateSerial({ ...parseBody(event), skipApi: true }));
  }

  if (method === "POST" && path === "/sales/save") {
    return response(200, await saveSaleToDatabase({ ...parseBody(event), skipApi: true }));
  }

  const datasetName = trimSlashes(path);
  const key = DATASETS[datasetName];
  if (key && method === "GET") {
    return response(200, { ok: true, data: await readDataset(key) });
  }
  if (key && (method === "PUT" || method === "POST")) {
    const body = parseBody(event);
    return response(200, { ok: true, data: await writeDataset(key, body.data, body.clientId || "api") });
  }

  return response(404, { ok: false, message: `No route for ${method} ${path}` });
}

exports.handler = async (event) => {
  try {
    return await handle(event || {});
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return response(statusCode, {
      ok: false,
      message: error.message || "Internal server error",
    });
  }
};
