import type {
  GenerationJob,
  GenerationJobPhase,
} from "@infinite-canvas/contracts";
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
  listForUser(userId: string, workspaceId: string): Promise<GenerationJob[]>;
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
    patch: GenerationJobTransitionPatch;
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
}

export class MemoryGenerationJobRepository implements GenerationJobRepository {
  private jobs = new Map<string, GenerationJob>();
  readonly workerHeartbeats = new Map<string, string>();

  async create(job: GenerationJob) {
    const existing = [...this.jobs.values()].find(
      (item) =>
        item.workspaceId === job.workspaceId &&
        item.ownerId === job.ownerId &&
        item.clientRequestId === job.clientRequestId &&
        item.attempt === job.attempt,
    );
    if (existing) return { job: existing, replayed: true };
    this.jobs.set(job.id, job);
    return { job, replayed: false };
  }
  async getForUser(userId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    return job?.ownerId === userId ? job : null;
  }
  async listForUser(userId: string, workspaceId: string) {
    return [...this.jobs.values()]
      .filter(
        (job) => job.ownerId === userId && job.workspaceId === workspaceId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    patch: GenerationJobTransitionPatch;
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
    const updated = transitionGenerationJob(
      job,
      input.phase,
      input.patch,
      input.now,
    );
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
  private requireUserJob(userId: string, jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.ownerId !== userId)
      throw new DomainError("JOB_NOT_FOUND", 404, "生成任务不存在");
    return job;
  }
}
