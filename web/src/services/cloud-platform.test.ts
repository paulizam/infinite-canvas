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
});
