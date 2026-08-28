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
// pnpm reports only the native Agent SDK package for the current OS. Normalize
// approved platform packages so THIRD_PARTY_NOTICES.md is reproducible across
// Windows, Linux and macOS runners.
const agentSdkName = "@anthropic-ai/claude-agent-sdk";
const agentSdkVersions = Object.values(inventory)
  .flat()
  .find((entry) => entry.name === agentSdkName)?.versions;
const agentSdkPlatforms = Object.keys(policy.allowedUnknown).filter((name) =>
  name.startsWith(`${agentSdkName}-`),
);
for (const packages of Object.values(inventory))
  packages.splice(
    0,
    packages.length,
    ...packages.filter((entry) => !entry.name.startsWith(`${agentSdkName}-`)),
  );
inventory.Unknown = [
  ...(inventory.Unknown || []),
  ...agentSdkPlatforms.map((name) => ({ name, versions: agentSdkVersions })),
];
// Native optional packages vary by runner OS even though the lockfile is the
// same. Preserve their license evidence under stable platform-family labels.
const nativeFamilies = [
  [/^@esbuild\/.+$/, "@esbuild/<platform>"],
  [/^@napi-rs\/lzma-.+$/, "@napi-rs/lzma-<platform>"],
  [/^@next\/swc-.+$/, "@next/swc-<platform>"],
  [/^@node-rs\/argon2-.+$/, "@node-rs/argon2-<platform>"],
  [/^@rollup\/rollup-.+$/, "@rollup/rollup-<platform>"],
  [/^@tailwindcss\/oxide-.+$/, "@tailwindcss/oxide-<platform>"],
  [/^lightningcss-.+$/, "lightningcss-<platform>"],
];
for (const packages of Object.values(inventory))
  for (const entry of packages) {
    for (const [pattern, canonical] of nativeFamilies)
      if (pattern.test(entry.name)) entry.name = canonical;
    if (entry.name === "@openai/codex")
      entry.versions = entry.versions?.map((version) =>
        version.replace(/-(?:win32|linux|darwin)-.+$/, ""),
      );
  }
const lockfile = readFileSync(
  new URL("../pnpm-lock.yaml", import.meta.url),
  "utf8",
);
const lockedVersion = (pattern) => lockfile.match(pattern)?.[1];
const sharpVersion = lockedVersion(
  /'@img\/sharp-(?:win32|linux|darwin)[^@]*@([^']+)'/,
);
const libvipsVersion = lockedVersion(/'@img\/sharp-libvips-[^@]+@([^']+)'/);
const lzmaVersion = lockedVersion(/'@napi-rs\/lzma-[^@]+@([^']+)'/);
for (const packages of Object.values(inventory))
  packages.splice(
    0,
    packages.length,
    ...packages.filter((entry) => !entry.name.startsWith("@img/sharp-")),
  );
inventory["Apache-2.0"] = [
  ...(inventory["Apache-2.0"] || []),
  { name: "@img/sharp-<platform>", versions: [sharpVersion] },
];
inventory["LGPL-3.0-or-later"] = [
  ...(inventory["LGPL-3.0-or-later"] || []),
  { name: "@img/sharp-libvips-<platform>", versions: [libvipsVersion] },
];
if (!inventory.MIT?.some((entry) => entry.name === "@napi-rs/lzma-<platform>"))
  inventory.MIT = [
    ...(inventory.MIT || []),
    { name: "@napi-rs/lzma-<platform>", versions: [lzmaVersion] },
  ];
for (const [license, packages] of Object.entries(inventory))
  if (packages.length === 0) delete inventory[license];
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
