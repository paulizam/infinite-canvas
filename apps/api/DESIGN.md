# API Design

## 定位与目标

`apps/api` 是 Server mode 的权威控制面：负责 Identity、Workspace RBAC、Canvas、Asset、Generation Job、Workflow、Agent Run、Billing 与 Model Gateway 管理。业务状态必须先持久化，再由可恢复 Worker 推进；浏览器不是权威任务执行器。

非目标：不在 API 进程执行 Provider 长任务，不保存 Provider 明文密钥，不让客户端提交可执行代码或可信 schema。

## 分层

```text
Hono route + Zod boundary
        ↓
Domain service (authorization + invariant + state transition)
        ↓
Repository interface
   ├─ Memory repository：contract tests
   └─ PostgreSQL repository：production transaction/locking
        ↓
BlobStore / Model Gateway / Worker protocol
```

`app.ts` 只处理 transport、认证、大小边界和 DTO；领域规则进入 Service；SQL 并发语义进入 PostgreSQL Repository。Memory 与 PostgreSQL 必须保持相同的跨租户 404、幂等和状态机行为。

## 核心决策

| 决策 | 选择 | 原因 |
|---|---|---|
| Tenant 隔离 | Workspace membership + resource lineage 双校验 | 仅校验资源 ID 或用户身份都不足以阻断 IDOR |
| 长任务 | durable row + `SKIP LOCKED` lease + heartbeat | 支持多 Worker、崩溃接管与页面关闭恢复 |
| 幂等 | caller key/ID + database unique constraint | 并发重放也只能产生一个权威结果 |
| Timeline | 单调 sequence、append-only trigger | 审计和 SSE resume 不允许历史被改写 |
| 凭据 | AES-256-GCM 或高熵 Token SHA-256 hash | 明文只在必要边界短暂存在 |
| 错误可见性 | opaque resource lookup 返回 404 | 不泄露其他 Workspace 资源存在性 |

## Agent Run

```text
Session → Run → Event / Subtask / Result / Approval
queued → claimed → running → waiting_approval → queued
                         └→ succeeded | failed | cancelled
```

- Worker 只有持有有效 lease 才能 transition；过期 Run 可被其他 Worker 接管。
- `delete`、`batch_paid_generation`、`external_access` 必须创建持久 Approval，并释放 lease。
- Approval 批准后重新排队，拒绝后进入可审计失败终态。
- Result Asset 必须属于同一 Workspace；输入与 transition 均有硬大小限制。
- 用户可见 planning summary 可以持久化，`reasoning`、`chain-of-thought`、`rationale` 被 Service 拒绝。
- Event 使用 `Last-Event-ID`/sequence 恢复 SSE，不把内部推理混入会话历史。

## 安全边界

- Browser：HttpOnly、SameSite=Strict Session cookie。
- Worker：独立 32+ 字符 Bearer Token，只能访问 `/internal/v1/generation|workflow|agent|model-gateway/*`。
- Maintenance：与 Worker 不同的 Token，只能管理模型、账务和运维入口。
- 上传内容使用 magic bytes、Workspace SHA-256 去重、server-generated key；S3 不向 Worker 泄露长期凭据。
- Provider URL 拒绝 credential/query/fragment、redirect 与默认私网目标。

## 已知限制与演进

- `app.ts` 仍是较大的 route composition root；后续按 domain 拆为 Hono sub-app，但不改变 Service/Repository contracts。
- PostgreSQL migration 是顺序追加且有 SHA-256 ledger；已应用文件禁止修改。
- 当前事件分发使用有界 polling/SSE；规模扩大后可引入 transactional Outbox + `LISTEN/NOTIFY`，数据库仍为权威来源。

## 验证

```bash
pnpm --filter @infinite-canvas/api test
pnpm --filter @infinite-canvas/api typecheck
pnpm --filter @infinite-canvas/api build
```

变更历史：2026-08-28 建立 Server mode 领域与 Agent Run 设计基线。
