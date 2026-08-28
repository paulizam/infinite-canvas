import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const directory = new URL("../apps/api/migrations/", import.meta.url);
const target = new URL("./migration-manifest.json", import.meta.url);
const files = readdirSync(directory)
  .filter((x) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(x))
  .sort();
files.forEach((file, index) => {
  const expected = String(index + 1).padStart(3, "0");
  if (!file.startsWith(`${expected}_`))
    throw new Error(`Migration sequence gap: ${file}`);
});
const manifest = Object.fromEntries(
  files.map((file) => [
    file,
    createHash("sha256")
      .update(readFileSync(new URL(file, directory)))
      .digest("hex"),
  ]),
);
const output = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output) {
    console.error(
      "Migration manifest mismatch; never modify applied SQL. Add a new migration or deliberately refresh before release.",
    );
    process.exit(1);
  }
  console.log(`Migration manifest verified (${files.length})`);
} else writeFileSync(target, output);
