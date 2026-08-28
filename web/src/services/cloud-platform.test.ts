import { describe, expect, it, vi } from "vitest";

import { CloudApiError, CloudPlatformClient } from "./cloud-platform";

describe("CloudPlatformClient", () => {
    it("[BAS-004] submits the installation token only in the bootstrap body", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: { installed: false }, requestId: "install" }));
        const client = new CloudPlatformClient("", fetcher);
        await client.installationStatus();
        const input = { token: "one-time-secret", email: "admin@example.com", password: "password", name: "Admin" };
        await client.install(input);
        expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/install/status", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v1/install", expect.objectContaining({ method: "POST", body: JSON.stringify(input) }));
    });
    it("uses cookie credentials and encodes workspace ids", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: [], requestId: "r1" }));
        const client = new CloudPlatformClient("https://api.example", fetcher);
        await client.listProjects("team/a");
        expect(fetcher).toHaveBeenCalledWith("https://api.example/api/v1/workspaces/team%2Fa/projects", expect.objectContaining({ credentials: "include" }));
    });

    it("surfaces structured API errors without losing the request id", async () => {
        const fetcher = vi.fn(async () => Response.json({ error: { code: "UNAUTHENTICATED", message: "登录已失效" }, requestId: "r2" }, { status: 401 }));
        const client = new CloudPlatformClient("", fetcher);
        await expect(client.me()).rejects.toEqual(expect.objectContaining<Partial<CloudApiError>>({ status: 401, code: "UNAUTHENTICATED", requestId: "r2" }));
    });

    it("rejects successful responses that violate the envelope contract", async () => {
        const client = new CloudPlatformClient(
            "",
            vi.fn(async () => Response.json({ requestId: "r3" })),
        );
        await expect(client.me()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("encodes model ids and sends billing estimate parameters", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: { estimatedUnits: 12 }, requestId: "r4" }));
        const client = new CloudPlatformClient("", fetcher);
        await client.estimateGeneration("image/default", "image", { count: 2 });
        expect(fetcher).toHaveBeenCalledWith("/api/v1/models/image%2Fdefault/estimate", expect.objectContaining({ method: "POST", body: JSON.stringify({ capability: "image", parameters: { count: 2 } }) }));
    });

    it("uses the generation job endpoints without leaking raw resource ids", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: [], requestId: "r5" }));
        const client = new CloudPlatformClient("https://api.example", fetcher);
        await client.listGenerationJobs("team/a");
        await client.getGenerationJob("job/a");
        expect(fetcher).toHaveBeenNthCalledWith(1, "https://api.example/api/v1/workspaces/team%2Fa/generation-jobs", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(2, "https://api.example/api/v1/generation-jobs/job%2Fa", expect.any(Object));
    });

    it("lists workspace assets with an encoded workspace id", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: [], requestId: "assets" }));
        const client = new CloudPlatformClient("https://api.example", fetcher);
        await client.listAssets("team/a");
        expect(fetcher).toHaveBeenCalledWith("https://api.example/api/v1/workspaces/team%2Fa/assets", expect.objectContaining({ credentials: "include" }));
    });

    it("loads wallet and immutable ledger through authenticated requests", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: [], requestId: "r6" }));
        const client = new CloudPlatformClient("", fetcher);
        await client.getBillingWallet();
        await client.listBillingLedger();
        expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/billing/wallet", expect.objectContaining({ credentials: "include" }));
        expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v1/billing/ledger", expect.objectContaining({ credentials: "include" }));
    });

    it("publishes workflows with encoded ids and preserves 422 compile diagnostics", async () => {
        const result = { compile: { publishable: false, definition: {}, sourceMapping: { nodes: {}, edges: {} }, issues: [{ code: "EMPTY_WORKFLOW", severity: "error", message: "empty" }] }, publication: null };
        const fetcher = vi.fn(async () => Response.json({ data: result, requestId: "r7" }, { status: 422 }));
        const client = new CloudPlatformClient("", fetcher);
        await expect(client.publishWorkflow("project/a", { publicationId: "pub-1", expectedProjectRevision: 3 })).resolves.toEqual(result);
        expect(fetcher).toHaveBeenCalledWith("/api/v1/projects/project%2Fa/workflows/publish", expect.objectContaining({ method: "POST", body: JSON.stringify({ publicationId: "pub-1", expectedProjectRevision: 3 }) }));
    });

    it("queries current workflow and immutable versions with encoded ids", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: [], requestId: "r8" }));
        const client = new CloudPlatformClient("", fetcher);
        await client.getProjectWorkflow("project/a");
        await client.listWorkflowVersions("workflow/a");
        expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/projects/project%2Fa/workflow", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v1/workflows/workflow%2Fa/versions", expect.any(Object));
    });

    it("uses encoded workflow execution lifecycle endpoints", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: [], requestId: "r9" }));
        const client = new CloudPlatformClient("", fetcher);
        await client.listWorkflowExecutions("workflow/a");
        await client.createWorkflowExecution("workflow/a", { executionId: "run", startNodeIds: ["node/a"] });
        await client.getWorkflowExecution("run/a");
        await client.cancelWorkflowExecution("run/a");
        await client.retryWorkflowNode("run/a", "node/a");
        expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/workflows/workflow%2Fa/executions", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v1/workflows/workflow%2Fa/executions", expect.objectContaining({ method: "POST", body: JSON.stringify({ executionId: "run", startNodeIds: ["node/a"] }) }));
        expect(fetcher).toHaveBeenNthCalledWith(3, "/api/v1/workflow-executions/run%2Fa", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(4, "/api/v1/workflow-executions/run%2Fa/cancel", expect.objectContaining({ method: "POST" }));
        expect(fetcher).toHaveBeenNthCalledWith(5, "/api/v1/workflow-executions/run%2Fa/nodes/node%2Fa/retry", expect.objectContaining({ method: "POST" }));
    });

    it("uses encoded workflow library and folder endpoints", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: [], requestId: "r10" }));
        const client = new CloudPlatformClient("", fetcher);
        await client.getWorkflowLibrary("team/a");
        await client.createWorkflowFolder("team/a", "Ideas");
        await client.deleteWorkflowFolder("folder/a");
        await client.updateWorkflowLibrary("workflow/a", { folderId: "folder/a", tags: ["featured"], isTemplate: true });
        expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/workspaces/team%2Fa/workflow-library", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v1/workspaces/team%2Fa/workflow-folders", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Ideas" }) }));
        expect(fetcher).toHaveBeenNthCalledWith(3, "/api/v1/workflow-folders/folder%2Fa", expect.objectContaining({ method: "DELETE" }));
        expect(fetcher).toHaveBeenNthCalledWith(4, "/api/v1/workflows/workflow%2Fa/library", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ folderId: "folder/a", tags: ["featured"], isTemplate: true }) }));
    });

    it("exports, imports and instantiates portable workflow bundles", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: {}, requestId: "r11" }));
        const client = new CloudPlatformClient("", fetcher);
        const bundle = { format: "infinite-canvas.workflow", schemaVersion: 1 } as never;
        await client.exportWorkflow("workflow/a", 7);
        await client.importWorkflow("team/a", bundle, "Imported");
        await client.instantiateWorkflowTemplate("template/a", "Copy");
        expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/workflows/workflow%2Fa/export?version=7", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v1/workspaces/team%2Fa/workflows/import", expect.objectContaining({ method: "POST", body: JSON.stringify({ bundle, name: "Imported" }) }));
        expect(fetcher).toHaveBeenNthCalledWith(3, "/api/v1/workflow-templates/template%2Fa/instantiate", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Copy" }) }));
    });

    it("manages scoped workflow API tokens without placing secrets in paths", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: [], requestId: "r12" }));
        const client = new CloudPlatformClient("", fetcher);
        const input = { name: "Production", scopes: ["invoke", "read_execution"] as const, rateLimitPerMinute: 30 };
        await client.listWorkflowApiTokens("workflow/a");
        await client.listWorkflowApiAudit("workflow/a", 20);
        await client.createWorkflowApiToken("workflow/a", { ...input, scopes: [...input.scopes] });
        await client.rotateWorkflowApiToken("token/a");
        await client.revokeWorkflowApiToken("token/a");
        expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/workflows/workflow%2Fa/api-tokens", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v1/workflows/workflow%2Fa/api-audit?limit=20", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(3, "/api/v1/workflows/workflow%2Fa/api-tokens", expect.objectContaining({ method: "POST", body: JSON.stringify(input) }));
        expect(fetcher).toHaveBeenNthCalledWith(4, "/api/v1/workflow-api-tokens/token%2Fa/rotate", expect.objectContaining({ method: "POST" }));
        expect(fetcher).toHaveBeenNthCalledWith(5, "/api/v1/workflow-api-tokens/token%2Fa", expect.objectContaining({ method: "DELETE" }));
    });

    it("uses encoded durable Agent Run lifecycle endpoints", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: [], requestId: "r13" }));
        const client = new CloudPlatformClient("", fetcher);
        await client.listAgentSessions("team/a");
        await client.createAgentSession("team/a", { title: "Campaign" });
        await client.listAgentRuns("session/a");
        await client.createAgentRun("session/a", { prompt: "Launch", attachments: [] });
        await client.getAgentRun("run/a");
        await client.cancelAgentRun("run/a");
        await client.retryAgentRun("run/a");
        await client.decideAgentApproval("approval/a", "approved");
        expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/workspaces/team%2Fa/agent-sessions", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v1/workspaces/team%2Fa/agent-sessions", expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "Campaign" }) }));
        expect(fetcher).toHaveBeenNthCalledWith(3, "/api/v1/agent-sessions/session%2Fa/runs", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(4, "/api/v1/agent-sessions/session%2Fa/runs", expect.objectContaining({ method: "POST" }));
        expect(fetcher).toHaveBeenNthCalledWith(5, "/api/v1/agent-runs/run%2Fa", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(8, "/api/v1/agent-approvals/approval%2Fa/decision", expect.objectContaining({ body: JSON.stringify({ decision: "approved" }) }));
    });

    it("uses encoded checkpoint lifecycle endpoints and sends the expected revision", async () => {
        const fetcher = vi.fn(async () => Response.json({ data: [], requestId: "checkpoint" }));
        const client = new CloudPlatformClient("", fetcher);
        await client.listProjectCheckpoints("project/a");
        await client.createProjectCheckpoint("project/a", { name: "Draft", description: "baseline" });
        await client.getProjectCheckpoint("project/a", "checkpoint/a");
        await client.restoreProjectCheckpoint("project/a", "checkpoint/a", 7);
        await client.deleteProjectCheckpoint("project/a", "checkpoint/a");
        expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/projects/project%2Fa/checkpoints", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v1/projects/project%2Fa/checkpoints", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Draft", description: "baseline" }) }));
        expect(fetcher).toHaveBeenNthCalledWith(3, "/api/v1/projects/project%2Fa/checkpoints/checkpoint%2Fa", expect.any(Object));
        expect(fetcher).toHaveBeenNthCalledWith(4, "/api/v1/projects/project%2Fa/checkpoints/checkpoint%2Fa/restore", expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedRevision: 7 }) }));
        expect(fetcher).toHaveBeenNthCalledWith(5, "/api/v1/projects/project%2Fa/checkpoints/checkpoint%2Fa", expect.objectContaining({ method: "DELETE" }));
    });
});
