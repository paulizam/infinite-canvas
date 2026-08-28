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
  upstreamModel: {
    id: "11111111-1111-4111-8111-111111111111",
    modelId: "image-v1",
  },
  binding: { capabilityProfile: {} },
  apiKey: "secret",
} as WorkerResolvedModel;

describe("model gateway worker handler", () => {
  it("materializes leased input AssetRefs in memory without persisting data URLs in the job", async () => {
    const assetJob = {
      ...job,
      input: {
        prompt: "edit",
        images: [{ assetId: "input-1" }, { assetId: "input-1" }],
      },
    } as GenerationJob;
    const client = {
      resolveModel: vi.fn(async () => resolved),
      readAsset: vi.fn(async () => ({
        bytes: Uint8Array.from([1, 2, 3]),
        mimeType: "image/png",
      })),
      transition: vi.fn(async (_w, _id, phase, patch) => ({
        ...assetJob,
        ...patch,
        phase,
      })),
      persistAsset: vi.fn(async () => ({ assetId: "output-1" })),
      reportModelHealth: vi.fn(async () => ({ accepted: true as const })),
    } as unknown as WorkerApiClient;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { images: string[] };
      expect(body.images).toEqual([
        "data:image/png;base64,AQID",
        "data:image/png;base64,AQID",
      ]);
      return Response.json({ data: [{ url: "https://cdn.example/out.png" }] });
    });
    await createModelGatewayHandler(fetcher as typeof fetch)(
      assetJob,
      client,
      "worker-a",
    );
    expect(client.readAsset).toHaveBeenCalledOnce();
    expect(assetJob.input).toEqual({
      prompt: "edit",
      images: [{ assetId: "input-1" }, { assetId: "input-1" }],
    });
  });

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
      reportModelHealth: vi.fn(async () => ({ accepted: true as const })),
    } as unknown as WorkerApiClient;
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            billing_units: 3,
            data: [{ url: "https://cdn.example/result.png" }],
          }),
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
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
    expect(client.persistAsset).toHaveBeenCalledOnce();
    expect(client.transition).toHaveBeenLastCalledWith(
      "worker-a",
      "job-1",
      "succeeded",
      { billingActualUnits: 3 },
      undefined,
    );
  });

  it("blocks provider media whose public hostname resolves to loopback", async () => {
    const client = {
      resolveModel: vi.fn(async () => resolved),
      transition: vi.fn(async (_w, _id, phase, patch) => ({
        ...job,
        ...patch,
        phase,
      })),
      persistAsset: vi.fn(),
      reportModelHealth: vi.fn(async () => ({ accepted: true as const })),
    } as unknown as WorkerApiClient;
    const fetcher = vi.fn(async () =>
      Response.json({ data: [{ url: "https://media.example/private.png" }] }),
    );
    await createModelGatewayHandler(fetcher as typeof fetch, async () => [
      "127.0.0.1",
    ])(job, client, "worker-a");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(client.persistAsset).not.toHaveBeenCalled();
    expect(client.transition).toHaveBeenLastCalledWith(
      "worker-a",
      job.id,
      "needs_review",
      expect.objectContaining({
        errorMessage: expect.stringContaining("private host"),
      }),
      undefined,
    );
  });

  it("rejects oversized provider media before buffering the body", async () => {
    const client = {
      resolveModel: vi.fn(async () => resolved),
      transition: vi.fn(async (_w, _id, phase, patch) => ({
        ...job,
        ...patch,
        phase,
      })),
      persistAsset: vi.fn(),
      reportModelHealth: vi.fn(async () => ({ accepted: true as const })),
    } as unknown as WorkerApiClient;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ url: "https://media.example/huge.png" }] }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(), {
          headers: { "content-length": String(64 * 1024 * 1024 + 1) },
        }),
      );
    await createModelGatewayHandler(fetcher as typeof fetch, async () => [
      "203.0.113.10",
    ])(job, client, "worker-a");
    expect(client.persistAsset).not.toHaveBeenCalled();
    expect(client.transition).toHaveBeenLastCalledWith(
      "worker-a",
      job.id,
      "needs_review",
      expect.objectContaining({
        errorMessage: expect.stringContaining("64MiB"),
      }),
      undefined,
    );
  });

  it("[GEN-004] persists a binary audio response without parsing it as JSON", async () => {
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
      reportModelHealth: vi.fn(async () => ({ accepted: true as const })),
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

  it("[GEN-012] calls the submitted provider before finalizing cancellation", async () => {
    const cancelledJob = {
      ...job,
      phase: "cancel_requested",
      capability: "video",
      upstreamTaskId: "task/42",
      channelId: "c",
    } as GenerationJob;
    const cancellable = {
      ...resolved,
      binding: { capabilityProfile: { supportsCancel: true } },
    } as WorkerResolvedModel;
    const client = {
      resolveModel: vi.fn(async () => cancellable),
      transition: vi.fn(async (_w, _id, phase, patch) => ({
        ...cancelledJob,
        ...patch,
        phase,
      })),
    } as unknown as WorkerApiClient;
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    await createModelGatewayHandler(fetcher as typeof fetch)(
      cancelledJob,
      client,
      "worker-a",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/videos/task%2F42/cancel",
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
    expect(client.transition).toHaveBeenCalledWith(
      "worker-a",
      "job-1",
      "cancelled",
      {},
      undefined,
    );
  });

  it("applies the same request policy while polling", async () => {
    const pollingJob = {
      ...job,
      phase: "polling",
      capability: "video",
      upstreamTaskId: "task/42",
      channelId: "c",
    } as GenerationJob;
    const client = {
      resolveModel: vi.fn(async () => resolved),
      transition: vi.fn(async (_w, _id, phase, patch) => ({
        ...pollingJob,
        ...patch,
        phase,
      })),
      reportModelHealth: vi.fn(async () => ({ accepted: true as const })),
    } as unknown as WorkerApiClient;
    const fetcher = vi.fn(async () => Response.json({ status: "processing" }));
    await createModelGatewayHandler(fetcher as typeof fetch)(
      pollingJob,
      client,
      "worker-a",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/videos/task%2F42",
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it("normalizes a Gemini inline image before Asset persistence", async () => {
    const gemini = {
      ...resolved,
      protocol: { ...resolved.protocol, adapter: "gemini" },
    } as WorkerResolvedModel;
    const client = {
      resolveModel: vi.fn(async () => gemini),
      transition: vi.fn(async (_w, _id, phase, patch) => ({
        ...job,
        ...patch,
        phase,
      })),
      persistAsset: vi.fn(async () => ({
        assetId: "gemini-image",
        mimeType: "image/png",
      })),
      reportModelHealth: vi.fn(async () => ({ accepted: true as const })),
    } as unknown as WorkerApiClient;
    const fetcher = vi.fn(async (_input: string | URL | Request) =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: "iVBORw0KGgo=" } }],
            },
          },
        ],
      }),
    );
    await createModelGatewayHandler(fetcher as typeof fetch)(
      job,
      client,
      "worker-a",
    );
    expect(fetcher.mock.calls[0]?.[0]).toContain(":generateContent");
    expect(client.persistAsset).toHaveBeenCalledOnce();
  });

  it("redacts provider credentials before persisting a diagnostic", async () => {
    const patches: Record<string, unknown>[] = [];
    const client = {
      resolveModel: vi.fn(async () => resolved),
      transition: vi.fn(async (_w, _id, phase, patch) => {
        patches.push(patch);
        return { ...job, ...patch, phase } as GenerationJob;
      }),
      reportModelHealth: vi.fn(async () => ({ accepted: true as const })),
    } as unknown as WorkerApiClient;
    const fetcher = vi.fn(async () => {
      throw new Error(
        "Authorization: Bearer exposed-token api_key=secret sk-12345678",
      );
    });
    await createModelGatewayHandler(fetcher as typeof fetch)(
      job,
      client,
      "worker-a",
    );
    const diagnostic = JSON.stringify(patches.at(-1));
    expect(diagnostic).not.toContain("exposed-token");
    expect(diagnostic).not.toContain("sk-12345678");
    expect(diagnostic).toContain("[REDACTED]");
  });
});
