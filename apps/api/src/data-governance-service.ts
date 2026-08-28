import type { AssetBlobStore } from "./blob-store.js";
import type { DataGovernanceRepository } from "./data-governance-repository.js";
import type { IdentityService } from "./services.js";
import { sanitizedError } from "./observability.js";

export class DataGovernanceService {
  constructor(
    private readonly repository: DataGovernanceRepository,
    private readonly blobs: AssetBlobStore,
    private readonly identity: IdentityService,
  ) {}

  exportAccount(userId: string) {
    return this.repository.exportAccount(userId, new Date().toISOString());
  }

  async deleteAccount(userId: string, password: string, requestId: string) {
    await this.identity.verifyPassword(userId, password);
    return this.repository.anonymizeAccount(
      userId,
      requestId,
      new Date().toISOString(),
    );
  }

  async mediaGc(input: {
    olderThan: string;
    limit: number;
    dryRun: boolean;
    requestId: string;
  }) {
    const now = new Date().toISOString();
    const prepared = await this.repository.prepareBlobGc({ ...input, now });
    if (input.dryRun) return { ...prepared, deleted: 0, failed: 0 };
    const pending = await this.repository.pendingBlobGc(input.limit);
    let deleted = 0,
      failed = 0;
    for (const item of pending) {
      try {
        await this.blobs.delete(item.storageKey);
        await this.repository.completeBlobGc(item.id, now);
        deleted++;
      } catch (error) {
        await this.repository.failBlobGc(
          item.id,
          sanitizedError(error).message,
          now,
        );
        failed++;
      }
    }
    return { ...prepared, deleted, failed };
  }

  retention(cutoffAt: string, requestId: string) {
    return this.repository.applyRetention({
      cutoffAt,
      requestId,
      now: new Date().toISOString(),
    });
  }
}
