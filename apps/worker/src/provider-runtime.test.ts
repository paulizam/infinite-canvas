import { describe, expect, it, vi } from "vitest";
import type { WorkerResolvedModel } from "./client.js";
import {
  buildOperationRequest,
  buildSubmitRequest,
  MAX_PROVIDER_JSON_BYTES,
  normalizePayload,
  providerFetch,
  safeJson,
} from "./provider-runtime.js";

function resolved(
  adapter: WorkerResolvedModel["protocol"]["adapter"],
): WorkerResolvedModel {
  return {
    protocol: {
      id: adapter,
      name: adapter,
      adapter,
      enabled: true,
      config: {},
    },
    channel: {
      id: "11111111-1111-4111-8111-111111111111",
      name: adapter,
      protocolId: adapter,
      baseUrl: "https://provider.example",
      enabled: true,
      credentialConfigured: true,
      config: {},
    },
    upstreamModel: {
      id: "22222222-2222-4222-8222-222222222222",
      channelId: "11111111-1111-4111-8111-111111111111",
      modelId: "model-1",
      capability: adapter === "seedance" ? "video" : "image",
      enabled: true,
      healthState: "healthy",
      cooldownUntil: null,
      config: {},
    },
    logicalModel: {
      id: "default",
      name: "Default",
      capability: adapter === "seedance" ? "video" : "image",
      enabled: true,
      isDefault: true,
    },
    binding: {
      id: "33333333-3333-4333-8333-333333333333",
      logicalModelId: "default",
      upstreamModelId: "22222222-2222-4222-8222-222222222222",
      enabled: true,
      priority: 1,
      weight: 100,
      capabilityProfile: {},
    },
    apiKey: "secret",
  };
}

describe("worker provider-specific routing", () => {
  it("routes Seedance submit and polling through the explicit adapter", () => {
    const runtime = resolved("seedance");
    expect(
      buildSubmitRequest(runtime, "video", { prompt: "scene" }).url,
    ).toContain("contents/generations/tasks");
    expect(
      buildOperationRequest(runtime, "video", "poll", "task/1").url,
    ).toContain("task%2F1");
  });
  it("normalizes A1111 output before asset persistence", () => {
    expect(
      normalizePayload(
        resolved("stable-diffusion"),
        { images: ["abc"] },
        "image",
      ),
    ).toMatchObject({ status: "succeeded", data: [{ base64: "abc" }] });
  });
  it("normalizes completed Veo operations into video URLs", () => {
    expect(
      normalizePayload(
        resolved("gemini"),
        {
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                { video: { uri: "https://media.example/video.mp4" } },
              ],
            },
          },
        },
        "video",
      ),
    ).toEqual({
      data: [{ url: "https://media.example/video.mp4" }],
      status: "succeeded",
    });
  });
});

describe("provider response boundaries", () => {
  it("preserves the adapter request while rejecting redirects", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    await providerFetch(
      fetcher as typeof fetch,
      "https://provider.example/jobs",
      {
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: "payload",
      },
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://provider.example/jobs",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: "payload",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects an oversized declared response before reading it", async () => {
    const response = new Response("not-read", {
      headers: {
        "content-length": String(MAX_PROVIDER_JSON_BYTES + 1),
      },
    });
    await expect(safeJson(response)).rejects.toThrow("exceeds the size limit");
    expect(response.bodyUsed).toBe(false);
  });

  it("rejects a chunked response that crosses the actual byte limit", async () => {
    const oversized = new Uint8Array(MAX_PROVIDER_JSON_BYTES + 1);
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(oversized);
          controller.close();
        },
      }),
    );
    await expect(safeJson(response)).rejects.toThrow("exceeds the size limit");
  });

  it("accepts JSON objects and rejects arrays or scalar values", async () => {
    await expect(safeJson(Response.json({ ok: true }))).resolves.toEqual({
      ok: true,
    });
    await expect(safeJson(Response.json([]))).rejects.toThrow(
      "malformed JSON object",
    );
    await expect(safeJson(Response.json("value"))).rejects.toThrow(
      "malformed JSON object",
    );
  });
});
