import { describe, expect, it } from "vitest";
import type { WorkerResolvedModel } from "./client.js";
import {
  buildOperationRequest,
  buildSubmitRequest,
  normalizePayload,
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
});
