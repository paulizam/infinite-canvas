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

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  const platform = new MemoryPlatformRepository();
  const jobs = new MemoryGenerationJobRepository();
  app = createApp({
    identity: new IdentityService(platform, 60_000),
    workspaces: new WorkspaceService(platform),
    projects: new ProjectService(platform),
    assets: new AssetService(platform, new MemoryAssetBlobStore(), 1024 * 1024),
    jobs: new GenerationJobService(platform, jobs),
    jobRepository: jobs,
    workerToken: "test-worker-token-32-characters-long",
    workerStaleMs: 120_000,
    modelGateway: new MemoryModelGatewayRepository(),
    maintenanceToken: "test-maintenance-token-32-characters",
    secureCookies: false,
  });
});
async function register(email: string) {
  const response = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "test-password", name: "Jobs" }),
  });
  const body = (await response.json()) as {
    data: { workspace: { id: string } };
  };
  return { body, cookie: response.headers.get("set-cookie")!.split(";")[0]! };
}

describe("generation job API", () => {
  it("creates idempotently and hides jobs across users", async () => {
    const owner = await register("job-owner@example.com");
    const url = `/api/v1/workspaces/${owner.body.data.workspace.id}/generation-jobs`;
    const request = () =>
      app.request(url, {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          capability: "image",
          logicalModelId: "image.default",
          clientRequestId: "ui-request-1",
          parameters: { prompt: "draw" },
        }),
      });
    const created = await request();
    expect(created.status).toBe(202);
    const jobId = ((await created.json()) as { data: { job: { id: string } } })
      .data.job.id;
    expect((await request()).status).toBe(200);
    const outsider = await register("job-outsider@example.com");
    expect(
      (
        await app.request(`/api/v1/generation-jobs/${jobId}`, {
          headers: { cookie: outsider.cookie },
        })
      ).status,
    ).toBe(404);
  });

  it("protects worker endpoints and enforces lease ownership", async () => {
    const owner = await register("job-worker@example.com");
    await app.request(
      `/api/v1/workspaces/${owner.body.data.workspace.id}/generation-jobs`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          capability: "video",
          logicalModelId: "video.default",
          clientRequestId: "worker-request-1",
          parameters: {},
        }),
      },
    );
    const claimBody = JSON.stringify({
      workerId: "worker-a",
      limit: 1,
      leaseMs: 90_000,
    });
    expect((await app.request("/health/worker")).status).toBe(503);
    expect(
      (
        await app.request("/internal/v1/generation/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: claimBody,
        })
      ).status,
    ).toBe(401);
    const headers = {
      authorization: "Bearer test-worker-token-32-characters-long",
      "content-type": "application/json",
    };
    expect(
      (
        await app.request("/internal/v1/generation/heartbeat", {
          method: "POST",
          headers,
          body: JSON.stringify({ workerId: "worker-a", jobIds: [] }),
        })
      ).status,
    ).toBe(200);
    expect((await app.request("/health/worker")).status).toBe(200);
    const claimed = await app.request("/internal/v1/generation/claim", {
      method: "POST",
      headers,
      body: claimBody,
    });
    const jobId = ((await claimed.json()) as { data: Array<{ id: string }> })
      .data[0]!.id;
    const transition = (workerId: string, phase = "submitting") =>
      app.request(`/internal/v1/generation/jobs/${jobId}/transition`, {
        method: "POST",
        headers,
        body: JSON.stringify({ workerId, phase, patch: {} }),
      });
    expect((await transition("worker-b")).status).toBe(409);
    expect((await transition("worker-a")).status).toBe(200);
    expect((await transition("worker-a", "submitted")).status).toBe(200);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const persisted = await app.request(
      `/internal/v1/generation/jobs/${jobId}/assets`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-worker-token-32-characters-long",
          "content-type": "application/octet-stream",
          "x-worker-id": "worker-a",
          "x-file-name": "provider-result.png",
        },
        body: png,
      },
    );
    expect(persisted.status).toBe(201);
    expect(
      ((await persisted.json()) as { data: { asset: { mimeType: string } } })
        .data.asset.mimeType,
    ).toBe("image/png");
  });
});
