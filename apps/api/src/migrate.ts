import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const assetStorageProvider = process.env.BLOB_STORAGE_DRIVER?.trim() || "local";
if (!/^[a-z][a-z0-9_-]{0,39}$/.test(assetStorageProvider))
  throw new Error("BLOB_STORAGE_DRIVER is invalid");
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();
  for (const file of files) await applyMigration(file, directory);
  console.log(`Database migrations complete (${files.length})`);
} finally {
  await pool.end();
}

async function applyMigration(file: string, directory: URL) {
  const sql = await readFile(new URL(file, directory), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const existing = await pool.query<{ checksum: string }>(
    "SELECT checksum FROM schema_migrations WHERE id=$1",
    [file],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].checksum !== checksum)
      throw new Error(`Applied migration checksum mismatch: ${file}`);
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.asset_storage_provider',$1,true)",
      [assetStorageProvider],
    );
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations(id,checksum) VALUES($1,$2)",
      [file, checksum],
    );
    await client.query("COMMIT");
    console.log(`Applied ${file}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
