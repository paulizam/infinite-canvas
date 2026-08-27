import { describe, expect, it, vi } from "vitest";
import type { GenerationJob } from "@infinite-canvas/contracts";
import { createModelGatewayHandler } from "./gateway-handler.js";
import type { WorkerApiClient, WorkerResolvedModel } from "./client.js";

const job = {
  id: "job-1",
  phase: "claimed",
  capability: "image",
  logicalModelId: "image.default",
  input: { prompt: "draw" },
} as unknown as GenerationJob;
const resolved = {
  protocol: {
    id: "p",
    adapter: "openai-compatible",
    enabled: true,
    config: {},
  },
  channel: {
    id: "c",
    baseUrl: "https://api.example.com",
    config: {},
    enabled: true,
    credentialConfigured: true,
  },
  upstreamModel: { modelId: "image-v1" },
  binding: { capabilityProfile: {} },
  apiKey: "secret",
} as WorkerResolvedModel;

describe("model gateway worker handler", () => {
  it("executes a synchronous provider result through every persistence phase", async () => {
    const phases: string[] = [];
    const client = {
      resolveModel: vi.fn(async () => resolved),
      transition: vi.fn(
        async (
          _worker: string,
          _id: string,
          phase: string,
          patch: Record<string, unknown>,
        ) => {
          phases.push(phase);
          return { ...job, ...patch, phase } as GenerationJob;
        },
      ),
      persistAsset: vi.fn(async () => ({
        assetId: "asset-1",
        mimeType: "image/png",
      })),
    } as unknown as WorkerApiClient;
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ url: "https://cdn.example/result.png" }] }),
          { status: 200 },
        ),
    );
    await createModelGatewayHandler(fetcher as typeof fetch)(
      job,
      client,
      "worker-a",
    );
    expect(phases).toEqual([
      "submitting",
      "submitted",
      "result_ready",
      "persisting",
      "succeeded",
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
    );
    expect(client.persistAsset).toHaveBeenCalledOnce();
  });

  it("persists a binary audio response without parsing it as JSON", async () => {
    const audioJob = {
      ...job,
      capability: "audio",
      logicalModelId: "audio.default",
    } as GenerationJob;
    const audioResolved = {
      ...resolved,
      upstreamModel: { modelId: "tts-v1" },
    } as WorkerResolvedModel;
    const phases: string[] = [];
    const client = {
      resolveModel: vi.fn(async () => audioResolved),
      transition: vi.fn(async (_w, _id, phase, patch) => {
        phases.push(phase);
        return { ...audioJob, ...patch, phase } as GenerationJob;
      }),
      persistAsset: vi.fn(async () => ({
        assetId: "audio-1",
        mimeType: "audio/mpeg",
      })),
    } as unknown as WorkerApiClient;
    const fetcher = vi.fn(
      async () =>
        new Response(Uint8Array.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]), {
          headers: { "content-type": "audio/mpeg" },
        }),
    );
    await createModelGatewayHandler(fetcher as typeof fetch)(
      audioJob,
      client,
      "worker-a",
    );
    expect(phases).toEqual([
      "submitting",
      "submitted",
      "result_ready",
      "persisting",
      "succeeded",
    ]);
    expect(client.persistAsset).toHaveBeenCalledWith(
      "worker-a",
      "job-1",
      expect.any(Uint8Array),
      "job-1.mp3",
      undefined,
    );
  });

  it.each([
    ["result_ready", ["persisting", "succeeded"]],
    ["persisting", ["succeeded"]],
  ] as const)(
    "resumes %s without another provider call",
    async (phase, expected) => {
      const phases: string[] = [];
      const resumable = { ...job, phase } as GenerationJob;
      const client = {
        transition: vi.fn(async (_w, _id, next, patch) => {
          phases.push(next);
          return { ...resumable, ...patch, phase: next } as GenerationJob;
        }),
      } as unknown as WorkerApiClient;
      const fetcher = vi.fn();
      await createModelGatewayHandler(fetcher as typeof fetch)(
        resumable,
        client,
        "worker-a",
      );
      expect(phases).toEqual(expected);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
