const fs = require("node:fs");
const path = require("node:path");
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { ROOT_DIR, createClient } = require("./common.cjs");

const BUSINESS_TABLES = [
  "audit_log",
  "order_returns",
  "order_payments",
  "order_lines",
  "order_documents",
  "invoices",
  "invoice_documents",
  "invoice_lines",
  "orders",
  "inventory_movements",
  "sku_inventory_balances",
  "product_image_assets",
  "product_images",
  "image_directories",
  "product_maintenance_items",
  "product_shein",
  "product_size_measurements",
  "product_compositions",
  "skus",
  "product_sizes",
  "product_colours",
  "products",
  "product_categories",
  "customer_addresses",
  "customer_phones",
  "customers",
  "document_serials",
];

const BACKUP_TABLES = [
  "app_settings",
  "app_users",
  "audit_log",
  "colour_palette",
  "customer_addresses",
  "customer_phones",
  "customers",
  "document_serials",
  "image_directories",
  "inventory_movements",
  "invoice_documents",
  "invoice_lines",
  "invoices",
  "lookup_address_types",
  "lookup_business_types",
  "lookup_client_types",
  "lookup_countries",
  "lookup_customer_statuses",
  "lookup_payment_methods",
  "measurement_templates",
  "order_documents",
  "order_lines",
  "order_payments",
  "order_returns",
  "orders",
  "product_categories",
  "product_colours",
  "product_compositions",
  "product_image_assets",
  "product_images",
  "product_maintenance_items",
  "product_shein",
  "product_size_measurements",
  "product_sizes",
  "products",
  "schema_migrations",
  "sku_inventory_balances",
  "skus",
  "warehouse_locations",
  "warehouses",
];

const KEEP_APP_SETTING_KEYS = new Set([
  "form.accounts.v1",
  "form.approvals.v1",
  "app.brand.ribbonTitle",
  "app.colours",
  "app.tax.b2bDefault",
  "app.tax.b2cDefault",
  "app.transport.defaultFee",
  "app.products.defaultB2cMarkupPercent",
]);

const KEEP_APP_SETTING_PREFIXES = [
  "app.company.",
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt === -1) continue;
    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

function jsonReplacer(_key, value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function appSettingWhereClause() {
  const keepKeys = [...KEEP_APP_SETTING_KEYS];
  const prefixChecks = KEEP_APP_SETTING_PREFIXES
    .map((_, index) => `key LIKE $${index + 2}::text`)
    .join(" OR ");
  return {
    sql: `DELETE FROM cms.app_settings WHERE NOT (key = ANY($1::text[])${prefixChecks ? ` OR ${prefixChecks}` : ""})`,
    params: [keepKeys, ...KEEP_APP_SETTING_PREFIXES.map((prefix) => `${prefix}%`)],
  };
}

async function countTables(client, tables) {
  const counts = {};
  for (const table of tables) {
    const result = await client.query(`SELECT count(*)::int AS count FROM cms.${table}`);
    counts[table] = result.rows[0].count;
  }
  return counts;
}

async function backupTables(client, backupDir) {
  const tables = {};
  for (const table of BACKUP_TABLES) {
    const result = await client.query(`SELECT * FROM cms.${table}`);
    tables[table] = result.rows;
  }
  const outputPath = path.join(backupDir, "database-full-backup.json");
  fs.writeFileSync(outputPath, JSON.stringify({ createdAt: new Date().toISOString(), tables }, jsonReplacer, 2), "utf8");
  return outputPath;
}

async function listS3Prefix(s3, bucket, prefix) {
  const objects = [];
  let ContinuationToken;
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  do {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalizedPrefix ? `${normalizedPrefix}/` : "",
        ContinuationToken,
      }),
    );
    for (const object of result.Contents || []) {
      if (object.Key) {
        objects.push({
          Key: object.Key,
          Size: object.Size,
          LastModified: object.LastModified,
          ETag: object.ETag,
        });
      }
    }
    ContinuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return objects;
}

async function deleteS3Objects(s3, bucket, objects) {
  let deleted = 0;
  for (let i = 0; i < objects.length; i += 1000) {
    const batch = objects.slice(i, i + 1000);
    if (batch.length === 0) continue;
    const result = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((object) => ({ Key: object.Key })),
          Quiet: true,
        },
      }),
    );
    if (result.Errors?.length) {
      throw new Error(`Failed to delete ${result.Errors.length} S3 objects. First error: ${result.Errors[0].Message}`);
    }
    deleted += batch.length;
  }
  return deleted;
}

async function run() {
  if (!process.argv.includes("--yes")) {
    throw new Error("Refusing to reset cloud data without --yes.");
  }

  loadEnvFile(path.join(ROOT_DIR, ".env"));
  loadEnvFile(path.join(ROOT_DIR, ".env.production"));

  const backupDir = path.join(ROOT_DIR, "exports", "cloud-reset-backups", timestampForFile());
  fs.mkdirSync(backupDir, { recursive: true });

  const client = createClient();
  await client.connect();

  let beforeCounts;
  let afterCounts;
  let backupPath;

  try {
    beforeCounts = await countTables(client, BACKUP_TABLES);
    backupPath = await backupTables(client, backupDir);

    await client.query("BEGIN");
    await client.query(`TRUNCATE TABLE ${BUSINESS_TABLES.map((table) => `cms.${table}`).join(", ")} RESTART IDENTITY CASCADE`);
    const appSettingDelete = appSettingWhereClause();
    const appSettingsDeleted = await client.query(appSettingDelete.sql, appSettingDelete.params);
    await client.query(
      `
        INSERT INTO cms.audit_log (actor, action, entity_table, after_data)
        VALUES ('codex', 'cloud.business_data_reset', 'system', $1::jsonb)
      `,
      [
        JSON.stringify({
          resetAt: new Date().toISOString(),
          truncatedTables: BUSINESS_TABLES,
          appSettingsDeleted: appSettingsDeleted.rowCount,
          preservedAppSettings: [...KEEP_APP_SETTING_KEYS, ...KEEP_APP_SETTING_PREFIXES.map((prefix) => `${prefix}*`)],
        }),
      ],
    );
    await client.query("COMMIT");
    afterCounts = await countTables(client, BACKUP_TABLES);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }

  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-south-2";
  const productPrefix = (process.env.S3_BASE_PREFIX || "products").replace(/^\/+|\/+$/g, "");
  const documentPrefix = (process.env.S3_DOCUMENTS_PREFIX || "documents").replace(/^\/+|\/+$/g, "");
  let s3Deleted = 0;
  let s3ManifestPath = null;

  if (bucket) {
    const s3 = new S3Client({ region });
    const s3Objects = [
      ...(await listS3Prefix(s3, bucket, productPrefix)),
      ...(await listS3Prefix(s3, bucket, documentPrefix)),
    ];
    const uniqueObjects = [...new Map(s3Objects.map((object) => [object.Key, object])).values()];
    s3ManifestPath = path.join(backupDir, "s3-objects-before-delete.json");
    fs.writeFileSync(
      s3ManifestPath,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        bucket,
        prefixes: [productPrefix, documentPrefix],
        objects: uniqueObjects,
      }, jsonReplacer, 2),
      "utf8",
    );
    s3Deleted = await deleteS3Objects(s3, bucket, uniqueObjects);
  }

  const summary = {
    ok: true,
    backupDir,
    databaseBackup: backupPath,
    s3Manifest: s3ManifestPath,
    s3Deleted,
    beforeCounts,
    afterCounts,
  };
  fs.writeFileSync(path.join(backupDir, "reset-summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
