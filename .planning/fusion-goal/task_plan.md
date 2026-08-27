# Infinite Canvas Fusion Goal 执行计划

> 状态：进行中。权威需求以 `docs/architecture/fusion-architecture.md` 与 `docs/requirements/functional-spec.md` 为准。

| 阶段 | 状态 | 交付物 |
|---|---|---|
| R0 Foundation | complete | workspace、contracts、canvas-core、v3/v4 migration、插件信任边界 |
| R1 Cloud Creation | in_progress | Identity、Workspace、Cloud Project、Collaboration、Asset、Job、Model Gateway、Billing |
| R2 Workflow Agent | pending | Workflow compiler/runtime、统一 Agent、Skills、durable execution |
| R3 Production Suite | pending | 素材库、短剧生产线、发布、治理、运营后台 |
| R4 Ecosystem | pending | Plugin SDK/Marketplace、部署矩阵、迁移、全量验收 |

## 当前切片

- [x] Hono API、Identity/Session、Workspace/RBAC、Cloud Canvas snapshot/mutation
- [x] PostgreSQL schema 与 revision/idempotency transaction
- [x] 标准 Node ESM build、文档与质量门禁
- [x] Web Local/Server repository adapter 与登录/Workspace UI
- [x] WebSocket collaboration hub
- [x] Asset storage（magic-byte、SHA-256、Local/S3、RBAC、AssetRef 保护）
- [x] Generation Job Worker（contract/state/schema/repository/API、独立 runtime、heartbeat/lease recovery）
- [▶] Model Gateway（OpenAI-compatible、Gemini、声明式 Custom runtime、媒体 Asset、health/cooldown、provider cancel 已完成；streaming、连接测试/模型发现、provider-specific adapter 待完成）、Billing ledger

## 错误账本

| 错误 | 次数 | 处置 |
|---|---:|---|
| 假定 `pending-test.mdx` 位于仓库根目录 | 1 | 已定位到 `docs/content/docs/progress/pending-test.mdx` |
| `apply_patch` 同一路径 Delete/Add 冲突 | 1 | 改用 Update File 精确替换 |
| API import patch 与实际 import 形态不一致 | 1 | 先枚举 import，再按原文精确修改 |
| AssetRef 递归未处理循环对象 | 1 | 增加 WeakSet 防环并补回归测试 |
| Worker fetch Body 的 Uint8Array 泛型不兼容 DOM BodyInit | 1 | 复制为确定的 ArrayBuffer 后上传，typecheck 通过 |
| Custom adapter 的 union `flatMap` 推断过窄 | 1 | 改为显式判别数组累积，保持 inline/file 两类结果 |
