import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  collectRequirementTestTraces,
  parseRequirements,
} from "./requirement-trace-lib.mjs";

const specPath = "docs/requirements/functional-spec.md";
const outputPath = "docs/requirements/test-traceability.md";
const requirements = parseRequirements(readFileSync(specPath, "utf8"));
if (
  requirements.length !== 133 ||
  new Set(requirements.map((item) => item.id)).size !== 133
)
  throw new Error("Requirement IDs must contain 133 unique values");

const traces = collectRequirementTestTraces(requirements);
const direct = requirements.filter((item) => traces.get(item.id).length);
const missing = requirements.filter((item) => !traces.get(item.id).length);
const content = `# Requirement Test Traceability

> 由 \`node ops/requirements-trace.mjs\` 生成。这里只统计 \`describe/it/test\` 标题中的显式 Requirement ID；注释、测试正文或普通字符串不计为直接证据。直接引用表示该测试声明覆盖该需求，不代表真实外部环境验收已 PASS。

## Summary

- Requirements: ${requirements.length}
- Direct test-title references: ${direct.length}
- Without direct test-title reference: ${missing.length}

## Direct references

| ID | P | Tests |
|---|---:|---|
${direct
  .map(
    (item) =>
      `| ${item.id} | ${item.priority} | ${traces
        .get(item.id)
        .map((path) => `\`${path}\``)
        .join("<br>")} |`,
  )
  .join("\n")}

## Missing direct references

${missing.length ? missing.map((item) => `- ${item.id} (${item.priority})`).join("\n") : "- None."}
`;

if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== content)
    throw new Error("Requirement test traceability is stale");
  console.log(
    `Requirement test-title traceability verified (${direct.length}/133 direct)`,
  );
} else {
  writeFileSync(outputPath, content);
  console.log(`Wrote ${outputPath} (${direct.length}/133 direct test titles)`);
}
