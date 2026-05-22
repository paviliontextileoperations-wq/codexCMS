const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const TMP_DIR = path.join(ROOT_DIR, "tmp", "seed-w109-test-data");
const TEST_TAG = "TEST_DATA_W109";
const CLIENT_ID = "codex-seed-w109-test-data";

const DATASET_KEYS = {
  products: "form.products.v1",
  customers: "form.customers.v1",
  sales: "form.sales.v1",
  inventoryMovements: "form.inventoryMovements.v1",
  inventoryLocations: "form.inventoryLocations.v1",
  images: "form.imageGallery.v1",
};

const IMAGE_PATHS = [
  "E:/夏雨的文件/3.0图片处理综合/2.0成品图/2026.5.8/W109/ComfyUI_02220_.png",
  "E:/夏雨的文件/3.0图片处理综合/2.0成品图/2026.5.8/W109/ComfyUI_02214_.png",
  "E:/夏雨的文件/3.0图片处理综合/2.0成品图/2026.5.8/W109/ComfyUI_02198_.png",
  "E:/夏雨的文件/3.0图片处理综合/2.0成品图/2026.5.8/W109/ComfyUI_02205_.png",
  "E:/夏雨的文件/3.0图片处理综合/2.0成品图/2026.5.8/W109/ComfyUI_02202_.png",
  "E:/夏雨的文件/3.0图片处理综合/2.0成品图/2026.5.8/W109/ComfyUI_02204_.png",
];

function loadEnv() {
  const envPath = path.join(ROOT_DIR, ".env");
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
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

function apiBaseUrl() {
  const value = process.env.API_BASE_URL;
  if (!value) throw new Error("API_BASE_URL is not configured in .env");
  return value.replace(/\/+$/, "");
}

async function apiRequest(pathname, { method = "POST", body } = {}) {
  const headers = { "content-type": "application/json" };
  if (process.env.API_KEY) headers["x-api-key"] = process.env.API_KEY;
  const response = await fetch(`${apiBaseUrl()}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(parsed.message || `API ${method} ${pathname} failed with ${response.status}`);
  }
  return parsed;
}

function dbConfig() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured in .env");
  return {
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.PGSSL === "true"
        ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" }
        : undefined,
  };
}

function createdAt(minutes) {
  return new Date(`2026-05-17T${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00+02:00`).getTime();
}

function testMeta(extra = {}) {
  return {
    isTestData: true,
    testTag: TEST_TAG,
    tags: [TEST_TAG, "W109", "PAVILION_TEST"],
    ...extra,
  };
}

function address(line1, postalCode, provinceState, country, line2 = "") {
  return { line1, line2, additionalInfo: TEST_TAG, postalCode, provinceState, country };
}

function buildProducts() {
  const rows = [
    ["001", "LBL", "Light Blue", "S", 34, 18.8, 54.9, IMAGE_PATHS[0], "F", 42],
    ["002", "LBL", "Light Blue", "M", 38, 18.8, 54.9, IMAGE_PATHS[1], "MF", 47],
    ["003", "LBL", "Light Blue", "L", 36, 18.8, 54.9, IMAGE_PATHS[2], "MX1", 39],
    ["004", "ICE", "Ice Blue", "S", 28, 19.2, 56.5, IMAGE_PATHS[3], "D1", 31],
    ["005", "ICE", "Ice Blue", "M", 41, 19.2, 56.5, IMAGE_PATHS[4], "B", 44],
    ["006", "ICE", "Ice Blue", "L", 33, 19.2, 56.5, IMAGE_PATHS[5], "D2", 36],
    ["007", "STB", "Stone Blue", "S", 25, 20.1, 58.0, IMAGE_PATHS[0], "F", 29],
    ["008", "STB", "Stone Blue", "M", 37, 20.1, 58.0, IMAGE_PATHS[1], "MF", 41],
    ["009", "STB", "Stone Blue", "L", 31, 20.1, 58.0, IMAGE_PATHS[2], "MX1", 35],
    ["010", "PIN", "Pale Indigo", "S", 22, 18.5, 53.5, IMAGE_PATHS[3], "D1", 26],
    ["011", "PIN", "Pale Indigo", "M", 40, 18.5, 53.5, IMAGE_PATHS[4], "B", 43],
    ["012", "PIN", "Pale Indigo", "L", 27, 18.5, 53.5, IMAGE_PATHS[5], "D2", 32],
  ];

  return rows.map(([number, colourCode, color, size, stock, cost, price, imagePath, imageCode, minutes]) => {
    const sku = `TST-W109-${number}-${colourCode}-${size}`;
    return {
      id: `test-w109-prod-${number}`,
      barcode: `TSTW109${number}`,
      name: `[TEST] W109 Drawstring Wide Leg Denim Pants ${number}`,
      sku,
      category: "Women",
      fineCategory: "Denim Pants",
      category2: "Bottoms",
      category3: "Wide Leg Pants",
      description: `[${TEST_TAG}] Test-only women's denim pants record for cloud API, inventory, image and order workflow validation.`,
      size,
      color,
      price,
      cost,
      b2cMarkup: 0.85,
      b2cPrice: Math.round(price * 1.85 * 100) / 100,
      composition: [
        { material: "Cotton", percentage: 72 },
        { material: "Polyester", percentage: 25 },
        { material: "Elastane", percentage: 3 },
      ],
      stock,
      lowStockThreshold: 8,
      otherSku: `TEST-W109-${number}`,
      weight: "620",
      lengthA: size === "S" ? "66" : size === "M" ? "70" : "74",
      lengthB: size === "S" ? "96" : size === "M" ? "100" : "104",
      lengthC: "101",
      lengthD: "30",
      lengthE: "34",
      lengthF: "24",
      lengthG: "29",
      lengthH: "21",
      mainImage: "",
      image: "",
      imagePath,
      imageCode,
      imageFileName: `${sku}-${imageCode}.PNG`,
      createdAt: createdAt(minutes),
      ...testMeta(),
    };
  });
}

