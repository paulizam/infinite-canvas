import { randomUUID } from "node:crypto";
import type {
  GenerationCapability,
  GenerationJob,
} from "@infinite-canvas/contracts";
import type { PlatformRepository } from "./domain.js";
import type { GenerationJobRepository } from "./generation-job-repository.js";

export class GenerationJobService {
  constructor(
    private readonly platform: PlatformRepository,
    private readonly jobs: GenerationJobRepository,
  ) {}

  async create(
    userId: string,
    workspaceId: string,
    input: {
      capability: GenerationCapability;
      logicalModelId: string;
      clientRequestId: string;
      parameters: Record<string, unknown>;
    },
  ) {
    await this.platform.requireWorkspaceRole(userId, workspaceId, "editor");
    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: randomUUID(),
      workspaceId,
      ownerId: userId,
      capability: input.capability,
      logicalModelId: input.logicalModelId,
      clientRequestId: input.clientRequestId,
      attempt: 1,
      retryOf: null,
      status: "queued",
      phase: "queued",
      input: input.parameters,
      result: null,
      upstreamTaskId: null,
      provider: null,
      channelId: null,
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
      nextRunAt: now,
      errorCode: null,
      errorMessage: null,
      billing: {
        state: "free",
        estimatedUnits: 0,
        reservedUnits: 0,
        actualUnits: null,
      },
      createdAt: now,
      updatedAt: now,
    };
    return this.jobs.create(job);
  }
  async list(userId: string, workspaceId: string) {
    await this.platform.requireWorkspaceRole(userId, workspaceId, "viewer");
    return this.jobs.listForUser(userId, workspaceId);
  }
  async get(userId: string, jobId: string) {
    return this.jobs.getForUser(userId, jobId);
  }
  async listWorkspace(userId: string, workspaceId: string) {
    await this.platform.requireWorkspaceRole(userId, workspaceId, "viewer");
    return this.jobs.listInWorkspace(workspaceId);
  }
  async getWorkspace(userId: string, workspaceId: string, jobId: string) {
    await this.platform.requireWorkspaceRole(userId, workspaceId, "viewer");
    return this.jobs.getInWorkspace(workspaceId, jobId);
  }
  cancel(userId: string, jobId: string) {
    return this.jobs.cancel(userId, jobId, new Date().toISOString());
  }
  retry(userId: string, jobId: string) {
    return this.jobs.retry(
      userId,
      jobId,
      randomUUID(),
      new Date().toISOString(),
    );
  }
  estimate(
    logicalModelId: string,
    capability: GenerationCapability,
    parameters: Record<string, unknown>,
  ) {
    return this.jobs.estimate(logicalModelId, capability, parameters);
  }
  wallet(userId: string) {
    return this.jobs.getWallet(userId);
  }
  ledger(userId: string, limit = 100) {
    return this.jobs.listLedger(userId, limit);
  }
}
