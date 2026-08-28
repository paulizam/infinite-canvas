import { describe, expect, it } from "vitest";
import { DataGovernanceService } from "./data-governance-service.js";
import type {
  AccountExport,
  BlobGcItem,
  DataGovernanceRepository,
} from "./data-governance-repository.js";
import { MemoryAssetBlobStore } from "./blob-store.js";
import { IdentityService } from "./services.js";
import { MemoryPlatformRepository } from "./memory-repository.js";
import { redactBusinessValue } from "./postgres-data-governance-repository.js";

class GovernanceRepositoryStub implements DataGovernanceRepository {
  anonymized: string[] = [];
  completed: string[] = [];
  failed: string[] = [];
  pending: BlobGcItem[] = [];
  async exportAccount(userId: string, exportedAt: string) {
    return {
      schemaVersion: 1,
      exportedAt,
      profile: {
        id: userId,
        email: "u@example.com",
        name: "U",
        createdAt: exportedAt,
      },
      workspaces: [],
      projects: [],
      assets: [],
      generationJobs: [],
      billingLedger: [],
      orders: [],
    } satisfies AccountExport;
  }
  async anonymizeAccount(userId: string, _requestId: string, now: string) {
    this.anonymized.push(userId);
    return { deletedAt: now };
  }
  async prepareBlobGc(input: { dryRun: boolean }) {
    const candidates = [
      {
        id: "gc-1",
        assetId: "asset-1",
        storageProvider: "default",
        storageKey: "ok",
      },
    ];
    return { candidates, queued: input.dryRun ? [] : candidates };
  }
  async pendingBlobGc() {
    return this.pending;
  }
  async completeBlobGc(id: string) {
    this.completed.push(id);
  }
  async failBlobGc(id: string) {
    this.failed.push(id);
  }
  async applyRetention() {
    return { expiredSessions: 2, generationEvents: 3, auditEventsPreserved: 4 };
  }
}

describe("data governance service", () => {
  it("recursively redacts secrets from business exports", () => {
    expect(
      redactBusinessValue({
        prompt: "keep",
        apiKey: "secret-key",
        nested: { authorization: "Bearer hidden", count: 2 },
      }),
    ).toEqual({
      prompt: "keep",
      apiKey: "[REDACTED]",
      nested: { authorization: "[REDACTED]", count: 2 },
    });
  });
  it("requires the current password before account anonymization", async () => {
    const platform = new MemoryPlatformRepository();
    const identity = new IdentityService(platform, 60_000);
    const registered = await identity.register({
      email: "owner@example.com",
      password: "correct-password",
      name: "Owner",
    });
    const repository = new GovernanceRepositoryStub();
    const service = new DataGovernanceService(
      repository,
      new MemoryAssetBlobStore(),
      identity,
    );
    await expect(
      service.deleteAccount(registered.user.id, "wrong", "request-1"),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(repository.anonymized).toEqual([]);
    await service.deleteAccount(
      registered.user.id,
      "correct-password",
      "request-2",
    );
    expect(repository.anonymized).toEqual([registered.user.id]);
  });

  it("keeps dry-run side-effect free and records retryable blob failures", async () => {
    const repository = new GovernanceRepositoryStub();
    const blobs = new MemoryAssetBlobStore();
    const identity = new IdentityService(
      new MemoryPlatformRepository(),
      60_000,
    );
    const service = new DataGovernanceService(repository, blobs, identity);
    const dry = await service.mediaGc({
      olderThan: new Date(0).toISOString(),
      limit: 50,
      dryRun: true,
      requestId: "dry",
    });
    expect(dry).toMatchObject({ deleted: 0, failed: 0, queued: [] });

    blobs.values.set("ok", Buffer.from("x"));
    repository.pending = [
      {
        id: "gc-ok",
        assetId: "asset-ok",
        storageProvider: "default",
        storageKey: "ok",
      },
      {
        id: "gc-fail",
        assetId: "asset-fail",
        storageProvider: "default",
        storageKey: "fail",
      },
    ];
    const originalDelete = blobs.delete.bind(blobs);
    blobs.delete = async (key) => {
      if (key === "fail") throw new Error("token=top-secret unavailable");
      return originalDelete(key);
    };
    const result = await service.mediaGc({
      olderThan: new Date(0).toISOString(),
      limit: 50,
      dryRun: false,
      requestId: "run",
    });
    expect(result).toMatchObject({ deleted: 1, failed: 1 });
    expect(repository.completed).toEqual(["gc-ok"]);
    expect(repository.failed).toEqual(["gc-fail"]);
  });

  it("deletes GC entries from the provider captured before the asset row was removed", async () => {
    const repository = new GovernanceRepositoryStub();
    repository.pending = [
      {
        id: "gc-local",
        assetId: "asset-old",
        storageProvider: "local",
        storageKey: "old",
      },
    ];
    const local = new MemoryAssetBlobStore();
    const s3 = new MemoryAssetBlobStore();
    local.values.set("old", Buffer.from("old"));
    const service = new DataGovernanceService(
      repository,
      { currentProvider: "s3", stores: { local, s3 } },
      new IdentityService(new MemoryPlatformRepository(), 60_000),
    );
    await service.mediaGc({
      olderThan: new Date(0).toISOString(),
      limit: 10,
      dryRun: false,
      requestId: "provider-gc",
    });
    expect(local.values.has("old")).toBe(false);
    expect(s3.values.size).toBe(0);
    expect(repository.completed).toEqual(["gc-local"]);
  });
});
