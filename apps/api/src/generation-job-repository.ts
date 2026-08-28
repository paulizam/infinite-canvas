import type {
  BillingEstimate,
  BillingLedgerEntry,
  BillingWallet,
  GenerationJob,
  GenerationJobPhase,
} from "@infinite-canvas/contracts";
import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.js";
import {
  isTerminalGenerationPhase,
  transitionGenerationJob,
  type GenerationJobTransitionPatch,
} from "./generation-job-state.js";

export interface GenerationJobRepository {
  create(
    job: GenerationJob,
  ): Promise<{ job: GenerationJob; replayed: boolean }>;
  getForUser(userId: string, jobId: string): Promise<GenerationJob | null>;
  getInWorkspace(workspaceId: string, jobId: string): Promise<GenerationJob | null>;
  getByClientRequest(
    userId: string,
    workspaceId: string,
    clientRequestId: string,
  ): Promise<GenerationJob | null>;
  listForUser(userId: string, workspaceId: string): Promise<GenerationJob[]>;
  listInWorkspace(workspaceId: string): Promise<GenerationJob[]>;
  cancel(userId: string, jobId: string, now: string): Promise<GenerationJob>;
  retry(
    userId: string,
    jobId: string,
    newId: string,
    now: string,
  ): Promise<GenerationJob>;
  claim(input: {
    workerId: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }): Promise<GenerationJob[]>;
  transitionByWorker(input: {
    workerId: string;
    jobId: string;
    phase: GenerationJobPhase;
    patch: GenerationJobTransitionPatch & { billingActualUnits?: number };
    now: string;
  }): Promise<GenerationJob>;
  getForWorker(
    workerId: string,
    jobId: string,
    now: string,
  ): Promise<GenerationJob | null>;
  heartbeat(
    workerId: string,
    jobIds: string[],
    now: string,
    leaseUntil: string,
  ): Promise<number>;
  recordWorkerHeartbeat(workerId: string, now: string): Promise<void>;
  latestWorkerHeartbeat(): Promise<string | null>;
  operationalMetrics(now: string): Promise<{
    queueDepth: number;
    queueOldestAt: string | null;
    stuckJobs: number;
    latestWorkerHeartbeatAt: string | null;
  }>;
  estimate(
    logicalModelId: string,
    capability: GenerationJob["capability"],
    parameters: Record<string, unknown>,
  ): Promise<BillingEstimate>;
  getWallet(userId: string): Promise<BillingWallet>;
  listLedger(userId: string, limit: number): Promise<BillingLedgerEntry[]>;
  adjustWallet(input: {
    userId: string;
    amountUnits: number;
    idempotencyKey: string;
    note: string;
    now: string;
  }): Promise<BillingWallet>;
  savePriceRule(rule: BillingPriceRule): Promise<BillingPriceRule>;
}

export type BillingPriceRule = {
  logicalModelId: string;
  capability: GenerationJob["capability"];
  baseUnits: number;
  multiplierConfig: Record<string, unknown>;
  enabled: boolean;
  updatedAt: string;
};

export class MemoryGenerationJobRepository implements GenerationJobRepository {
  private jobs = new Map<string, GenerationJob>();
  readonly workerHeartbeats = new Map<string, string>();
  readonly priceRules = new Map<string, BillingPriceRule>();
  readonly wallets = new Map<string, BillingWallet>();
  readonly ledger: BillingLedgerEntry[] = [];

