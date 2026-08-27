# Infinite Canvas API

Hono/Node API for Server mode identity, workspaces, RBAC, and durable cloud canvas projects.

## Configure

Copy `.env.example` into your deployment secret/config system. `DATABASE_URL` and
`SESSION_TTL_SECONDS` are required. The session TTL intentionally has no implicit default so each
deployment must choose its own expiry policy.

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

The in-memory repository exists only for contract tests. Production startup always uses PostgreSQL.
