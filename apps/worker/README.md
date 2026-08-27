# Infinite Canvas Generation Worker

The Worker polls the authenticated API for PostgreSQL-backed generation leases. Configure
`WORKER_API_ORIGIN` and the same 32+ character `WORKER_TOKEN` used by the API. `WORKER_ID` is
optional; a process-unique ID is generated otherwise.

```bash
cp apps/worker/.env.example apps/worker/.env
pnpm --filter @infinite-canvas/worker build
pnpm --filter @infinite-canvas/worker start
```

The API must already be running, its migrations must be applied, and `WORKER_API_ORIGIN` must be
reachable from the Worker network. Never expose `WORKER_TOKEN` to the browser.

It heartbeats even while idle, renews ownership through the API, recovers expired leases, uses
bounded exponential idle backoff, and exits cleanly on SIGINT/SIGTERM. Until Model Gateway
channels are configured, claimed generation work is moved to `needs_review` rather than silently
calling or charging an unknown provider; cancellation requests are completed normally.

For configured jobs, the Worker resolves a logical model through the API, validates request
parameters against its capability profile, and invokes the selected OpenAI-compatible, Gemini, or
declarative Custom channel.
Provider credentials remain API-managed and are never stored in Worker configuration. URL,
Base64, and binary audio media results are persisted through the API Asset pipeline, and Job JSON
retains only Asset references. Input Asset references are read only through the active Worker lease,
then materialized by the isolated input-asset module with 16-asset and 64 MiB bounds; duplicate
references share one in-flight read and materialized data never returns to Job storage. Runtime calls
report health for routing cooldown. Cancellation calls
the original provider when the binding declares `supportsCancel`; an uncertain unsupported cancel
moves to `needs_review` rather than falsely claiming that billing stopped. SSE text streaming and
provider-specific adapters use the same normalized gateway contract.

The same process also claims durable Workflow Executions, Schedule Triggers, and Cloud Agent
Runs. The stock Agent handler executes text-only Runs through the configured logical text model,
persists visible output deltas/results, and deliberately discards Provider reasoning. Set
`REMOTE_AGENT_URL` and a 32+ character `REMOTE_AGENT_TOKEN` to enable the authenticated team Agent adapter for
attachments, executable Skills, mixed-media/drama results, and the versioned core tool contract.
Only HTTPS endpoints are accepted (HTTP is limited to loopback development), redirects are rejected,
responses are limited to 2 MiB, and the token is never persisted or logged. Remote Canvas writes run
through the API lease, RBAC, revision, idempotency, approval, audit, and collaboration broadcast path.
If a lease
expires after a Provider attempt started, the stock handler fails closed with
`AGENT_AMBIGUOUS_RECOVERY`; an explicit user retry is required instead of silently duplicating a
potentially billable request.
