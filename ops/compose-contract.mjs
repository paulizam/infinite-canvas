import { readFileSync } from "node:fs";

const compose = readFileSync("docker-compose.yml", "utf8");
const required = [
  ["postgres service", /^  postgres:\s*$/m],
  [
    "migration completion dependency",
    /migrate:\s*\{ condition: service_completed_successfully \}/,
  ],
  ["API health dependency", /api:\s*\{ condition: service_healthy \}/],
  [
    "PostgreSQL healthcheck",
    /pg_isready -U \$\$POSTGRES_USER -d \$\$POSTGRES_DB/,
  ],
  ["API healthcheck", /fetch\('http:\/\/127\.0\.0\.1:3001\/health'\)/],
  [
    "web healthcheck",
    /wget -q -O \/dev\/null http:\/\/127\.0\.0\.1:3000\/health/,
  ],
  [
    "migration storage provider",
    /migrate:[\s\S]*?BLOB_STORAGE_DRIVER: \$\{BLOB_STORAGE_DRIVER:-local\}/,
  ],
  [
    "API storage provider",
    /api:[\s\S]*?BLOB_STORAGE_DRIVER: \$\{BLOB_STORAGE_DRIVER:-local\}/,
  ],
  [
    "S3 secret forwarding",
    /S3_SECRET_ACCESS_KEY: \$\{S3_SECRET_ACCESS_KEY:-\}/,
  ],
  ["asset volume", /asset-data:\/data\/assets/],
];

for (const [name, pattern] of required)
  if (!pattern.test(compose))
    throw new Error(`Compose contract missing: ${name}`);
if (/BLOB_STORAGE_DRIVER:\s+local\s*$/m.test(compose))
  throw new Error("Compose must not hard-code the asset storage provider");
console.log(`Compose contract verified (${required.length})`);

const backup = readFileSync("ops/backup.sh", "utf8");
const restore = readFileSync("ops/restore.sh", "utf8");
if (
  !backup.includes("$FILE.assets.tar.gz") ||
  !restore.includes("$FILE.assets.tar.gz")
)
  throw new Error("Local asset backup/restore pair is incomplete");
if (!restore.includes("CONFIRM_RESTORE=RESTORE"))
  throw new Error("Restore confirmation guard is missing");
