# CMS PostgreSQL database

This folder contains the first real PostgreSQL backend layer for the CMS desktop
app. It is designed for PostgreSQL 14+ and can run locally first, then move to
AWS RDS PostgreSQL later.

## What is included

- Product database for clothing:
  - `products`: one style/model, for example `P001`
  - `product_compositions`: material percentages, enforced to total 100 percent
  - `product_colours`: style colors and color images
  - `product_sizes`: style sizes and optional weight
  - `skus`: sellable units, one per style + color + size
  - `measurement_templates`: category measurement definitions from the Excel file
  - `product_size_measurements`: size measurements A-H
  - `product_shein`: optional SHEIN channel fields
- Customer database:
  - `customers`: B2B/B2C identity, tax, VAT, status
  - `customer_addresses`: fiscal and logistics addresses
  - `customer_phones`: primary and additional phone numbers
- Order database:
  - `orders`: invoice, delivery note, receipt, channel, payment state
  - `order_lines`: sold SKUs and price snapshots
  - `order_payments`: payments and references
  - `order_returns`: returns and refund information
  - `inventory_movements`: stock audit trail
- Export views:
  - `v_product_sku_export`
  - `v_product_measurement_export`
  - `v_customer_export`
  - `v_order_export`
  - `v_order_line_export`
  - `v_inventory_export`

## Local setup

1. Install PostgreSQL 14 or newer.
2. Create a database and user:

```sql
CREATE DATABASE cms;
CREATE USER cms_app WITH PASSWORD 'change_me';
GRANT ALL PRIVILEGES ON DATABASE cms TO cms_app;
```

3. Copy `.env.example` to `.env` and set `DATABASE_URL`.
4. Run migrations:

```bash
npm run db:migrate
```

5. Check the schema:

```bash
npm run db:check
```

## AWS RDS setup

Use Amazon RDS for PostgreSQL. Recommended first production settings:

- PostgreSQL 14 or newer.
- Private subnet if the app will connect through VPN or a backend API.
- Public access only for early testing, restricted by security group IP.
- Automated backups enabled.
- Storage autoscaling enabled.
- SSL enabled.

For AWS RDS, `.env` usually needs:

```bash
DATABASE_URL=postgres://cms_app:strong_password@your-rds-endpoint.amazonaws.com:5432/cms
PGSSL=true
PGSSL_REJECT_UNAUTHORIZED=true
```

The first migration creates `pgcrypto` and `citext`. On AWS RDS this should be
run by a user with enough privileges to create extensions.

## Import existing desktop data

The current desktop app stores data in browser `localStorage`. Export the data
as JSON with these keys:

```json
{
  "form.products.v1": "[]",
  "form.customers.v1": "[]",
  "form.sales.v1": "[]",
  "form.inventoryMovements.v1": "[]"
}
```

Then import it:

```bash
npm run db:import:localstorage -- ./localstorage-export.json
```

The importer also accepts this shape:

```json
{
  "products": [],
  "customers": [],
  "sales": [],
  "inventoryMovements": []
}
```

Legacy B2B customers with incomplete VAT/business fields are imported with
minimal placeholder values so they still satisfy the stricter customer database
rules. Review `v_customer_export` after importing.

## CSV exports

Use the export views for downloadable files:

```bash
npm run db:export -- v_product_sku_export ./exports/products.csv
npm run db:export -- v_customer_export ./exports/customers.csv
npm run db:export -- v_order_export ./exports/orders.csv
npm run db:export -- v_order_line_export ./exports/order-lines.csv
```

The CSV files are written from PostgreSQL data, not localStorage.

## Migration rules

- Do not edit an already applied migration in production.
- Add a new numbered migration instead, for example `004_add_column.sql`.
- `scripts/db/migrate.cjs` stores a SHA-256 checksum in `cms.schema_migrations`
  and stops if an already applied migration changes.
