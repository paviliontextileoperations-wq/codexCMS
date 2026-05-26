const fs = require("node:fs");
const path = require("node:path");
const xlsx = require("xlsx");
const { createClient, ROOT_DIR, writeCsv } = require("./common.cjs");

const DEFAULT_FILE = "C:/Users/Administrator/Desktop/Bohao_PRODUCTS.xls";
const FALLBACK_FILE = path.resolve(ROOT_DIR, "..", "\u516c\u53f8\u6570\u636e\u4e2d\u5fc3", "Bohao_PRODUCTS.xls");
const IMPORT_TAG = "bohao-products-full";

const CURRENT_COLOURS = [
  ["N", "BLACK"],
  ["B", "WHITE"],
  ["R", "RED"],
  ["F", "PINK"],
  ["FC", "LIGHT PINK"],
  ["FO", "DARK PINK"],
  ["V", "GREEN"],
  ["J", "ORANGE"],
  ["G", "GRAY"],
  ["A", "YELLOW"],
  ["W", "BROWN"],
  ["P", "PURPLE"],
  ["Z", "BLUE"],
  ["BG", "BEIGE"],
  ["BGO", "DARK BEIGE"],
  ["GT", "MAROON"],
  ["ZM", "NAVY"],
  ["CM", "CAMEL"],
  ["VO", "OLIVE"],
  ["VC", "LIGHT GREEN"],
  ["GC", "LIGHT GRAY"],
  ["GO", "DARK GRAY"],
  ["Q", "TURQUOISE"],
  ["VK", "KAKHI"],
  ["VP", "PETROL GREEN"],
  ["JC", "LIGHT ORANGE"],
  ["ZC", "LIGHT BLUE"],
  ["VA", "WATER GREEN"],
  ["GM", "MEDIUM GREY"],
  ["DN", "DENIM"],
  ["CRA", "CORAL"],
  ["M", "MUSTARD"],
  ["MO", "DARK MUSTARD"],
  ["L", "LILAC"],
  ["PT", "PISTACHIO"],
  ["CR", "YVORY"],
  ["WO", "DARK BROWN"],
  ["D", "GOLDEN"],
  ["PL", "SILVER"],
];

const COLOUR_ALIASES = [
  ...CURRENT_COLOURS.map(([raw, name]) => ({ raw, normalized: raw, name, kind: "current" })),
  { raw: "NGR", normalized: "N", name: "BLACK", kind: "old_colour" },
  { raw: "NEGRO", normalized: "N", name: "BLACK", kind: "old_colour" },
  { raw: "AM", normalized: "A", name: "YELLOW", kind: "old_colour" },
  { raw: "AMARILLO", normalized: "A", name: "YELLOW", kind: "old_colour" },
].sort((a, b) => b.raw.length - a.raw.length);