function buildCustomers() {
  const customers = [
    {
      id: "test-w109-cust-001",
      customerCode: "TEST-CUST-W109-001",
      clientType: "B2B",
      name: "[TEST] Boutique Alba",
      surname: "Madrid",
      businessType: "ESP EMPRESA",
      businessName: "[TEST] Boutique Alba Madrid SL",
      email: "test.w109.001@pavilion.example",
      vatNumber: "ESB10900001",
      phoneCountryCode: "+34",
      phoneNumber: "600 109 001",
      phone: "+34 600 109 001",
      fiscalAddress: address("Calle Serrano 109", "28006", "Madrid", "Spain"),
      logisticsAddress: address("Calle Serrano 109", "28006", "Madrid", "Spain"),
      taxRate: 21,
      createdAt: createdAt(12),
    },
    {
      id: "test-w109-cust-002",
      customerCode: "TEST-CUST-W109-002",
      clientType: "B2B",
      name: "[TEST] Atelier Nord",
      surname: "Lyon",
      businessType: "EU VAT",
      businessName: "[TEST] Atelier Nord SARL",
      email: "test.w109.002@pavilion.example",
      vatNumber: "FR109000002",
      phoneCountryCode: "+33",
      phoneNumber: "4 72 10 90 02",
      phone: "+33 4 72 10 90 02",
      fiscalAddress: address("12 Rue Merciere", "69002", "Rhone", "France"),
      logisticsAddress: address("Zone Mode Nord, Dock 3", "69007", "Rhone", "France"),
      taxRate: 0,
      createdAt: createdAt(14),
    },
    {
      id: "test-w109-cust-003",
      customerCode: "TEST-CUST-W109-003",
      clientType: "B2B",
      name: "[TEST] Moda Sol",
      surname: "Barcelona",
      businessType: "ESP AUTONOMO",
      businessName: "[TEST] Moda Sol Barcelona",
      email: "test.w109.003@pavilion.example",
      vatNumber: "ESX10900003",
      phoneCountryCode: "+34",
      phoneNumber: "600 109 003",
      phone: "+34 600 109 003",
      fiscalAddress: address("Passeig de Gracia 55", "08007", "Barcelona", "Spain"),
      logisticsAddress: address("Poligono Textile Nave 8", "08930", "Barcelona", "Spain"),
      taxRate: 21,
      createdAt: createdAt(16),
    },
    {
      id: "test-w109-cust-004",
      customerCode: "TEST-CUST-W109-004",
      clientType: "B2B",
      name: "[TEST] Studio Verde",
      surname: "Milano",
      businessType: "EU VAT",
      businessName: "[TEST] Studio Verde SRL",
      email: "test.w109.004@pavilion.example",
      vatNumber: "IT109000004",
      phoneCountryCode: "+39",
      phoneNumber: "02 1090 0004",
      phone: "+39 02 1090 0004",
      fiscalAddress: address("Via Torino 41", "20123", "Milano", "Italy"),
      logisticsAddress: address("Magazzino Moda, Gate B", "20090", "Milano", "Italy"),
      taxRate: 0,
      createdAt: createdAt(18),
    },
    {
      id: "test-w109-cust-005",
      customerCode: "TEST-CUST-W109-005",
      clientType: "B2C",
      name: "[TEST] Clara",
      surname: "Online",
      email: "test.w109.005@pavilion.example",
      phoneCountryCode: "+34",
      phoneNumber: "600 109 005",
      phone: "+34 600 109 005",
      fiscalAddress: address("Calle Mayor 18", "46001", "Valencia", "Spain"),
      logisticsAddress: address("Calle Mayor 18", "46001", "Valencia", "Spain"),
      taxRate: 21,
      createdAt: createdAt(20),
    },
    {
      id: "test-w109-cust-006",
      customerCode: "TEST-CUST-W109-006",
      clientType: "B2B",
      name: "[TEST] Retail Lisboa",
      surname: "Chiado",
      businessType: "EU VAT",
      businessName: "[TEST] Retail Lisboa LDA",
      email: "test.w109.006@pavilion.example",
      vatNumber: "PT109000006",
      phoneCountryCode: "+351",
      phoneNumber: "21 109 0006",
      phone: "+351 21 109 0006",
      fiscalAddress: address("Rua do Carmo 25", "1200-093", "Lisboa", "Portugal"),
      logisticsAddress: address("Rua do Carmo 25", "1200-093", "Lisboa", "Portugal"),
      taxRate: 0,
      createdAt: createdAt(22),
    },
    {
      id: "test-w109-cust-007",
      customerCode: "TEST-CUST-W109-007",
      clientType: "B2B",
      name: "[TEST] Pavilion Sample",
      surname: "Room",
      businessType: "INTERNATIONAL",
      businessName: "[TEST] Pavilion Internal Sample Room",
      email: "test.w109.007@pavilion.example",
      vatNumber: "SAMPLE-W109-007",
      phoneCountryCode: "+34",
      phoneNumber: "600 109 007",
      phone: "+34 600 109 007",
      fiscalAddress: address("Internal Warehouse A", "46980", "Valencia", "Spain"),
      logisticsAddress: address("Internal Warehouse A", "46980", "Valencia", "Spain"),
      taxRate: 0,
      createdAt: createdAt(24),
    },
    {
      id: "test-w109-cust-008",
      customerCode: "TEST-CUST-W109-008",
      clientType: "B2B",
      name: "[TEST] Valencia Concept",
      surname: "Store",
      businessType: "ESP EMPRESA",
      businessName: "[TEST] Valencia Concept Store SL",
      email: "test.w109.008@pavilion.example",
      vatNumber: "ESB10900008",
      phoneCountryCode: "+34",
      phoneNumber: "600 109 008",
      phone: "+34 600 109 008",
      fiscalAddress: address("Carrer Colon 12", "46004", "Valencia", "Spain"),
      logisticsAddress: address("Carrer Colon 12", "46004", "Valencia", "Spain"),
      taxRate: 21,
      createdAt: createdAt(26),
    },
    {
      id: "test-w109-cust-009",
      customerCode: "TEST-CUST-W109-009",
      clientType: "B2B",
      name: "[TEST] Berlin Denim Lab",
      surname: "Mitte",
      businessType: "EU VAT",
      businessName: "[TEST] Berlin Denim Lab GmbH",
      email: "test.w109.009@pavilion.example",
      vatNumber: "DE109000009",
      phoneCountryCode: "+49",
      phoneNumber: "30 1090 0009",
      phone: "+49 30 1090 0009",
      fiscalAddress: address("Munzstrasse 7", "10178", "Berlin", "Germany"),
      logisticsAddress: address("Munzstrasse 7", "10178", "Berlin", "Germany"),
      taxRate: 0,
      createdAt: createdAt(28),
    },
    {
      id: "test-w109-cust-010",
      customerCode: "TEST-CUST-W109-010",
      clientType: "B2C",
      name: "[TEST] Pickup",
      surname: "No Invoice",
      email: "test.w109.010@pavilion.example",
      phoneCountryCode: "+34",
      phoneNumber: "600 109 010",
      phone: "+34 600 109 010",
      fiscalAddress: address("Warehouse Counter", "46980", "Valencia", "Spain"),
      logisticsAddress: address("Warehouse Counter", "46980", "Valencia", "Spain"),
      taxRate: 21,
      createdAt: createdAt(30),
    },
  ];

  return customers.map((customer) => ({
    ...customer,
    address: [
      customer.fiscalAddress?.line1,
      customer.fiscalAddress?.postalCode,
      customer.fiscalAddress?.provinceState,
      customer.fiscalAddress?.country,
    ]
      .filter(Boolean)
      .join(", "),
    notes: `[${TEST_TAG}] Test customer. Safe to delete before production.`,
    ...testMeta(),
  }));
}

