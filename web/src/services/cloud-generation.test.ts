import type { GenerationJob } from "@infinite-canvas/contracts";
import { describe, expect, it, vi } from "vitest";

import { CloudGenerationError, createAndWaitForGeneration, generationAssets, generationText, waitForGeneration } from "./cloud-generation";

const queued = {
    id: "job-1",
    workspaceId: "workspace-1",
    phase: "queued",
    status: "queued",
    result: null,
    errorMessage: null,
} as GenerationJob;

describe("cloud generation orchestration", () => {
    it("creates with a stable client request id and waits for success", async () => {
        const succeeded = { ...queued, phase: "succeeded", status: "succeeded", result: { text: "done" } } as GenerationJob;
        const client = {
            createGenerationJob: vi.fn(async () => ({ job: queued, replayed: false })),
            getGenerationJob: vi.fn(async () => succeeded),
        };
        const result = await createAndWaitForGeneration(client as never, { workspaceId: "workspace-1", capability: "text", logicalModelId: "text.default", clientRequestId: "request-1", parameters: { prompt: "hello" } }, { sleep: async () => undefined });
        expect(result).toBe(succeeded);
        expect(client.createGenerationJob).toHaveBeenCalledWith("workspace-1", expect.objectContaining({ clientRequestId: "request-1" }), undefined);
    });

    it("requests provider cancellation when the browser operation is aborted", async () => {
        const controller = new AbortController();
        const client = { getGenerationJob: vi.fn(), cancelGenerationJob: vi.fn(async () => queued) };
        const promise = waitForGeneration(client as never, queued, {
            signal: controller.signal,
            sleep: async () => {
                controller.abort();
                throw new DOMException("aborted", "AbortError");
            },
        });
        await expect(promise).rejects.toMatchObject({ name: "AbortError" });
        expect(client.cancelGenerationJob).toHaveBeenCalledWith("job-1");
    });

    it("preserves terminal diagnostics for failed and review jobs", async () => {
        const failed = { ...queued, phase: "needs_review", status: "needs_review", errorMessage: "manual review" } as GenerationJob;
        await expect(waitForGeneration({} as never, failed)).rejects.toEqual(expect.objectContaining<Partial<CloudGenerationError>>({ message: "manual review", job: failed }));
    });
});

describe("cloud generation result parsing", () => {
    it("accepts normalized, OpenAI and asset results", () => {
        expect(generationText({ ...queued, result: { text: "Gemini" } } as GenerationJob)).toBe("Gemini");
        expect(generationText({ ...queued, result: { choices: [{ message: { content: "OpenAI" } }] } } as GenerationJob)).toBe("OpenAI");
        expect(generationAssets({ ...queued, result: { assets: [{ assetId: "asset-1", mimeType: "image/png" }, { nope: true }] } } as GenerationJob)).toEqual([{ assetId: "asset-1", mimeType: "image/png" }]);
    });
});
