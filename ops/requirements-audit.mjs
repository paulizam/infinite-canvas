import { existsSync, readFileSync, writeFileSync } from "node:fs";

const specPath = "docs/requirements/functional-spec.md";
const outputPath = "docs/requirements/acceptance-matrix.md";
const detailedEvidencePath = "ops/requirements-evidence.json";
const detailedEvidence = JSON.parse(readFileSync(detailedEvidencePath, "utf8"));
const evidence = {
  BAS: ["apps/api/src/app.test.ts", "web/src/services/cloud-platform.test.ts"],
  CAN: ["packages/canvas-core/src/core.test.ts", "web/src/lib/canvas/canvas-import.test.ts"],
  GEN: ["apps/api/src/generation-job-api.test.ts", "apps/worker/src/gateway-handler.test.ts"],
  AGT: ["apps/api/src/agent-run-api.test.ts", "apps/worker/src/agent-runtime.test.ts"],
  WFL: ["packages/workflow-runtime/src/compiler.test.ts", "apps/api/src/workflow-api.test.ts"],
  AST: ["apps/api/src/asset-references.test.ts", "web/src/services/webdav-sync.ts"],
  PLG: ["web/src/lib/canvas/plugin-manifest.test.ts", "web/src/lib/canvas/plugin-sandbox.test.ts"],
  COL: ["apps/api/src/collaboration.test.ts", "web/src/services/cloud-collaboration.test.ts"],
  DRM: ["apps/api/src/drama-api.test.ts", "apps/worker/src/drama-render-runtime.test.ts"],
  COM: ["apps/api/src/community-api.test.ts", "apps/api/src/community-service.ts"],
  BIL: ["apps/api/src/commerce-api.test.ts", "apps/api/src/payment-service.test.ts"],
  ADM: ["apps/api/src/admin-domain-api.test.ts", "web/src/pages/admin/model-commerce.tsx"],
  OPS: [".github/workflows/quality-security.yml", "ops/README.md"],
};
const runtimePending = new Set([
  "GEN-008", "GEN-017", "GEN-018", "AST-002", "AST-007",
  "PLG-005", "DRM-008", "BIL-005", "BIL-006", "BIL-007",
]);

if (Object.keys(detailedEvidence).sort().join() !== [...runtimePending].sort().join())
  throw new Error("Detailed evidence IDs must exactly match runtime-pending IDs");
for (const [id, item] of Object.entries(detailedEvidence)) {
  for (const path of [...item.sources, ...item.tests])
    if (!existsSync(path)) throw new Error(`Detailed evidence path does not exist for ${id}: ${path}`);
  if (!item.command?.trim() || !item.runtime?.trim()) throw new Error(`Incomplete detailed evidence for ${id}`);
}

const requirements = [...readFileSync(specPath, "utf8").matchAll(/^\| ([A-Z]{3}-\d{3}) \| ([^|]+) \| ([^|]+) \| (.+) \|$/gm)].map((match) => ({ id: match[1], priority: match[2].trim(), source: match[3].trim(), text: match[4].trim() }));
if (requirements.length !== 133) throw new Error(`Expected 133 requirements, found ${requirements.length}`);
for (const paths of Object.values(evidence)) for (const path of paths) if (!existsSync(path)) throw new Error(`Evidence path does not exist: ${path}`);

const rows = requirements.map((requirement) => {
  const prefix = requirement.id.slice(0, 3);
  const paths = evidence[prefix];
  if (!paths) throw new Error(`No evidence mapping for ${requirement.id}`);
  const status = runtimePending.has(requirement.id) ? "RUNTIME-PENDING" : "SOURCE-EVIDENCE";
  const detail = detailedEvidence[requirement.id];
  const cells = detail
    ? [...detail.sources, ...detail.tests].map((path) => `\`${path}\``).concat(`Command: \`${detail.command}\``, `Needs: ${detail.runtime}`)
    : paths.map((path) => `\`${path}\``);
  return `| ${requirement.id} | ${requirement.priority} | ${status} | ${escapeCell(requirement.text)} | ${cells.join("<br>")} |`;
});
const pending = requirements.filter((item) => runtimePending.has(item.id));
const content = `# 133 项功能验收矩阵

> 由 \`node ops/requirements-audit.mjs\` 从 \`${specPath}\` 生成。\`SOURCE-EVIDENCE\` 仅表示已定位领域实现与测试入口，不等价于该需求最终 PASS；\`RUNTIME-PENDING\` 表示还必须在真实 Docker/PostgreSQL、外部 Provider、WebDAV、支付沙箱或媒体工具链中取得运行证据。矩阵不以“未发现 TODO”或宽泛领域测试替代逐项验收。

## 汇总

- 总需求：133
- 已定位源码/测试入口：${133 - pending.length}
- 实机/外部环境待验：${pending.length}
- 待验 ID：${pending.map((item) => item.id).join("、")}

## 逐项证据

| ID | P | 状态 | 验收目标 | 当前权威证据 |
|---|---:|---|---|---|
${rows.join("\n")}

## 最终运行证据门槛

1. GitHub Actions \`Quality and Security\` 全部 jobs 在当前 commit 通过，包含 PostgreSQL 001–028 双迁移、业务包 round-trip、Gitleaks、Syft、Trivy、Compose 与三镜像构建。
2. 隔离 Compose 环境完成注册登录、Workspace/Canvas、Asset 上传下载、Generation Worker、Workflow Worker、Drama FFmpeg 与备份恢复 smoke。
3. 使用所有者提供的测试账户完成 Seedance、Stable Diffusion/A1111/Forge、MediaKit、Volcengine AK/SK、WebDAV、支付 sandbox 的无真实消费或受控小额验收。
4. 每个 \`RUNTIME-PENDING\` 必须附日期、环境、命令/步骤、脱敏结果与 artifact URL，之后方可改为 \`PASS\`。
`;

if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== content) throw new Error("Acceptance matrix is stale; run node ops/requirements-audit.mjs");
  console.log(`Acceptance matrix verified (${requirements.length}, runtime pending ${pending.length})`);
} else {
  writeFileSync(outputPath, content);
  console.log(`Wrote ${outputPath} (${requirements.length}, runtime pending ${pending.length})`);
}

function escapeCell(value) { return value.replaceAll("|", "\\|"); }