const SIZE_ALIASES = [
  { raw: "XXL", normalized: "XXL", kind: "current" },
  { raw: "XXS", normalized: "XXS", kind: "current" },
  { raw: "XL", normalized: "XL", kind: "current" },
  { raw: "XS", normalized: "XS", kind: "current" },
  { raw: "TU", normalized: "U", kind: "old_size" },
  { raw: "T", normalized: "U", kind: "old_size" },
  { raw: "S", normalized: "S", kind: "current" },
  { raw: "M", normalized: "M", kind: "current" },
  { raw: "L", normalized: "L", kind: "current" },
  { raw: "U", normalized: "U", kind: "current" },
].sort((a, b) => b.raw.length - a.raw.length);

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((item) => item.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function sourceFile() {
  const requested = argValue("file", DEFAULT_FILE);
  if (fs.existsSync(requested)) return requested;
  if (fs.existsSync(FALLBACK_FILE)) return FALLBACK_FILE;
  throw new Error(`Missing products file. Checked ${requested} and ${FALLBACK_FILE}`);
}

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function nullableText(value) {
  const clean = text(value);
  return clean ? clean : null;
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanCode(value, fallback = "") {
  const clean = text(value)
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .toUpperCase();
  return clean || fallback;
}

function isParseableModelCode(model) {
  return /^[A-Z0-9][A-Z0-9._-]+$/.test(model) && /\d/.test(model);
}

function readProducts(filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  return xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });
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

function isMonoColourSource(rawSku) {
  return rawSku.endsWith("CU") || rawSku.endsWith("C");
}

function parseModelColourSize(rawSku) {
  const candidates = [];
  for (const size of SIZE_ALIASES) {
    if (!rawSku.endsWith(size.raw)) continue;
    const beforeSize = rawSku.slice(0, -size.raw.length);
    for (const colour of COLOUR_ALIASES) {
      if (!beforeSize.endsWith(colour.raw)) continue;
      const model = beforeSize.slice(0, -colour.raw.length);
      if (!isParseableModelCode(model)) continue;
      const autoSku = `${model}${colour.normalized}${size.normalized}`;
      candidates.push({
        modelCode: model,
        colourCode: colour.normalized,
        colourName: colour.name,
        sizeCode: size.normalized,
        autoSku,
        parseRule: colour.kind === "current" && size.kind === "current" ? "model_colour_size" : "old_model_colour_size",
        oldAliasUsed: colour.kind !== "current" || size.kind !== "current",
        score: colour.kind === "current" && size.kind === "current" ? 95 : 88,
      });
    }
  }
  return candidates;
}

function parseModelSizeColour(rawSku) {
  const candidates = [];
  for (const colour of COLOUR_ALIASES) {
    if (!rawSku.endsWith(colour.raw)) continue;
    const beforeColour = rawSku.slice(0, -colour.raw.length);
    for (const size of SIZE_ALIASES) {
      if (!beforeColour.endsWith(size.raw)) continue;
      const model = beforeColour.slice(0, -size.raw.length);
      if (!isParseableModelCode(model)) continue;
      const autoSku = `${model}${colour.normalized}${size.normalized}`;
      candidates.push({
        modelCode: model,
        colourCode: colour.normalized,
        colourName: colour.name,
        sizeCode: size.normalized,
        autoSku,
        parseRule: "old_model_size_colour",
        oldAliasUsed: true,
        score: 90,
      });
    }
  }
  return candidates;
}

function parseSku(rawSku) {
  if (!rawSku) {
    return {
      modelCode: "BOHAO-EMPTY",
      colourCode: "UNP",
      colourName: "Unparsed",
      sizeCode: "U",
      autoSku: null,
      otherSku: null,
      parseRule: "missing_id",
      parseStatus: "other_sku_only",
    };
  }
  if (isMonoColourSource(rawSku)) {
    return {
      modelCode: rawSku,
      colourCode: "UNP",
      colourName: "Unparsed",
      sizeCode: "U",
      autoSku: null,
      otherSku: rawSku,
      parseRule: "single_colour_c_cu",
      parseStatus: "other_sku_only",
    };
  }

  const candidates = [...parseModelColourSize(rawSku), ...parseModelSizeColour(rawSku)]
    .sort((a, b) => b.score - a.score || b.colourCode.length - a.colourCode.length);

  if (!candidates.length) {
    return {
      modelCode: rawSku,
      colourCode: "UNP",
      colourName: "Unparsed",
      sizeCode: "U",
      autoSku: null,
      otherSku: rawSku,
      parseRule: "unparsed_or_model_only",
      parseStatus: "other_sku_only",
    };
  }

  const best = candidates[0];
  return {
    ...best,
    otherSku: best.autoSku === rawSku ? null : rawSku,
    parseStatus: "auto_sku",
    candidateCount: candidates.length,
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

async function ensureColours(client) {
  for (const [code, name] of [...CURRENT_COLOURS, ["UNP", "Unparsed"]]) {
    await client.query(
      `
        INSERT INTO cms.colour_palette (colour_code, colour_name)
        VALUES ($1, $2)
        ON CONFLICT (colour_code) DO UPDATE SET
          colour_name = EXCLUDED.colour_name,
          updated_at = now()
      `,
      [code, name],
    );
  }
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

async function clearExistingBohaoProducts(client) {
  await client.query(`
    DELETE FROM cms.inventory_movements im
    USING cms.skus s
    JOIN cms.products p ON p.id = s.product_id
    WHERE im.sku_id = s.id
      AND p.source = 'bohao'
  `);
  await client.query("DELETE FROM cms.products WHERE source = 'bohao'");
}

async function upsertProduct(client, row, parsed) {
  const productName = text(row.NombreES) || parsed.modelCode;
  const [category, fineCategory] = categoryFromName(productName);
  const { categoryId, fineCategoryId } = await ensureProductCategory(client, category, fineCategory);
  const b2bPrice = Math.max(0, numberValue(row.PrecioMayor, numberValue(row.PrecioFactura, numberValue(row.PrecioDetalle, 0))));
  const retailPrice = numberValue(row.PrecioDetalle, 0);
  const status = numberValue(row.Bloqueado, 0) === 0 ? "active" : "archived";
  const description = [
    `Import tag: ${IMPORT_TAG}`,
    `Raw ArticuloID: ${cleanCode(row.ArticuloID)}`,
    `Parse rule: ${parsed.parseRule}`,
    `Parse status: ${parsed.parseStatus}`,
    parsed.otherSku ? `Other SKU: ${parsed.otherSku}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const result = await client.query(
    `
      INSERT INTO cms.products (
        legacy_id, model_code, name, description, category_id, fine_category_id,
        category, fine_category, b2b_price, b2c_markup_percent, b2c_price_override,
        status, source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 100, $10, $11, 'bohao')
      ON CONFLICT (model_code) DO UPDATE SET
        name = COALESCE(NULLIF(cms.products.name, ''), EXCLUDED.name),
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
      `bohao-product:${parsed.modelCode}`,
      parsed.modelCode,
      productName,
      description,
      categoryId,
      fineCategoryId,
      category,
      fineCategory,
      b2bPrice,
      retailPrice > 0 ? retailPrice : null,
      status,
    ],
  );
  return { productId: result.rows[0].id, category, fineCategory, productName, b2bPrice, retailPrice, status };
}

async function upsertColour(client, productId, parsed) {
  const result = await client.query(
    `
      INSERT INTO cms.product_colours (product_id, colour_name, colour_code, sort_order)
      VALUES ($1, $2, $3, 100)
      ON CONFLICT (product_id, colour_code) DO UPDATE SET
        colour_name = EXCLUDED.colour_name,
        updated_at = now()
      RETURNING id
    `,
    [productId, parsed.colourName, parsed.colourCode],
  );
  return result.rows[0].id;
}

async function upsertSize(client, productId, parsed) {
  const result = await client.query(
    `
      INSERT INTO cms.product_sizes (product_id, size_code, size_label, sort_order)
      VALUES ($1, $2, $3, 100)
      ON CONFLICT (product_id, size_code) DO UPDATE SET
        size_label = EXCLUDED.size_label,
        updated_at = now()
      RETURNING id
    `,
    [productId, parsed.sizeCode, parsed.sizeCode === "U" ? "One Size" : parsed.sizeCode],
  );
  return result.rows[0].id;
}

async function upsertSku(client, row, parsed, productId, colourId, sizeId, warehouse) {
  const rawSku = cleanCode(row.ArticuloID);
  const minQty = Math.max(0, Math.round(numberValue(row.MiniStock, 0)));
  const skuStatus = numberValue(row.Bloqueado, 0) === 0 ? "active" : "archived";
  const result = await client.query(
    `
      INSERT INTO cms.skus (
        legacy_id, product_id, colour_id, size_id, sku_code, barcode, other_sku,
        stock_qty, low_stock_threshold, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)
      ON CONFLICT (product_id, colour_id, size_id) DO UPDATE SET
        sku_code = COALESCE(EXCLUDED.sku_code, cms.skus.sku_code),
        barcode = COALESCE(EXCLUDED.barcode, cms.skus.barcode),
        other_sku = CASE
          WHEN EXCLUDED.other_sku IS NULL OR EXCLUDED.other_sku = '' THEN cms.skus.other_sku
          WHEN cms.skus.other_sku IS NULL OR cms.skus.other_sku = '' THEN EXCLUDED.other_sku
          WHEN position(EXCLUDED.other_sku in cms.skus.other_sku) > 0 THEN cms.skus.other_sku
          ELSE cms.skus.other_sku || '; ' || EXCLUDED.other_sku
        END,
        low_stock_threshold = GREATEST(cms.skus.low_stock_threshold, EXCLUDED.low_stock_threshold),
        status = EXCLUDED.status,
        updated_at = now()
      RETURNING id, sku_code, other_sku
    `,
    [
      `bohao-sku:${rawSku}`,
      productId,
      colourId,
      sizeId,
      parsed.autoSku,
      nullableText(row.CodigoBarra),
      parsed.otherSku,
      minQty,
      skuStatus,
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
    [result.rows[0].id, warehouse.warehouseId, warehouse.locationId, minQty],
  );

  await client.query(
    `
      INSERT INTO cms.inventory_movements (
        legacy_id, sku_id, movement_type, warehouse_id, location_id,
        previous_qty, new_qty, quantity_change, reason_category, notes, created_by
      )
      VALUES ($1, $2, 'initial_import', $3, $4, 0, 0, 0, 'bohao_product_import', $5, 'bohao-import')
      ON CONFLICT (legacy_id) DO NOTHING
    `,
    [
      `bohao-products-initial:${rawSku}`,
      result.rows[0].id,
      warehouse.warehouseId,
      warehouse.locationId,
      `Raw ArticuloID ${rawSku}; parse rule ${parsed.parseRule}; status ${parsed.parseStatus}`,
    ],
  );

  return result.rows[0];
}

function prepareRecords(rows) {
  return rows
    .map((row, index) => {
      const rawSku = cleanCode(row.ArticuloID);
      if (!rawSku) return null;
      const parsed = parseSku(rawSku);
      const productName = text(row.NombreES) || parsed.modelCode;
      const [category, fineCategory] = categoryFromName(productName);
      const b2bPrice = Math.max(
        0,
        numberValue(row.PrecioMayor, numberValue(row.PrecioFactura, numberValue(row.PrecioDetalle, 0))),
      );
      const retailPrice = numberValue(row.PrecioDetalle, 0);
      return {
        sourceRow: index + 2,
        row,
        rawSku,
        parsed,
        productName,
        category,
        fineCategory,
        b2bPrice,
        retailPrice,
        minQty: Math.max(0, Math.round(numberValue(row.MiniStock, 0))),
        status: numberValue(row.Bloqueado, 0) === 0 ? "active" : "archived",
        barcode: nullableText(row.CodigoBarra),
      };
    })
    .filter(Boolean);
}

function buildProductDefinitions(records, categoryMap) {
  const products = new Map();
  for (const record of records) {
    const existing = products.get(record.parsed.modelCode);
    const shouldReplace =
      !existing ||
      (existing.name === existing.model_code && record.productName !== record.parsed.modelCode) ||
      (Number(existing.b2b_price) === 0 && record.b2bPrice > 0);
    if (!shouldReplace) {
      if (record.status === "active") existing.status = "active";
      continue;
    }
    const category = categoryMap.get(`${record.category}\u0000${record.fineCategory}`);
    products.set(record.parsed.modelCode, {
      legacy_id: `bohao-product:${record.parsed.modelCode}`,
      model_code: record.parsed.modelCode,
      name: record.productName,
      description: `Import tag: ${IMPORT_TAG} | Source file: Bohao_PRODUCTS.xls | Raw IDs are stored on SKU rows.`,
      category_id: category.categoryId,
      fine_category_id: category.fineCategoryId,
      category: record.category,
      fine_category: record.fineCategory,
      b2b_price: record.b2bPrice,
      b2c_price_override: record.retailPrice > 0 ? record.retailPrice : null,
      status: record.status,
    });
  }
  return [...products.values()];
}

function uniqueRecords(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function rowMap(rows, keyFn) {
  return new Map(rows.map((row) => [keyFn(row), row]));
}

function joinOtherSkus(values) {
  const seen = new Set();
  for (const value of values) {
    if (!value) continue;
    for (const part of String(value).split(";")) {
      const clean = cleanCode(part);
      if (clean) seen.add(clean);
    }
  }
  return seen.size ? [...seen].join("; ") : null;
}

async function upsertProductsBatch(client, products) {
  if (!products.length) return new Map();
  const result = await client.query(
    `
      WITH input AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS x(
          legacy_id text,
          model_code text,
          name text,
          description text,
          category_id uuid,
          fine_category_id uuid,
          category text,
          fine_category text,
          b2b_price numeric,
          b2c_price_override numeric,
          status text
        )
      )
      INSERT INTO cms.products (
        legacy_id, model_code, name, description, category_id, fine_category_id,
        category, fine_category, b2b_price, b2c_markup_percent, b2c_price_override,
        status, source
      )
      SELECT
        legacy_id, model_code, name, description, category_id, fine_category_id,
        category, fine_category, b2b_price, 100, b2c_price_override,
        status, 'bohao'
      FROM input
      ON CONFLICT (model_code) DO UPDATE SET
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
      RETURNING id, model_code
    `,
    [JSON.stringify(products)],
  );
  return rowMap(result.rows, (row) => row.model_code);
}

async function upsertColoursBatch(client, colours) {
  if (!colours.length) return new Map();
  const result = await client.query(
    `
      WITH input AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS x(
          product_id uuid,
          colour_name text,
          colour_code text
        )
      )
      INSERT INTO cms.product_colours (product_id, colour_name, colour_code, sort_order)
      SELECT product_id, colour_name, colour_code, 100
      FROM input
      ON CONFLICT (product_id, colour_code) DO UPDATE SET
        colour_name = EXCLUDED.colour_name,
        updated_at = now()
      RETURNING id, product_id, colour_code
    `,
    [JSON.stringify(colours)],
  );
  return rowMap(result.rows, (row) => `${row.product_id}\u0000${row.colour_code}`);
}

async function upsertSizesBatch(client, sizes) {
  if (!sizes.length) return new Map();
  const result = await client.query(
    `
      WITH input AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS x(
          product_id uuid,
          size_code text,
          size_label text
        )
      )
      INSERT INTO cms.product_sizes (product_id, size_code, size_label, sort_order)
      SELECT product_id, size_code, size_label, 100
      FROM input
      ON CONFLICT (product_id, size_code) DO UPDATE SET
        size_label = EXCLUDED.size_label,
        updated_at = now()
      RETURNING id, product_id, size_code
    `,
    [JSON.stringify(sizes)],
  );
  return rowMap(result.rows, (row) => `${row.product_id}\u0000${row.size_code}`);
}

async function upsertSkusBatch(client, skus) {
  if (!skus.length) return new Map();
  const result = await client.query(
    `
      WITH input AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS x(
          legacy_id text,
          product_id uuid,
          colour_id uuid,
          size_id uuid,
          sku_code text,
          barcode text,
          other_sku text,
          low_stock_threshold integer,
          status text
        )
      )
      INSERT INTO cms.skus (
        legacy_id, product_id, colour_id, size_id, sku_code, barcode, other_sku,
        stock_qty, low_stock_threshold, status
      )
      SELECT
        legacy_id, product_id, colour_id, size_id, sku_code, barcode, other_sku,
        0, low_stock_threshold, status
      FROM input
      ON CONFLICT (product_id, colour_id, size_id) DO UPDATE SET
        sku_code = COALESCE(EXCLUDED.sku_code, cms.skus.sku_code),
        barcode = COALESCE(EXCLUDED.barcode, cms.skus.barcode),
        other_sku = CASE
          WHEN EXCLUDED.other_sku IS NULL OR EXCLUDED.other_sku = '' THEN cms.skus.other_sku
          WHEN cms.skus.other_sku IS NULL OR cms.skus.other_sku = '' THEN EXCLUDED.other_sku
          WHEN position(EXCLUDED.other_sku in cms.skus.other_sku) > 0 THEN cms.skus.other_sku
          ELSE cms.skus.other_sku || '; ' || EXCLUDED.other_sku
        END,
        low_stock_threshold = GREATEST(cms.skus.low_stock_threshold, EXCLUDED.low_stock_threshold),
        status = EXCLUDED.status,
        updated_at = now()
      RETURNING id, product_id, colour_id, size_id, sku_code, other_sku
    `,
    [JSON.stringify(skus)],
  );
  return rowMap(result.rows, (row) => `${row.product_id}\u0000${row.colour_id}\u0000${row.size_id}`);
}

async function upsertInventoryBalancesBatch(client, balances) {
  if (!balances.length) return;
  await client.query(
    `
      WITH input AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS x(
          sku_id uuid,
          warehouse_id uuid,
          location_id uuid,
          min_qty integer
        )
      )
      INSERT INTO cms.sku_inventory_balances (
        sku_id, warehouse_id, location_id, qty, min_qty, last_counted_at
      )
      SELECT sku_id, warehouse_id, location_id, 0, min_qty, now()
      FROM input
      ON CONFLICT (sku_id, warehouse_id, location_id) DO UPDATE SET
        min_qty = EXCLUDED.min_qty,
        updated_at = now()
    `,
    [JSON.stringify(balances)],
  );
}

async function insertInventoryMovementsBatch(client, movements) {
  if (!movements.length) return;
  await client.query(
    `
      WITH input AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS x(
          legacy_id text,
          sku_id uuid,
          warehouse_id uuid,
          location_id uuid,
          notes text
        )
      )
      INSERT INTO cms.inventory_movements (
        legacy_id, sku_id, movement_type, warehouse_id, location_id,
        previous_qty, new_qty, quantity_change, reason_category, notes, created_by
      )
      SELECT
        legacy_id, sku_id, 'initial_import', warehouse_id, location_id,
        0, 0, 0, 'bohao_product_import', notes, 'bohao-import'
      FROM input
      ON CONFLICT (legacy_id) DO NOTHING
    `,
    [JSON.stringify(movements)],
  );
}

async function main() {
  const filePath = sourceFile();
  const rows = readProducts(filePath);
  const records = prepareRecords(rows);
  const reportDir = path.join(
    ROOT_DIR,
    "exports",
    "import-reports",
    `bohao-products-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`,
  );
  fs.mkdirSync(reportDir, { recursive: true });

  const client = createClient();
  let report = [];
  await client.connect();
  try {
    await client.query("BEGIN");
    await clearExistingBohaoProducts(client);
    await ensureColours(client);
    const warehouse = await warehouseTarget(client);

    const categoryMap = new Map();
    const categoryPairs = uniqueRecords(records, (record) => `${record.category}\u0000${record.fineCategory}`);
    for (const record of categoryPairs) {
      categoryMap.set(
        `${record.category}\u0000${record.fineCategory}`,
        await ensureProductCategory(client, record.category, record.fineCategory),
      );
    }

    const productDefs = buildProductDefinitions(records, categoryMap);
    const productMap = await upsertProductsBatch(client, productDefs);

    const colourDefs = uniqueRecords(
      records.map((record) => ({
        product_id: productMap.get(record.parsed.modelCode).id,
        colour_name: record.parsed.colourName,
        colour_code: record.parsed.colourCode,
      })),
      (item) => `${item.product_id}\u0000${item.colour_code}`,
    );
    const colourMap = await upsertColoursBatch(client, colourDefs);

    const sizeDefs = uniqueRecords(
      records.map((record) => ({
        product_id: productMap.get(record.parsed.modelCode).id,
        size_code: record.parsed.sizeCode,
        size_label: record.parsed.sizeCode === "U" ? "One Size" : record.parsed.sizeCode,
      })),
      (item) => `${item.product_id}\u0000${item.size_code}`,
    );
    const sizeMap = await upsertSizesBatch(client, sizeDefs);

    const variantMap = new Map();
    const barcodeCounts = new Map();
    for (const record of records) {
      if (record.barcode) barcodeCounts.set(record.barcode, (barcodeCounts.get(record.barcode) ?? 0) + 1);
    }
    for (const record of records) {
      const productId = productMap.get(record.parsed.modelCode).id;
      const colourId = colourMap.get(`${productId}\u0000${record.parsed.colourCode}`).id;
      const sizeId = sizeMap.get(`${productId}\u0000${record.parsed.sizeCode}`).id;
      const key = `${productId}\u0000${colourId}\u0000${sizeId}`;
      const existing = variantMap.get(key) ?? {
        legacy_id: `bohao-sku:${record.rawSku}`,
        product_id: productId,
        colour_id: colourId,
        size_id: sizeId,
        sku_code: record.parsed.autoSku,
        barcode: record.barcode && barcodeCounts.get(record.barcode) === 1 ? record.barcode : null,
        other_skus: [],
        low_stock_threshold: 0,
        status: "archived",
        raw_skus: [],
      };
      if (!existing.sku_code && record.parsed.autoSku) existing.sku_code = record.parsed.autoSku;
      if (!existing.barcode && record.barcode && barcodeCounts.get(record.barcode) === 1) existing.barcode = record.barcode;
      if (record.parsed.otherSku) existing.other_skus.push(record.parsed.otherSku);
      existing.raw_skus.push(record.rawSku);
      existing.low_stock_threshold = Math.max(existing.low_stock_threshold, record.minQty);
      if (record.status === "active") existing.status = "active";
      variantMap.set(key, existing);
    }

    const skuDefs = [...variantMap.values()].map((item) => ({
      legacy_id: item.legacy_id,
      product_id: item.product_id,
      colour_id: item.colour_id,
      size_id: item.size_id,
      sku_code: item.sku_code,
      barcode: item.barcode,
      other_sku: joinOtherSkus(item.other_skus),
      low_stock_threshold: item.low_stock_threshold,
      status: item.status,
      raw_skus: item.raw_skus,
    }));
    const skuMap = await upsertSkusBatch(client, skuDefs);

    await upsertInventoryBalancesBatch(
      client,
      skuDefs.map((item) => {
        const sku = skuMap.get(`${item.product_id}\u0000${item.colour_id}\u0000${item.size_id}`);
        return {
          sku_id: sku.id,
          warehouse_id: warehouse.warehouseId,
          location_id: warehouse.locationId,
          min_qty: item.low_stock_threshold,
        };
      }),
    );

    await insertInventoryMovementsBatch(
      client,
      skuDefs.map((item) => {
        const sku = skuMap.get(`${item.product_id}\u0000${item.colour_id}\u0000${item.size_id}`);
        return {
          legacy_id: `bohao-products-initial:${item.raw_skus[0]}`,
          sku_id: sku.id,
          warehouse_id: warehouse.warehouseId,
          location_id: warehouse.locationId,
          notes: `Raw ArticuloID ${item.raw_skus.join("; ")}; imported with ${IMPORT_TAG}`,
        };
      }),
    );

    report = records.map((record) => {
      const productId = productMap.get(record.parsed.modelCode).id;
      const colourId = colourMap.get(`${productId}\u0000${record.parsed.colourCode}`).id;
      const sizeId = sizeMap.get(`${productId}\u0000${record.parsed.sizeCode}`).id;
      const sku = skuMap.get(`${productId}\u0000${colourId}\u0000${sizeId}`);
      return {
        source_row: record.sourceRow,
        raw_articulo_id: record.rawSku,
        parse_status: record.parsed.parseStatus,
        parse_rule: record.parsed.parseRule,
        model_code: record.parsed.modelCode,
        colour_code: record.parsed.colourCode,
        colour_name: record.parsed.colourName,
        size_code: record.parsed.sizeCode,
        auto_sku: sku.sku_code ?? "",
        other_sku: sku.other_sku ?? "",
        product_name: record.productName,
        category: record.category,
        fine_category: record.fineCategory,
        b2b_price: record.b2bPrice,
        stock_qty: 0,
        status: record.status,
      };
    });

    await client.query(
      `
        INSERT INTO cms.audit_log (actor, action, entity_table, entity_id, after_data)
        VALUES ('bohao-import', 'full_product_import', 'products', $1, $2::jsonb)
      `,
      [
        IMPORT_TAG,
        JSON.stringify({
          sourceFile: filePath,
          rowsRead: rows.length,
          rowsImported: report.length,
          productsImported: productDefs.length,
          skusImported: skuDefs.length,
          autoSkuRows: report.filter((row) => row.auto_sku).length,
          otherSkuOnlyRows: report.filter((row) => !row.auto_sku && row.other_sku).length,
        }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  const reportPath = writeCsv(path.relative(ROOT_DIR, path.join(reportDir, "bohao-product-import-map.csv")), report, [
    { name: "source_row" },
    { name: "raw_articulo_id" },
    { name: "parse_status" },
    { name: "parse_rule" },
    { name: "model_code" },
    { name: "colour_code" },
    { name: "colour_name" },
    { name: "size_code" },
    { name: "auto_sku" },
    { name: "other_sku" },
    { name: "product_name" },
    { name: "category" },
    { name: "fine_category" },
    { name: "b2b_price" },
    { name: "stock_qty" },
    { name: "status" },
  ]);
  const summary = {
    sourceFile: filePath,
    rowsRead: rows.length,
    rowsImported: report.length,
    autoSkuRows: report.filter((row) => row.auto_sku).length,
    otherSkuOnlyRows: report.filter((row) => !row.auto_sku && row.other_sku).length,
    reportPath,
  };
  fs.writeFileSync(path.join(reportDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
