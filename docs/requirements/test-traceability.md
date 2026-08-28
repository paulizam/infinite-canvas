# Requirement Test Traceability

> 由 `node ops/requirements-trace.mjs` 生成。这里只统计测试源码中的显式 Requirement ID；直接引用表示该测试声明覆盖该需求，不代表真实外部环境验收已 PASS。

## Summary

- Requirements: 133
- Direct test references: 22
- Without direct test reference: 111

## Direct references

| ID | P | Tests |
|---|---:|---|
| BAS-003 | P0 | `apps/api/src/app.test.ts` |
| BAS-005 | P1 | `apps/api/src/app.test.ts` |
| BAS-006 | P1 | `apps/api/src/admin-mfa-service.test.ts` |
| BAS-007 | P1 | `apps/api/src/app.test.ts` |
| BAS-008 | P1 | `apps/api/src/app.test.ts` |
| CAN-004 | P0 | `packages/canvas-core/src/core.test.ts` |
| CAN-005 | P0 | `packages/canvas-core/src/core.test.ts` |
| CAN-008 | P0 | `packages/canvas-core/src/core.test.ts` |
| CAN-013 | P1 | `apps/api/src/app.test.ts` |
| CAN-014 | P1 | `apps/api/src/app.test.ts` |
| GEN-001 | P0 | `apps/api/src/generation-job-api.test.ts`<br>`web/src/services/canvas-generation-provider.test.ts` |
| GEN-002 | P0 | `web/src/services/canvas-generation-provider.test.ts` |
| GEN-003 | P0 | `web/src/services/canvas-generation-provider.test.ts` |
| GEN-004 | P0 | `apps/worker/src/gateway-handler.test.ts` |
| GEN-006 | P0 | `apps/api/src/model-gateway-api.test.ts` |
| GEN-009 | P1 | `apps/api/src/model-gateway-api.test.ts` |
| GEN-010 | P0 | `apps/api/src/generation-job-api.test.ts` |
| GEN-011 | P0 | `apps/api/src/generation-job-api.test.ts` |
| GEN-012 | P0 | `apps/worker/src/gateway-handler.test.ts` |
| GEN-013 | P0 | `apps/api/src/generation-job-api.test.ts` |
| GEN-016 | P1 | `apps/api/src/generation-job-api.test.ts` |
| COL-007 | P2 | `apps/api/src/app.test.ts` |

## Missing direct references

- BAS-001 (P0)
- BAS-002 (P0)
- BAS-004 (P0)
- BAS-009 (P2)
- BAS-010 (P1)
- CAN-001 (P0)
- CAN-002 (P0)
- CAN-003 (P0)
- CAN-006 (P0)
- CAN-007 (P0)
- CAN-009 (P0)
- CAN-010 (P0)
- CAN-011 (P0)
- CAN-012 (P1)
- CAN-015 (P1)
- CAN-016 (P2)
- GEN-005 (P0)
- GEN-007 (P0)
- GEN-008 (P1)
- GEN-014 (P1)
- GEN-015 (P1)
- GEN-017 (P2)
- GEN-018 (P2)
- AGT-001 (P0)
- AGT-002 (P0)
- AGT-003 (P1)
- AGT-004 (P1)
- AGT-005 (P1)
- AGT-006 (P1)
- AGT-007 (P1)
- AGT-008 (P1)
- AGT-009 (P2)
- AGT-010 (P1)
- AGT-011 (P2)
- WFL-001 (P1)
- WFL-002 (P1)
- WFL-003 (P1)
- WFL-004 (P1)
- WFL-005 (P1)
- WFL-006 (P1)
- WFL-007 (P1)
- WFL-008 (P2)
- WFL-009 (P2)
- WFL-010 (P2)
- AST-001 (P0)
- AST-002 (P0)
- AST-003 (P0)
- AST-004 (P0)
- AST-005 (P0)
- AST-006 (P1)
- AST-007 (P1)
- AST-008 (P1)
- AST-009 (P1)
- AST-010 (P2)
- PLG-001 (P0)
- PLG-002 (P0)
- PLG-003 (P0)
- PLG-004 (P0)
- PLG-005 (P1)
- PLG-006 (P1)
- PLG-007 (P2)
- COL-001 (P1)
- COL-002 (P1)
- COL-003 (P1)
- COL-004 (P1)
- COL-005 (P1)
- COL-006 (P2)
- DRM-001 (P2)
- DRM-002 (P2)
- DRM-003 (P2)
- DRM-004 (P2)
- DRM-005 (P2)
- DRM-006 (P2)
- DRM-007 (P2)
- DRM-008 (P2)
- DRM-009 (P2)
- DRM-010 (P3)
- COM-001 (P2)
- COM-002 (P2)
- COM-003 (P2)
- COM-004 (P2)
- COM-005 (P2)
- COM-006 (P3)
- BIL-001 (P1)
- BIL-002 (P1)
- BIL-003 (P2)
- BIL-004 (P2)
- BIL-005 (P2)
- BIL-006 (P2)
- BIL-007 (P2)
- BIL-008 (P2)
- ADM-001 (P1)
- ADM-002 (P1)
- ADM-003 (P1)
- ADM-004 (P1)
- ADM-005 (P1)
- ADM-006 (P2)
- ADM-007 (P2)
- ADM-008 (P1)
- ADM-009 (P1)
- ADM-010 (P1)
- OPS-001 (P0)
- OPS-002 (P0)
- OPS-003 (P1)
- OPS-004 (P1)
- OPS-005 (P1)
- OPS-006 (P0)
- OPS-007 (P0)
- OPS-008 (P1)
- OPS-009 (P1)
- OPS-010 (P1)
