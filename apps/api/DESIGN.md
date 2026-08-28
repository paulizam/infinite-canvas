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

| 决策               | 选择                                                      | 原因                                      |
| ------------------ | --------------------------------------------------------- | ----------------------------------------- |
| Tenant 隔离        | Workspace membership + resource lineage 双校验            | 仅校验资源 ID 或用户身份都不足以阻断 IDOR |
| 长任务             | durable row + `SKIP LOCKED` lease + heartbeat             | 支持多 Worker、崩溃接管与页面关闭恢复     |
| 幂等               | caller key/ID + database unique constraint                | 并发重放也只能产生一个权威结果            |
| Timeline           | 单调 sequence、append-only trigger                        | 审计和 SSE resume 不允许历史被改写        |
| 凭据               | AES-256-GCM 或高熵 Token SHA-256 hash                     | 明文只在必要边界短暂存在                  |
| 错误可见性         | opaque resource lookup 返回 404                           | 不泄露其他 Workspace 资源存在性           |
| Project checkpoint | row-lock 下复制 immutable snapshot；restore 新增 revision | 保留历史证据且拒绝并发静默覆盖            |

## Project Checkpoint

- `canvas_project_checkpoints` 保存创建时的完整 canonical document 与 `sourceRevision`，记录不可被 restore 更新。
- list/get 至少要求 Workspace viewer；create/delete/restore 在 Project lock 内要求 editor。
- restore 必须匹配 `expectedRevision`，生成 `current + 1` revision、刷新 Asset references，并广播 canonical snapshot。
- checkpoint 与 Project 同租户且随 Project 级联删除；跨 Project checkpoint ID 返回 404。

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
- Worker 可在有效 lease 内读取绑定 Project/Workspace Asset 的最小上下文；远端 `canvas_apply_ops` 使用与 Local Agent 相同的 JSON tool contract，经 API 转换为 canonical operations。执行必须匹配 revision，mutation ID 由 run/tool-call 派生且可重放，delete 仍须持久 Approval；成功后广播 canonical snapshot。

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

## Drama production domain

- `DramaService` owns DRM-001～004 validation and generated identifiers.
- `DramaRepository` has Memory and PostgreSQL adapters; production writes lock the aggregate row.
- Every mutation requires `expectedRevision` and `mutationId`; request hashes reject idempotency drift.
- Script/shot version tables are immutable. Media foreign keys include `workspace_id` to prevent cross-tenant references.
- API coverage lives in `drama-api.test.ts`.

### Drama media production

`DramaProductionService` binds image/video Generation Jobs to shots, records selected outputs, maintains dialogue/voice/BGM/subtitle timeline items, and appends immutable shot review decisions. Production mutations share the Drama aggregate revision and mutation hash. Generation creation uses a stable `drama:<project>:<mutation>` client request ID, so a failed binding can be retried without duplicate billing.

### Drama render queue

`DramaRenderService` owns FFmpeg/Jianying render creation and retry. PostgreSQL claims use `FOR UPDATE SKIP LOCKED`; workers must hold a renewable lease to report progress or terminal state. Successful transitions create immutable, monotonically versioned render records. Render creation snapshots selected media and timeline input and advances the Drama aggregate revision.

### Render worker execution

Workers claim Drama render leases independently from model-generation jobs. Input assets and output uploads are lease-bound API calls. FFmpeg is invoked with `spawn(executable, argv, { shell: false })`, controlled temporary filenames, `-nostdin`, and abort-driven termination. `FFMPEG_PATH` selects the deployment binary and defaults to `ffmpeg`. Jianying exports are deterministic ZIP packages containing v6 draft metadata/content and bundled media. Generic ZIP outputs use the restricted `file` asset kind; arbitrary executables/documents remain rejected.

### Drama / Canvas interoperability

`DramaInteropService` supports Drama-to-Canvas media nodes and Canvas/Asset-to-Drama entity or timeline imports. It requires source and destination to share a Workspace, verifies Drama ownership of exported media, and uses destination revisions and mutation IDs. Canvas mutations now persist SHA-256 request hashes and reject mutation-ID payload drift; legacy mutation rows without hashes remain replayable for forward migration compatibility.

## Community publication domain

Community works are revisioned drafts linked to same-Workspace Canvas projects. Submission refreshes a full Canvas `draftSnapshot`; approval copies it into an immutable publication version so later source changes cannot alter public content. Anonymous feed/detail/author APIs expose only published visibility, while authenticated mutations enforce ownership and idempotency hashes. Likes/follows use set semantics, reports and moderation write auditable events, and Maintenance retries are request-id idempotent.

