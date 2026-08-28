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

    it("streams text deltas and then reads the authoritative terminal job", async () => {
        const succeeded = { ...queued, phase: "succeeded", status: "succeeded", result: { text: "hello" } } as GenerationJob;
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(
                        'id: 1\nevent: text.delta\ndata: {"type":"text.delta","payload":{"delta":"hel"}}\n\nid: 2\nevent: text.delta\ndata: {"type":"text.delta","payload":{"delta":"lo"}}\n\nid: 3\nevent: job.terminal\ndata: {"type":"job.terminal","payload":{"phase":"succeeded"}}\n\n',
                    ),
                );
                controller.close();
            },
        });
        const client = { createGenerationJob: vi.fn(async () => ({ job: queued, replayed: false })), openGenerationEvents: vi.fn(async () => new Response(stream)), getGenerationJob: vi.fn(async () => succeeded) };
        const updates: string[] = [];
        await expect(
            createAndWaitForGeneration(client as never, { workspaceId: "workspace-1", capability: "text", logicalModelId: "text.default", clientRequestId: "request-stream", parameters: {} }, { onTextDelta: (text) => updates.push(text) }),
        ).resolves.toBe(succeeded);
        expect(updates).toEqual(["hel", "hello"]);
    });

    it("abandons an oversized event stream and falls back to polling", async () => {
        const succeeded = { ...queued, phase: "succeeded", status: "succeeded", result: { text: "polled" } } as GenerationJob;
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1));
                controller.close();
            },
        });
        const client = {
            createGenerationJob: vi.fn(async () => ({ job: queued, replayed: false })),
            openGenerationEvents: vi.fn(async () => new Response(stream)),
            getGenerationJob: vi.fn(async () => succeeded),
        };
        await expect(
            createAndWaitForGeneration(
                client as never,
                { workspaceId: "workspace-1", capability: "text", logicalModelId: "text.default", clientRequestId: "request-oversized", parameters: {} },
                { onTextDelta: vi.fn(), sleep: async () => undefined },
            ),
        ).resolves.toBe(succeeded);
        expect(client.getGenerationJob).toHaveBeenCalledOnce();
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

    it("[GEN-014][GEN-015] preserves terminal diagnostics for failed and review jobs", async () => {
        const failed = { ...queued, phase: "needs_review", status: "needs_review", errorMessage: "manual review" } as GenerationJob;
        await expect(waitForGeneration({} as never, failed)).rejects.toEqual(expect.objectContaining<Partial<CloudGenerationError>>({ message: "manual review", job: failed }));
    });
});

describe("cloud generation result parsing", () => {
    it("[GEN-015] restores normalized text and batch asset results", () => {
        expect(generationText({ ...queued, result: { text: "Gemini" } } as GenerationJob)).toBe("Gemini");
        expect(generationText({ ...queued, result: { choices: [{ message: { content: "OpenAI" } }] } } as GenerationJob)).toBe("OpenAI");
        expect(generationAssets({ ...queued, result: { assets: [{ assetId: "asset-1", mimeType: "image/png" }, { nope: true }] } } as GenerationJob)).toEqual([{ assetId: "asset-1", mimeType: "image/png" }]);
    });
});
