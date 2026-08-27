import { readFile } from "node:fs/promises";
import pg from "pg";
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  await pool.query(
    await readFile(
      new URL("../migrations/001_platform.sql", import.meta.url),
      "utf8",
    ),
  );
  console.log("Database migration complete");
} finally {
  await pool.end();
}
