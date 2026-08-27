# Model Gateway Design

## Goals

Separate Protocol, Channel, Upstream Model, Logical Model, Capability Profile and billing identity. Routing is pure and deterministic; provider execution is isolated in Worker.

## Decisions

- Disabled, uncredentialed and active-cooldown candidates are excluded.
- Preferred channel wins only among valid candidates, then priority ascending and weight descending.
- HTTPS is mandatory unless administrators explicitly enable insecure transport for a private deployment.
- Credentials are absent from public contracts and stored by API using AES-256-GCM with channel ID as AAD.
- Custom protocols are data-only: safe relative paths, fixed auth modes, top-level field mapping and static JSON. No `eval`, script, arbitrary headers, or credential-in-URL behavior is permitted.
- Gemini uses the `x-goog-api-key` header and normalizes text, inline media and long-running operation responses into durable Job contracts.

## Limitations

Connection tests/model discovery UI, provider-specific Seedance/Stable Diffusion/A1111 adapters,
SSE text streaming, and administrator-configurable status/result mappings remain subsequent work.

## Security

Configured URLs reject credentials, query and fragments. User parameters cannot override the routed upstream model. Worker and Maintenance tokens are distinct, strong secrets.
Custom paths reject traversal/query/fragment syntax and reserved prototype field names. Provider
errors are credential-redacted before durable Job storage.

## History

- 2026-08-28: initial contracts, router, capability validation, encrypted channel credentials and OpenAI-compatible execution.
- 2026-08-28: Gemini and declarative Custom runtime adapters, health feedback, Asset persistence and provider-side cancellation.
