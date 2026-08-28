export type AccountExport = {
  schemaVersion: 1;
  exportedAt: string;
  profile: { id: string; email: string; name: string; createdAt: string };
  workspaces: unknown[];
  projects: unknown[];
  assets: unknown[];
  generationJobs: unknown[];
  billingLedger: unknown[];
  orders: unknown[];
};

export type BlobGcItem = {
  id: string;
  assetId: string;
  storageKey: string;
};

export interface DataGovernanceRepository {
  exportAccount(userId: string, exportedAt: string): Promise<AccountExport>;
  anonymizeAccount(
    userId: string,
    requestId: string,
    now: string,
  ): Promise<{ deletedAt: string }>;
  prepareBlobGc(input: {
    olderThan: string;
    limit: number;
    dryRun: boolean;
    requestId: string;
    now: string;
  }): Promise<{ candidates: BlobGcItem[]; queued: BlobGcItem[] }>;
  pendingBlobGc(limit: number): Promise<BlobGcItem[]>;
  completeBlobGc(id: string, now: string): Promise<void>;
  failBlobGc(id: string, message: string, now: string): Promise<void>;
  applyRetention(input: {
    cutoffAt: string;
    requestId: string;
    now: string;
  }): Promise<{
    expiredSessions: number;
    generationEvents: number;
    auditEventsPreserved: number;
  }>;
}