### Community social layer

Comments use immutable IDs, per-author mutation keys, bounded content, reply ownership checks, soft moderation states, reports, and Maintenance audit events. Bookmarks are set-valued rows. Collections are owner-controlled revisioned aggregates with request hashes and public/unlisted/private visibility. Service-level sliding windows limit abusive comment/report/bookmark bursts; database uniqueness remains the authoritative consistency boundary.

## Billing commerce catalog

`CommerceService` owns BIL-003/004 product, promotion, redemption-code, free-grant, and referral rules. Public catalog prices are calculated from integer minor units and active promotion windows; free products use a unique `(product_id, user_id)` grant so retries never mint units twice. Wallet mutations, immutable ledger entries, redemption/referral records, and counters are committed in one PostgreSQL transaction under row locks.

Coupon/CDK and invite plaintext is returned only at creation. Persistence stores `HMAC-SHA256(code, BILLING_CODE_SECRET)`; production requires a secret of at least 32 bytes and explicit inviter/invitee reward units. User-supplied idempotency keys are unique, replay returns the original outcome, self-invite and a second referral relationship are rejected, and ledger entry types distinguish `redemption` and `referral` from purchases and generation billing.

### Orders, payments, refunds, and reconciliation

`PaymentService` depends on a channel-neutral `PaymentAdapter`. Orders snapshot promotion-adjusted integer price and units, bind an idempotency-key payload hash, expose hosted checkout/QR data, and expire after a bounded window. Webhooks are verified over the untouched raw body with HMAC-SHA256, a timestamp tolerance, constant-time comparison, and a provider event-ID unique constraint. A paid event, wallet credit, immutable purchase ledger entry, and fulfilled state commit in one transaction.

Refunds first acquire a durable `pending` record, call the provider with the refund ID as its stable key, then atomically debit units and append a refund ledger entry. If the provider refunded money but the wallet no longer contains the purchased units, the order enters `needs_review` instead of producing a negative balance. Reconciliation persists statement-line matches/mismatches; reporting keeps money in minor units and separates gross revenue, refunds, purchased units, and actual model-unit cost.

## Admin control plane

`AdminService` and its Hono sub-app implement the platform control plane without adding more domain logic to the route composition root. Browser access uses the existing HttpOnly Session and a live `active/admin` database check on every request; the separately scoped Maintenance Token mounts the same service for break-glass operation. Suspending a user revokes active sessions, and session authentication rejects both revoked sessions and non-active users.

Admin mutations append an immutable audit event with actor, action, resource and request ID in the same transaction. Dashboard, user search, generation recovery/cancellation, asset utilization/orphan inspection, typed settings, announcements and managed prompts are server aggregates. Failed/cancelled generation recovery creates a new attempt and re-reserves wallet units atomically; it never requeues a refunded attempt for free. Public setting keys use an allowlist and value validators. Secret settings are AES-256-GCM ciphertext bound to per-setting AAD and responses reveal only `secretConfigured`.

### Admin domain bridges

The Admin API composes existing Model Gateway, Discovery, Commerce, and Payment services rather than creating duplicate control-plane state. Its model flow covers protocol selection, credential-bearing channel creation, connection testing, bounded model discovery, upstream import, and logical-model binding. Credential plaintext is accepted only on channel mutation and catalog DTOs expose only `credentialConfigured`. Commerce management lists products, promotions, safe code metadata, referrals, orders, refunds, and financial reports; CDK plaintext appears only in the create response and hashes never leave persistence. Mutations append cross-domain admin audit records without secret values.

### Administrator MFA and token rotation

Browser administrators must enroll RFC-compatible TOTP with HMAC-SHA256 and complete MFA per Session before any control-plane route is readable. The encrypted TOTP seed uses a dedicated `MFA_SECRET_KEY`; recovery codes use high entropy, keyed hashes under `MFA_RECOVERY_PEPPER`, and atomic one-time consumption. A monotonically increasing database counter rejects TOTP replay, including concurrent requests. Enrollment and verification routes are the only Admin routes reachable without MFA assurance; Maintenance Token remains a separate break-glass boundary.

Worker and Maintenance bearer credentials support a deployment rotation ring containing current and previous tokens. Previous-token acceptance requires an explicit future ISO-8601 expiry, expired configuration fails startup, and the two privilege rings may not share any token.
