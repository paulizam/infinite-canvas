# Infinite Canvas API

Hono/Node API for Server mode identity, workspaces, RBAC, durable cloud canvas projects, collaboration, and immutable media assets.

## Configure

Copy `.env.example` into your deployment secret/config system. `DATABASE_URL` and
`SESSION_TTL_SECONDS` are required. The session TTL intentionally has no implicit default so each
deployment must choose its own expiry policy.
`WORKER_TOKEN` is also required, must contain at least 32 characters, and must only be shared with
the isolated generation Worker process.

Model Gateway administration requires a separate 32+ character `MAINTENANCE_TOKEN`; it must not
equal `WORKER_TOKEN`. Provider credentials are encrypted with AES-256-GCM using the 32-byte
base64 `MODEL_SECRET_KEY`. Keep both values in a secret manager, never expose either to the
browser, and retain the encryption key while any channel credentials still use it. The Worker can
resolve enabled logical-model candidates through its internal token but cannot mutate the catalog.

Media uploads require `MAX_UPLOAD_BYTES` and `BLOB_STORAGE_DRIVER`. Use `local` with
`ASSET_LOCAL_ROOT` for a single-node deployment, or `s3` with the `S3_*` settings for shared
object storage. File types are derived from magic bytes rather than request headers.

Billing uses integer point units. Maintenance configures per-logical-model price rules and audited
wallet adjustments. Job creation, point reservation, wallet update, and immutable ledger insertion
share one PostgreSQL transaction; terminal settlement or refund shares the Job transition
transaction. Never update or delete ledger rows—the database trigger rejects both operations.

Cloud Agent Runs persist sessions, multimodal Asset references, plans, public events, subtasks,
results, and high-risk approvals. Workers claim Runs through a lease/heartbeat protocol under
`/internal/v1/agent/*`; private reasoning fields are rejected and the event timeline is
database-enforced append-only. Delete, batch paid generation, and external access must pause in
`waiting_approval` until an editor decides the durable approval record.

## Run

```bash
pnpm --filter @infinite-canvas/contracts build
pnpm --filter @infinite-canvas/canvas-core build
pnpm --filter @infinite-canvas/api db:migrate
pnpm --filter @infinite-canvas/api build
pnpm --filter @infinite-canvas/api start
```

Migrations are ordered SQL files with a SHA-256 ledger. Applied files are immutable: editing one
causes startup migration to fail instead of silently drifting the schema; add a new numbered file.

Development uses `pnpm --filter @infinite-canvas/api dev`. The API listens on port `3001` unless
`PORT` is set.

## Security and consistency

- Passwords are Argon2 hashes; only SHA-256 session-token hashes are persisted.
- The browser receives an HttpOnly, SameSite=Strict cookie; production cookies are Secure.
- Workspace roles are `owner`, `admin`, `editor`, and `viewer`.
- Project mutation requires the current base revision and an idempotent `mutationId`.
- Cross-tenant resource lookups return `404` instead of revealing resource existence.
- Asset keys are server-generated, content is SHA-256 deduplicated per workspace, and referenced
  assets cannot be deleted. S3 content is served through short-lived signed URLs.
- Provider endpoints default to HTTPS-only, reject URL credentials/query/fragment components, and
  channel secrets are decrypted only while resolving a Worker request.
- Maintenance can test or discover a saved channel through
  `POST /internal/v1/maintenance/model-channels/:id/test` and `.../:id/discover`. Discovery rejects
  redirects and private/reserved DNS targets unless private-network access is explicitly enabled,
  caps catalog responses at 2 MiB, and never returns provider bodies or credentials in diagnostics.
- Paid Job retries create a new reservation for a new attempt. Failed/cancelled attempts refund
  once; uncertain `needs_review` attempts retain their reservation for explicit reconciliation.
- Agent Run opaque identifiers are tenant-hidden, Worker transitions require a live lease, result
  Assets are checked against the Run Workspace, and transition payloads are capped at 1 MiB.

The in-memory repository exists only for contract tests. Production startup always uses PostgreSQL.
