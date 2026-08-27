# Infinite Canvas API

Hono/Node API for Server mode identity, workspaces, RBAC, durable cloud canvas projects, collaboration, and immutable media assets.

## Configure

Copy `.env.example` into your deployment secret/config system. `DATABASE_URL` and
`SESSION_TTL_SECONDS` are required. The session TTL intentionally has no implicit default so each
deployment must choose its own expiry policy.

Media uploads require `MAX_UPLOAD_BYTES` and `BLOB_STORAGE_DRIVER`. Use `local` with
`ASSET_LOCAL_ROOT` for a single-node deployment, or `s3` with the `S3_*` settings for shared
object storage. File types are derived from magic bytes rather than request headers.

## Run

```bash
pnpm --filter @infinite-canvas/contracts build
pnpm --filter @infinite-canvas/canvas-core build
pnpm --filter @infinite-canvas/api db:migrate
pnpm --filter @infinite-canvas/api build
pnpm --filter @infinite-canvas/api start
```

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

The in-memory repository exists only for contract tests. Production startup always uses PostgreSQL.
