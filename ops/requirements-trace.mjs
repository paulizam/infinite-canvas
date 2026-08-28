import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const specPath = "docs/requirements/functional-spec.md";
const outputPath = "docs/requirements/test-traceability.md";
const requirements = [
  ...readFileSync(specPath, "utf8").matchAll(
    /^\| ([A-Z]{3}-\d{3}) \| ([^|]+) \| ([^|]+) \| (.+) \|$/gm,
  ),
].map((match) => ({ id: match[1], priority: match[2].trim() }));
const known = new Set(requirements.map((item) => item.id));
if (known.size !== 133) throw new Error("Requirement IDs must be unique");

const testFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((path) => /(?:^|\/)[^/]+\.test\.tsx?$/.test(path));
const traces = new Map(requirements.map((item) => [item.id, []]));
const unknown = new Set();
for (const path of testFiles) {
  const contents = readFileSync(path, "utf8");
  for (const match of contents.matchAll(/\b[A-Z]{3}-\d{3}\b/g)) {
    if (!known.has(match[0])) unknown.add(match[0]);
    else traces.get(match[0]).push(path);
  }
}
if (unknown.size)
  throw new Error(`Unknown requirement IDs in tests: ${[...unknown].join(", ")}`);

const direct = requirements.filter((item) => traces.get(item.id).length);
const missing = requirements.filter((item) => !traces.get(item.id).length);
const content = `# Requirement Test Traceability\n\n> 由 \`node ops/requirements-trace.mjs\` 生成。这里只统计测试源码中的显式 Requirement ID；直接引用表示该测试声明覆盖该需求，不代表真实外部环境验收已 PASS。\n\n## Summary\n\n- Requirements: ${requirements.length}\n- Direct test references: ${direct.length}\n- Without direct test reference: ${missing.length}\n\n## Direct references\n\n| ID | P | Tests |\n|---|---:|---|\n${direct.map((item) => `| ${item.id} | ${item.priority} | ${[...new Set(traces.get(item.id))].map((path) => `\`${path}\``).join("<br>")} |`).join("\n")}\n\n## Missing direct references\n\n${missing.map((item) => `- ${item.id} (${item.priority})`).join("\n")}\n`;

if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== content)
    throw new Error("Requirement test traceability is stale");
  console.log(
    `Requirement test traceability verified (${direct.length}/133 direct)`,
  );
} else {
  writeFileSync(outputPath, content);
  console.log(`Wrote ${outputPath} (${direct.length}/133 direct)`);
}
