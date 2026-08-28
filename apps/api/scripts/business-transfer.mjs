#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hash } from "@node-rs/argon2";
import pg from "pg";

const FORMAT = "infinite-canvas-business-transfer/v1";
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const EXCLUDED_TABLES = new Set([
  "schema_migrations",
  "sessions",
  "generation_worker_heartbeats",
  "model_channels",
  "upstream_models",
  "logical_model_bindings",
  "workflow_api_tokens",
  "workflow_api_invocations",
  "workflow_api_audit_events",
  "admin_mfa_credentials",
  "admin_mfa_recovery_codes",
  "billing_payment_events",
  "media_blob_gc",
]);
const SENSITIVE_KEY =
  /(?:password|secret|authorization|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)/i;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

async function main() {
  const [command, fileArg, ...flags] = process.argv.slice(2);
  if (!command || !fileArg || !["export", "import", "verify"].includes(command))
    usage();
  const file = resolve(fileArg);
  if (command === "verify") {
    const bundle = await readBundle(file);
    verifyBundle(bundle);
    console.log(
      `Business transfer verified: ${bundle.tables.length} tables, ${bundle.rowCount} rows`,
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  try {
    if (command === "export") await exportBusiness(pool, file);
    else await importBusiness(pool, file, flags.includes("--allow-nonempty"));
  } finally {
    await pool.end();
  }
}

async function exportBusiness(database, target) {
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const names = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    const tables = [];
    const lockedPassword = await hash(randomBytes(32).toString("base64url"));
    for (const { tablename } of names.rows) {
      if (EXCLUDED_TABLES.has(tablename)) continue;
      const columns = await client.query(
        "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
        [tablename],
      );
      const result = await client.query(
        `SELECT * FROM ${quoteIdent(tablename)}`,
      );
      const rows = result.rows.map((row) =>
        sanitizeRow(tablename, row, lockedPassword),
      );
      tables.push({ name: tablename, columns: columns.rows, rows });
    }
    await client.query("COMMIT");
    const payload = {
      format: FORMAT,
      exportedAt: new Date().toISOString(),
      tables,
    };
    const bundle = {
      ...payload,
      rowCount: tables.reduce((sum, table) => sum + table.rows.length, 0),
      sha256: digest(payload),
    };
    const temp = `${target}.tmp-${process.pid}`;
    await writeFile(temp, `${JSON.stringify(bundle)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temp, target);
    await chmod(target, 0o600).catch(() => undefined);
    console.log(
      `Business transfer exported: ${bundle.rowCount} rows -> ${target}`,
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function importBusiness(database, source, allowNonempty) {
  if (process.env.CONFIRM_BUSINESS_IMPORT !== "IMPORT")
    throw new Error("Set CONFIRM_BUSINESS_IMPORT=IMPORT");
  const bundle = await readBundle(source);
  verifyBundle(bundle);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    if (!allowNonempty) {
      for (const table of bundle.tables) {
        const count = await client.query(
          `SELECT count(*)::int AS count FROM ${quoteIdent(table.name)}`,
        );
        if (count.rows[0].count)
          throw new Error(
            `Target table is not empty: ${table.name}; use an isolated database or --allow-nonempty`,
          );
      }
    }
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of bundle.tables) {
      assertTableShape(table);
      const columns = table.columns.map((column) => column.column_name);
      const sql = `INSERT INTO ${quoteIdent(table.name)} (${columns.map(quoteIdent).join(",")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(",")})`;
      for (const row of table.rows)
        await client.query(
          sql,
          columns.map((column) => row[column]),
        );
    }
    await validateForeignKeys(
      client,
      new Set(bundle.tables.map((table) => table.name)),
    );
    await client.query("COMMIT");
    console.log(
      `Business transfer imported: ${bundle.rowCount} rows from ${source}`,
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function validateForeignKeys(client, importedTables) {
  const constraints = await client.query(`
    SELECT c.conname, child.relname AS child_table, parent.relname AS parent_table,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY key(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key.attnum ORDER BY key.ord)::text[] child_columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY key(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=key.attnum ORDER BY key.ord)::text[] parent_columns
    FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_class parent ON parent.oid=c.confrelid
    JOIN pg_namespace n ON n.oid=child.relnamespace WHERE c.contype='f' AND n.nspname='public'`);
  for (const fk of constraints.rows) {
    if (!importedTables.has(fk.child_table)) continue;
    if (!importedTables.has(fk.parent_table))
      throw new Error(
        `Business table ${fk.child_table} depends on excluded table ${fk.parent_table}`,
      );
    const pairs = fk.child_columns
      .map(
        (column, index) =>
          `p.${quoteIdent(fk.parent_columns[index])}=c.${quoteIdent(column)}`,
      )
      .join(" AND ");
    const present = fk.child_columns
      .map((column) => `c.${quoteIdent(column)} IS NOT NULL`)
      .join(" AND ");
    const missing = await client.query(
      `SELECT 1 FROM ${quoteIdent(fk.child_table)} c WHERE ${present} AND NOT EXISTS (SELECT 1 FROM ${quoteIdent(fk.parent_table)} p WHERE ${pairs}) LIMIT 1`,
    );
    if (missing.rowCount)
      throw new Error(`Foreign key validation failed: ${fk.conname}`);
  }
}

function sanitizeRow(table, row, lockedPassword) {
  if (table === "users")
    return {
      ...row,
      email: `${row.id}@redacted.invalid`,
      name: "Redacted user",
      password_hash: lockedPassword,
    };
  return sanitizeValue(row);
}

export function sanitizeValue(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === "object" && !Buffer.isBuffer(value))
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizeValue(child, childKey),
      ]),
    );
  return value;
}

function verifyBundle(bundle) {
  if (
    bundle?.format !== FORMAT ||
    !Array.isArray(bundle.tables) ||
    !Number.isSafeInteger(bundle.rowCount) ||
    !/^[a-f0-9]{64}$/.test(bundle.sha256 || "")
  )
    throw new Error("Invalid business transfer format");
  for (const table of bundle.tables) assertTableShape(table);
  if (
    bundle.rowCount !==
    bundle.tables.reduce((sum, table) => sum + table.rows.length, 0)
  )
    throw new Error("Business transfer row count mismatch");
  const payload = {
    format: bundle.format,
    exportedAt: bundle.exportedAt,
    tables: bundle.tables,
  };
  if (digest(payload) !== bundle.sha256)
    throw new Error("Business transfer checksum mismatch");
}

function assertTableShape(table) {
  if (
    !table ||
    !/^[a-z][a-z0-9_]*$/.test(table.name) ||
    EXCLUDED_TABLES.has(table.name) ||
    !Array.isArray(table.columns) ||
    !Array.isArray(table.rows)
  )
    throw new Error("Invalid business transfer table");
  if (
    !table.columns.every((column) =>
      /^[a-z][a-z0-9_]*$/.test(column.column_name),
    )
  )
    throw new Error(`Invalid columns for ${table.name}`);
}

async function readBundle(source) {
  const data = await readFile(source);
  if (data.byteLength > MAX_IMPORT_BYTES)
    throw new Error("Business transfer exceeds 512MiB limit");
  return JSON.parse(data.toString("utf8"));
}

function digest(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
function quoteIdent(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value))
    throw new Error(`Unsafe identifier: ${value}`);
  return `"${value}"`;
}
function usage() {
  console.error(
    "usage: business-transfer.mjs export|verify|import FILE [--allow-nonempty]",
  );
  process.exit(2);
}
