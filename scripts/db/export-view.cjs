const { createClient, writeCsv } = require("./common.cjs");

const EXPORT_VIEWS = new Set([
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
]);

async function run() {
  const [, , viewName, outputPath] = process.argv;
  if (!viewName || !outputPath || !EXPORT_VIEWS.has(viewName)) {
    console.error("Usage: npm run db:export -- <view_name> <output.csv>");
    console.error(`Allowed views: ${Array.from(EXPORT_VIEWS).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const client = createClient();
  await client.connect();

  try {
    const result = await client.query(`SELECT * FROM cms.${viewName}`);
    const writtenTo = writeCsv(outputPath, result.rows, result.fields);
    console.log(`Exported ${result.rowCount} rows from ${viewName}`);
    console.log(writtenTo);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
