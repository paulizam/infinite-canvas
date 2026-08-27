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
let jobRepository: MemoryGenerationJobRepository;
beforeEach(() => {
  const platform = new MemoryPlatformRepository();
  const jobs = new MemoryGenerationJobRepository();
  jobRepository = jobs;
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
    data: { user: { id: string }; workspace: { id: string } };
  };
  return { body, cookie: response.headers.get("set-cookie")!.split(";")[0]! };
}

describe("generation job API", () => {
  it("estimates, reserves and idempotently refunds integer points", async () => {
    const owner = await register("billing-owner@example.com");
    const maintenanceHeaders = {
      authorization: "Bearer test-maintenance-token-32-characters",
      "content-type": "application/json",
    };
    await app.request(
      "/internal/v1/maintenance/billing/price-rules/image.default",
      {
        method: "PUT",
        headers: maintenanceHeaders,
        body: JSON.stringify({
          capability: "image",
          baseUnits: 10,
          multiplierConfig: { resolutionPermille: { hd: 2000 } },
          enabled: true,
        }),
      },
    );
    await app.request("/internal/v1/maintenance/billing/wallet-adjustments", {
      method: "POST",
      headers: maintenanceHeaders,
      body: JSON.stringify({
        userId: owner.body.data.user.id,
        amountUnits: 100,
        idempotencyKey: "initial-credit-billing-owner",
        note: "test credit",
      }),
    });
    const parameters = { count: 2, resolution: "hd" };
    const estimate = await app.request(
      "/api/v1/models/image.default/estimate",
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ capability: "image", parameters }),
      },
    );
    expect(
      ((await estimate.json()) as { data: { estimatedUnits: number } }).data
        .estimatedUnits,
    ).toBe(40);
    const url = `/api/v1/workspaces/${owner.body.data.workspace.id}/generation-jobs`;
    const create = () =>
      app.request(url, {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          capability: "image",
          logicalModelId: "image.default",
          clientRequestId: "billing-request-1",
          parameters,
        }),
      });
    const created = await create();
    const job = ((await created.json()) as { data: { job: { id: string } } })
      .data.job;
    expect((await create()).status).toBe(200);
    expect(
      (await jobRepository.getWallet(owner.body.data.user.id)).balanceUnits,
    ).toBe(60);
    const [claimed] = await jobRepository.claim({
      workerId: "billing-worker",
      now: new Date().toISOString(),
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
      limit: 1,
    });
    await jobRepository.transitionByWorker({
      workerId: "billing-worker",
      jobId: claimed!.id,
      phase: "submitting",
      patch: {},
      now: new Date().toISOString(),
    });
    await jobRepository.transitionByWorker({
      workerId: "billing-worker",
      jobId: claimed!.id,
      phase: "failed",
      patch: { errorCode: "TEST" },
      now: new Date().toISOString(),
    });
    expect(
      (await jobRepository.getWallet(owner.body.data.user.id)).balanceUnits,
    ).toBe(100);
    expect(
      (await jobRepository.listLedger(owner.body.data.user.id, 10)).map(
        (x) => x.type,
      ),
    ).toEqual(["refund", "reserve", "adjustment"]);
    expect(job.id).toBe(claimed!.id);

    const settledResponse = await app.request(url, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        capability: "image",
        logicalModelId: "image.default",
        clientRequestId: "billing-request-2",
        parameters,
      }),
    });
    const settledId = (
      (await settledResponse.json()) as { data: { job: { id: string } } }
    ).data.job.id;
    const [settledClaim] = await jobRepository.claim({
      workerId: "settle-worker",
      now: new Date().toISOString(),
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
      limit: 1,
    });
    expect(settledClaim!.id).toBe(settledId);
    for (const phase of [
      "submitting",
      "submitted",
      "result_ready",
      "persisting",
    ] as const)
      await jobRepository.transitionByWorker({
        workerId: "settle-worker",
        jobId: settledId,
        phase,
        patch: {},
        now: new Date().toISOString(),
      });
    const settled = await jobRepository.transitionByWorker({
      workerId: "settle-worker",
      jobId: settledId,
      phase: "succeeded",
      patch: { billingActualUnits: 30 },
      now: new Date().toISOString(),
    });
    expect(settled.billing).toMatchObject({
      state: "settled",
      actualUnits: 30,
    });
    expect(
      (await jobRepository.getWallet(owner.body.data.user.id)).balanceUnits,
    ).toBe(70);
    expect(
      (await jobRepository.listLedger(owner.body.data.user.id, 1))[0],
    ).toMatchObject({
      type: "settle",
      amountUnits: 10,
    });
  });
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
    const persistedBody = (await persisted.json()) as {
      data: { asset: { id: string; mimeType: string } };
    };
    expect(persistedBody.data.asset.mimeType).toBe("image/png");
    const readUrl = `/internal/v1/generation/jobs/${jobId}/assets/${persistedBody.data.asset.id}`;
    expect(
      (
        await app.request(readUrl, {
          headers: {
            authorization: "Bearer test-worker-token-32-characters-long",
            "x-worker-id": "worker-b",
          },
        })
      ).status,
    ).toBe(409);
    const read = await app.request(readUrl, {
      headers: {
        authorization: "Bearer test-worker-token-32-characters-long",
        "x-worker-id": "worker-a",
      },
    });
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await read.arrayBuffer())).toEqual(png);
  });

  it("accepts leased text deltas, replays SSE and hides the stream across users", async () => {
    const owner = await register("stream-owner@example.com");
    const created = await app.request(
      `/api/v1/workspaces/${owner.body.data.workspace.id}/generation-jobs`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          capability: "text",
          logicalModelId: "text.default",
          clientRequestId: "stream-1",
          parameters: { prompt: "hello" },
        }),
      },
    );
    const jobId = ((await created.json()) as { data: { job: { id: string } } })
      .data.job.id;
    const headers = {
      authorization: "Bearer test-worker-token-32-characters-long",
      "content-type": "application/json",
    };
    await app.request("/internal/v1/generation/claim", {
      method: "POST",
      headers,
      body: JSON.stringify({
        workerId: "stream-worker",
        limit: 1,
        leaseMs: 90_000,
      }),
    });
    const transition = (phase: string, patch: Record<string, unknown> = {}) =>
      app.request(`/internal/v1/generation/jobs/${jobId}/transition`, {
        method: "POST",
        headers,
        body: JSON.stringify({ workerId: "stream-worker", phase, patch }),
      });
    await transition("submitting");
    await transition("submitted");
    const eventPath = `/internal/v1/generation/jobs/${jobId}/events`;
    expect(
      (
        await app.request(eventPath, {
          method: "POST",
          headers,
          body: JSON.stringify({
            workerId: "intruder",
            type: "text.delta",
            delta: "no",
          }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request(eventPath, {
          method: "POST",
          headers,
          body: JSON.stringify({
            workerId: "stream-worker",
            type: "text.delta",
            delta: "hello",
          }),
        })
      ).status,
    ).toBe(201);
    await transition("result_ready", { result: { text: "hello" } });
    await transition("persisting");
    await transition("succeeded");
    const stream = await app.request(
      `/api/v1/generation-jobs/${jobId}/events`,
      { headers: { cookie: owner.cookie, "last-event-id": "0" } },
    );
    expect(stream.status).toBe(200);
    const body = await stream.text();
    expect(body).toContain("event: text.delta");
    expect(body).toContain("event: job.terminal");
    const outsider = await register("stream-outsider@example.com");
    expect(
      (
        await app.request(`/api/v1/generation-jobs/${jobId}/events`, {
          headers: { cookie: outsider.cookie },
        })
      ).status,
    ).toBe(404);
  });
});