  async create(job: GenerationJob) {
    const existing = [...this.jobs.values()].find(
      (item) =>
        item.workspaceId === job.workspaceId &&
        item.ownerId === job.ownerId &&
        item.clientRequestId === job.clientRequestId &&
        item.attempt === job.attempt,
    );
    if (existing) return { job: existing, replayed: true };
    const charged = await this.reserve(job);
    this.jobs.set(job.id, charged);
    return { job: charged, replayed: false };
  }
  async getForUser(userId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    return job?.ownerId === userId ? job : null;
  }
  async getInWorkspace(workspaceId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    return job?.workspaceId === workspaceId ? job : null;
  }
  async getByClientRequest(
    userId: string,
    workspaceId: string,
    clientRequestId: string,
  ) {
    return (
      [...this.jobs.values()].find(
        (job) =>
          job.ownerId === userId &&
          job.workspaceId === workspaceId &&
          job.clientRequestId === clientRequestId &&
          job.attempt === 1,
      ) || null
    );
  }
  async listForUser(userId: string, workspaceId: string) {
    return [...this.jobs.values()]
      .filter(
        (job) => job.ownerId === userId && job.workspaceId === workspaceId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async listInWorkspace(workspaceId: string) {
    return [...this.jobs.values()].filter((job) => job.workspaceId === workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async cancel(userId: string, jobId: string, now: string) {
    const job = this.requireUserJob(userId, jobId);
    if (job.phase === "cancel_requested" || job.phase === "cancelled")
      return job;
    if (isTerminalGenerationPhase(job.phase))
      throw new DomainError("JOB_NOT_CANCELLABLE", 409, "终态任务不能取消");
    const updated = transitionGenerationJob(
      job,
      "cancel_requested",
      { nextRunAt: now },
      now,
    );
    this.jobs.set(jobId, updated);
    return updated;
  }
  async retry(userId: string, jobId: string, newId: string, now: string) {
    const source = this.requireUserJob(userId, jobId);
    if (
      source.phase !== "failed" &&
      source.phase !== "cancelled" &&
      source.phase !== "needs_review"
    )
      throw new DomainError(
        "JOB_NOT_RETRYABLE",
        409,
        "仅失败、取消或待复核任务可重试",
      );
    const next: GenerationJob = {
      ...source,
      id: newId,
      attempt: source.attempt + 1,
      retryOf: source.id,
      status: "queued",
      phase: "queued",
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
    return (await this.create(next)).job;
  }
  async claim(input: {
    workerId: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }) {
    const claimable = new Set<GenerationJobPhase>([
      "queued",
      "claimed",
      "submitting",
      "submitted",
      "polling",
      "result_ready",
      "persisting",
      "cancel_requested",
    ]);
    const due = [...this.jobs.values()]
      .filter(
        (job) =>
          claimable.has(job.phase) &&
          job.nextRunAt <= input.now &&
          (!job.leaseUntil || job.leaseUntil <= input.now),
      )
      .sort(
        (a, b) =>
          a.nextRunAt.localeCompare(b.nextRunAt) || a.id.localeCompare(b.id),
      )
      .slice(0, input.limit);
    return due.map((job) => {
      const claimed =
        job.phase === "queued"
          ? transitionGenerationJob(
              job,
              "claimed",
              {
                workerId: input.workerId,
                leaseUntil: input.leaseUntil,
                lastHeartbeatAt: input.now,
              },
              input.now,
            )
          : {
              ...job,
              workerId: input.workerId,
              leaseUntil: input.leaseUntil,
              lastHeartbeatAt: input.now,
              updatedAt: input.now,
            };
      this.jobs.set(job.id, claimed);
      return claimed;
    });
  }
  async transitionByWorker(input: {
    workerId: string;
    jobId: string;
    phase: GenerationJobPhase;
    patch: GenerationJobTransitionPatch & { billingActualUnits?: number };
    now: string;
  }) {
    const job = this.jobs.get(input.jobId);
    if (
      !job ||
      job.workerId !== input.workerId ||
      !job.leaseUntil ||
      job.leaseUntil <= input.now
    )
      throw new DomainError("JOB_LEASE_LOST", 409, "任务租约已失效");
    const { billingActualUnits, ...statePatch } = input.patch;
    const updated = transitionGenerationJob(
      job,
      input.phase,
      statePatch,
      input.now,
    );
    this.settleTerminal(updated, input.now, billingActualUnits);
    this.jobs.set(job.id, updated);
    return updated;
  }
  async getForWorker(workerId: string, jobId: string, now: string) {
    const job = this.jobs.get(jobId);
    return job?.workerId === workerId && job.leaseUntil && job.leaseUntil > now
      ? job
      : null;
  }
  async heartbeat(
    workerId: string,
    jobIds: string[],
    now: string,
    leaseUntil: string,
  ) {
    let count = 0;
    for (const id of new Set(jobIds)) {
      const job = this.jobs.get(id);
      if (
        !job ||
        job.workerId !== workerId ||
        !job.leaseUntil ||
        job.leaseUntil <= now
      )
        continue;
      this.jobs.set(id, {
        ...job,
        leaseUntil,
        lastHeartbeatAt: now,
        updatedAt: now,
      });
      count++;
    }
    return count;
  }
  async recordWorkerHeartbeat(workerId: string, now: string) {
    this.workerHeartbeats.set(workerId, now);
  }
  async latestWorkerHeartbeat() {
    return [...this.workerHeartbeats.values()].sort().at(-1) || null;
  }
  async operationalMetrics(now: string) {
    const jobs = [...this.jobs.values()];
    const queued = jobs.filter((job) => job.phase === "queued");
    return {
      queueDepth: queued.length,
      queueOldestAt:
        queued
          .map((job) => job.createdAt)
          .sort()
          .at(0) || null,
      stuckJobs: jobs.filter(
        (job) =>
          !isTerminalGenerationPhase(job.phase) &&
          Boolean(job.leaseUntil && job.leaseUntil <= now),
      ).length,
      latestWorkerHeartbeatAt: await this.latestWorkerHeartbeat(),
    };
  }
  async estimate(
    logicalModelId: string,
    capability: GenerationJob["capability"],
    parameters: Record<string, unknown>,
  ) {
    return estimatePrice(
      logicalModelId,
      capability,
      parameters,
      this.priceRules.get(priceKey(logicalModelId, capability)),
    );
  }
  async getWallet(userId: string) {
    return (
      this.wallets.get(userId) || {
        userId,
        balanceUnits: 0,
        updatedAt: new Date(0).toISOString(),
      }
    );
  }
  async listLedger(userId: string, limit: number) {
    return this.ledger
      .filter((entry) => entry.userId === userId)
      .slice(-limit)
      .reverse();
  }
  async adjustWallet(input: {
    userId: string;
    amountUnits: number;
    idempotencyKey: string;
    note: string;
    now: string;
  }) {
    if (
      this.ledger.some((entry) => entry.idempotencyKey === input.idempotencyKey)
    )
      return this.getWallet(input.userId);
    const current = await this.getWallet(input.userId);
    const balance = current.balanceUnits + input.amountUnits;
    if (balance < 0)
      throw new DomainError("INSUFFICIENT_POINTS", 409, "积分余额不足");
    const wallet = {
      userId: input.userId,
      balanceUnits: balance,
      updatedAt: input.now,
    };
    this.wallets.set(input.userId, wallet);
    this.ledger.push({
      id: randomUUID(),
      userId: input.userId,
      jobId: null,
      type: "adjustment",
      amountUnits: input.amountUnits,
      balanceAfterUnits: balance,
      idempotencyKey: input.idempotencyKey,
      metadata: { note: input.note },
      createdAt: input.now,
    });
    return wallet;
  }
  async savePriceRule(rule: BillingPriceRule) {
    this.priceRules.set(priceKey(rule.logicalModelId, rule.capability), rule);
    return rule;
  }
  private async reserve(job: GenerationJob) {
    const estimate = await this.estimate(
      job.logicalModelId,
      job.capability,
      job.input,
    );
    if (!estimate.estimatedUnits)
      return {
        ...job,
        billing: {
          state: "free" as const,
          estimatedUnits: 0,
          reservedUnits: 0,
          actualUnits: null,
        },
      };
    const wallet = await this.getWallet(job.ownerId);
    if (wallet.balanceUnits < estimate.estimatedUnits)
      throw new DomainError("INSUFFICIENT_POINTS", 409, "积分余额不足");
    const balance = wallet.balanceUnits - estimate.estimatedUnits;
    this.wallets.set(job.ownerId, {
      ...wallet,
      balanceUnits: balance,
      updatedAt: job.createdAt,
    });
    this.ledger.push({
      id: randomUUID(),
      userId: job.ownerId,
      jobId: job.id,
      type: "reserve",
      amountUnits: -estimate.estimatedUnits,
      balanceAfterUnits: balance,
      idempotencyKey: `job:${job.id}:reserve`,
      metadata: { estimate },
      createdAt: job.createdAt,
    });
    return {
      ...job,
      billing: {
        state: "reserved" as const,
        estimatedUnits: estimate.estimatedUnits,
        reservedUnits: estimate.estimatedUnits,
        actualUnits: null,
      },
    };
  }
  private settleTerminal(
    job: GenerationJob,
    now: string,
    actualInput?: number,
  ) {
    if (job.billing.state !== "reserved") return;
    if (job.phase === "succeeded") {
      const actual =
        actualInput === undefined
          ? job.billing.reservedUnits
          : safeUnits(actualInput);
      const delta = job.billing.reservedUnits - actual;
      const wallet = this.wallets.get(job.ownerId)!;
      const balance = wallet.balanceUnits + delta;
      if (balance < 0)
        throw new DomainError(
          "INSUFFICIENT_POINTS_AT_SETTLEMENT",
          409,
          "实际用量超过预留且余额不足",
        );
      this.wallets.set(job.ownerId, {
        ...wallet,
        balanceUnits: balance,
        updatedAt: now,
      });
      job.billing = {
        ...job.billing,
        state: "settled",
        actualUnits: actual,
      };
      this.ledger.push({
        id: randomUUID(),
        userId: job.ownerId,
        jobId: job.id,
        type: "settle",
        amountUnits: delta,
        balanceAfterUnits: balance,
        idempotencyKey: `job:${job.id}:settle`,
        metadata: {},
        createdAt: now,
      });
    } else if (job.phase === "failed" || job.phase === "cancelled") {
      const wallet = this.wallets.get(job.ownerId)!;
      const balance = wallet.balanceUnits + job.billing.reservedUnits;
      this.wallets.set(job.ownerId, {
        ...wallet,
        balanceUnits: balance,
        updatedAt: now,
      });
      job.billing = { ...job.billing, state: "refunded", actualUnits: 0 };
      this.ledger.push({
        id: randomUUID(),
        userId: job.ownerId,
        jobId: job.id,
        type: "refund",
        amountUnits: job.billing.reservedUnits,
        balanceAfterUnits: balance,
        idempotencyKey: `job:${job.id}:refund`,
        metadata: {},
        createdAt: now,
      });
    } else if (job.phase === "needs_review")
      job.billing = { ...job.billing, state: "needs_review" };
  }
  private requireUserJob(userId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.ownerId !== userId)
      throw new DomainError("JOB_NOT_FOUND", 404, "生成任务不存在");
    return job;
  }
}

export function estimatePrice(
  logicalModelId: string,
  capability: GenerationJob["capability"],
  parameters: Record<string, unknown>,
  rule?: BillingPriceRule,
): BillingEstimate {
  const baseUnits = rule?.enabled ? safeUnits(rule.baseUnits) : 0;
  const config = rule?.multiplierConfig || {};
  const count = boundedNumber(parameters.count, 1, 1, 100);
  const resolution = String(parameters.resolution || "");
  const resolutionMap = objectValue(config.resolutionPermille);
  const resolutionPermille = boundedNumber(
    resolutionMap[resolution],
    1000,
    1,
    100_000,
  );
  const duration = boundedNumber(parameters.durationSeconds, 0, 0, 86_400);
  const durationPerSecond = boundedNumber(
    config.durationPermillePerSecond,
    0,
    0,
    100_000,
  );
  const multiplierPermille = Math.ceil(
    (count *
      resolutionPermille *
      (duration ? Math.max(1000, duration * durationPerSecond) : 1000)) /
      1000,
  );
  const estimatedUnits = Math.ceil((baseUnits * multiplierPermille) / 1000);
  if (!Number.isSafeInteger(estimatedUnits))
    throw new DomainError(
      "BILLING_ESTIMATE_INVALID",
      400,
      "计费预估超出安全范围",
    );
  return {
    logicalModelId,
    capability,
    estimatedUnits,
    baseUnits,
    multiplierPermille,
    currency: "points",
  };
}
function priceKey(
  logicalModelId: string,
  capability: GenerationJob["capability"],
) {
  return `${logicalModelId.trim().toLowerCase()}\u0000${capability}`;
}
function safeUnits(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new DomainError(
      "BILLING_PRICE_INVALID",
      400,
      "积分价格必须为非负安全整数",
    );
  return value;
}
function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
