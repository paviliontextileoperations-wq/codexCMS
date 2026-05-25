const fs = require("node:fs");
const path = require("node:path");
const xlsx = require("xlsx");
const { createClient, ROOT_DIR, writeCsv } = require("./common.cjs");

const DATA_DIR = path.resolve(ROOT_DIR, "..", "\u516c\u53f8\u6570\u636e\u4e2d\u5fc3");
const PRODUCTS_FILE = path.join(DATA_DIR, "Bohao_PRODUCTS.xls");
const CUSTOMERS_FILE = path.join(DATA_DIR, "Bohao_CLIENTS.xls");
const DEFAULT_LIMIT = 200;
const IMPORT_TAG = "bohao-sample-200";

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((item) => item.startsWith(prefix));
  if (!match) return fallback;
  const value = Number(match.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readRows(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing import file: ${filePath}`);
  }
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  return xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });
}

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function nullableText(value) {
  const clean = text(value);
  return clean ? clean : null;
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanCode(value, fallback) {
  const clean = text(value)
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .toUpperCase();
  return clean || fallback;
}

function cleanVat(value) {
  return nullableText(value)?.replace(/\s+/g, "").toUpperCase() ?? null;
}

function cleanEmail(value) {
  const clean = nullableText(value)?.toLowerCase() ?? null;
  if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return null;
  return clean;
}

function phoneParts(value) {
  const raw = nullableText(value);
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.startsWith("+")) {
    const match = normalized.match(/^(\+\d{1,4})\s*(.*)$/);
    if (match && match[2]) {
      return { countryCode: match[1], phoneNumber: match[2].trim() };
    }
  }
  const embedded = normalized.match(/\+(\d{1,4})/);
  if (embedded) {
    return {
      countryCode: `+${embedded[1]}`,
      phoneNumber: normalized.replace(embedded[0], "").replace(/^0+/, "").trim(),
    };
  }
  return { countryCode: "+34", phoneNumber: normalized };
}

function categoryFromName(name) {
  const upper = name.toUpperCase();
  if (/VESTIDO|MONO/.test(upper)) return ["Dresses", "Dress"];
  if (/PANTALON|JEANS|SHORT/.test(upper)) return ["Trousers & Jeans", "Long Pants"];
  if (/CAMISA|JERSEY|TOP|CAMISETA|BLUSA|CHALECO/.test(upper)) return ["Tops", "Top"];
  if (/BLAZER|CHAQUETA|ABRIGO|CAZADORA|TRENCH/.test(upper)) return ["Coats & Jackets", "Jacket"];
  if (/FALDA/.test(upper)) return ["Skirts", "Skirt"];
  if (/CONJUNTO|CHANDAL/.test(upper)) return ["Sets", "Set"];
  return ["Imported", "Bohao"];
}

function parseStatus(blocked) {
  return toNumber(blocked, 0) === 0 ? "active" : "archived";
}

function skuPairForProduct(row, index) {
  const sourceSku = cleanCode(row.ArticuloID, `BOHAO-${String(index + 1).padStart(4, "0")}`);
  const alternate = cleanCode(row.CodigoBarra || row.MultiCodigo || row.SerialNo || row.ArticuloID, sourceSku);
  return {
    nsku: sourceSku,
    osku: alternate,
    sourceSku,
  };
}

async function ensureProductCategory(client, categoryName, fineCategoryName) {
  const category = await client.query(
    `
      INSERT INTO cms.product_categories (name, category_level, sort_order)
      VALUES ($1, 'category', 100)
      ON CONFLICT (parent_id, name, category_level) DO UPDATE SET
        is_active = true,
        updated_at = now()
      RETURNING id
    `,
    [categoryName],
  );
  const fine = await client.query(
    `
      INSERT INTO cms.product_categories (parent_id, name, category_level, sort_order)
      VALUES ($1, $2, 'fine_category', 100)
      ON CONFLICT (parent_id, name, category_level) DO UPDATE SET
        is_active = true,
        updated_at = now()
      RETURNING id
    `,
    [category.rows[0].id, fineCategoryName],
  );
  return { categoryId: category.rows[0].id, fineCategoryId: fine.rows[0].id };
}

async function ensureColour(client) {
  await client.query(
    `
      INSERT INTO cms.colour_palette (colour_code, colour_name)
      VALUES ('UNSPECIFIED', 'Unspecified')
      ON CONFLICT (colour_code) DO UPDATE SET
        colour_name = EXCLUDED.colour_name,
        updated_at = now()
    `,
  );
}

async function upsertProductRow(client, row, index, warehouse) {
  const { nsku, osku, sourceSku } = skuPairForProduct(row, index);
  const productName = text(row.NombreES) || nsku;
  const [category, fineCategory] = categoryFromName(productName);
  const { categoryId, fineCategoryId } = await ensureProductCategory(client, category, fineCategory);
  const price = Math.max(0, toNumber(row.PrecioMayor, toNumber(row.PrecioFactura, toNumber(row.PrecioDetalle, 0))));
  const retailPrice = toNumber(row.PrecioDetalle, 0);
  const costPrice = toNumber(row.PrecioCoste, 0);
  const minQty = Math.max(0, Math.round(toNumber(row.MiniStock, 0)));
  const status = parseStatus(row.Bloqueado);
  const notes = [
    `Import tag: ${IMPORT_TAG}`,
    `Nsku: ${nsku}`,
    `Osku: ${osku}`,
    `Bohao ArticuloID: ${sourceSku}`,
    row.DibujoID ? `DibujoID: ${row.DibujoID}` : null,
    costPrice ? `Cost price: ${costPrice}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const product = await client.query(
    `
      INSERT INTO cms.products (
        legacy_id, model_code, name, description, category_id, fine_category_id,
        category, fine_category, b2b_price, b2c_markup_percent, b2c_price_override,
        status, source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 100, $10, $11, 'bohao')
      ON CONFLICT (legacy_id) DO UPDATE SET
        model_code = EXCLUDED.model_code,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category_id = EXCLUDED.category_id,
        fine_category_id = EXCLUDED.fine_category_id,
        category = EXCLUDED.category,
        fine_category = EXCLUDED.fine_category,
        b2b_price = EXCLUDED.b2b_price,
        b2c_price_override = EXCLUDED.b2c_price_override,
        status = EXCLUDED.status,
        source = EXCLUDED.source,
        updated_at = now()
      RETURNING id
    `,
    [
      `bohao-product:${sourceSku}`,
      nsku,
      productName,
      notes,
      categoryId,
      fineCategoryId,
      category,
      fineCategory,
      price,
      retailPrice > 0 ? retailPrice : null,
      status,
    ],
  );
  const productId = product.rows[0].id;

  const colour = await client.query(
    `
      INSERT INTO cms.product_colours (product_id, colour_name, colour_code, sort_order)
      VALUES ($1, 'Unspecified', 'UNSPECIFIED', 100)
      ON CONFLICT (product_id, colour_code) DO UPDATE SET
        colour_name = EXCLUDED.colour_name,
        updated_at = now()
      RETURNING id
    `,
    [productId],
  );
  const size = await client.query(
    `
      INSERT INTO cms.product_sizes (product_id, size_code, size_label, sort_order)
      VALUES ($1, 'U', 'One Size / Unspecified', 100)
      ON CONFLICT (product_id, size_code) DO UPDATE SET
        size_label = EXCLUDED.size_label,
        updated_at = now()
      RETURNING id
    `,
    [productId],
  );

  const sku = await client.query(
    `
      INSERT INTO cms.skus (
        legacy_id, product_id, colour_id, size_id, sku_code, barcode, other_sku,
        stock_qty, low_stock_threshold, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)
      ON CONFLICT (legacy_id) DO UPDATE SET
        product_id = EXCLUDED.product_id,
        colour_id = EXCLUDED.colour_id,
        size_id = EXCLUDED.size_id,
        sku_code = EXCLUDED.sku_code,
        barcode = EXCLUDED.barcode,
        other_sku = EXCLUDED.other_sku,
        low_stock_threshold = EXCLUDED.low_stock_threshold,
        status = EXCLUDED.status,
        updated_at = now()
      RETURNING id
    `,
    [
      `bohao-sku:${sourceSku}`,
      productId,
      colour.rows[0].id,
      size.rows[0].id,
      nsku,
      nullableText(row.CodigoBarra),
      osku,
      minQty,
      status === "active" ? "active" : "archived",
    ],
  );

  await client.query(
    `
      INSERT INTO cms.sku_inventory_balances (
        sku_id, warehouse_id, location_id, qty, min_qty, last_counted_at
      )
      VALUES ($1, $2, $3, 0, $4, now())
      ON CONFLICT (sku_id, warehouse_id, location_id) DO UPDATE SET
        min_qty = EXCLUDED.min_qty,
        updated_at = now()
    `,
    [sku.rows[0].id, warehouse.warehouseId, warehouse.locationId, minQty],
  );

  await client.query(
    `
      INSERT INTO cms.inventory_movements (
        legacy_id, sku_id, movement_type, warehouse_id, location_id,
        previous_qty, new_qty, quantity_change, reason_category, notes, created_by
      )
      VALUES ($1, $2, 'initial_import', $3, $4, 0, 0, 0, 'bohao_sample', $5, 'bohao-import')
      ON CONFLICT (legacy_id) DO NOTHING
    `,
    [`bohao-initial:${sourceSku}`, sku.rows[0].id, warehouse.warehouseId, warehouse.locationId, notes],
  );

  return {
    row_no: index + 1,
    nsku,
    osku,
    source_articulo_id: sourceSku,
    name: productName,
    category,
    fine_category: fineCategory,
    b2b_price: price,
    retail_price: retailPrice || "",
    stock_qty: 0,
    low_stock_threshold: minQty,
    status,
  };
}

async function warehouseTarget(client) {
  const warehouse = await client.query("SELECT id FROM cms.warehouses WHERE code = 'MAIN'");
  if (!warehouse.rowCount) throw new Error("Missing MAIN warehouse.");
  const location = await client.query(
    `
      SELECT id
      FROM cms.warehouse_locations
      WHERE warehouse_id = $1 AND location_code = 'A-01-01'
    `,
    [warehouse.rows[0].id],
  );
  if (!location.rowCount) throw new Error("Missing MAIN A-01-01 warehouse location.");
  return { warehouseId: warehouse.rows[0].id, locationId: location.rows[0].id };
}

function customerCode(row, index) {
  const sourceId = cleanCode(row.EmpresaID, String(index + 1).padStart(4, "0"));
  return `BOH-C${sourceId}`;
}

function customerName(row, code) {
  return text(row.NombreES) || text(row.NombreCN) || code;
}

function customerStatus(row) {
  return toNumber(row.Bloqueado, 0) === 0 ? "Active" : "Blocked";
}

function taxRate(row) {
  const explicit = toNumber(row.FacturaPorcentaje, NaN);
  if (Number.isFinite(explicit) && explicit > 0 && explicit <= 30) return explicit;
  const iva = String(row.IVAClase ?? "").trim();
  if (iva === "1") return 21;
  if (iva === "2") return 0;
  return 0;
}

function normalizedCountry(row) {
  const countries = new Map([
    ["ESPANA", "Spain"],
    ["ESPAÑA", "Spain"],
    ["SPAIN", "Spain"],
    ["PORTUGAL", "Portugal"],
    ["FRANCE", "France"],
    ["FRANCIA", "France"],
    ["ITALIA", "Italy"],
    ["ITALY", "Italy"],
    ["GERMANY", "Germany"],
    ["ALEMANIA", "Germany"],
    ["ECUADOR", "Ecuador"],
    ["USA", "United States"],
    ["UNITED STATES", "United States"],
    ["ESTADOS UNIDOS", "United States"],
    ["GUINEA ECUATORIAL", "Equatorial Guinea"],
    ["ANGOLA", "Angola"],
  ]);
  for (const candidate of [row.Pais, row.Provincia]) {
    const clean = text(candidate).toUpperCase();
    if (countries.has(clean)) return countries.get(clean);
  }
  return "Spain";
}

function businessTypeFor(row, vat) {
  if (!vat) return null;
  if (String(row.IVAClase ?? "").trim() === "2") return "INTERNATIONAL";
  if (normalizedCountry(row) !== "Spain") return "INTERNATIONAL";
  return "ESP EMPRESA";
}

async function upsertCustomerRow(client, row, index) {
  const code = customerCode(row, index);
  const name = customerName(row, code);
  const vat = cleanVat(row.CIF || row.NumeroIVA);
  const isBusiness = Boolean(vat);
  const clientType = isBusiness ? "B2B" : "B2C";
  const businessType = businessTypeFor(row, vat);
  const businessName = isBusiness ? name : null;
  const status = customerStatus(row);
  const notes = [
    `Import tag: ${IMPORT_TAG}`,
    `Bohao EmpresaID: ${text(row.EmpresaID)}`,
    text(row.NombreCN) ? `CN name: ${text(row.NombreCN)}` : null,
    `Needs invoice source flag: ${text(row.NecesitaFactura) || "0"}`,
    `IVAClase: ${text(row.IVAClase) || "0"}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const customer = await client.query(
    `
      INSERT INTO cms.customers (
        legacy_id, customer_code, client_type, name, business_type, business_name,
        email, vat_number, tax_rate_percent, status, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (legacy_id) DO UPDATE SET
        customer_code = EXCLUDED.customer_code,
        client_type = EXCLUDED.client_type,
        name = EXCLUDED.name,
        business_type = EXCLUDED.business_type,
        business_name = EXCLUDED.business_name,
        email = EXCLUDED.email,
        vat_number = EXCLUDED.vat_number,
        tax_rate_percent = EXCLUDED.tax_rate_percent,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        updated_at = now()
      RETURNING id
    `,
    [
      `bohao-customer:${text(row.EmpresaID) || index + 1}`,
      code,
      clientType,
      name,
      businessType,
      businessName,
      cleanEmail(row.Email),
      vat,
      taxRate(row),
      status,
      notes,
    ],
  );

  const customerId = customer.rows[0].id;
  const line1 = text(row.Domicilio) || text(row.Poblacion) || "Imported address unavailable";
  const postal = text(row.CodigoPostal) || "N/A";
  const province = text(row.Provincia) || text(row.Poblacion) || "N/A";
  const country = normalizedCountry(row);
  await client.query(
    `
      INSERT INTO cms.customer_addresses (
        legacy_id, address_code, customer_id, address_type, address_line_1,
        postal_code, province_state, country, is_default, same_as_other_address
      )
      VALUES ($1, $2, $3, 'Fiscal', $4, $5, $6, $7, true, false)
      ON CONFLICT (legacy_id) DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        address_line_1 = EXCLUDED.address_line_1,
        postal_code = EXCLUDED.postal_code,
        province_state = EXCLUDED.province_state,
        country = EXCLUDED.country,
        is_default = true,
        updated_at = now()
    `,
    [`bohao-customer-address:${text(row.EmpresaID) || index + 1}`, `${code}-FISCAL`, customerId, line1, postal, province, country],
  );

  const phone = phoneParts(row.Telefono || row.Telefono2);
  if (phone) {
    await client.query(
      `
        INSERT INTO cms.customer_phones (
          legacy_id, phone_code, customer_id, country_code, phone_number, is_primary
        )
        VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (legacy_id) DO UPDATE SET
          customer_id = EXCLUDED.customer_id,
          country_code = EXCLUDED.country_code,
          phone_number = EXCLUDED.phone_number,
          is_primary = true,
          updated_at = now()
      `,
      [
        `bohao-customer-phone:${text(row.EmpresaID) || index + 1}`,
        `${code}-PHONE`,
        customerId,
        phone.countryCode,
        phone.phoneNumber,
      ],
    );
  }

  return {
    row_no: index + 1,
    customer_code: code,
    source_empresa_id: text(row.EmpresaID),
    client_type: clientType,
    name,
    business_type: businessType || "",
    vat_number: vat || "",
    tax_rate_percent: taxRate(row),
    phone: phone ? `${phone.countryCode} ${phone.phoneNumber}` : "",
    fiscal_address: `${line1}, ${postal}, ${province}, ${country}`,
    status,
  };
}

async function main() {
  const productLimit = argValue("products", DEFAULT_LIMIT);
  const customerLimit = argValue("customers", DEFAULT_LIMIT);
  const products = readRows(PRODUCTS_FILE).slice(0, productLimit);
  const customers = readRows(CUSTOMERS_FILE).slice(0, customerLimit);
  const reportDir = path.join(
    ROOT_DIR,
    "exports",
    "import-reports",
    `bohao-sample-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`,
  );
  fs.mkdirSync(reportDir, { recursive: true });

  const client = createClient();
  await client.connect();
  try {
    await client.query("BEGIN");
    await ensureColour(client);
    const warehouse = await warehouseTarget(client);

    const productReport = [];
    for (let i = 0; i < products.length; i += 1) {
      productReport.push(await upsertProductRow(client, products[i], i, warehouse));
    }

    const customerReport = [];
    for (let i = 0; i < customers.length; i += 1) {
      customerReport.push(await upsertCustomerRow(client, customers[i], i));
    }

    await client.query(
      `
        INSERT INTO cms.audit_log (actor, action, entity_table, entity_id, after_data)
        VALUES ('bohao-import', 'sample_import', 'products_customers', $1, $2::jsonb)
      `,
      [
        IMPORT_TAG,
        JSON.stringify({
          productLimit,
          customerLimit,
          productsImported: productReport.length,
          customersImported: customerReport.length,
          source: {
            productsFile: PRODUCTS_FILE,
            customersFile: CUSTOMERS_FILE,
          },
          skuMapping: {
            nsku: "skus.sku_code",
            osku: "skus.other_sku",
            note: "The first 200 Bohao product rows mostly contain only ArticuloID, so both fields preserve the source style code unless an alternate code exists.",
          },
        }),
      ],
    );

    await client.query("COMMIT");

    const productCsv = writeCsv(path.relative(ROOT_DIR, path.join(reportDir, "product-sku-map.csv")), productReport, [
      { name: "row_no" },
      { name: "nsku" },
      { name: "osku" },
      { name: "source_articulo_id" },
      { name: "name" },
      { name: "category" },
      { name: "fine_category" },
      { name: "b2b_price" },
      { name: "retail_price" },
      { name: "stock_qty" },
      { name: "low_stock_threshold" },
      { name: "status" },
    ]);
    const customerCsv = writeCsv(path.relative(ROOT_DIR, path.join(reportDir, "customer-map.csv")), customerReport, [
      { name: "row_no" },
      { name: "customer_code" },
      { name: "source_empresa_id" },
      { name: "client_type" },
      { name: "name" },
      { name: "business_type" },
      { name: "vat_number" },
      { name: "tax_rate_percent" },
      { name: "phone" },
      { name: "fiscal_address" },
      { name: "status" },
    ]);
    fs.writeFileSync(
      path.join(reportDir, "summary.json"),
      JSON.stringify(
        {
          importTag: IMPORT_TAG,
          productsImported: productReport.length,
          customersImported: customerReport.length,
          reportDir,
          productCsv,
          customerCsv,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(`Imported products: ${productReport.length}`);
    console.log(`Imported customers: ${customerReport.length}`);
    console.log(`Report directory: ${reportDir}`);
    console.log(`Product SKU map: ${productCsv}`);
    console.log(`Customer map: ${customerCsv}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
