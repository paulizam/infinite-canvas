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
parameters against its capability profile, and invokes the selected OpenAI-compatible channel.
Provider credentials remain API-managed and are never stored in Worker configuration. URL,
Base64, and binary audio media results are persisted through the API Asset pipeline, and Job JSON
retains only Asset references. SSE text streaming, Gemini/custom adapters, provider-side
cancellation, and health feedback remain follow-up work.
