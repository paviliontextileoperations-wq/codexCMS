const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT_DIR, "database", "migrations");

function loadDotEnv() {
  const envPath = path.join(ROOT_DIR, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsAt = trimmed.indexOf("=");
    if (equalsAt === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsAt).trim();
    let value = trimmed.slice(equalsAt + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function databaseUrl() {
  loadDotEnv();
  return process.env.DATABASE_URL;
}

function requireDatabaseUrl() {
  const url = databaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and set a PostgreSQL connection string.",
    );
  }
  return url;
}

function clientConfig() {
  const connectionString = requireDatabaseUrl();
  const sslEnabled = process.env.PGSSL === "true";
  const rejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED !== "false";

  return {
    connectionString,
    ssl: sslEnabled ? { rejectUnauthorized } : undefined,
  };
}

function createClient() {
  return new Client(clientConfig());
}

function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Missing migrations directory: ${MIGRATIONS_DIR}`);
  }

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort()
    .map((filename) => {
      const fullPath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(fullPath, "utf8");
      return {
        filename,
        fullPath,
        sql,
        checksum: sha256(sql),
      };
    });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath, rows, fields) {
  const outputPath = path.resolve(process.cwd(), filePath);
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  const header = fields.map((field) => csvEscape(field.name)).join(",");
  const lines = rows.map((row) =>
    fields.map((field) => csvEscape(row[field.name])).join(","),
  );
  fs.writeFileSync(outputPath, `${[header, ...lines].join("\n")}\n`, "utf8");
  return outputPath;
}

function parseMaybeJson(value, fallback) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return JSON.parse(value);
  }
  return fallback;
}

function nullIfBlank(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDate(value) {
  if (!value) {
    return new Date();
  }
  if (typeof value === "number") {
    return new Date(value);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

module.exports = {
  ROOT_DIR,
  MIGRATIONS_DIR,
  createClient,
  databaseUrl,
  migrationFiles,
  nullIfBlank,
  parseMaybeJson,
  requireDatabaseUrl,
  sha256,
  toDate,
  toNumber,
  writeCsv,
};
