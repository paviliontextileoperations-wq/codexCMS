const fs = require("node:fs");
const path = require("node:path");
const {
  createClient,
  nullIfBlank,
  parseMaybeJson,
  toDate,
  toNumber,
} = require("./common.cjs");

const PRODUCT_KEY = "form.products.v1";
const CUSTOMER_KEY = "form.customers.v1";
const SALES_KEY = "form.sales.v1";
const INVENTORY_KEY = "form.inventoryMovements.v1";
const IMAGE_GALLERY_KEY = "form.imageGallery.v1";
const MAINTENANCE_KEY = "form.productMaintenance.v1";

const PAYMENT_METHODS = new Set(["CASH", "CARD", "TRANSFER", "OTHER"]);
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
const SALES_CHANNELS = new Set([
  "physical_store",
  "whatsapp",
  "website",
  "instagram",
  "phone",
  "b2b_direct",
  "marketplace",
  "other",
]);
const RETURN_REASONS = new Set([
  "customer_changed_mind",
  "defective",
  "wrong_size",
  "wrong_item",
  "damaged",
  "other",
]);
const RETURN_CONDITIONS = new Set(["resellable", "damaged", "repair_needed"]);
const STOCK_ACTIONS = new Set(["back_to_stock", "repair", "discard", "no_stock_change"]);
const INVOICE_TYPES = new Set(["B2B_INVOICE", "B2C_RECEIPT", "DELIVERY_NOTE", "NO_INVOICE", "PROFORMA"]);
const FISCAL_STATUSES = new Set(["draft", "issued", "void", "cancelled"]);
const TAX_PROFILES = new Set(["standard", "b2b_spain", "b2b_eu_vat", "b2b_international", "b2c", "no_tax", "custom"]);
const IMAGE_ROLES = new Set(["front", "back", "detail", "model_front", "model_back", "model_extra", "shein", "other"]);
const IMAGE_FILENAME_RE = /^([A-Z0-9-]+)[_-](F|B|MF|MB|D\d+|MX\d+|S\d+)\.JPG$/;
const MAINTENANCE_REASONS = new Set(["cannot_find_product", "missing_physical_barcode", "wrong_price", "other"]);

function oneOf(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function requiredText(value, fallback) {
  return nullIfBlank(value) ?? fallback;
}

function cleanCode(value, fallback) {
  const text = nullIfBlank(value);
  if (!text) {
    return fallback;
  }
  return text.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "").toUpperCase();
}

