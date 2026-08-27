import type { GenerationJob, LogicalModel } from "@infinite-canvas/contracts";
import { describe, expect, it, vi } from "vitest";

import { runCloudMediaGeneration, runCloudTextGeneration } from "./cloud-canvas-generation";

const model: LogicalModel = { id: "text.default", name: "Default", capability: "text", enabled: true, isDefault: true };

describe("Cloud Canvas generation adapter", () => {
    it("resolves a logical model and normalizes a text result", async () => {
        const job = { id: "job-1", phase: "succeeded", status: "succeeded", result: { choices: [{ message: { content: "answer" } }] } } as unknown as GenerationJob;
        const client = {
            listModels: vi.fn(async () => [model]),
            createGenerationJob: vi.fn(async () => ({ job, replayed: false })),
        };
        await expect(runCloudTextGeneration({ workspaceId: "w1", capability: "text", requestedModel: "local-name", parameters: { prompt: "hello" }, client: client as never })).resolves.toBe("answer");
        expect(client.createGenerationJob).toHaveBeenCalledWith("w1", expect.objectContaining({ logicalModelId: "text.default", capability: "text", parameters: { prompt: "hello" } }), undefined);
    });

    it("downloads only validated AssetRefs from a media result", async () => {
        const imageModel = { ...model, id: "image.default", capability: "image" as const };
        const job = { id: "job-2", phase: "succeeded", status: "succeeded", result: { assets: [{ assetId: "a1" }] } } as unknown as GenerationJob;
        const blob = new Blob(["image"], { type: "image/png" });
        const client = {
            listModels: vi.fn(async () => [imageModel]),
            createGenerationJob: vi.fn(async () => ({ job, replayed: false })),
            downloadAsset: vi.fn(async () => blob),
        };
        await expect(runCloudMediaGeneration({ workspaceId: "w1", capability: "image", requestedModel: "", parameters: {}, client: client as never })).resolves.toEqual([blob]);
        expect(client.downloadAsset).toHaveBeenCalledWith("a1", undefined);
    });
});
