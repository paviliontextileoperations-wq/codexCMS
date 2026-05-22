const { createClient } = require("./common.cjs");

const products = [
  {
    model: "P101",
    name: "Milan Wool Long Coat",
    category: "Coats & Jackets",
    fineCategory: "Long Coat",
    description: "Double-faced wool long coat with clean lapel and relaxed fit.",
    b2bPrice: 68.5,
    markup: 120,
    colorCode: "CAM",
    colorName: "Camel",
    size: "S",
    stock: 18,
    threshold: 4,
    composition: [["Wool", 70], ["Polyester", 25], ["Elastane", 5]],
    measurements: { A: 112, B: 41, C: 52, D: 60, E: 14, F: 58, G: 50, H: 24 },
  },
  {
    model: "P102",
    name: "Oslo Quilted Short Jacket",
    category: "Coats & Jackets",
    fineCategory: "Short Coat",
    description: "Light padded jacket with snap closure and curved hem.",
    b2bPrice: 42,
    markup: 110,
    colorCode: "BLK",
    colorName: "Black",
    size: "M",
    stock: 24,
    threshold: 5,
    composition: [["Nylon", 60], ["Polyester", 40]],
    measurements: { A: 62, B: 44, C: 55, D: 59, E: 13, F: 54, G: 49, H: 25 },
  },
  {
    model: "P103",
    name: "Luna Ribbed T-Shirt",
    category: "Tops",
    fineCategory: "T-Shirt",
    description: "Soft ribbed cotton T-shirt with stretch and slim silhouette.",
    b2bPrice: 9.8,
    markup: 140,
    colorCode: "WHT",
    colorName: "White",
    size: "M",
    stock: 80,
    threshold: 12,
    composition: [["Cotton", 92], ["Elastane", 8]],
    measurements: { A: 58, B: 36, C: 42, D: 18, E: 42 },
  },
  {
    model: "P104",
    name: "Siena Satin Midi Dress",
    category: "Dresses",
    fineCategory: "Dress",
    description: "Satin midi dress with draped waist and soft A-line hem.",
    b2bPrice: 31.5,
    markup: 130,
    colorCode: "GRN",
    colorName: "Sage Green",
    size: "S",
    stock: 16,
    threshold: 3,
    composition: [["Viscose", 55], ["Polyester", 45]],
    measurements: { A: 118, B: 37, C: 44, D: 36, E: 48, F: 0, G: 74 },
  },
  {
    model: "P105",
    name: "Paris Wide Leg Pants",
    category: "Trousers & Jeans",
    fineCategory: "Long Pants",
    description: "High-waist wide-leg pants with pleated front and fluid drape.",
    b2bPrice: 24.9,
    markup: 125,
    colorCode: "NVY",
    colorName: "Navy",
    size: "L",
    stock: 35,
    threshold: 6,
    composition: [["Polyester", 78], ["Viscose", 18], ["Elastane", 4]],
    measurements: { A: 38, B: 52, C: 104, D: 76, E: 32, F: 28 },
  },
  {
    model: "P106",
    name: "Florence Linen Shirt",
    category: "Tops",
    fineCategory: "T-Shirt",
    description: "Breathable linen blend short sleeve top with relaxed neckline.",
    b2bPrice: 17.2,
    markup: 115,
    colorCode: "BEI",
    colorName: "Beige",
    size: "M",
    stock: 42,
    threshold: 7,
    composition: [["Linen", 65], ["Cotton", 35]],
    measurements: { A: 61, B: 39, C: 49, D: 21, E: 50 },
  },
  {
    model: "P107",
    name: "Berlin Faux Leather Jacket",
    category: "Coats & Jackets",
    fineCategory: "Short Coat",
    description: "Structured faux leather jacket with metal zipper and fitted cuff.",
    b2bPrice: 49.9,
    markup: 120,
    colorCode: "BRN",
    colorName: "Chocolate",
    size: "M",
    stock: 20,
    threshold: 4,
    composition: [["Polyurethane", 55], ["Polyester", 45]],
    measurements: { A: 58, B: 43, C: 51, D: 61, E: 12, F: 50, G: 45, H: 24 },
  },
  {
    model: "P108",
    name: "Valencia Knit Dress",
    category: "Dresses",
    fineCategory: "Dress",
    description: "Stretch knit dress with clean square neckline and midi length.",
    b2bPrice: 28.4,
    markup: 135,
    colorCode: "RED",
    colorName: "Wine Red",
    size: "M",
    stock: 22,
    threshold: 5,
    composition: [["Viscose", 50], ["Nylon", 30], ["Elastane", 20]],
    measurements: { A: 110, B: 35, C: 41, D: 34, E: 45, F: 57, G: 66 },
  },
  {
    model: "P109",
    name: "Tokyo Cargo Pants",
    category: "Trousers & Jeans",
    fineCategory: "Long Pants",
    description: "Utility cargo pants with adjustable ankle tabs and side pockets.",
    b2bPrice: 27.6,
    markup: 118,
    colorCode: "KHK",
    colorName: "Khaki",
    size: "S",
    stock: 30,
    threshold: 6,
    composition: [["Cotton", 72], ["Polyester", 25], ["Elastane", 3]],
    measurements: { A: 35, B: 49, C: 101, D: 74, E: 31, F: 21 },
  },
  {
    model: "P110",
    name: "Copenhagen Trench Coat",
    category: "Coats & Jackets",
    fineCategory: "Long Coat",
    description: "Classic belted trench coat with storm flap and button front.",
    b2bPrice: 57.8,
    markup: 120,
    colorCode: "STN",
    colorName: "Stone",
    size: "L",
    stock: 14,
    threshold: 3,
    composition: [["Cotton", 58], ["Polyester", 42]],
    measurements: { A: 116, B: 43, C: 55, D: 62, E: 14, F: 61, G: 52, H: 25 },
  },
];

