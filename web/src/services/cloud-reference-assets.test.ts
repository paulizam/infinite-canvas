import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearCloudReferenceCache, uploadCloudReferenceImages } from "./cloud-reference-assets";

describe("Cloud reference assets", () => {
    beforeEach(clearCloudReferenceCache);

    it("uploads reference bytes once and returns only AssetRefs to the Job layer", async () => {
        const client = {
            uploadAsset: vi.fn(async (_workspaceId: string, _blob: Blob) => ({ asset: { id: "asset-1", mimeType: "image/png" }, deduplicated: false })),
        };
        const reference = { id: "r1", name: "reference.png", type: "image/png", dataUrl: "data:image/png;base64,AQID" };
        const first = await uploadCloudReferenceImages("workspace-1", [reference], undefined, client as never);
        const second = await uploadCloudReferenceImages("workspace-1", [reference], undefined, client as never);
        expect(first).toEqual([{ assetId: "asset-1", mimeType: "image/png" }]);
        expect(second).toEqual(first);
        expect(client.uploadAsset).toHaveBeenCalledOnce();
        expect(client.uploadAsset.mock.calls[0]?.[1]).toEqual(expect.any(Blob));
    });
});
