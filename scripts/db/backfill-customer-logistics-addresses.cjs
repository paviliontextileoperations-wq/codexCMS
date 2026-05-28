const { createClient, toDate, toNumber } = require("./common.cjs");

const CUSTOMER_CACHE_KEY = "form.customers.v1";

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
      taxRate: row.tax_rate_percent == null ? undefined : toNumber(row.tax_rate_percent, 0),
      createdAt: toDate(row.created_at).getTime(),
      updatedAt: toDate(row.updated_at).getTime(),
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
    [CUSTOMER_CACHE_KEY, JSON.stringify(customers)],
  );
  return customers.length;
}

async function run() {
  const client = createClient();
  await client.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(`
      UPDATE cms.customer_addresses logistics
      SET
        address_line_1 = fiscal.address_line_1,
        address_line_2 = fiscal.address_line_2,
        additional_info = fiscal.additional_info,
        postal_code = fiscal.postal_code,
        province_state = fiscal.province_state,
        country = fiscal.country,
        is_default = true,
        same_as_other_address = true,
        updated_at = now()
      FROM cms.customer_addresses fiscal
      WHERE logistics.customer_id = fiscal.customer_id
        AND lower(logistics.address_type) = 'logistics'
        AND lower(fiscal.address_type) = 'fiscal'
        AND nullif(trim(coalesce(fiscal.address_line_1, '')), '') IS NOT NULL
        AND nullif(trim(coalesce(fiscal.country, '')), '') IS NOT NULL
        AND (
          nullif(trim(coalesce(logistics.address_line_1, '')), '') IS NULL
          OR nullif(trim(coalesce(logistics.country, '')), '') IS NULL
        )
    `);

    const inserted = await client.query(`
      WITH fiscal AS (
        SELECT
          c.id AS customer_id,
          c.customer_code,
          f.address_line_1,
          f.address_line_2,
          f.additional_info,
          f.postal_code,
          f.province_state,
          f.country
        FROM cms.customers c
        JOIN cms.customer_addresses f
          ON f.customer_id = c.id
         AND lower(f.address_type) = 'fiscal'
        WHERE nullif(trim(coalesce(f.address_line_1, '')), '') IS NOT NULL
          AND nullif(trim(coalesce(f.country, '')), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM cms.customer_addresses l
            WHERE l.customer_id = c.id
              AND lower(l.address_type) = 'logistics'
              AND nullif(trim(coalesce(l.address_line_1, '')), '') IS NOT NULL
              AND nullif(trim(coalesce(l.country, '')), '') IS NOT NULL
          )
      )
      INSERT INTO cms.customer_addresses (
        legacy_id, address_code, customer_id, address_type, address_line_1,
        address_line_2, additional_info, postal_code, province_state, country,
        is_default, same_as_other_address
      )
      SELECT
        'backfill-logistics:' || fiscal.customer_id::text,
        coalesce(nullif(fiscal.customer_code, ''), fiscal.customer_id::text) || '-LOGISTICS',
        fiscal.customer_id,
        'Logistics',
        fiscal.address_line_1,
        fiscal.address_line_2,
        fiscal.additional_info,
        fiscal.postal_code,
        fiscal.province_state,
        fiscal.country,
        true,
        true
      FROM fiscal
      ON CONFLICT (address_code) DO UPDATE SET
        address_line_1 = EXCLUDED.address_line_1,
        address_line_2 = EXCLUDED.address_line_2,
        additional_info = EXCLUDED.additional_info,
        postal_code = EXCLUDED.postal_code,
        province_state = EXCLUDED.province_state,
        country = EXCLUDED.country,
        same_as_other_address = true,
        updated_at = now()
      RETURNING customer_id
    `);

    const cached = await refreshCustomerCache(client);
    await client.query("COMMIT");
    console.log(`Updated existing logistics addresses: ${updated.rowCount}`);
    console.log(`Inserted missing logistics addresses: ${inserted.rowCount}`);
    console.log(`Refreshed customer sync cache: ${cached}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
