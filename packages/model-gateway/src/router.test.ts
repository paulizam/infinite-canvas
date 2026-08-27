import { describe, expect, it } from "vitest";
import type { ModelRoutingCatalog } from "./router.js";
import { resolveModelCandidates } from "./router.js";
import { validateModelParameters } from "./capabilities.js";
import {
  buildOpenAiCompatibleRequest,
  openAiCompatibleEndpoint,
} from "./openai-compatible.js";

const catalog: ModelRoutingCatalog = {
  protocols: [
    {
      id: "openai",
      name: "OpenAI",
      adapter: "openai-compatible",
      enabled: true,
      config: {},
    },
  ],
  channels: [
    {
      id: "primary",
      name: "Primary",
      protocolId: "openai",
      baseUrl: "https://one.example",
      enabled: true,
      credentialConfigured: true,
      config: {},
    },
    {
      id: "backup",
      name: "Backup",
      protocolId: "openai",
      baseUrl: "https://two.example",
      enabled: true,
      credentialConfigured: true,
      config: {},
    },
  ],
  upstreamModels: [
    {
      id: "up-1",
      channelId: "primary",
      modelId: "image-a",
      capability: "image",
      enabled: true,
      healthState: "healthy",
      cooldownUntil: null,
      config: {},
    },
    {
      id: "up-2",
      channelId: "backup",
      modelId: "image-b",
      capability: "image",
      enabled: true,
      healthState: "degraded",
      cooldownUntil: null,
      config: {},
    },
  ],
  logicalModels: [
    {
      id: "image.default",
      name: "Default image",
      capability: "image",
      enabled: true,
      isDefault: true,
    },
  ],
  bindings: [
    {
      id: "b1",
      logicalModelId: "image.default",
      upstreamModelId: "up-1",
      enabled: true,
      priority: 10,
      weight: 100,
      capabilityProfile: {},
    },
    {
      id: "b2",
      logicalModelId: "image.default",
      upstreamModelId: "up-2",
      enabled: true,
      priority: 20,
      weight: 100,
      capabilityProfile: {},
    },
  ],
};

describe("logical model router", () => {
  it("orders by priority but honors an explicit preferred healthy channel", () => {
    expect(
      resolveModelCandidates(catalog, "image", "IMAGE.DEFAULT").map(
        (item) => item.channel.id,
      ),
    ).toEqual(["primary", "backup"]);
    expect(
      resolveModelCandidates(catalog, "image", "image.default", {
        preferredChannelId: "backup",
      })[0]?.channel.id,
    ).toBe("backup");
  });
  it("filters cooldown, disabled credentials and capability mismatches", () => {
    const copy = structuredClone(catalog);
    copy.upstreamModels[0]!.healthState = "cooldown";
    copy.upstreamModels[0]!.cooldownUntil = "2099-01-01T00:00:00.000Z";
    copy.channels[1]!.credentialConfigured = false;
    expect(
      resolveModelCandidates(copy, "image", "image.default", {
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).toEqual([]);
  });
});

describe("model capability validation", () => {
  it("reports every incompatible request dimension", () => {
    const issues = validateModelParameters(
      {
        supportsReferenceImage: true,
        maxReferenceImages: 1,
        aspectRatios: ["1:1"],
        durationSeconds: [5],
        maxBatchSize: 2,
      },
      {
        referenceImages: ["a", "b"],
        referenceVideos: ["v"],
        aspectRatio: "16:9",
        durationSeconds: 10,
        count: 3,
      },
    );
    expect(issues.map((item) => item.code)).toEqual([
      "TOO_MANY_REFERENCES",
      "REFERENCES_UNSUPPORTED",
      "VALUE_UNSUPPORTED",
      "UNSUPPORTED_DURATION",
      "BATCH_TOO_LARGE",
    ]);
  });
});

describe("OpenAI-compatible request policy", () => {
  it("normalizes capability endpoints and prevents model override", () => {
    const request = buildOpenAiCompatibleRequest({
      baseUrl: "https://api.example.com",
      apiKey: "secret",
      capability: "image",
      upstreamModel: "real-model",
      parameters: { model: "forged", prompt: "draw" },
    });
    expect(request.url).toBe("https://api.example.com/v1/images/generations");
    expect(JSON.parse(String(request.init.body)).model).toBe("real-model");
  });
  it("rejects insecure transport and URL credentials", () => {
    expect(() =>
      openAiCompatibleEndpoint("http://api.example.com", "text"),
    ).toThrow(/HTTPS/);
    expect(() =>
      openAiCompatibleEndpoint("https://user:pass@example.com", "text"),
    ).toThrow(/credentials/);
  });
});