const customers = [
  {
    code: "CUS-DEMO-001",
    clientType: "B2B",
    name: "Isabel",
    surname: "Martin",
    businessType: "ESP EMPRESA",
    businessName: "Moda Norte SL",
    email: "orders@modanorte.es",
    vat: "B12345678",
    tax: 21,
    phoneCountry: "+34",
    phone: "600 101 001",
    fiscal: ["Calle Serrano 18", "28001", "Madrid", "Spain"],
    logistics: ["Calle Alcala 120", "28009", "Madrid", "Spain"],
  },
  {
    code: "CUS-DEMO-002",
    clientType: "B2B",
    name: "Marco",
    surname: "Rossi",
    businessType: "EU VAT",
    businessName: "Rossi Boutique SRL",
    email: "buying@rossiboutique.it",
    vat: "IT12345678901",
    tax: 0,
    phoneCountry: "+39",
    phone: "02 5550 2010",
    fiscal: ["Via Torino 34", "20123", "Milano", "Italy"],
    logistics: ["Via Tortona 12", "20144", "Milano", "Italy"],
  },
  {
    code: "CUS-DEMO-003",
    clientType: "B2C",
    name: "Laura",
    surname: "Garcia",
    businessType: null,
    businessName: null,
    email: "laura.garcia@example.com",
    vat: null,
    tax: 21,
    phoneCountry: "+34",
    phone: "611 202 002",
    fiscal: ["Avinguda Diagonal 410", "08037", "Barcelona", "Spain"],
    logistics: ["Avinguda Diagonal 410", "08037", "Barcelona", "Spain"],
  },
  {
    code: "CUS-DEMO-004",
    clientType: "B2B",
    name: "Claire",
    surname: "Dubois",
    businessType: "EU VAT",
    businessName: "Maison Claire SARL",
    email: "contact@maisonclaire.fr",
    vat: "FR12345678912",
    tax: 0,
    phoneCountry: "+33",
    phone: "1 45 20 18 88",
    fiscal: ["14 Rue Saint-Honore", "75001", "Paris", "France"],
    logistics: ["22 Rue Reaumur", "75003", "Paris", "France"],
  },
  {
    code: "CUS-DEMO-005",
    clientType: "B2C",
    name: "Sofia",
    surname: "Lopez",
    businessType: null,
    businessName: null,
    email: "sofia.lopez@example.com",
    vat: null,
    tax: 21,
    phoneCountry: "+34",
    phone: "622 303 003",
    fiscal: ["Calle Colon 9", "46004", "Valencia", "Spain"],
    logistics: ["Calle Colon 9", "46004", "Valencia", "Spain"],
  },
  {
    code: "CUS-DEMO-006",
    clientType: "B2B",
    name: "Anna",
    surname: "Schmidt",
    businessType: "EU VAT",
    businessName: "Schmidt Mode GmbH",
    email: "purchase@schmidtmode.de",
    vat: "DE123456789",
    tax: 0,
    phoneCountry: "+49",
    phone: "30 5557 9001",
    fiscal: ["Friedrichstrasse 90", "10117", "Berlin", "Germany"],
    logistics: ["Oranienburger Strasse 20", "10178", "Berlin", "Germany"],
  },
  {
    code: "CUS-DEMO-007",
    clientType: "B2B",
    name: "Elena",
    surname: "Ruiz",
    businessType: "ESP AUTONOMO",
    businessName: "Elena Ruiz Fashion",
    email: "elena@eruizfashion.es",
    vat: "ES12345678Z",
    tax: 21,
    phoneCountry: "+34",
    phone: "633 404 004",
    fiscal: ["Calle Larios 6", "29005", "Malaga", "Spain"],
    logistics: ["Poligono Guadalhorce Nave 8", "29004", "Malaga", "Spain"],
  },
  {
    code: "CUS-DEMO-008",
    clientType: "B2C",
    name: "Marta",
    surname: "Navarro",
    businessType: null,
    businessName: null,
    email: "marta.navarro@example.com",
    vat: null,
    tax: 21,
    phoneCountry: "+34",
    phone: "644 505 005",
    fiscal: ["Paseo Independencia 21", "50001", "Zaragoza", "Spain"],
    logistics: ["Paseo Independencia 21", "50001", "Zaragoza", "Spain"],
  },
  {
    code: "CUS-DEMO-009",
    clientType: "B2B",
    name: "Nadia",
    surname: "Khan",
    businessType: "INTERNATIONAL",
    businessName: "Khan Concept Store",
    email: "nadia@khanconcept.co.uk",
    vat: "GB987654321",
    tax: 0,
    phoneCountry: "+44",
    phone: "20 7000 9090",
    fiscal: ["31 Carnaby Street", "W1F 7DL", "London", "United Kingdom"],
    logistics: ["8 Commercial Street", "E1 6LP", "London", "United Kingdom"],
  },
  {
    code: "CUS-DEMO-010",
    clientType: "B2C",
    name: "Carmen",
    surname: "Ortega",
    businessType: null,
    businessName: null,
    email: "carmen.ortega@example.com",
    vat: null,
    tax: 21,
    phoneCountry: "+34",
    phone: "655 606 006",
    fiscal: ["Calle Sierpes 15", "41004", "Sevilla", "Spain"],
    logistics: ["Calle Sierpes 15", "41004", "Sevilla", "Spain"],
  },
];

