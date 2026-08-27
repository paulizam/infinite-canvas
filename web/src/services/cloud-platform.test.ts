import { describe, expect, it, vi } from "vitest";

import { CloudApiError, CloudPlatformClient } from "./cloud-platform";

describe("CloudPlatformClient", () => {
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
});
