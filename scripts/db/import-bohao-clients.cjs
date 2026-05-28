const fs = require("node:fs");
const path = require("node:path");
const xlsx = require("xlsx");
const { createClient, ROOT_DIR, writeCsv } = require("./common.cjs");

const DEFAULT_FILE = "C:/Users/Administrator/Desktop/CMS数据/preprocessed_clients_merged_review.xlsx";
const CUSTOMER_CACHE_KEY = "form.customers.v1";
const IMPORT_TAG = "bohao-clients-merged-full";
const ACTOR = "bohao-client-import";

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find((item) => item.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function nullableText(value) {
  const clean = text(value);
  return clean ? clean : null;
}

function requiredText(value, fallback) {
  return text(value) || fallback;
}

function numberValue(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeJson(value) {
  return JSON.stringify(value);
}

function sourceFile() {
  const requested = argValue("file", DEFAULT_FILE);
  if (fs.existsSync(requested)) return requested;
  throw new Error(`Missing preprocessed clients workbook: ${requested}`);
}

function readMergedCustomers(filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets["Merged Customers"];
  if (!sheet) {
    throw new Error(`Workbook does not contain a "Merged Customers" sheet: ${filePath}`);
  }
  return xlsx.utils.sheet_to_json(sheet, { defval: null });
}

function customerStatus(row) {
  const values = text(row.source_blocked_values)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.some((item) => Number(item) > 0) ? "Blocked" : "Active";
}

function normalizedBusinessType(row) {
  if (text(row.client_type).toUpperCase() === "B2C") return null;
  const allowed = new Set(["ESP AUTONOMO", "ESP EMPRESA", "EU VAT", "EU LOCAL", "INTERNATIONAL"]);
  const candidate = text(row.business_type).toUpperCase();
  if (allowed.has(candidate)) return candidate;
  return "INTERNATIONAL";
}

function normalizeCustomer(row, index) {
  const clientType = text(row.client_type).toUpperCase() === "B2C" ? "B2C" : "B2B";
  const businessType = normalizedBusinessType(row);
  const customerCode = requiredText(row.customer_code, `BOH-CLIENT-${index + 1}`);
  const displayName = requiredText(row.name, requiredText(row.business_name, customerCode));
  const businessName =
    clientType === "B2B" ? requiredText(row.business_name, displayName) : null;
  const vatNumber =
    clientType === "B2B"
      ? businessType === "INTERNATIONAL"
        ? nullableText(row.vat_number)
        : requiredText(row.vat_number, "PENDING")
      : null;

  return {
    customerCode,
    clientType,
    name: displayName,
    businessType,
    businessName,
    vatNumber,
    email: nullableText(row.email),
    status: customerStatus(row),
  };
}

function noteParts(row) {
  return [
    `Import tag: ${IMPORT_TAG}`,
    `Import status: ${text(row.import_status) || "UNKNOWN"}`,
    text(row.primary_source_empresa_id)
      ? `Primary Bohao EmpresaID: ${text(row.primary_source_empresa_id)}`
      : null,
    text(row.merged_source_empresa_ids)
      ? `Merged Bohao EmpresaIDs: ${text(row.merged_source_empresa_ids)}`
      : null,
    text(row.source_rows) ? `Source rows: ${text(row.source_rows)}` : null,
    text(row.merge_reason) ? `Merge reason: ${text(row.merge_reason)}` : null,
    text(row.vat_status) ? `VAT status: ${text(row.vat_status)}` : null,
    text(row.phone_status) ? `Phone status: ${text(row.phone_status)}` : null,
    text(row.address_status) ? `Address status: ${text(row.address_status)}` : null,
    text(row.address_corrections) ? `Address corrections: ${text(row.address_corrections)}` : null,
    text(row.address_unresolved) ? `Address unresolved: ${text(row.address_unresolved)}` : null,
    text(row.secondary_phones) ? `Secondary phones: ${text(row.secondary_phones)}` : null,
    text(row.needs_invoice_source_values)
      ? `Needs invoice source values: ${text(row.needs_invoice_source_values)}`
      : null,
    text(row.tax_mode) ? `Tax mode review: ${text(row.tax_mode)}` : null,
    text(row.source_invoice_percent_values)
      ? `Source invoice percent values: ${text(row.source_invoice_percent_values)}`
      : null,
    text(row.source_discount_values)
      ? `Source discount values: ${text(row.source_discount_values)}`
      : null,
    text(row.source_blocked_values)
      ? `Source blocked values: ${text(row.source_blocked_values)}`
      : null,
    text(row.issue_summary) ? `Issue summary: ${text(row.issue_summary)}` : null,
    text(row.notes) ? `Source notes: ${text(row.notes)}` : null,
  ].filter(Boolean);
}

function customerNotes(row) {
  return noteParts(row).join(" | ");
}

function addressFromRow(row) {
  const line1 = text(row.fiscal_address_line_1);
  const line2 = text(row.fiscal_address_line_2) || text(row.fiscal_city);
  const postalCode = text(row.fiscal_postal_code);
  const province = text(row.fiscal_province_state) || text(row.fiscal_city);
  const country = text(row.fiscal_country);

  if (!line1 && !line2 && !postalCode && !province && !country) {
    return null;
  }

  return {
    line1: requiredText(line1 || line2, "Pending"),
    line2: nullableText(line2 && line2 !== line1 ? line2 : ""),
    additionalInfo: nullableText(row.address_unresolved),
    postalCode: requiredText(postalCode, "00000"),
    provinceState: requiredText(province, "Pending"),
    country: requiredText(country, "Spain"),
  };
}

function phoneFromRow(row) {
  const phoneNumber = text(row.phone_number);
  if (!phoneNumber) return null;
  return {
    countryCode: requiredText(row.phone_country_code, "+34"),
    phoneNumber,
  };
}

function toMs(value) {
  if (!value) return Date.now();
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function mapAddress(row, prefix) {
  if (!row[`${prefix}_address_line_1`]) return undefined;
  return {
    line1: row[`${prefix}_address_line_1`] ?? "",
    line2: row[`${prefix}_address_line_2`] ?? "",
    additionalInfo: row[`${prefix}_additional_info`] ?? "",
    postalCode: row[`${prefix}_postal_code`] ?? "",
    provinceState: row[`${prefix}_province_state`] ?? "",
    country: row[`${prefix}_country`] ?? "",
  };
}

async function customersCachePayload(client) {
  const result = await client.query("SELECT * FROM cms.v_customer_export ORDER BY created_at DESC");
  return result.rows.map((row) => {
    const fiscalAddress = mapAddress(row, "fiscal");
    const logisticsAddress = mapAddress(row, "logistics");
    return {
      id: String(row.customer_id),
      customerCode: row.customer_code ?? "",
      clientType: row.client_type ?? "B2B",
      name: row.name ?? "",
      surname: row.surname ?? "",
      businessType: row.business_type ?? undefined,
      businessName: row.business_name ?? "",
      email: row.email ?? "",
      vatNumber: row.vat_number ?? "",
      phoneCountryCode: row.primary_phone_country_code ?? "",
      phoneNumber: row.primary_phone_number ?? "",
      phone: row.primary_phone ?? "",
      fiscalAddress,
      logisticsAddress,
      address: fiscalAddress
        ? [fiscalAddress.line1, fiscalAddress.postalCode, fiscalAddress.provinceState, fiscalAddress.country]
            .filter(Boolean)
            .join(", ")
        : "",
      taxRate: row.tax_rate_percent == null ? undefined : numberValue(row.tax_rate_percent, 0),
      createdAt: toMs(row.created_at),
      updatedAt: toMs(row.updated_at),
    };
  });
}

async function refreshCustomerCache(client) {
  const customers = await customersCachePayload(client);
  await client.query(
    `
      INSERT INTO cms.app_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
    `,
    [CUSTOMER_CACHE_KEY, safeJson(customers)],
  );
  return customers.length;
}

async function assertSafeToReplaceBohaoCustomers(client) {
  const orderRefs = await client.query(`
    SELECT count(*)::int AS count
    FROM cms.orders o
    JOIN cms.customers c ON c.id = o.customer_id
    WHERE c.customer_code LIKE 'BOH-%'
  `);
  const invoiceRefs = await client.query(`
    SELECT count(*)::int AS count
    FROM cms.invoices i
    JOIN cms.customers c ON c.id = i.customer_id
    WHERE c.customer_code LIKE 'BOH-%'
  `);
  if ((orderRefs.rows[0]?.count ?? 0) > 0 || (invoiceRefs.rows[0]?.count ?? 0) > 0) {
    throw new Error(
      "Refusing to replace BOH customers because orders or invoices still reference them. Review those documents first.",
    );
  }
}

async function deleteExistingBohaoCustomers(client) {
  await client.query("DELETE FROM cms.customer_phones cp USING cms.customers c WHERE cp.customer_id = c.id AND c.customer_code LIKE 'BOH-%'");
  await client.query("DELETE FROM cms.customer_addresses ca USING cms.customers c WHERE ca.customer_id = c.id AND c.customer_code LIKE 'BOH-%'");
  const result = await client.query("DELETE FROM cms.customers WHERE customer_code LIKE 'BOH-%'");
  return result.rowCount;
}

async function upsertImportedAddress(client, customerId, customerCode, type, address, sameAsOtherAddress = false) {
  if (!address) return;
  const suffix = type.toUpperCase();
  await client.query(
    `
      INSERT INTO cms.customer_addresses (
        legacy_id, address_code, customer_id, address_type, address_line_1,
        address_line_2, additional_info, postal_code, province_state, country,
        is_default, same_as_other_address
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
      ON CONFLICT (address_code) DO UPDATE SET
        customer_id = EXCLUDED.customer_id,
        address_line_1 = EXCLUDED.address_line_1,
        address_line_2 = EXCLUDED.address_line_2,
        additional_info = EXCLUDED.additional_info,
        postal_code = EXCLUDED.postal_code,
        province_state = EXCLUDED.province_state,
        country = EXCLUDED.country,
        is_default = true,
        same_as_other_address = EXCLUDED.same_as_other_address,
        updated_at = now()
    `,
    [
      `bohao-customer-address:${customerCode}:${suffix}`,
      `${customerCode}-${suffix}`,
      customerId,
      type,
      address.line1,
      address.line2,
      address.additionalInfo,
      address.postalCode,
      address.provinceState,
      address.country,
      sameAsOtherAddress,
    ],
  );
}

async function insertCustomer(client, row, index) {
  const normalized = normalizeCustomer(row, index);
  const legacyId = `bohao-customer:${text(row.primary_source_empresa_id) || normalized.customerCode}`;
  const customer = await client.query(
    `
      INSERT INTO cms.customers (
        legacy_id, customer_code, client_type, name, business_type, business_name,
        email, vat_number, tax_rate_percent, status, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10)
      ON CONFLICT (customer_code) DO UPDATE SET
        legacy_id = EXCLUDED.legacy_id,
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
      legacyId,
      normalized.customerCode,
      normalized.clientType,
      normalized.name,
      normalized.businessType,
      normalized.businessName,
      normalized.email,
      normalized.vatNumber,
      normalized.status,
      customerNotes(row),
    ],
  );

  const customerId = customer.rows[0].id;
  const address = addressFromRow(row);
  if (address) {
    await upsertImportedAddress(client, customerId, normalized.customerCode, "Fiscal", address, false);
    await upsertImportedAddress(client, customerId, normalized.customerCode, "Logistics", address, true);
  }

  const phone = phoneFromRow(row);
  if (phone) {
    await client.query(
      `
        INSERT INTO cms.customer_phones (
          legacy_id, phone_code, customer_id, country_code, phone_number, is_primary
        )
        VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (phone_code) DO UPDATE SET
          customer_id = EXCLUDED.customer_id,
          country_code = EXCLUDED.country_code,
          phone_number = EXCLUDED.phone_number,
          is_primary = true,
          updated_at = now()
      `,
      [
        `bohao-customer-phone:${normalized.customerCode}`,
        `${normalized.customerCode}-PHONE`,
        customerId,
        phone.countryCode,
        phone.phoneNumber,
      ],
    );
  }

  return {
    source_rows: text(row.source_rows),
    merged_group_id: text(row.merged_group_id),
    customer_code: normalized.customerCode,
    import_status: text(row.import_status),
    merged_count: numberValue(row.merged_count, 1),
    source_empresa_ids: text(row.merged_source_empresa_ids),
    name: normalized.name,
    business_type: normalized.businessType ?? "",
    vat_number: normalized.vatNumber ?? "",
    email: normalized.email ?? "",
    phone: phone ? `${phone.countryCode} ${phone.phoneNumber}` : "",
    fiscal_address: address
      ? [address.line1, address.line2, address.postalCode, address.provinceState, address.country]
          .filter(Boolean)
          .join(", ")
      : "",
    address_status: text(row.address_status),
    issue_summary: text(row.issue_summary),
  };
}

function reportFields() {
  return [
    { name: "source_rows" },
    { name: "merged_group_id" },
    { name: "customer_code" },
    { name: "import_status" },
    { name: "merged_count" },
    { name: "source_empresa_ids" },
    { name: "name" },
    { name: "business_type" },
    { name: "vat_number" },
    { name: "email" },
    { name: "phone" },
    { name: "fiscal_address" },
    { name: "address_status" },
    { name: "issue_summary" },
  ];
}

async function main() {
  const filePath = sourceFile();
  const allRows = readMergedCustomers(filePath);
  const skippedRows = allRows.filter((row) => text(row.import_status) === "REVIEW_HIGH");
  const importRows = allRows.filter((row) => text(row.import_status) !== "REVIEW_HIGH");

  if (!hasFlag("yes")) {
    throw new Error("This import replaces existing BOH customers. Re-run with --yes after confirming.");
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const reportDir = path.join(ROOT_DIR, "exports", "import-reports", `bohao-clients-${timestamp}`);
  fs.mkdirSync(reportDir, { recursive: true });

  const client = createClient();
  await client.connect();

  let deletedCustomers = 0;
  let refreshedCacheCount = 0;
  const report = [];

  try {
    await client.query("BEGIN");
    await assertSafeToReplaceBohaoCustomers(client);
    deletedCustomers = await deleteExistingBohaoCustomers(client);

    for (let i = 0; i < importRows.length; i += 1) {
      report.push(await insertCustomer(client, importRows[i], i));
    }

    refreshedCacheCount = await refreshCustomerCache(client);

    await client.query(
      `
        INSERT INTO cms.audit_log (actor, action, entity_table, entity_id, after_data)
        VALUES ($1, 'full_client_import', 'customers', $2, $3::jsonb)
      `,
      [
        ACTOR,
        IMPORT_TAG,
        safeJson({
          sourceFile: filePath,
          rowsRead: allRows.length,
          rowsImported: report.length,
          rowsSkippedHighRisk: skippedRows.length,
          deletedExistingBohaoCustomers: deletedCustomers,
          refreshedCacheCount,
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

  const importedPath = writeCsv(
    path.relative(ROOT_DIR, path.join(reportDir, "bohao-client-imported.csv")),
    report,
    reportFields(),
  );
  const skippedPath = writeCsv(
    path.relative(ROOT_DIR, path.join(reportDir, "bohao-client-skipped-review-high.csv")),
    skippedRows.map((row) => ({
      source_rows: text(row.source_rows),
      merged_group_id: text(row.merged_group_id),
      customer_code: text(row.customer_code),
      import_status: text(row.import_status),
      merged_count: numberValue(row.merged_count, 1),
      source_empresa_ids: text(row.merged_source_empresa_ids),
      name: text(row.name),
      business_type: text(row.business_type),
      vat_number: text(row.vat_number),
      email: text(row.email),
      phone: `${text(row.phone_country_code)} ${text(row.phone_number)}`.trim(),
      fiscal_address: [
        text(row.fiscal_address_line_1),
        text(row.fiscal_address_line_2) || text(row.fiscal_city),
        text(row.fiscal_postal_code),
        text(row.fiscal_province_state),
        text(row.fiscal_country),
      ]
        .filter(Boolean)
        .join(", "),
      address_status: text(row.address_status),
      issue_summary: text(row.issue_summary),
    })),
    reportFields(),
  );

  const summary = {
    sourceFile: filePath,
    rowsRead: allRows.length,
    rowsImported: report.length,
    rowsSkippedHighRisk: skippedRows.length,
    deletedExistingBohaoCustomers: deletedCustomers,
    refreshedCacheCount,
    importedPath,
    skippedPath,
  };
  fs.writeFileSync(path.join(reportDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