function normalizeImageKey(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function slugPart(value, fallback) {
  const clean = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || fallback;
}

function uuidOrNull(value) {
  const text = String(value || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function warehouseCodeFor(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "shop" || text === "shop floor" || text === "sala de ventas") return "SHOP";
  if (text === "returns" || text === "returns area" || text === "zona de devoluciones") return "RETURNS";
  const raw = String(value || "").trim();
  if (/^[A-Z0-9_-]+$/.test(raw) && raw.length <= 16) return raw.toUpperCase();
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

function parseImageName(fileName) {
  const parsed = String(fileName ?? "").match(IMAGE_FILENAME_RE);
  if (!parsed) return null;
  return { prefix: parsed[1], code: parsed[2] };
}

function imageRoleFromCode(code) {
  if (code === "F") return "front";
  if (code === "B") return "back";
  if (code === "MF") return "model_front";
  if (code === "MB") return "model_back";
  if (String(code).startsWith("D")) return "detail";
  if (String(code).startsWith("MX")) return "model_extra";
  if (String(code).startsWith("S")) return "shein";
  return "other";
}

function modelCodeFor(product, index) {
  const fromSku = nullIfBlank(product.sku)?.split("-")[0];
  return cleanCode(product.barcode ?? product.modelCode ?? product.model_code ?? fromSku, `MODEL-${index + 1}`);
}

function colourCodeFor(product) {
  const explicit = product.colourCode ?? product.colorCode ?? product.colour_code;
  if (explicit) {
    return cleanCode(explicit, "UNK");
  }

  const modelCode = nullIfBlank(product.barcode);
  const sku = nullIfBlank(product.sku);
  const size = nullIfBlank(product.size);
  if (modelCode && sku?.startsWith(modelCode) && size && sku.endsWith(size)) {
    const middle = sku.slice(modelCode.length, sku.length - size.length).replace(/^-|-$/g, "");
    if (middle) {
      return cleanCode(middle, "UNK");
    }
  }

  const color = nullIfBlank(product.color) ?? "Unknown";
  const initials = color
    .split(/[\s/_-]+/)
    .map((part) => part[0])
    .join("");
  return cleanCode(initials || color.slice(0, 3), "UNK");
}

function sizeSort(sizeCode) {
  const order = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"];
  const index = order.indexOf(String(sizeCode).toUpperCase());
  return index === -1 ? 100 : index + 1;
}

function markupPercent(product) {
  if (product.b2cMarkup === null || product.b2cMarkup === undefined || product.b2cMarkup === "") {
    return 100;
  }
  const value = toNumber(product.b2cMarkup, 1);
  return value > 10 ? value : value * 100;
}

function normalizeRate(value, fallback = 0) {
  const number = toNumber(value, fallback);
  return number > 1 ? number / 100 : number;
}

function loadInput(filePath) {
  const absolute = path.resolve(process.cwd(), filePath);
  const payload = JSON.parse(fs.readFileSync(absolute, "utf8"));

  return {
    products: parseMaybeJson(payload.products ?? payload[PRODUCT_KEY], []),
    customers: parseMaybeJson(payload.customers ?? payload[CUSTOMER_KEY], []),
    sales: parseMaybeJson(payload.sales ?? payload.orders ?? payload[SALES_KEY], []),
    inventoryMovements: parseMaybeJson(
      payload.inventoryMovements ?? payload[INVENTORY_KEY],
      [],
    ),
    images: parseMaybeJson(payload.images ?? payload.imageGallery ?? payload[IMAGE_GALLERY_KEY], []),
    maintenance: parseMaybeJson(payload.maintenance ?? payload.productMaintenance ?? payload[MAINTENANCE_KEY], []),
  };
}

function groupProducts(products) {
  const groups = new Map();
  products.forEach((product, index) => {
    const modelCode = modelCodeFor(product, index);
    if (!groups.has(modelCode)) {
      groups.set(modelCode, []);
    }
    groups.get(modelCode).push(product);
  });
  return groups;
}

async function upsertProduct(client, modelCode, rows) {
  const first = rows[0] ?? {};
  const result = await client.query(
    `
      INSERT INTO cms.products (
        legacy_id, model_code, name, description, category, fine_category,
        category2, category3, b2b_price, b2c_markup_percent, b2c_price_override,
        main_picture_url, status, source, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, 'active', 'desktop', $13
      )
      ON CONFLICT (model_code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        fine_category = EXCLUDED.fine_category,
        category2 = EXCLUDED.category2,
        category3 = EXCLUDED.category3,
        b2b_price = EXCLUDED.b2b_price,
        b2c_markup_percent = EXCLUDED.b2c_markup_percent,
        b2c_price_override = EXCLUDED.b2c_price_override,
        main_picture_url = EXCLUDED.main_picture_url,
        updated_at = now()
      RETURNING id
    `,
    [
      `product:${modelCode}`,
      modelCode,
      requiredText(first.name, modelCode),
      first.description ?? "",
      requiredText(first.category, "Uncategorized"),
      requiredText(first.fineCategory ?? first.fine_category, "Unspecified"),
      nullIfBlank(first.category2),
      nullIfBlank(first.category3),
      toNumber(first.price ?? first.b2b_price, 0),
      markupPercent(first),
      first.b2cPrice === undefined || first.b2cPrice === "" ? null : toNumber(first.b2cPrice, 0),
      nullIfBlank(first.mainImage ?? first.main_picture_url),
      toDate(first.createdAt),
    ],
  );

  const productId = result.rows[0].id;

  await client.query("DELETE FROM cms.product_compositions WHERE product_id = $1", [productId]);
  const composition = Array.isArray(first.composition) ? first.composition : [];
  for (let index = 0; index < composition.length; index += 1) {
    const item = composition[index];
    await client.query(
      `
        INSERT INTO cms.product_compositions (product_id, material, percentage, sort_order)
        VALUES ($1, $2, $3, $4)
      `,
      [
        productId,
        requiredText(item.material, `Material ${index + 1}`),
        toNumber(item.percentage, 0),
        index + 1,
      ],
    );
  }

  await client.query("DELETE FROM cms.product_images WHERE product_id = $1", [productId]);
  if (first.mainImage) {
    await client.query(
      `
        INSERT INTO cms.product_images (product_id, image_role, url, sort_order)
        VALUES ($1, 'main', $2, 1)
      `,
      [productId, first.mainImage],
    );
  }

  return productId;
}

async function upsertProductColour(client, productId, product) {
  const colourCode = colourCodeFor(product);
  const colourName = requiredText(product.color ?? product.colour_name, colourCode);
  const result = await client.query(
    `
      INSERT INTO cms.product_colours (
        product_id, colour_name, colour_code, image_url, sort_order
      ) VALUES ($1, $2, $3, $4, 100)
      ON CONFLICT (product_id, colour_code) DO UPDATE SET
        colour_name = EXCLUDED.colour_name,
        image_url = COALESCE(EXCLUDED.image_url, cms.product_colours.image_url),
        updated_at = now()
      RETURNING id
    `,
    [productId, colourName, colourCode, nullIfBlank(product.image)],
  );
  return result.rows[0].id;
}

async function upsertProductSize(client, productId, product) {
  const sizeCode = cleanCode(product.size ?? product.size_code, "ONE");
  const result = await client.query(
    `
      INSERT INTO cms.product_sizes (
        product_id, size_code, size_label, sort_order, weight_grams
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (product_id, size_code) DO UPDATE SET
        size_label = EXCLUDED.size_label,
        sort_order = EXCLUDED.sort_order,
        weight_grams = COALESCE(EXCLUDED.weight_grams, cms.product_sizes.weight_grams),
        updated_at = now()
      RETURNING id, size_code
    `,
    [
      productId,
      sizeCode,
      nullIfBlank(product.size),
      sizeSort(sizeCode),
      product.weight === undefined || product.weight === "" ? null : toNumber(product.weight, 0),
    ],
  );
  return result.rows[0];
}

async function upsertSku(client, productId, colourId, sizeId, product, modelCode, colourCode, sizeCode) {
  const skuCode = nullIfBlank(product.sku) ? cleanCode(product.sku, "") : null;
  const result = await client.query(
    `
      INSERT INTO cms.skus (
        legacy_id, product_id, colour_id, size_id, sku_code, barcode, other_sku,
        stock_qty, low_stock_threshold, image_url, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11)
      ON CONFLICT (legacy_id) DO UPDATE SET
        product_id = EXCLUDED.product_id,
        colour_id = EXCLUDED.colour_id,
        size_id = EXCLUDED.size_id,
        sku_code = EXCLUDED.sku_code,
        barcode = EXCLUDED.barcode,
        other_sku = EXCLUDED.other_sku,
        stock_qty = EXCLUDED.stock_qty,
        low_stock_threshold = EXCLUDED.low_stock_threshold,
        image_url = COALESCE(EXCLUDED.image_url, cms.skus.image_url),
        updated_at = now()
      RETURNING id
    `,
    [
      nullIfBlank(product.id),
      productId,
      colourId,
      sizeId,
      skuCode,
      nullIfBlank(product.barcodeValue ?? product.ean ?? product.upc),
      nullIfBlank(product.otherSku),
      Math.max(0, Math.round(toNumber(product.stock, 0))),
      Math.max(0, Math.round(toNumber(product.lowStockThreshold, 5))),
      nullIfBlank(product.image),
      toDate(product.createdAt),
    ],
  );

  if (product.image) {
    await client.query(
      `
        INSERT INTO cms.product_images (
          product_id, colour_id, sku_id, image_role, url, sort_order
        ) VALUES ($1, $2, $3, 'sku', $4, 100)
      `,
      [productId, colourId, result.rows[0].id, product.image],
    );
  }

  const stockQty = Math.max(0, Math.round(toNumber(product.stock, 0)));
  if (stockQty > 0) {
    await client.query(
      `
        INSERT INTO cms.inventory_movements (
          legacy_id, sku_id, movement_type, quantity_change, notes, created_by, created_at
        ) VALUES ($1, $2, 'initial_import', $3, $4, 'desktop-import', $5)
        ON CONFLICT (legacy_id) DO UPDATE SET
          sku_id = EXCLUDED.sku_id,
          quantity_change = EXCLUDED.quantity_change,
          notes = EXCLUDED.notes
      `,
      [
        `initial:${product.id ?? skuCode}`,
        result.rows[0].id,
        stockQty,
        "Imported from desktop stock",
        toDate(product.createdAt),
      ],
    );
  }

  return result.rows[0].id;
}

async function upsertMeasurements(client, productId, sizeId, fineCategory, product) {
  const fields = [
    ["A", product.lengthA],
    ["B", product.lengthB],
    ["C", product.lengthC],
    ["D", product.lengthD],
    ["E", product.lengthE],
    ["F", product.lengthF],
    ["G", product.lengthG],
    ["H", product.lengthH],
  ];

  for (const [code, rawValue] of fields) {
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      continue;
    }

    const template = await client.query(
      `
        SELECT id, measurement_name, unit
        FROM cms.measurement_templates
        WHERE fine_category = $1 AND measurement_code = $2
      `,
      [fineCategory, code],
    );
    const templateRow = template.rows[0];

    await client.query(
      `
        INSERT INTO cms.product_size_measurements (
          product_id, size_id, measurement_template_id, measurement_code,
          measurement_name, value, unit
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (product_id, size_id, measurement_code) DO UPDATE SET
          measurement_template_id = EXCLUDED.measurement_template_id,
          measurement_name = EXCLUDED.measurement_name,
          value = EXCLUDED.value,
          unit = EXCLUDED.unit,
          updated_at = now()
      `,
      [
        productId,
        sizeId,
        templateRow?.id ?? null,
        code,
        templateRow?.measurement_name ?? `Measurement ${code}`,
        toNumber(rawValue, 0),
        templateRow?.unit ?? "cm",
      ],
    );
  }
}

function normalizeCustomer(customer) {
  const hasBusinessData = Boolean(customer.businessName || customer.vatNumber || customer.businessType);
  const clientType = customer.clientType === "B2C" && !hasBusinessData ? "B2C" : "B2B";

  return {
    clientType,
    businessType:
      clientType === "B2B"
        ? oneOf(customer.businessType, new Set(["ESP AUTONOMO", "ESP EMPRESA", "EU VAT", "EU LOCAL", "INTERNATIONAL"]), "INTERNATIONAL")
        : null,
    businessName:
      clientType === "B2B"
        ? requiredText(customer.businessName, `${customer.name ?? "Pending"} ${customer.surname ?? ""}`.trim())
        : null,
    vatNumber: clientType === "B2B" ? requiredText(customer.vatNumber, "PENDING") : null,
  };
}

async function upsertCustomer(client, customer, index) {
  const normalized = normalizeCustomer(customer);
  const customerCode = cleanCode(customer.customerCode ?? customer.id, `CUS-${index + 1}`);
  const result = await client.query(
    `
      INSERT INTO cms.customers (
        legacy_id, customer_code, client_type, name, surname, business_type,
        business_name, email, vat_number, tax_rate_percent, status, notes, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Active', $11, $12)
      ON CONFLICT (customer_code) DO UPDATE SET
        client_type = EXCLUDED.client_type,
        name = EXCLUDED.name,
        surname = EXCLUDED.surname,
        business_type = EXCLUDED.business_type,
        business_name = EXCLUDED.business_name,
        email = EXCLUDED.email,
        vat_number = EXCLUDED.vat_number,
        tax_rate_percent = EXCLUDED.tax_rate_percent,
        notes = EXCLUDED.notes,
        updated_at = now()
      RETURNING id
    `,
    [
      nullIfBlank(customer.id),
      customerCode,
      normalized.clientType,
      requiredText(customer.name, customer.businessName ?? customerCode),
      nullIfBlank(customer.surname),
      normalized.businessType,
      normalized.businessName,
      nullIfBlank(customer.email),
      normalized.vatNumber,
      customer.taxRate === undefined || customer.taxRate === "" ? null : toNumber(customer.taxRate, 0),
      nullIfBlank(customer.notes),
      toDate(customer.createdAt),
    ],
  );

  const customerId = result.rows[0].id;
  await upsertCustomerPhone(client, customerId, customer);
  await upsertCustomerAddress(client, customerId, "Fiscal", customer.fiscalAddress);
  await upsertCustomerAddress(client, customerId, "Logistics", customer.logisticsAddress);

  return customerId;
}

async function upsertCustomerPhone(client, customerId, customer) {
  const phoneNumber = nullIfBlank(customer.phoneNumber ?? customer.phone);
  if (!phoneNumber) {
    return;
  }

  await client.query(
    `
      INSERT INTO cms.customer_phones (
        legacy_id, phone_code, customer_id, country_code, phone_number, is_primary
      ) VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (phone_code) DO UPDATE SET
        country_code = EXCLUDED.country_code,
        phone_number = EXCLUDED.phone_number,
        is_primary = true,
        updated_at = now()
    `,
    [
      `phone:${customer.id}`,
      `phone:${customer.id}`,
      customerId,
      requiredText(customer.phoneCountryCode, "+34"),
      phoneNumber.replace(String(customer.phoneCountryCode ?? ""), "").trim(),
    ],
  );
}

async function upsertCustomerAddress(client, customerId, type, address) {
  if (!address) {
    return;
  }

  await client.query(
    `
      INSERT INTO cms.customer_addresses (
        legacy_id, address_code, customer_id, address_type, address_line_1,
        address_line_2, additional_info, postal_code, province_state, country,
        is_default, same_as_other_address
      ) VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, true, false)
      ON CONFLICT (address_code) DO UPDATE SET
        address_line_1 = EXCLUDED.address_line_1,
        address_line_2 = EXCLUDED.address_line_2,
        additional_info = EXCLUDED.additional_info,
        postal_code = EXCLUDED.postal_code,
        province_state = EXCLUDED.province_state,
        country = EXCLUDED.country,
        updated_at = now()
    `,
    [
      `${type.toLowerCase()}:${customerId}`,
      customerId,
      type,
      requiredText(address.line1, "Pending"),
      nullIfBlank(address.line2),
      nullIfBlank(address.additionalInfo),
      requiredText(address.postalCode, "00000"),
      requiredText(address.provinceState, "Pending"),
      requiredText(address.country, "Spain"),
    ],
  );
}

async function upsertOrder(client, sale, customerMap, orderMap) {
  const orderNumber = requiredText(sale.invoiceNumber ?? sale.orderNumber, `ORDER-${sale.id}`);
  const customerId = customerMap.get(sale.customerId) ?? null;
  const result = await client.query(
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
      ON CONFLICT (order_number) DO UPDATE SET
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
      nullIfBlank(sale.id),
      orderNumber,
      oneOf(sale.documentType, DOCUMENT_TYPES, "INVOICE"),
      oneOf(sale.documentStatus, DOCUMENT_STATUSES, "open"),
      oneOf(sale.deliveryStatus, DELIVERY_STATUSES, "open"),
      oneOf(sale.salesChannel, SALES_CHANNELS, "physical_store"),
      customerId,
      JSON.stringify(sale.customerSnapshot ?? {}),
      toNumber(sale.subtotal, 0),
      normalizeRate(sale.taxRate, 0),
      toNumber(sale.tax, 0),
      sale.taxBreakdown ? JSON.stringify(sale.taxBreakdown) : null,
      sale.transport?.method ?? null,
      sale.transport?.label ?? null,
      toNumber(sale.transport?.fee, 0),
      toNumber(sale.total, 0),
      oneOf(sale.paymentStatus, new Set(["PAID", "PARTIAL", "OPEN"]), "OPEN"),
      toNumber(sale.amountPaid, 0),
      toNumber(sale.amountDue, toNumber(sale.total, 0) - toNumber(sale.amountPaid, 0)),
      Boolean(sale.stockMovementCreated),
      sale.cancelledAt ? toDate(sale.cancelledAt) : null,
      nullIfBlank(sale.cancelledBy),
      nullIfBlank(sale.cancellationReason),
      toDate(sale.createdAt),
    ],
  );

  const orderId = result.rows[0].id;
  orderMap.set(sale.id, orderId);

  await client.query("DELETE FROM cms.order_returns WHERE order_id = $1", [orderId]);
  await client.query("DELETE FROM cms.order_payments WHERE order_id = $1", [orderId]);
  await client.query("DELETE FROM cms.order_lines WHERE order_id = $1", [orderId]);

  return orderId;
}

async function insertOrderLines(client, orderId, sale, skuMap) {
  for (const line of sale.lines ?? []) {
    const skuId = skuMap.get(line.productId) ?? null;
    const skuInfo = skuId
      ? await client.query("SELECT product_id, sku_code FROM cms.skus WHERE id = $1", [skuId])
      : { rows: [] };
    const skuRow = skuInfo.rows[0];

    await client.query(
      `
        INSERT INTO cms.order_lines (
          order_id, sku_id, product_id, sku_code_snapshot, product_name_snapshot,
          size_snapshot, colour_snapshot, unit_price, quantity, discount_percent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        orderId,
        skuId,
        skuRow?.product_id ?? null,
        skuRow?.sku_code ?? requiredText(line.barcode, "UNKNOWN-SKU"),
        requiredText(line.name, "Imported item"),
        nullIfBlank(line.size),
        nullIfBlank(line.color),
        toNumber(line.unitPrice, 0),
        Math.max(1, Math.round(toNumber(line.quantity, 1))),
        toNumber(line.discountPct, 0),
      ],
    );
  }
}

async function insertPayments(client, orderId, sale) {
  for (const payment of sale.payments ?? []) {
    await client.query(
      `
        INSERT INTO cms.order_payments (
          legacy_id, order_id, amount, method, note, payment_date, reference, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (legacy_id) DO UPDATE SET
          amount = EXCLUDED.amount,
          method = EXCLUDED.method,
          note = EXCLUDED.note,
          payment_date = EXCLUDED.payment_date,
          reference = EXCLUDED.reference,
          updated_at = now()
      `,
      [
        nullIfBlank(payment.id),
        orderId,
        toNumber(payment.amount, 0),
        oneOf(payment.method, PAYMENT_METHODS, "OTHER"),
        nullIfBlank(payment.note),
        toDate(payment.paymentDate ?? payment.createdAt),
        nullIfBlank(payment.reference),
        toDate(payment.createdAt),
      ],
    );
  }
}

async function insertReturns(client, orderId, sale, skuMap) {
  for (const entry of sale.returns ?? []) {
    await client.query(
      `
        INSERT INTO cms.order_returns (
          legacy_id, order_id, sku_id, quantity, reason, condition, refund_amount,
          refund_method, stock_action, notes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (legacy_id) DO UPDATE SET
          sku_id = EXCLUDED.sku_id,
          quantity = EXCLUDED.quantity,
          reason = EXCLUDED.reason,
          condition = EXCLUDED.condition,
          refund_amount = EXCLUDED.refund_amount,
          refund_method = EXCLUDED.refund_method,
          stock_action = EXCLUDED.stock_action,
          notes = EXCLUDED.notes,
          updated_at = now()
      `,
      [
        nullIfBlank(entry.id),
        orderId,
        skuMap.get(entry.productId) ?? null,
        Math.max(1, Math.round(toNumber(entry.quantity, 1))),
        oneOf(entry.reason, RETURN_REASONS, null),
        oneOf(entry.condition, RETURN_CONDITIONS, null),
        toNumber(entry.refundAmount, 0),
        oneOf(entry.refundMethod, PAYMENT_METHODS, null),
        oneOf(entry.stockAction, STOCK_ACTIONS, "back_to_stock"),
        nullIfBlank(entry.notes),
        toDate(entry.createdAt),
      ],
    );
  }
}

function invoiceTypeForSale(sale) {
  const docType = oneOf(sale.documentType, DOCUMENT_TYPES, "INVOICE");
  if (docType === "PROFORMA") return "PROFORMA";
  if (docType === "DELIVERY_NOTE") return "NO_INVOICE";
  if (docType === "RECEIPT") return "B2C_RECEIPT";
  return "B2B_INVOICE";
}

function fiscalStatusForSale(sale) {
  if (sale.documentStatus === "cancelled") return "cancelled";
  if (String(sale.invoiceNumber ?? "").startsWith("DRAFT-") || sale.paymentStatus !== "PAID") {
    return "draft";
  }
  return "issued";
}

function taxProfileForSale(sale) {
  if (TAX_PROFILES.has(sale.invoiceTaxProfile)) return sale.invoiceTaxProfile;
  if (sale.documentType === "DELIVERY_NOTE") return "no_tax";
  if (sale.documentType === "RECEIPT") return "b2c";
  if (normalizeRate(sale.taxRate, 0) <= 0) return "no_tax";
  return "standard";
}

async function upsertInvoice(client, orderId, sale, customerMap) {
  const invoiceNumber = requiredText(sale.invoiceNumber, `DRAFT-${sale.id}`);
  const customerId = customerMap.get(sale.customerId) ?? null;
  const taxBreakdown = sale.taxBreakdown ?? {};
  const surchargeAmount = toNumber(taxBreakdown.surchargeAmount, 0);
  const taxAmount = taxBreakdown.vatAmount === undefined
    ? Math.max(0, toNumber(sale.tax, 0) - surchargeAmount)
    : toNumber(taxBreakdown.vatAmount, 0);
  const fiscalStatus = oneOf(fiscalStatusForSale(sale), FISCAL_STATUSES, "draft");
  const result = await client.query(
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
      ON CONFLICT (invoice_number) DO UPDATE SET
        order_id = EXCLUDED.order_id,
        customer_id = EXCLUDED.customer_id,
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
        issued_at = EXCLUDED.issued_at,
        updated_at = now()
      RETURNING id
    `,
    [
      orderId,
      customerId,
      invoiceNumber,
      oneOf(invoiceTypeForSale(sale), INVOICE_TYPES, "B2B_INVOICE"),
      fiscalStatus,
      fiscalStatus === "draft",
      oneOf(taxProfileForSale(sale), TAX_PROFILES, "standard"),
      normalizeRate(sale.taxRate, 0),
      normalizeRate(taxBreakdown.vat, normalizeRate(sale.taxRate, 0)),
      normalizeRate(taxBreakdown.surcharge, 0),
      toDate(sale.createdAt),
      sale.dueDate ? toDate(sale.dueDate) : null,
      JSON.stringify(sale.customerSnapshot ?? {}),
      toNumber(sale.subtotal, 0),
      taxAmount,
      surchargeAmount,
      toNumber(sale.transport?.fee, 0),
      toNumber(sale.total, 0),
      toNumber(sale.amountPaid, 0),
      toNumber(sale.amountDue, toNumber(sale.total, 0) - toNumber(sale.amountPaid, 0)),
      nullIfBlank(sale.invoiceNotes),
      fiscalStatus === "issued" ? toDate(sale.createdAt) : null,
    ],
  );
  return result.rows[0].id;
}

async function insertInvoiceLines(client, invoiceId, sale, skuMap) {
  await client.query("DELETE FROM cms.invoice_lines WHERE invoice_id = $1", [invoiceId]);
  let lineNo = 1;
  for (const line of sale.lines ?? []) {
    const skuId = skuMap.get(line.productId) ?? null;
    const skuInfo = skuId
      ? await client.query("SELECT sku_code FROM cms.skus WHERE id = $1", [skuId])
      : { rows: [] };
    await client.query(
      `
        INSERT INTO cms.invoice_lines (
          invoice_id, sku_id, line_no, sku_code_snapshot, product_name_snapshot,
          colour_snapshot, size_snapshot, quantity, unit_price, discount_percent, tax_rate
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        invoiceId,
        skuId,
        lineNo,
        skuInfo.rows[0]?.sku_code ?? requiredText(line.barcode, "UNKNOWN-SKU"),
        requiredText(line.name, "Imported item"),
        nullIfBlank(line.color),
        nullIfBlank(line.size),
        Math.max(1, Math.round(toNumber(line.quantity, 1))),
        toNumber(line.unitPrice, 0),
        toNumber(line.discountPct, 0),
        normalizeRate(sale.taxRate, 0),
      ],
    );
    lineNo += 1;
  }
}

async function upsertImageDirectory(client, directoryKey, info) {
  const result = await client.query(
    `
      INSERT INTO cms.image_directories (
        directory_key, category, fine_category, model_code, sku_code,
        cloud_provider, base_prefix
      ) VALUES ($1, $2, $3, $4, $5, 'aws_s3', $6)
      ON CONFLICT (directory_key) DO UPDATE SET
        category = EXCLUDED.category,
        fine_category = EXCLUDED.fine_category,
        model_code = EXCLUDED.model_code,
        sku_code = EXCLUDED.sku_code,
        base_prefix = EXCLUDED.base_prefix,
        updated_at = now()
      RETURNING id
    `,
    [
      directoryKey,
      requiredText(info.category, "Uncategorized"),
      nullIfBlank(info.fineCategory),
      nullIfBlank(info.modelCode),
      nullIfBlank(info.skuCode),
      directoryKey,
    ],
  );
  return result.rows[0].id;
}

async function importImageGallery(client, images, productIndex) {
  for (const image of images) {
    const parsed = parseImageName(image.fileName);
    const prefix = nullIfBlank(image.prefix) ?? parsed?.prefix;
    const code = nullIfBlank(image.code) ?? parsed?.code;
    const fileName = nullIfBlank(image.fileName);
    if (!prefix || !code || !fileName) continue;

    const lookup =
      productIndex.get(`id:${image.productId}`) ??
      productIndex.get(normalizeImageKey(image.sku)) ??
      productIndex.get(normalizeImageKey(prefix)) ??
      null;
    const modelCode = cleanCode(image.modelCode ?? lookup?.modelCode ?? prefix, prefix);
    const skuCode = cleanCode(image.sku ?? lookup?.skuCode ?? prefix, prefix);
    const category = lookup?.category ?? "Uncategorized";
    const fineCategory = lookup?.fineCategory ?? "General";
    const directoryKey =
      nullIfBlank(image.directory) ??
      ["women", slugPart(category, "uncategorized"), slugPart(fineCategory, "general"), modelCode, skuCode].join("/");
    const imageRole = oneOf(image.imageRole ?? imageRoleFromCode(code), IMAGE_ROLES, "other");
    const imageUrl = String(image.dataUrl ?? image.url ?? "").startsWith("http")
      ? (image.dataUrl ?? image.url)
      : null;
    const directoryId = await upsertImageDirectory(client, directoryKey, {
      category,
      fineCategory,
      modelCode,
      skuCode,
    });

    await client.query(
      `
        INSERT INTO cms.product_image_assets (
          product_id, sku_id, directory_id, model_code, sku_code, image_code,
          image_role, file_name, cloud_key, url, sort_order, uploaded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 100, $11)
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
          updated_at = now()
      `,
      [
        lookup?.productId ?? null,
        lookup?.skuId ?? null,
        directoryId,
        modelCode,
        skuCode,
        code,
        imageRole,
        fileName,
        `${directoryKey}/${fileName}`,
        imageUrl,
        image.createdAt ? toDate(image.createdAt) : new Date(),
      ],
    );
    const shouldUseAsMain = imageRole === "front" || imageRole === "model_front";
    if (imageUrl && lookup?.skuId) {
      await client.query(
        `
          UPDATE cms.skus
          SET image_url = $1, updated_at = now()
          WHERE id = $2
            AND ($3::boolean OR image_url IS NULL OR image_url = '')
        `,
        [imageUrl, lookup.skuId, shouldUseAsMain],
      );
    }
    if (imageUrl && lookup?.productId) {
      await client.query(
        `
          UPDATE cms.products
          SET main_picture_url = $1, updated_at = now()
          WHERE id = $2
            AND ($3::boolean OR main_picture_url IS NULL OR main_picture_url = '')
        `,
        [imageUrl, lookup.productId, shouldUseAsMain],
      );
    }
  }
}

async function importInventoryMovements(client, inventoryMovements, skuMap) {
  const latestBalanceByKey = new Map();
  for (const movement of inventoryMovements) {
    const skuId = skuMap.get(movement.productId);
    if (!skuId) {
      continue;
    }
    const warehouseLocation = await ensureWarehouseAndLocation(client, movement.warehouse, movement.location);
    const createdAt = toDate(movement.createdAt);
    const documentUuid = uuidOrNull(movement.documentId);
    const newQty = movement.newQty === undefined ? null : Math.max(0, Math.round(toNumber(movement.newQty, 0)));

    await client.query(
      `
        INSERT INTO cms.inventory_movements (
          legacy_id, sku_id, movement_type, document_id, previous_qty,
          quantity_change, new_qty, reason_category, warehouse_id, location_id,
          external_reference, notes, created_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'desktop-import', $13)
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
          notes = EXCLUDED.notes
      `,
      [
        nullIfBlank(movement.id),
        skuId,
        oneOf(
          movement.movementType,
          new Set(["sale", "return", "cancel_restore", "adjustment", "initial_import", "inbound", "outbound", "stocktake", "transfer"]),
          "adjustment",
        ),
        documentUuid,
        movement.previousQty === undefined ? null : Math.round(toNumber(movement.previousQty, 0)),
        Math.round(toNumber(movement.quantityChange, 0)),
        newQty,
        nullIfBlank(movement.reason),
        warehouseLocation.warehouseId,
        warehouseLocation.locationId,
        documentUuid ? null : nullIfBlank(movement.documentId),
        nullIfBlank(movement.notes),
        createdAt,
      ],
    );
    if (newQty !== null) {
      const key = `${skuId}|${warehouseLocation.warehouseId}|${warehouseLocation.locationId}`;
      const current = latestBalanceByKey.get(key);
      if (!current || createdAt.getTime() >= current.createdAt.getTime()) {
        latestBalanceByKey.set(key, {
          skuId,
          warehouseId: warehouseLocation.warehouseId,
          locationId: warehouseLocation.locationId,
          newQty,
          movementType: movement.movementType,
          createdAt,
        });
      }
    }
  }

  for (const balance of latestBalanceByKey.values()) {
    await client.query(
      `
        INSERT INTO cms.sku_inventory_balances (
          sku_id, warehouse_id, location_id, qty, last_counted_at
        ) VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN $6 ELSE null END)
        ON CONFLICT (sku_id, warehouse_id, location_id) DO UPDATE SET
          qty = EXCLUDED.qty,
          last_counted_at = CASE WHEN $5 THEN EXCLUDED.last_counted_at ELSE cms.sku_inventory_balances.last_counted_at END,
          updated_at = now()
      `,
      [
        balance.skuId,
        balance.warehouseId,
        balance.locationId,
        balance.newQty,
        balance.movementType === "stocktake",
        balance.createdAt,
      ],
    );
  }
}

async function importMaintenance(client, items) {
  for (const item of items ?? []) {
    await client.query(
      `
        INSERT INTO cms.product_maintenance_items (
          legacy_id, reason, reason_other, associated_sku, note, photo_data_url,
          diagnostics, resolved, resolved_at, created_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (legacy_id) DO UPDATE SET
          reason = EXCLUDED.reason,
          reason_other = EXCLUDED.reason_other,
          associated_sku = EXCLUDED.associated_sku,
          note = EXCLUDED.note,
          photo_data_url = EXCLUDED.photo_data_url,
          diagnostics = EXCLUDED.diagnostics,
          resolved = EXCLUDED.resolved,
          resolved_at = EXCLUDED.resolved_at,
          created_by = EXCLUDED.created_by,
          updated_at = now()
      `,
      [
        nullIfBlank(item.id),
        oneOf(item.reason, MAINTENANCE_REASONS, "other"),
        nullIfBlank(item.reasonOther),
        nullIfBlank(item.associatedSku),
        nullIfBlank(item.note),
        nullIfBlank(item.photo),
        nullIfBlank(item.diagnostics),
        Boolean(item.resolved),
        item.resolvedAt ? toDate(item.resolvedAt) : null,
        nullIfBlank(item.createdBy),
        toDate(item.createdAt),
      ],
    );
  }
}

function isDeletedRecord(item) {
  return Boolean(item && typeof item === "object" && item.id && (item.__deleted || item.deletedAt));
}

async function importSnapshot(client, input) {
  const skuMap = new Map();
  const customerMap = new Map();
  const orderMap = new Map();
  const productIndex = new Map();
  const products = (input.products ?? []).filter((item) => !isDeletedRecord(item));
  const customers = (input.customers ?? []).filter((item) => !isDeletedRecord(item));
  const sales = (input.sales ?? []).filter((item) => !isDeletedRecord(item));
  const inventoryMovements = (input.inventoryMovements ?? []).filter((item) => !isDeletedRecord(item));
  const images = (input.images ?? []).filter((item) => !isDeletedRecord(item));
  const maintenance = (input.maintenance ?? []).filter((item) => !isDeletedRecord(item));

  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");

    for (const [modelCode, rows] of groupProducts(products)) {
      const productId = await upsertProduct(client, modelCode, rows);
      const fineCategory = requiredText(rows[0]?.fineCategory ?? rows[0]?.fine_category, "Unspecified");
      productIndex.set(normalizeImageKey(modelCode), {
        productId,
        skuId: null,
        modelCode,
        skuCode: modelCode,
        category: requiredText(rows[0]?.category, "Uncategorized"),
        fineCategory,
      });

      for (const row of rows) {
        const colourId = await upsertProductColour(client, productId, row);
        const size = await upsertProductSize(client, productId, row);
        const colourCode = colourCodeFor(row);
        const skuId = await upsertSku(
          client,
          productId,
          colourId,
          size.id,
          row,
          modelCode,
          colourCode,
          size.size_code,
        );
        if (row.id) {
          skuMap.set(row.id, skuId);
        }
        const skuCode = nullIfBlank(row.sku) ? cleanCode(row.sku, "") : null;
        const productInfo = {
          productId,
          skuId,
          modelCode,
          skuCode,
          category: requiredText(row.category, "Uncategorized"),
          fineCategory: requiredText(row.fineCategory ?? row.fine_category, "General"),
        };
        if (row.id) productIndex.set(`id:${row.id}`, productInfo);
        [row.sku, row.barcode && cleanCode(row.barcode, "") !== modelCode ? row.barcode : null, row.otherSku, skuCode]
          .filter(Boolean)
          .forEach((candidate) => productIndex.set(normalizeImageKey(candidate), productInfo));
        await upsertMeasurements(client, productId, size.id, fineCategory, row);
      }
    }

    for (let index = 0; index < customers.length; index += 1) {
      const customer = customers[index];
      const customerId = await upsertCustomer(client, customer, index);
      if (customer.id) {
        customerMap.set(customer.id, customerId);
      }
    }

    for (const sale of sales) {
      const orderId = await upsertOrder(client, sale, customerMap, orderMap);
      await insertOrderLines(client, orderId, sale, skuMap);
      await insertPayments(client, orderId, sale);
      await insertReturns(client, orderId, sale, skuMap);
      const invoiceId = await upsertInvoice(client, orderId, sale, customerMap);
      await insertInvoiceLines(client, invoiceId, sale, skuMap);
    }

    for (const sale of sales) {
      if (sale.sourceDocumentId && orderMap.has(sale.sourceDocumentId) && orderMap.has(sale.id)) {
        await client.query("UPDATE cms.orders SET source_order_id = $1 WHERE id = $2", [
          orderMap.get(sale.sourceDocumentId),
          orderMap.get(sale.id),
        ]);
      }
    }

    await importInventoryMovements(client, inventoryMovements, skuMap);
    await importImageGallery(client, images, productIndex);
    await importMaintenance(client, maintenance);

    await client.query("COMMIT");
    return {
      products: products.length,
      customers: customers.length,
      sales: sales.length,
      inventoryMovements: inventoryMovements.length,
      images: images.length,
      maintenance: maintenance.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function run() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npm run db:import:localstorage -- <localstorage-export.json>");
    process.exitCode = 1;
    return;
  }

  const input = loadInput(inputPath);
  const client = createClient();
  await client.connect();

  try {
    const counts = await importSnapshot(client, input);
    console.log(`Imported products: ${counts.products}`);
    console.log(`Imported customers: ${counts.customers}`);
    console.log(`Imported orders: ${counts.sales}`);
    console.log(`Imported invoices: ${counts.sales}`);
    console.log(`Imported inventory movements: ${counts.inventoryMovements}`);
    console.log(`Imported image assets: ${counts.images}`);
    console.log(`Imported maintenance items: ${counts.maintenance}`);
  } finally {
    await client.end();
  }
}

module.exports = {
  loadInput,
  importSnapshot,
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
