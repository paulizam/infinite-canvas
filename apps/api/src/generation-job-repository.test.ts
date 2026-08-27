import { describe, expect, it } from "vitest";
import { IdentityService } from "./services.js";
import { MemoryPlatformRepository } from "./memory-repository.js";
import { GenerationJobService } from "./generation-job-service.js";
import { MemoryGenerationJobRepository } from "./generation-job-repository.js";

async function fixture() {
  const platform = new MemoryPlatformRepository();
  const identity = new IdentityService(platform, 60_000);
  const registration = await identity.register({
    email: "jobs@example.com",
    password: "test-password",
    name: "Jobs",
  });
  const repository = new MemoryGenerationJobRepository();
  return {
    repository,
    service: new GenerationJobService(platform, repository),
    userId: registration.user.id,
    workspaceId: registration.workspace.id,
  };
}

describe("generation job repository", () => {
  it("creates idempotently and isolates the original attempt", async () => {
    const { service, userId, workspaceId } = await fixture();
    const input = {
      capability: "image" as const,
      logicalModelId: "image.default",
      clientRequestId: "request-1",
      parameters: { prompt: "draw" },
    };
    const first = await service.create(userId, workspaceId, input);
    const replay = await service.create(userId, workspaceId, input);
    expect(replay.replayed).toBe(true);
    expect(replay.job.id).toBe(first.job.id);
    expect(await service.list(userId, workspaceId)).toHaveLength(1);
  });

  it("claims once, renews only owned leases and recovers expiration", async () => {
    const { service, repository, userId, workspaceId } = await fixture();
    const { job } = await service.create(userId, workspaceId, {
      capability: "video",
      logicalModelId: "video.default",
      clientRequestId: "lease-1",
      parameters: {},
    });
    const now = job.createdAt;
    const leaseUntil = new Date(Date.parse(now) + 1_000).toISOString();
    expect(
      await repository.claim({
        workerId: "worker-a",
        now,
        leaseUntil,
        limit: 1,
      }),
    ).toHaveLength(1);
    expect(
      await repository.claim({
        workerId: "worker-b",
        now,
        leaseUntil,
        limit: 1,
      }),
    ).toHaveLength(0);
    expect(
      await repository.heartbeat("worker-b", [job.id], now, leaseUntil),
    ).toBe(0);
    const recoveredAt = new Date(Date.parse(leaseUntil) + 1).toISOString();
    const recovered = await repository.claim({
      workerId: "worker-b",
      now: recoveredAt,
      leaseUntil: new Date(Date.parse(recoveredAt) + 1_000).toISOString(),
      limit: 1,
    });
    expect(recovered[0]?.workerId).toBe("worker-b");
    expect(recovered[0]?.phase).toBe("claimed");
  });

  it("cancels idempotently and retries as a fresh attempt", async () => {
    const { service, repository, userId, workspaceId } = await fixture();
    const { job } = await service.create(userId, workspaceId, {
      capability: "audio",
      logicalModelId: "audio.default",
      clientRequestId: "cancel-1",
      parameters: {},
    });
    const cancelRequested = await service.cancel(userId, job.id);
    expect(cancelRequested.phase).toBe("cancel_requested");
    expect((await service.cancel(userId, job.id)).phase).toBe(
      "cancel_requested",
    );
    const claimed = await repository.claim({
      workerId: "worker-cancel",
      now: cancelRequested.nextRunAt,
      leaseUntil: new Date(
        Date.parse(cancelRequested.nextRunAt) + 90_000,
      ).toISOString(),
      limit: 1,
    });
    await repository.transitionByWorker({
      workerId: "worker-cancel",
      jobId: claimed[0]!.id,
      phase: "cancelled",
      patch: {},
      now: new Date(Date.parse(job.createdAt) + 1).toISOString(),
    });
    const retry = await service.retry(userId, job.id);
    expect(retry.attempt).toBe(2);
    expect(retry.retryOf).toBe(job.id);
    expect(retry.upstreamTaskId).toBeNull();
  });
});
