const { createClient, migrationFiles } = require("./common.cjs");

async function ensureMigrationTable(client) {
  await client.query("CREATE SCHEMA IF NOT EXISTS cms");
  await client.query(`
    CREATE TABLE IF NOT EXISTS cms.schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const files = migrationFiles();

  if (dryRun) {
    console.log("Dry run. Migrations found:");
    for (const file of files) {
      console.log(`- ${file.filename} ${file.checksum.slice(0, 12)}`);
    }
    return;
  }

  const client = createClient();
  await client.connect();

  try {
    await ensureMigrationTable(client);

    for (const file of files) {
      const existing = await client.query(
        "SELECT checksum FROM cms.schema_migrations WHERE filename = $1",
        [file.filename],
      );

      if (existing.rowCount > 0) {
        const appliedChecksum = existing.rows[0].checksum;
        if (appliedChecksum !== file.checksum) {
          throw new Error(
            `Migration checksum mismatch for ${file.filename}. Applied ${appliedChecksum}, current ${file.checksum}.`,
          );
        }
        console.log(`Skipping already applied migration ${file.filename}`);
        continue;
      }

      console.log(`Applying migration ${file.filename}`);
      await client.query("BEGIN");
      try {
        await client.query(file.sql);
        await client.query(
          "INSERT INTO cms.schema_migrations (filename, checksum) VALUES ($1, $2)",
          [file.filename, file.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("Database migrations are up to date.");
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
