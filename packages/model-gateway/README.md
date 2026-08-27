# Model Gateway

Pure routing, capability validation, and provider request policies shared by API and Worker.
Logical models bind product-facing model IDs to prioritized upstream channel models without exposing credentials.

Runtime adapters cover OpenAI-compatible, Gemini `generateContent`, and declarative Custom HTTP
protocols. Custom protocols use allowlisted field mappings and relative submit/poll/cancel paths;
they never execute administrator-supplied JavaScript.

```bash
pnpm --filter @infinite-canvas/model-gateway test
```
