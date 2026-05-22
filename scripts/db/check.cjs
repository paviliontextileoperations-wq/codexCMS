const { createClient } = require("./common.cjs");

const TABLES = [
  "products",
  "product_colours",
  "product_sizes",
  "skus",
  "customers",
  "customer_addresses",
  "customer_phones",
  "orders",
  "order_lines",
  "order_payments",
  "invoices",
  "invoice_lines",
  "invoice_documents",
  "product_maintenance_items",
  "warehouses",
  "warehouse_locations",
  "sku_inventory_balances",
  "inventory_movements",
  "image_directories",
  "product_image_assets",
];

const VIEWS = [
  "v_product_sku_export",
  "v_product_measurement_export",
  "v_customer_export",
  "v_order_export",
  "v_order_line_export",
  "v_invoice_export",
  "v_invoice_line_export",
  "v_inventory_balance_export",
  "v_inventory_export",
  "v_product_image_asset_export",
];

async function run() {
  const client = createClient();
  await client.connect();

  try {
    const db = await client.query(
      "SELECT current_database() AS database_name, current_user AS user_name, version() AS version",
    );
    console.log(`Connected to ${db.rows[0].database_name} as ${db.rows[0].user_name}`);
    console.log(db.rows[0].version.split(",")[0]);

    const missing = await client.query(
      `
        SELECT name
        FROM unnest($1::text[]) AS t(name)
        WHERE to_regclass('cms.' || name) IS NULL
        ORDER BY name
      `,
      [[...TABLES, ...VIEWS]],
    );
    if (missing.rowCount > 0) {
      throw new Error(
        `Missing database objects: ${missing.rows.map((row) => row.name).join(", ")}`,
      );
    }

    console.log("Core tables:");
    for (const table of TABLES) {
      const result = await client.query(`SELECT count(*)::int AS count FROM cms.${table}`);
      console.log(`- ${table}: ${result.rows[0].count}`);
    }

    console.log("Export views:");
    for (const view of VIEWS) {
      const result = await client.query(`SELECT count(*)::int AS count FROM cms.${view}`);
      console.log(`- ${view}: ${result.rows[0].count}`);
    }

    console.log("Database health check completed.");
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