function line(product, quantity, discountPct = 0, unitPrice = product.price) {
  return {
    productId: product.id,
    barcode: product.sku,
    name: product.name,
    size: product.size,
    color: product.color,
    unitPrice,
    quantity,
    discountPct,
  };
}

function customerSnapshot(customer) {
  return {
    name: customer.name,
    phone: customer.phone,
    vatNumber: customer.vatNumber,
    email: customer.email,
    address: customer.address,
    businessName: customer.businessName,
    fiscalAddress: customer.fiscalAddress,
    logisticsAddress: customer.logisticsAddress,
  };
}

function buildSale({
  id,
  invoiceNumber,
  documentType,
  documentStatus = "open",
  deliveryStatus = "open",
  invoiceTaxProfile,
  salesChannel,
  customer,
  lines,
  taxRate,
  vatRate,
  surchargeRate = 0,
  transport,
  paymentStatus,
  paidAmount,
  paymentMethod = "TRANSFER",
  dueMinutes,
  createdMinutes,
}) {
  const subtotal = roundMoney(
    lines.reduce((sum, item) => sum + item.unitPrice * item.quantity * (1 - (item.discountPct ?? 0) / 100), 0),
  );
  const vatAmount = roundMoney(subtotal * vatRate);
  const surchargeAmount = roundMoney(subtotal * surchargeRate);
  const tax = roundMoney(vatAmount + surchargeAmount);
  const transportFee = transport?.fee ?? 0;
  const total = roundMoney(subtotal + tax + transportFee);
  const amountPaid = roundMoney(Math.min(total, paidAmount ?? 0));
  const amountDue = roundMoney(Math.max(0, total - amountPaid));
  const payments =
    amountPaid > 0
      ? [
          {
            id: `${id}-pay-001`,
            amount: amountPaid,
            method: paymentMethod,
            note: `[${TEST_TAG}] Test payment`,
            paymentDate: createdAt(createdMinutes + 1),
            reference: `${invoiceNumber}-PAY`,
            createdAt: createdAt(createdMinutes + 1),
            ...testMeta(),
          },
        ]
      : [];

  return {
    id,
    invoiceNumber,
    documentType,
    documentStatus,
    deliveryStatus,
    dueDate: dueMinutes ? createdAt(dueMinutes) : undefined,
    invoiceNotes: `[${TEST_TAG}] Test order/invoice generated for software validation. Do not use for real accounting.`,
    invoiceTaxProfile,
    salesChannel,
    stockMovementCreated: true,
    returns: [],
    customerId: customer.id,
    customerSnapshot: customerSnapshot(customer),
    lines,
    subtotal,
    taxRate,
    tax,
    taxBreakdown: {
      vat: vatRate,
      surcharge: surchargeRate,
      vatAmount,
      surchargeAmount,
    },
    transport,
    total,
    paymentStatus,
    amountPaid,
    amountDue,
    payments,
    createdAt: createdAt(createdMinutes),
    ...testMeta(),
  };
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function buildSales(products, customers) {
  const p = (index) => products[index - 1];
  const c = (index) => customers[index - 1];
  return [
    buildSale({
      id: "test-w109-order-001",
      invoiceNumber: "TEST-INV-W109-001",
      documentType: "INVOICE",
      invoiceTaxProfile: "b2b_spain",
      salesChannel: "b2b_direct",
      customer: c(1),
      lines: [line(p(1), 4), line(p(2), 3, 5), line(p(3), 2)],
      taxRate: 0.21,
      vatRate: 0.21,
      transport: { method: "DELIVERY", label: "TEST GLS pallet", fee: 18 },
      paymentStatus: "PAID",
      paidAmount: 999999,
      createdMinutes: 61,
      dueMinutes: 61 + 60 * 24 * 15,
    }),
    buildSale({
      id: "test-w109-order-002",
      invoiceNumber: "TEST-DN-W109-002",
      documentType: "DELIVERY_NOTE",
      deliveryStatus: "preparing",
      invoiceTaxProfile: "no_tax",
      salesChannel: "whatsapp",
      customer: c(2),
      lines: [line(p(4), 5), line(p(5), 5), line(p(6), 3)],
      taxRate: 0,
      vatRate: 0,
      transport: { method: "DELIVERY", label: "TEST pickup carrier", fee: 0 },
      paymentStatus: "OPEN",
      paidAmount: 0,
      createdMinutes: 73,
      dueMinutes: 73 + 60 * 24 * 30,
    }),
    buildSale({
      id: "test-w109-order-003",
      invoiceNumber: "TEST-RCP-W109-003",
      documentType: "RECEIPT",
      invoiceTaxProfile: "b2c",
      salesChannel: "website",
      customer: c(5),
      lines: [line(p(7), 1, 0, p(7).b2cPrice), line(p(8), 1, 0, p(8).b2cPrice)],
      taxRate: 0.21,
      vatRate: 0.21,
      transport: { method: "DELIVERY", label: "TEST parcel", fee: 5.5 },
      paymentStatus: "PAID",
      paymentMethod: "CARD",
      paidAmount: 999999,
      createdMinutes: 86,
      dueMinutes: 86,
    }),
    buildSale({
      id: "test-w109-order-004",
      invoiceNumber: "TEST-INV-W109-004",
      documentType: "INVOICE",
      invoiceTaxProfile: "b2b_eu_vat",
      salesChannel: "b2b_direct",
      customer: c(4),
      lines: [line(p(9), 6), line(p(10), 4)],
      taxRate: 0,
      vatRate: 0,
      transport: { method: "DELIVERY", label: "TEST international pallet", fee: 24 },
      paymentStatus: "PAID",
      paidAmount: 999999,
      createdMinutes: 98,
      dueMinutes: 98 + 60 * 24 * 20,
    }),
    buildSale({
      id: "test-w109-order-005",
      invoiceNumber: "TEST-INV-W109-005",
      documentType: "INVOICE",
      invoiceTaxProfile: "custom",
      salesChannel: "phone",
      customer: c(3),
      lines: [line(p(11), 4), line(p(12), 4)],
      taxRate: 0.262,
      vatRate: 0.21,
      surchargeRate: 0.052,
      transport: { method: "PICKUP", label: "TEST warehouse pickup", fee: 0 },
      paymentStatus: "PARTIAL",
      paidAmount: 120,
      createdMinutes: 111,
      dueMinutes: 111 + 60 * 24 * 10,
    }),
    buildSale({
      id: "test-w109-order-006",
      invoiceNumber: "TEST-DN-W109-006",
      documentType: "DELIVERY_NOTE",
      deliveryStatus: "not_prepared",
      invoiceTaxProfile: "no_tax",
      salesChannel: "physical_store",
      customer: c(10),
      lines: [line(p(1), 1, 0, p(1).b2cPrice), line(p(5), 1, 0, p(5).b2cPrice)],
      taxRate: 0,
      vatRate: 0,
      transport: { method: "PICKUP", label: "TEST no invoice pickup", fee: 0 },
      paymentStatus: "OPEN",
      paidAmount: 0,
      createdMinutes: 124,
      dueMinutes: 124 + 60 * 24 * 5,
    }),
    buildSale({
      id: "test-w109-order-007",
      invoiceNumber: "TEST-INV-W109-007",
      documentType: "INVOICE",
      invoiceTaxProfile: "b2b_international",
      salesChannel: "marketplace",
      customer: c(7),
      lines: [line(p(2), 2), line(p(6), 2), line(p(10), 2)],
      taxRate: 0,
      vatRate: 0,
      transport: { method: "DELIVERY", label: "TEST internal sample transfer", fee: 0 },
      paymentStatus: "PAID",
      paymentMethod: "OTHER",
      paidAmount: 999999,
      createdMinutes: 136,
      dueMinutes: 136,
    }),
    buildSale({
      id: "test-w109-order-008",
      invoiceNumber: "TEST-INV-W109-008",
      documentType: "INVOICE",
      invoiceTaxProfile: "b2b_spain",
      salesChannel: "instagram",
      customer: c(8),
      lines: [line(p(3), 3), line(p(7), 3), line(p(11), 2, 10)],
      taxRate: 0.21,
      vatRate: 0.21,
      transport: { method: "DELIVERY", label: "TEST courier", fee: 14 },
      paymentStatus: "PAID",
      paymentMethod: "TRANSFER",
      paidAmount: 999999,
      createdMinutes: 149,
      dueMinutes: 149 + 60 * 24 * 7,
    }),
  ];
}

function buildInventory(products) {
  const locations = products.map((product, index) => ({
    productId: product.id,
    warehouse: index % 4 === 0 ? "MAIN" : "主仓库",
    location: `TEST-W109-A-${String(index + 1).padStart(2, "0")}`,
    updatedAt: createdAt(180 + index),
    ...testMeta(),
  }));

  const movements = products.map((product, index) => ({
    id: `test-w109-move-${String(index + 1).padStart(3, "0")}`,
    movementType: "initial_import",
    documentId: "TEST-W109-SEED",
    productId: product.id,
    sku: product.sku,
    previousQty: 0,
    quantityChange: product.stock,
    newQty: product.stock,
    reason: "purchase_inbound",
    warehouse: locations[index].warehouse,
    location: locations[index].location,
    notes: `[${TEST_TAG}] Initial test stock for W109 seeded data.`,
    createdAt: createdAt(181 + index),
    ...testMeta(),
  }));

  return { locations, movements };
}

async function pullCurrent() {
  const response = await apiRequest("/sync/pull", {
    body: { keys: Object.values(DATASET_KEYS) },
  });
  const records = new Map();
  for (const record of response.records ?? []) {
    records.set(record.key, parseArray(record.raw));
  }
  return {
    products: records.get(DATASET_KEYS.products) ?? [],
    customers: records.get(DATASET_KEYS.customers) ?? [],
    sales: records.get(DATASET_KEYS.sales) ?? [],
    inventoryMovements: records.get(DATASET_KEYS.inventoryMovements) ?? [],
    inventoryLocations: records.get(DATASET_KEYS.inventoryLocations) ?? [],
    images: records.get(DATASET_KEYS.images) ?? [],
  };
}

function parseArray(raw) {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function withoutW109(records, kind) {
  return records.filter((record) => {
    if (!record) return false;
    if (record.testTag === TEST_TAG) return false;
    if (kind === "products") {
      return !(
        String(record.id ?? "").startsWith("test-w109-prod-") ||
        String(record.sku ?? "").startsWith("TST-W109-") ||
        String(record.barcode ?? "").startsWith("TSTW109")
      );
    }
    if (kind === "customers") {
      return !(
        String(record.id ?? "").startsWith("test-w109-cust-") ||
        String(record.customerCode ?? "").startsWith("TEST-CUST-W109-")
      );
    }
    if (kind === "sales") {
      return !(
        String(record.id ?? "").startsWith("test-w109-order-") ||
        String(record.invoiceNumber ?? "").includes("W109")
      );
    }
    if (kind === "inventoryMovements") {
      return !(
        String(record.id ?? "").startsWith("test-w109-move-") ||
        String(record.productId ?? "").startsWith("test-w109-prod-")
      );
    }
    if (kind === "inventoryLocations") {
      return !String(record.productId ?? "").startsWith("test-w109-prod-");
    }
    if (kind === "images") {
      return !(
        String(record.id ?? "").startsWith("test-w109-img-") ||
        String(record.fileName ?? "").startsWith("TST-W109-") ||
        String(record.prefix ?? "").startsWith("TST-W109-") ||
        String(record.sku ?? "").startsWith("TST-W109-")
      );
    }
    return true;
  });
}

function mergedPayload(current, next) {
  return {
    products: [...next.products, ...withoutW109(current.products, "products")],
    customers: [...next.customers, ...withoutW109(current.customers, "customers")],
    sales: [...next.sales, ...withoutW109(current.sales, "sales")],
    inventoryMovements: [
      ...next.inventoryMovements,
      ...withoutW109(current.inventoryMovements, "inventoryMovements"),
    ],
    inventoryLocations: [
      ...next.inventoryLocations,
      ...withoutW109(current.inventoryLocations, "inventoryLocations"),
    ],
    images: [...next.images, ...withoutW109(current.images, "images")],
  };
}

function importPayload(payload, filename) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const exportPath = path.join(TMP_DIR, filename);
  fs.writeFileSync(exportPath, JSON.stringify(payload, null, 2), "utf8");
  const result = spawnSync(process.execPath, ["scripts/db/import-localstorage.cjs", exportPath], {
    cwd: ROOT_DIR,
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Import failed for ${filename}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.trim();
}

async function uploadProductImages(products) {
  const gallery = [];
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    if (!fs.existsSync(product.imagePath)) {
      throw new Error(`Missing image file: ${product.imagePath}`);
    }
    const ticket = await apiRequest("/images/upload-url", {
      body: {
        fileName: product.imageFileName,
        contentType: "image/png",
      },
    });
    const buffer = fs.readFileSync(product.imagePath);
    const contentType =
      ticket.headers?.["content-type"] ?? ticket.headers?.["Content-Type"] ?? ticket.asset?.mimeType ?? "image/png";
    const upload = await fetch(ticket.uploadUrl, {
      method: ticket.method || "PUT",
      headers: { "content-type": contentType },
      body: buffer,
    });
    if (!upload.ok) {
      throw new Error(`S3 upload failed for ${product.imageFileName}: ${upload.status} ${upload.statusText}`);
    }
    await apiRequest("/images/register", {
      body: { asset: ticket.asset },
    });

    product.image = ticket.asset.url;
    product.mainImage = ticket.asset.url;
    gallery.push({
      id: `test-w109-img-${String(index + 1).padStart(3, "0")}`,
      prefix: product.sku,
      code: product.imageCode,
      fileName: ticket.asset.fileName,
      dataUrl: ticket.asset.url,
      sku: product.sku,
      modelCode: product.barcode,
      productId: product.id,
      directory: ticket.asset.directoryKey,
      imageRole: ticket.asset.imageRole,
      createdAt: createdAt(240 + index),
      ...testMeta({
        cloudKey: ticket.asset.cloudKey,
        sourceImagePath: product.imagePath,
      }),
    });
    console.log(`Uploaded ${index + 1}/12: ${ticket.asset.fileName}`);
  }

  for (const product of products) {
    delete product.imagePath;
    delete product.imageCode;
    delete product.imageFileName;
  }
  return gallery;
}

async function pushAppSettings(payload) {
  await apiRequest("/sync/push", {
    body: {
      clientId: CLIENT_ID,
      records: [
        { key: DATASET_KEYS.products, raw: JSON.stringify(payload.products) },
        { key: DATASET_KEYS.customers, raw: JSON.stringify(payload.customers) },
        { key: DATASET_KEYS.sales, raw: JSON.stringify(payload.sales) },
        { key: DATASET_KEYS.inventoryMovements, raw: JSON.stringify(payload.inventoryMovements) },
        { key: DATASET_KEYS.inventoryLocations, raw: JSON.stringify(payload.inventoryLocations) },
        { key: DATASET_KEYS.images, raw: JSON.stringify(payload.images) },
      ],
    },
  });
}

async function verify() {
  const client = new Client(dbConfig());
  await client.connect();
  try {
    const queries = {
      skus: "SELECT count(*)::int AS count FROM cms.skus WHERE sku_code LIKE 'TST-W109-%'",
      products:
        "SELECT count(*)::int AS count FROM cms.products WHERE model_code LIKE 'TSTW109%' AND description LIKE '%TEST_DATA_W109%'",
      customers:
        "SELECT count(*)::int AS count FROM cms.customers WHERE customer_code LIKE 'TEST-CUST-W109-%' AND notes LIKE '%TEST_DATA_W109%'",
      orders:
        "SELECT count(*)::int AS count FROM cms.orders WHERE order_number LIKE 'TEST-%W109-%'",
      invoices:
        "SELECT count(*)::int AS count FROM cms.invoices WHERE invoice_number LIKE 'TEST-%W109-%'",
      images:
        "SELECT count(*)::int AS count FROM cms.product_image_assets WHERE file_name LIKE 'TST-W109-%'",
    };
    const output = {};
    for (const [key, sql] of Object.entries(queries)) {
      const result = await client.query(sql);
      output[key] = result.rows[0].count;
    }
    return output;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function cleanupDuplicateImportedImages() {
  const client = new Client(dbConfig());
  await client.connect();
  try {
    await client.query(
      `
        DELETE FROM cms.product_image_assets
        WHERE file_name LIKE 'TST-W109-%'
          AND cloud_key NOT LIKE 'products/%'
      `,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function run() {
  loadEnv();

  for (const imagePath of IMAGE_PATHS) {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Missing image file: ${imagePath}`);
    }
  }

  const health = await apiRequest("/health", { method: "GET" });
  console.log(`Cloud API health: ${health.ok ? "ok" : "failed"}`);

  const current = await pullCurrent();
  const products = buildProducts();
  const customers = buildCustomers();
  const sales = buildSales(products, customers);
  const inventory = buildInventory(products);

  const initialPayload = {
    products: products.map((product) => ({ ...product, image: "", mainImage: "" })),
    customers,
    sales,
    inventoryMovements: inventory.movements,
    inventoryLocations: inventory.locations,
    images: [],
  };
  console.log(importPayload(initialPayload, "w109-initial-normalized-import.json"));

  const images = await uploadProductImages(products);
  const finalTestPayload = {
    products,
    customers,
    sales,
    inventoryMovements: inventory.movements,
    inventoryLocations: inventory.locations,
    images,
  };
  const finalMergedPayload = mergedPayload(current, finalTestPayload);
  await pushAppSettings(finalMergedPayload);
  console.log("Cloud app datasets pushed.");
  console.log(
    importPayload(
      {
        ...finalTestPayload,
        images: [],
      },
      "w109-final-normalized-import.json",
    ),
  );
  await cleanupDuplicateImportedImages();

  const counts = await verify();
  const report = {
    testTag: TEST_TAG,
    products: products.map((product) => ({
      id: product.id,
      sku: product.sku,
      image: product.image,
    })),
    customers: customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      customerCode: customer.customerCode,
    })),
    orders: sales.map((sale) => ({
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      customerId: sale.customerId,
      total: sale.total,
      paymentStatus: sale.paymentStatus,
    })),
    images: images.map((image) => ({
      fileName: image.fileName,
      sku: image.sku,
      url: image.dataUrl,
    })),
    verification: counts,
  };
  fs.writeFileSync(path.join(TMP_DIR, "w109-test-data-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("Verification:", JSON.stringify(counts));
  console.log(`Report: ${path.join(TMP_DIR, "w109-test-data-report.json")}`);
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
