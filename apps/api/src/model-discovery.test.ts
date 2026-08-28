import { describe, expect, it, vi } from "vitest";
import { MemoryModelGatewayRepository } from "./model-gateway-repository.js";
import { ModelDiscoveryService } from "./model-discovery.js";

async function runtime(
  adapter:
    | "openai-compatible"
    | "gemini"
    | "seedance"
    | "stable-diffusion"
    | "media-kit"
    | "volcengine"
    | "custom",
  baseUrl = "https://api.example.com/v1",
  protocolConfig: Record<string, unknown> = {},
  channelConfig: Record<string, unknown> = {},
) {
  const repository = new MemoryModelGatewayRepository();
  await repository.saveProtocol({
    id: "p",
    name: "P",
    adapter,
    enabled: true,
    config: protocolConfig,
  });
  await repository.saveChannel({
    id: "c",
    name: "C",
    protocolId: "p",
    baseUrl,
    enabled: true,
    credentialConfigured: false,
    config: channelConfig,
    apiKey: "secret",
  });
  return repository;
}

describe("ModelDiscoveryService", () => {
  it("discovers and deduplicates OpenAI-compatible model ids", async () => {
    const repository = await runtime("openai-compatible");
    const fetcher = vi.fn(async () =>
      Response.json({
        data: [{ id: "gpt-5" }, { id: "gpt-5" }, { id: "gpt-image-2" }],
      }),
    );
    const result = await new ModelDiscoveryService(
      repository,
      fetcher as typeof fetch,
      async () => ["203.0.113.10"],
    ).discover("c");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      expect.objectContaining({
        headers: { authorization: "Bearer secret" },
        redirect: "error",
      }),
    );
    expect(result.models.map((model) => model.id)).toEqual([
      "gpt-5",
      "gpt-image-2",
    ]);
  });

  it("normalizes Gemini names and uses the API key header", async () => {
    const repository = await runtime(
      "gemini",
      "https://generativelanguage.googleapis.com",
    );
    const fetcher = vi.fn(async () =>
      Response.json({
        models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini Pro" }],
      }),
    );
    const result = await new ModelDiscoveryService(
      repository,
      fetcher as typeof fetch,
      async () => ["8.8.8.8"],
    ).discover("c");
    expect(fetcher).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      expect.objectContaining({ headers: { "x-goog-api-key": "secret" } }),
    );
    expect(result.models).toEqual([
      { id: "gemini-2.5-pro", displayName: "Gemini Pro" },
    ]);
  });

  it("requires an explicit safe Custom catalog path and blocks private destinations", async () => {
    const missing = await runtime("custom", "https://custom.example.com", {
      submitPath: "/submit",
    });
    await expect(
      new ModelDiscoveryService(missing, vi.fn() as never, async () => [
        "8.8.8.8",
      ]).discover("c"),
    ).rejects.toMatchObject({ code: "MODEL_CATALOG_UNSUPPORTED" });
    const privateRepo = await runtime(
      "openai-compatible",
      "https://private.example.com",
    );
    await expect(
      new ModelDiscoveryService(privateRepo, vi.fn() as never, async () => [
        "127.0.0.1",
      ]).discover("c"),
    ).rejects.toMatchObject({ code: "UNSAFE_CHANNEL_URL" });
  });

  it("returns sanitized diagnostics without provider response bodies or credentials", async () => {
    const repository = await runtime("openai-compatible");
    const fetcher = vi.fn(
      async () => new Response("secret provider detail", { status: 401 }),
    );
    await expect(
      new ModelDiscoveryService(
        repository,
        fetcher as typeof fetch,
        async () => ["8.8.8.8"],
      ).discover("c"),
    ).rejects.toMatchObject({
      code: "MODEL_DISCOVERY_FAILED",
      message: "模型渠道返回 HTTP 401",
    });
  });

  it("rejects oversized catalogs before buffering the provider body", async () => {
    const repository = await runtime("openai-compatible");
    const fetcher = vi.fn(async () =>
      Response.json(
        { data: [] },
        { headers: { "content-length": String(3 * 1024 * 1024) } },
      ),
    );
    await expect(
      new ModelDiscoveryService(
        repository,
        fetcher as typeof fetch,
        async () => ["8.8.8.8"],
      ).discover("c"),
    ).rejects.toMatchObject({ code: "MODEL_CATALOG_TOO_LARGE" });
  });

  it("signs Volcengine resource and usage inventory without exposing AK/SK", async () => {
    const repository = await runtime(
      "volcengine",
      "https://open.volcengineapi.com",
      {},
      { accessKeyId: "AKLTEXAMPLE", region: "cn-north-1", service: "ark" },
    );
    const fetcher = vi.fn(async () =>
      Response.json({ Result: { RemainingUnits: 42 } }),
    );
    const service = new ModelDiscoveryService(
      repository,
      fetcher as typeof fetch,
      async () => ["8.8.8.8"],
    );
    const result = await service.volcengineInventory("c", "usage");
    expect(result).toMatchObject({
      kind: "usage",
      payload: { Result: { RemainingUnits: 42 } },
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("Action=GetResourceUsage");
    expect(String(url)).not.toContain("AKLTEXAMPLE");
    expect(JSON.stringify(init)).not.toContain("secret");
    expect((init?.headers as Record<string, string>).authorization).toContain(
      "AKLTEXAMPLE",
    );
  });
});
