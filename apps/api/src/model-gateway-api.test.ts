import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { AssetService } from "./asset-service.js";
import { MemoryAssetBlobStore } from "./blob-store.js";
import { GenerationJobService } from "./generation-job-service.js";
import { MemoryGenerationJobRepository } from "./generation-job-repository.js";
import { MemoryPlatformRepository } from "./memory-repository.js";
import { MemoryModelGatewayRepository } from "./model-gateway-repository.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";

const maintenance = "Bearer test-maintenance-token-32-characters";
const worker = "Bearer test-worker-token-32-characters-long";
let app: ReturnType<typeof createApp>;
let cookie: string;
beforeEach(async () => {
  const platform = new MemoryPlatformRepository();
  const jobs = new MemoryGenerationJobRepository();
  app = createApp({
    identity: new IdentityService(platform, 60_000),
    workspaces: new WorkspaceService(platform),
    projects: new ProjectService(platform),
    assets: new AssetService(platform, new MemoryAssetBlobStore(), 1024),
    jobs: new GenerationJobService(platform, jobs),
    jobRepository: jobs,
    workerToken: worker.slice(7),
    workerStaleMs: 120_000,
    modelGateway: new MemoryModelGatewayRepository(),
    modelDiscovery: {
      discover: async (channelId: string) => ({
        channelId,
        adapter: "openai-compatible",
        models: [{ id: "image-v1" }],
        latencyMs: 12,
      }),
    } as never,
    maintenanceToken: maintenance.slice(7),
    secureCookies: false,
  });
  const response = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "models@example.com",
      password: "test-password",
      name: "Models",
    }),
  });
  cookie = response.headers.get("set-cookie")!.split(";")[0]!;
});
async function put(path: string, body: unknown, token = maintenance) {
  return app.request(`/internal/v1/maintenance/${path}`, {
    method: "PUT",
    headers: { authorization: token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("model gateway control plane", () => {
  it("[GEN-006] keeps credentials out of public DTOs and resolves only for workers", async () => {
    const channelId = "4bffb4be-e6a1-4d80-a40d-963b1764f00a";
    const upstreamId = "8ce7b9a0-c0f9-4a61-8a85-50b57b84d7eb";
    const protocol = {
      name: "OpenAI",
      adapter: "openai-compatible",
      enabled: true,
      config: {},
    };
    expect((await put("model-protocols/openai", protocol, worker)).status).toBe(
      401,
    );
    expect((await put("model-protocols/openai", protocol)).status).toBe(200);
    const channel = await put(`model-channels/${channelId}`, {
      name: "Primary",
      protocolId: "openai",
      baseUrl: "https://api.example.com",
      enabled: true,
      config: {},
      apiKey: "provider-secret",
    });
    expect(JSON.stringify(await channel.json())).not.toContain(
      "provider-secret",
    );
    const discovered = await app.request(
      `/internal/v1/maintenance/model-channels/${channelId}/discover`,
      { method: "POST", headers: { authorization: maintenance } },
    );
    expect(discovered.status).toBe(200);
    expect(
      ((await discovered.json()) as { data: { models: Array<{ id: string }> } })
        .data.models,
    ).toEqual([{ id: "image-v1" }]);
    await put(`upstream-models/${upstreamId}`, {
      channelId,
      modelId: "image-v1",
      capability: "image",
      enabled: true,
      healthState: "healthy",
      cooldownUntil: null,
      config: {},
    });
    await put("logical-models/image.default", {
      name: "Default image",
      capability: "image",
      enabled: true,
      isDefault: true,
    });
    await put("model-bindings/7ad8f97d-2dfa-4dca-879d-b847083da4ec", {
      logicalModelId: "image.default",
      upstreamModelId: upstreamId,
      enabled: true,
      priority: 10,
      weight: 100,
      capabilityProfile: { maxBatchSize: 4 },
    });
    expect(
      JSON.stringify(
        await (
          await app.request("/api/v1/models", { headers: { cookie } })
        ).json(),
      ),
    ).not.toContain("provider-secret");
    const body = JSON.stringify({
      capability: "image",
      logicalModelId: "image.default",
    });
    expect(
      (
        await app.request("/internal/v1/model-gateway/resolve", {
          method: "POST",
          headers: {
            authorization: maintenance,
            "content-type": "application/json",
          },
          body,
        })
      ).status,
    ).toBe(401);
    const resolved = await app.request("/internal/v1/model-gateway/resolve", {
      method: "POST",
      headers: { authorization: worker, "content-type": "application/json" },
      body,
    });
    expect(
      ((await resolved.json()) as { data: { apiKey: string } }).data.apiKey,
    ).toBe("provider-secret");
    const health = (outcome: "success" | "failure") =>
      app.request("/internal/v1/model-gateway/health", {
        method: "POST",
        headers: { authorization: worker, "content-type": "application/json" },
        body: JSON.stringify({ upstreamModelId: upstreamId, outcome }),
      });
    expect((await health("failure")).status).toBe(200);
    await health("failure");
    await health("failure");
    expect(
      (
        await app.request("/internal/v1/model-gateway/resolve", {
          method: "POST",
          headers: {
            authorization: worker,
            "content-type": "application/json",
          },
          body,
        })
      ).status,
    ).toBe(404);
    await health("success");
    expect(
      (
        await app.request("/internal/v1/model-gateway/resolve", {
          method: "POST",
          headers: {
            authorization: worker,
            "content-type": "application/json",
          },
          body,
        })
      ).status,
    ).toBe(200);
  });
  it("[GEN-009] rejects insecure or credential-bearing channel URLs by default", async () => {
    const common = {
      name: "Bad",
      protocolId: "openai",
      enabled: true,
      config: {},
      apiKey: "secret",
    };
    const id = "4bffb4be-e6a1-4d80-a40d-963b1764f00a";
    expect(
      (
        await put(`model-channels/${id}`, {
          ...common,
          baseUrl: "http://api.example.com",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put(`model-channels/${id}`, {
          ...common,
          baseUrl: "https://user:pass@example.com",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put("model-protocols/custom", {
          name: "Unsafe custom",
          adapter: "custom",
          enabled: true,
          config: { submitPath: "/../internal" },
        })
      ).status,
    ).toBe(400);
  });
});
