const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

function loadDotEnv() {
  const envPaths = [
    path.resolve(__dirname, "..", ".env"),
    path.resolve(process.resourcesPath ?? "", ".env"),
    path.resolve(path.dirname(process.execPath ?? ""), ".env"),
  ];

  for (const envPath of envPaths) {
    if (!envPath || !fs.existsSync(envPath)) {
      continue;
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
}

function connectionConfig() {
  loadDotEnv();
  if (!process.env.DATABASE_URL) {
    return null;
  }

  return {
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.PGSSL === "true"
        ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" }
        : undefined,
  };
}

async function databaseHealth() {
  loadDotEnv();
  if (process.env.API_BASE_URL) {
    const baseUrl = process.env.API_BASE_URL.replace(/\/+$/, "");
    const headers = {};
    if (process.env.API_KEY) {
      headers["x-api-key"] = process.env.API_KEY;
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { headers });
      const body = await response.json().catch(() => ({}));
      return {
        ok: response.ok && body.ok !== false,
        configured: true,
        message: response.ok ? "Connected through cloud API." : body.message || response.statusText,
        databaseName: body.database?.databaseName,
        userName: "cloud-api",
      };
    } catch (error) {
      return {
        ok: false,
        configured: true,
        message: error.message,
      };
    }
  }

  const config = connectionConfig();
  if (!config) {
    return {
      ok: false,
      configured: false,
      message: "DATABASE_URL is not configured.",
    };
  }

  const client = new Client(config);
  try {
    await client.connect();
    const result = await client.query(
      "SELECT current_database() AS database_name, current_user AS user_name",
    );
    return {
      ok: true,
      configured: true,
      databaseName: result.rows[0].database_name,
      userName: result.rows[0].user_name,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      message: error.message,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

function createDatabaseClient() {
  const config = connectionConfig();
  if (!config) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return new Client(config);
}

module.exports = {
  createDatabaseClient,
  databaseHealth,
  loadDotEnv,
};
