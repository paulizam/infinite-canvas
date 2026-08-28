import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

import { loadAgentMediaUrl } from "./use-agent-media-url";

describe("Agent media object URLs", () => {
    afterEach(() => vi.restoreAllMocks());

    it("fetches protected media with a header and revokes its Blob URL", async () => {
        const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:agent-media");
        const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["image"], { type: "image/png" }), { status: 200 }));
        const endpoint = "http://127.0.0.1:17371";
        const source = `${endpoint}/agent/message-assets/${"a".repeat(64)}/${"b".repeat(64)}.png`;
        const media = await loadAgentMediaUrl(endpoint, "top-secret", source);

        expect(media.url).toBe("blob:agent-media");
        expect(String(fetchMock.mock.calls[0][0])).not.toContain("top-secret");
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("x-canvas-agent-token")).toBe("top-secret");
        media.revoke();
        expect(createObjectURL).toHaveBeenCalledOnce();
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:agent-media");
    });

    it("does not fetch or own public and data URLs", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const media = await loadAgentMediaUrl("http://127.0.0.1:17371", "top-secret", "data:image/png;base64,YQ==");
        expect(media.url).toBe("data:image/png;base64,YQ==");
        media.revoke();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
