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
  });
});
