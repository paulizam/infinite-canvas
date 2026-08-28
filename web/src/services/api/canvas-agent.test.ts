import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { fetchAgentJson, fetchAgentResource, resolveAgentMessageAssetUrl, withAgentAuth } from "./canvas-agent";

describe("Local Agent header authentication", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("merges the token header without overwriting content type", () => {
        const init = withAgentAuth("top-secret", { headers: { "content-type": "application/json", "x-request-id": "42" } });
        const headers = new Headers(init.headers);
        expect(headers.get("content-type")).toBe("application/json");
        expect(headers.get("x-request-id")).toBe("42");
        expect(headers.get("x-canvas-agent-token")).toBe("top-secret");
    });

    it("sends JSON authentication only in the header", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        await fetchAgentJson("http://127.0.0.1:17371", "top-secret", "/agent/codex/models?reload=1", { headers: { "content-type": "application/json" } });
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe("http://127.0.0.1:17371/agent/codex/models?reload=1");
        expect(String(url)).not.toContain("top-secret");
        expect(new Headers(init?.headers).get("x-canvas-agent-token")).toBe("top-secret");
        expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    });

    it("resolves persistent message assets without putting a token in the URL", () => {
        const digest = "a".repeat(64);
        const file = `${"b".repeat(64)}.png`;
        const url = resolveAgentMessageAssetUrl("http://127.0.0.1:17371/", `agent-asset:${digest}/${file}`);
        expect(url).toBe(`http://127.0.0.1:17371/agent/message-assets/${digest}/${file}`);
        expect(url).not.toContain("?");
    });

    it("refuses to forward the Agent token to an absolute or protocol-relative resource", () => {
        expect(() => fetchAgentResource("http://127.0.0.1:17371", "top-secret", "https://example.com/image.png")).toThrow("must be local");
        expect(() => fetchAgentResource("http://127.0.0.1:17371", "top-secret", "//example.com/image.png")).toThrow("must be local");
    });
});
