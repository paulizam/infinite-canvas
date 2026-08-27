# Model Gateway Design

## Goals

Separate Protocol, Channel, Upstream Model, Logical Model, Capability Profile and billing identity. Routing is pure and deterministic; provider execution is isolated in Worker.

## Decisions

- Disabled, uncredentialed and active-cooldown candidates are excluded.
- Preferred channel wins only among valid candidates, then priority ascending and weight descending.
- HTTPS is mandatory unless administrators explicitly enable insecure transport for a private deployment.
- Credentials are absent from public contracts and stored by API using AES-256-GCM with channel ID as AAD.

## Limitations

This slice implements OpenAI-compatible submit/poll. Gemini and declarative custom adapters, runtime health feedback and media persistence remain subsequent work.

## Security

Configured URLs reject credentials, query and fragments. User parameters cannot override the routed upstream model. Worker and Maintenance tokens are distinct, strong secrets.

## History

- 2026-08-28: initial contracts, router, capability validation, encrypted channel credentials and OpenAI-compatible execution.
