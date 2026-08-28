# Requirement Test Traceability

> 由 `node ops/requirements-trace.mjs` 生成。这里只统计测试源码中的显式 Requirement ID；直接引用表示该测试声明覆盖该需求，不代表真实外部环境验收已 PASS。

## Summary

- Requirements: 133
- Direct test references: 133
- Without direct test reference: 0

## Direct references

| ID | P | Tests |
|---|---:|---|
| BAS-001 | P0 | `web/src/i18n/drama-i18n.test.ts` |
| BAS-002 | P0 | `web/src/lib/canvas/canvas-export.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts`<br>`web/src/stores/canvas/use-canvas-store.test.ts` |
| BAS-003 | P0 | `apps/api/src/app.test.ts` |
| BAS-004 | P0 | `apps/api/src/app.test.ts`<br>`web/src/services/cloud-platform.test.ts`<br>`web/src/services/installation-route.test.ts` |
| BAS-005 | P1 | `apps/api/src/app.test.ts` |
| BAS-006 | P1 | `apps/api/src/admin-mfa-service.test.ts` |
| BAS-007 | P1 | `apps/api/src/app.test.ts` |
| BAS-008 | P1 | `apps/api/src/app.test.ts` |
| BAS-009 | P2 | `apps/api/src/data-governance-service.test.ts` |
| BAS-010 | P1 | `web/src/services/cloud-canvas-sync.test.ts` |
| CAN-001 | P0 | `web/src/stores/canvas/use-canvas-store.test.ts` |
| CAN-002 | P0 | `web/src/lib/canvas/canvas-interactions.test.ts` |
| CAN-003 | P0 | `web/src/lib/canvas/canvas-interactions.test.ts` |
| CAN-004 | P0 | `packages/canvas-core/src/core.test.ts` |
| CAN-005 | P0 | `packages/canvas-core/src/core.test.ts` |
| CAN-006 | P0 | `packages/canvas-core/src/core.test.ts` |
| CAN-007 | P0 | `web/src/lib/canvas/canvas-file-drop.test.ts` |
| CAN-008 | P0 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-export.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-009 | P0 | `web/src/lib/canvas/canvas-media-geometry.test.ts` |
| CAN-010 | P0 | `web/src/lib/canvas/canvas-generation-contracts.test.ts` |
| CAN-011 | P0 | `web/src/lib/canvas/canvas-generation-contracts.test.ts` |
| CAN-012 | P1 | `web/src/lib/studio/project-media-projection.test.ts` |
| CAN-013 | P1 | `apps/api/src/app.test.ts` |
| CAN-014 | P1 | `apps/api/src/app.test.ts` |
| CAN-015 | P1 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-project-organization.test.ts`<br>`web/src/services/cloud-canvas-sync.test.ts` |
| CAN-016 | P2 | `web/src/lib/canvas/canvas-agent-ops.test.ts` |
| GEN-001 | P0 | `apps/api/src/generation-job-api.test.ts`<br>`web/src/services/canvas-generation-provider.test.ts` |
| GEN-002 | P0 | `web/src/services/canvas-generation-provider.test.ts` |
| GEN-003 | P0 | `web/src/services/canvas-generation-provider.test.ts` |
| GEN-004 | P0 | `apps/worker/src/gateway-handler.test.ts` |
| GEN-005 | P0 | `packages/model-gateway/src/router.test.ts`<br>`web/src/services/api/model-channel-discovery.test.ts`<br>`web/src/stores/model-channel-config.test.ts` |
| GEN-006 | P0 | `apps/api/src/model-gateway-api.test.ts` |
| GEN-007 | P0 | `packages/model-gateway/src/router.test.ts` |
| GEN-008 | P1 | `packages/model-gateway/src/provider-specific.test.ts`<br>`packages/model-gateway/src/router.test.ts` |
| GEN-009 | P1 | `apps/api/src/model-gateway-api.test.ts` |
| GEN-010 | P0 | `apps/api/src/generation-job-api.test.ts` |
| GEN-011 | P0 | `apps/api/src/generation-job-api.test.ts` |
| GEN-012 | P0 | `apps/worker/src/gateway-handler.test.ts` |
| GEN-013 | P0 | `apps/api/src/generation-job-api.test.ts` |
| GEN-014 | P1 | `apps/api/src/admin-service.test.ts`<br>`apps/api/src/observability.test.ts`<br>`web/src/services/cloud-generation.test.ts` |
| GEN-015 | P1 | `apps/api/src/asset-service.test.ts`<br>`web/src/services/cloud-generation.test.ts` |
| GEN-016 | P1 | `apps/api/src/generation-job-api.test.ts` |
| GEN-017 | P2 | `packages/model-gateway/src/volcengine.test.ts` |
| GEN-018 | P2 | `packages/model-gateway/src/provider-specific.test.ts` |
| AGT-001 | P0 | `canvas-agent/src/canvas/session.test.ts` |
| AGT-002 | P0 | `canvas-agent/src/canvas/session.test.ts` |
| AGT-003 | P1 | `canvas-agent/src/agent/claude.test.ts` |
| AGT-004 | P1 | `apps/worker/src/remote-agent-adapter.test.ts` |
| AGT-005 | P1 | `apps/worker/src/remote-agent-adapter.test.ts` |
| AGT-006 | P1 | `apps/api/src/agent-run-api.test.ts` |
| AGT-007 | P1 | `apps/worker/src/remote-agent-adapter.test.ts` |
| AGT-008 | P1 | `canvas-agent/src/skills/store.test.ts` |
| AGT-009 | P2 | `canvas-agent/src/skills/installer.test.ts` |
| AGT-010 | P1 | `apps/worker/src/remote-agent-adapter.test.ts` |
| AGT-011 | P2 | `apps/worker/src/remote-agent-adapter.test.ts` |
| WFL-001 | P1 | `packages/workflow-runtime/src/validator.test.ts` |
| WFL-002 | P1 | `packages/workflow-runtime/src/validator.test.ts` |
| WFL-003 | P1 | `packages/workflow-runtime/src/compiler.test.ts` |
| WFL-004 | P1 | `packages/workflow-runtime/src/execution.test.ts` |
| WFL-005 | P1 | `packages/workflow-runtime/src/execution.test.ts` |
| WFL-006 | P1 | `packages/workflow-runtime/src/execution.test.ts` |
| WFL-007 | P1 | `packages/workflow-runtime/src/execution.test.ts` |
| WFL-008 | P2 | `apps/api/src/workflow-api.test.ts` |
| WFL-009 | P2 | `apps/api/src/workflow-api.test.ts` |
| WFL-010 | P2 | `apps/api/src/workflow-api.test.ts` |
| AST-001 | P0 | `apps/api/src/app.test.ts` |
| AST-002 | P0 | `apps/api/src/asset-provider-switch-runtime.integration.test.ts`<br>`apps/api/src/asset-service.test.ts` |
| AST-003 | P0 | `apps/api/src/asset-service.test.ts` |
| AST-004 | P0 | `apps/api/src/app.test.ts` |
| AST-005 | P0 | `apps/api/src/asset-service.test.ts`<br>`apps/api/src/blob-store-runtime.integration.test.ts` |
| AST-006 | P1 | `apps/api/src/app.test.ts` |
| AST-007 | P1 | `web/src/services/webdav-runtime.integration.test.ts`<br>`web/src/services/webdav-sync.test.ts` |
| AST-008 | P1 | `web/src/services/api/prompts.test.ts` |
| AST-009 | P1 | `apps/api/src/admin-service.test.ts`<br>`web/src/services/api/prompts.test.ts`<br>`web/src/services/cloud-platform.test.ts`<br>`web/src/services/prompt-handoff.test.ts` |
| AST-010 | P2 | `apps/api/src/asset-service.test.ts` |
| PLG-001 | P0 | `web/src/lib/canvas/canvas-export.test.ts`<br>`web/src/lib/canvas/plugin-node-codec.test.ts` |
| PLG-002 | P0 | `web/src/lib/canvas/builtin-plugin-catalog.test.ts` |
| PLG-003 | P0 | `web/src/lib/canvas/plugin-integrity.test.ts`<br>`web/src/lib/canvas/plugin-manifest.test.ts` |
| PLG-004 | P0 | `web/src/lib/canvas/plugin-lifecycle.test.ts` |
| PLG-005 | P1 | `web/src/lib/canvas/plugin-browser-runtime.integration.test.ts`<br>`web/src/lib/canvas/plugin-compatibility.test.ts`<br>`web/src/lib/canvas/plugin-lifecycle.test.ts` |
| PLG-006 | P1 | `web/src/lib/canvas/plugin-manifest.test.ts` |
| PLG-007 | P2 | `web/src/lib/canvas/plugin-compatibility.test.ts`<br>`web/src/lib/canvas/plugin-lifecycle.test.ts` |
| COL-001 | P1 | `apps/api/src/collaboration.test.ts` |
| COL-002 | P1 | `apps/api/src/app.test.ts` |
| COL-003 | P1 | `web/src/services/cloud-canvas-sync.test.ts` |
| COL-004 | P1 | `apps/api/src/collaboration.test.ts` |
| COL-005 | P1 | `apps/api/src/app.test.ts` |
| COL-006 | P2 | `web/src/services/cloud-canvas-sync.test.ts` |
| COL-007 | P2 | `apps/api/src/app.test.ts` |
| DRM-001 | P2 | `web/src/i18n/drama-i18n.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| DRM-002 | P2 | `apps/api/src/drama-api.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| DRM-003 | P2 | `web/src/services/cloud-platform.test.ts` |
| DRM-004 | P2 | `web/src/services/cloud-platform.test.ts` |
| DRM-005 | P2 | `web/src/services/cloud-platform.test.ts` |
| DRM-006 | P2 | `web/src/services/cloud-platform.test.ts` |
| DRM-007 | P2 | `apps/worker/src/drama-render-runtime.integration.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| DRM-008 | P2 | `web/src/services/cloud-platform.test.ts` |
| DRM-009 | P2 | `web/src/services/cloud-platform.test.ts` |
| DRM-010 | P3 | `web/src/services/cloud-platform.test.ts` |
| COM-001 | P2 | `apps/api/src/community-api.test.ts` |
| COM-002 | P2 | `apps/api/src/community-api.test.ts` |
| COM-003 | P2 | `apps/api/src/community-api.test.ts` |
| COM-004 | P2 | `apps/api/src/community-api.test.ts` |
| COM-005 | P2 | `apps/api/src/community-api.test.ts` |
| COM-006 | P3 | `apps/api/src/community-api.test.ts` |
| BIL-001 | P1 | `apps/api/src/commerce-api.test.ts` |
| BIL-002 | P1 | `apps/api/src/generation-job-api.test.ts` |
| BIL-003 | P2 | `apps/api/src/commerce-api.test.ts` |
| BIL-004 | P2 | `apps/api/src/commerce-api.test.ts` |
| BIL-005 | P2 | `apps/api/src/payment-service.test.ts` |
| BIL-006 | P2 | `apps/api/src/payment-service.test.ts` |
| BIL-007 | P2 | `apps/api/src/payment-service.test.ts` |
| BIL-008 | P2 | `apps/api/src/admin-domain-api.test.ts` |
| ADM-001 | P1 | `apps/api/src/admin-service.test.ts` |
| ADM-002 | P1 | `apps/api/src/admin-service.test.ts` |
| ADM-003 | P1 | `apps/api/src/admin-domain-api.test.ts` |
| ADM-004 | P1 | `apps/api/src/admin-service.test.ts` |
| ADM-005 | P1 | `apps/api/src/admin-service.test.ts` |
| ADM-006 | P2 | `apps/api/src/admin-domain-api.test.ts` |
| ADM-007 | P2 | `apps/api/src/admin-service.test.ts` |
| ADM-008 | P1 | `apps/api/src/admin-service.test.ts` |
| ADM-009 | P1 | `apps/api/src/admin-service.test.ts` |
| ADM-010 | P1 | `apps/api/src/admin-domain-api.test.ts` |
| OPS-001 | P0 | `apps/api/scripts/business-transfer.test.ts` |
| OPS-002 | P0 | `apps/api/scripts/business-transfer.test.ts` |
| OPS-003 | P1 | `apps/api/scripts/business-transfer.test.ts` |
| OPS-004 | P1 | `apps/api/src/observability.test.ts` |
| OPS-005 | P1 | `apps/api/src/observability.test.ts` |
| OPS-006 | P0 | `apps/api/src/app.test.ts` |
| OPS-007 | P0 | `apps/api/scripts/business-transfer.test.ts` |
| OPS-008 | P1 | `apps/api/src/app.test.ts` |
| OPS-009 | P1 | `apps/api/src/data-governance-service.test.ts` |
| OPS-010 | P1 | `apps/api/scripts/business-transfer.test.ts` |

## Missing direct references

- None.
