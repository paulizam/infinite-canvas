import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const target = new URL("../THIRD_PARTY_NOTICES.md", import.meta.url);
const inventory = JSON.parse(
  execFileSync("pnpm", ["licenses", "list", "--json"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === "win32",
  }),
);
const policy = JSON.parse(
  readFileSync(new URL("./license-policy.json", import.meta.url), "utf8"),
);
const unknown = (inventory.Unknown || []).map((x) => x.name);
const unapprovedUnknown = unknown.filter(
  (name) => !policy.allowedUnknown[name],
);
if (unapprovedUnknown.length)
  throw new Error(
    `Unapproved packages with unknown license: ${unapprovedUnknown.join(", ")}`,
  );
for (const license of Object.keys(inventory))
  if (
    policy.deniedLicensePatterns.some((pattern) =>
      license.toLowerCase().includes(pattern.toLowerCase()),
    )
  )
    throw new Error(`Denied license expression: ${license}`);
const groups = Object.entries(inventory)
  .map(([license, packages]) => [
    license,
    [
      ...new Map(
        packages.map((x) => [
          `${x.name}@${x.versions?.join(",") || "unknown"}`,
          x,
        ]),
      ).keys(),
    ].sort(),
  ])
  .sort(([a], [b]) => a.localeCompare(b));
const lines = [
  "# Third-Party Notices",
  "",
  "Generated from `pnpm-lock.yaml` by `node ops/license-inventory.mjs`. The repository MIT license does not replace dependency licenses; consult each package distribution for full terms and copyright notices.",
  "",
  "Packages reported as `Unknown` are permitted only when explicitly documented in `ops/license-policy.json`; strong-copyleft and source-available deny patterns block the release check.",
  "",
];
for (const [license, packages] of groups) {
  lines.push(`## ${license}`, "", ...packages.map((x) => `- \`${x}\``), "");
}
const output = `${lines.join("\n").trim()}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output) {
    console.error(
      "THIRD_PARTY_NOTICES.md is stale; run node ops/license-inventory.mjs",
    );
    process.exit(1);
  }
  console.log(`License inventory is current (${groups.length} expressions)`);
} else {
  writeFileSync(target, output);
  console.log(`Wrote THIRD_PARTY_NOTICES.md (${groups.length} expressions)`);
}