function skuCode(product) {
  return `${product.model}-${product.colorCode}-${product.size}`;
}

async function seedProducts(client) {
  for (const product of products) {
    await client.query("DELETE FROM cms.products WHERE model_code = $1", [product.model]);

    const productResult = await client.query(
      `
        INSERT INTO cms.products (
          legacy_id, model_code, name, description, category, fine_category,
          category2, category3, b2b_price, b2c_markup_percent, main_picture_url, status
        ) VALUES ($1, $2, $3, $4, $5, $6, 'Demo', 'Sample', $7, $8, $9, 'active')
        RETURNING id
      `,
      [
        `demo:${product.model}`,
        product.model,
        product.name,
        product.description,
        product.category,
        product.fineCategory,
        product.b2bPrice,
        product.markup,
        `${product.model}-main.jpeg`,
      ],
    );
    const productId = productResult.rows[0].id;

    for (let index = 0; index < product.composition.length; index += 1) {
      const [material, percentage] = product.composition[index];
      await client.query(
        `
          INSERT INTO cms.product_compositions (product_id, material, percentage, sort_order)
          VALUES ($1, $2, $3, $4)
        `,
        [productId, material, percentage, index + 1],
      );
    }

    const colourResult = await client.query(
      `
        INSERT INTO cms.product_colours (
          product_id, colour_name, colour_code, image_url, sort_order
        ) VALUES ($1, $2, $3, $4, 1)
        RETURNING id
      `,
      [productId, product.colorName, product.colorCode, `${product.model}-${product.colorCode}.jpeg`],
    );
    const colourId = colourResult.rows[0].id;

    const sizeResult = await client.query(
      `
        INSERT INTO cms.product_sizes (
          product_id, size_code, size_label, sort_order, weight_grams
        ) VALUES ($1, $2, $2, 1, $3)
        RETURNING id
      `,
      [productId, product.size, product.fineCategory.includes("Coat") ? 950 : 420],
    );
    const sizeId = sizeResult.rows[0].id;

    const skuResult = await client.query(
      `
        INSERT INTO cms.skus (
          legacy_id, product_id, colour_id, size_id, sku_code, other_sku,
          stock_qty, low_stock_threshold, image_url, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
        RETURNING id
      `,
      [
        `demo:${skuCode(product)}`,
        productId,
        colourId,
        sizeId,
        skuCode(product),
        `EXT-${product.model}`,
        product.stock,
        product.threshold,
        `${skuCode(product)}.jpeg`,
      ],
    );
    const skuId = skuResult.rows[0].id;

    await client.query(
      `
        INSERT INTO cms.inventory_movements (
          legacy_id, sku_id, movement_type, quantity_change, notes, created_by
        ) VALUES ($1, $2, 'initial_import', $3, 'Demo sample stock', 'demo-seed')
      `,
      [`demo-stock:${skuCode(product)}`, skuId, product.stock],
    );

    for (const [code, value] of Object.entries(product.measurements)) {
      if (value === 0) {
        continue;
      }
      const template = await client.query(
        `
          SELECT id, measurement_name, unit
          FROM cms.measurement_templates
          WHERE fine_category = $1 AND measurement_code = $2
        `,
        [product.fineCategory, code],
      );
      const templateRow = template.rows[0];
      await client.query(
        `
          INSERT INTO cms.product_size_measurements (
            product_id, size_id, measurement_template_id, measurement_code,
            measurement_name, value, unit
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          productId,
          sizeId,
          templateRow?.id ?? null,
          code,
          templateRow?.measurement_name ?? `Measurement ${code}`,
          value,
          templateRow?.unit ?? "cm",
        ],
      );
    }
  }
}

async function seedCustomers(client) {
  for (const customer of customers) {
    await client.query("DELETE FROM cms.customers WHERE customer_code = $1", [customer.code]);

    const result = await client.query(
      `
        INSERT INTO cms.customers (
          legacy_id, customer_code, client_type, name, surname, business_type,
          business_name, email, vat_number, tax_rate_percent, status, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Active', 'Demo customer')
        RETURNING id
      `,
      [
        `demo:${customer.code}`,
        customer.code,
        customer.clientType,
        customer.name,
        customer.surname,
        customer.businessType,
        customer.businessName,
        customer.email,
        customer.vat,
        customer.tax,
      ],
    );
    const customerId = result.rows[0].id;

    await client.query(
      `
        INSERT INTO cms.customer_phones (
          legacy_id, phone_code, customer_id, country_code, phone_number, is_primary
        ) VALUES ($1, $1, $2, $3, $4, true)
      `,
      [`demo-phone:${customer.code}`, customerId, customer.phoneCountry, customer.phone],
    );

    for (const [type, address] of [
      ["Fiscal", customer.fiscal],
      ["Logistics", customer.logistics],
    ]) {
      await client.query(
        `
          INSERT INTO cms.customer_addresses (
            legacy_id, address_code, customer_id, address_type, address_line_1,
            postal_code, province_state, country, is_default
          ) VALUES ($1, $1, $2, $3, $4, $5, $6, $7, true)
        `,
        [
          `demo-${type.toLowerCase()}:${customer.code}`,
          customerId,
          type,
          address[0],
          address[1],
          address[2],
          address[3],
        ],
      );
    }
  }
}

async function run() {
  const client = createClient();
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await seedProducts(client);
    await seedCustomers(client);
    await client.query("COMMIT");

    console.log(`Seeded ${products.length} demo products/SKUs.`);
    console.log(`Seeded ${customers.length} demo customers.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
