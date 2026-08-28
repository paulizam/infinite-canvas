import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  collectRequirementTestTraces,
  parseRequirements,
} from "./requirement-trace-lib.mjs";

const specPath = "docs/requirements/functional-spec.md";
const outputPath = "docs/requirements/acceptance-matrix.md";
const detailedEvidence = JSON.parse(
  readFileSync("ops/requirements-evidence.json", "utf8"),
);
const runtimePending = new Set(["GEN-008", "GEN-017", "GEN-018", "DRM-008"]);

if (
  Object.keys(detailedEvidence).sort().join() !==
  [...runtimePending].sort().join()
)
  throw new Error(
    "Detailed evidence IDs must exactly match runtime-pending IDs",
  );
for (const [id, item] of Object.entries(detailedEvidence)) {
  for (const path of [...item.sources, ...item.tests])
    if (!existsSync(path))
      throw new Error(
        `Detailed evidence path does not exist for ${id}: ${path}`,
      );
  if (!item.command?.trim() || !item.runtime?.trim())
    throw new Error(`Incomplete detailed evidence for ${id}`);
}

const requirements = parseRequirements(readFileSync(specPath, "utf8"));
if (requirements.length !== 133)
  throw new Error(`Expected 133 requirements, found ${requirements.length}`);
const traces = collectRequirementTestTraces(requirements);
const missingTraces = requirements.filter(
  (item) => !traces.get(item.id)?.length,
);
if (missingTraces.length)
  throw new Error(
    `Requirements without direct test-title evidence: ${missingTraces.map((item) => item.id).join(", ")}`,
  );

const rows = requirements.map((requirement) => {
  const status = runtimePending.has(requirement.id)
    ? "RUNTIME-PENDING"
    : "DIRECT-TEST-EVIDENCE";
  const detail = detailedEvidence[requirement.id];
  const cells = detail
    ? [...detail.sources, ...detail.tests]
        .map((path) => `\`${path}\``)
        .concat(`Command: \`${detail.command}\``, `Needs: ${detail.runtime}`)
    : traces.get(requirement.id).map((path) => `\`${path}\``);
  return `| ${requirement.id} | ${requirement.priority} | ${status} | ${escapeCell(requirement.text)} | ${cells.join("<br>")} |`;
});
const pending = requirements.filter((item) => runtimePending.has(item.id));
const content = `# 133 项功能验收矩阵

> 由 \`node ops/requirements-audit.mjs\` 从 \`${specPath}\` 生成。\`DIRECT-TEST-EVIDENCE\` 要求 Requirement ID 出现在实际 \`describe/it/test\` 标题中，注释、测试正文和领域级“万能文件”不计；它仍不等价于真实外部环境最终 PASS。\`RUNTIME-PENDING\` 表示还必须取得真实运行证据。

## 汇总

- 总需求：133
- 已具备逐项测试标题证据：${133 - pending.length}
- 实机/外部环境待验：${pending.length}
- 待验 ID：${pending.map((item) => item.id).join("、")}

## 逐项证据

| ID | P | 状态 | 验收目标 | 当前权威证据 |
|---|---:|---|---|---|
${rows.join("\n")}

## 最终运行证据门槛

1. 当前 commit 在本机通过 \`pnpm release:check\`；GitHub Actions 已按仓库所有者要求保持禁用，不以远端 workflow 代替本机验收。
2. 隔离 Compose 环境完成注册登录、Workspace/Canvas、Asset 上传下载、Generation Worker、Workflow Worker、Drama FFmpeg 与备份恢复 smoke。
3. 使用所有者提供的测试账户完成 Seedance、Stable Diffusion/A1111/Forge、MediaKit、Volcengine AK/SK、WebDAV、支付 sandbox 的无真实消费或受控小额验收。
4. 每个 \`RUNTIME-PENDING\` 必须附日期、环境、命令/步骤、脱敏结果与 artifact URL，之后方可改为 \`PASS\`。
`;

if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== content)
    throw new Error(
      "Acceptance matrix is stale; run node ops/requirements-audit.mjs",
    );
  console.log(
    `Acceptance matrix verified (${requirements.length}, direct test titles ${requirements.length - missingTraces.length}, runtime pending ${pending.length})`,
  );
} else {
  writeFileSync(outputPath, content);
  console.log(
    `Wrote ${outputPath} (${requirements.length}, runtime pending ${pending.length})`,
  );
}

function escapeCell(value) {
  return value.replaceAll("|", "\\|");
}
