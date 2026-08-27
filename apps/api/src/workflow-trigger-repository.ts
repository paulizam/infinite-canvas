import { DomainError } from "./domain.js";

export type WorkflowTriggerKind = "webhook" | "form" | "email" | "schedule";
export type WorkflowTriggerRecord = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  workspaceId: string;
  createdBy: string;
  kind: WorkflowTriggerKind;
  targetNodeId: string;
  tokenHash: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
  nextRunAt: string | null;
  workerId: string | null;
  leaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
};
export type TriggerInvocation = {
  id: string;
  triggerId: string;
  idempotencyKey: string;
  executionId: string;
  createdAt: string;
};

export interface WorkflowTriggerRepository {
  create(trigger: WorkflowTriggerRecord): Promise<WorkflowTriggerRecord>;
  list(userId: string, workflowId: string): Promise<WorkflowTriggerRecord[]>;
  disable(
    userId: string,
    triggerId: string,
    now: string,
  ): Promise<WorkflowTriggerRecord>;
  getForToken(
    triggerId: string,
    tokenHash: string,
  ): Promise<WorkflowTriggerRecord | null>;
  reserveInvocation(
    input: TriggerInvocation & { maxPerMinute: number },
  ): Promise<{ invocation: TriggerInvocation; replayed: boolean }>;
  claimSchedules(input: {
    workerId: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }): Promise<WorkflowTriggerRecord[]>;
  getClaimedSchedule(
    workerId: string,
    triggerId: string,
    now: string,
  ): Promise<WorkflowTriggerRecord | null>;
  completeSchedule(
    workerId: string,
    triggerId: string,
    now: string,
    nextRunAt: string,
  ): Promise<WorkflowTriggerRecord>;
}

export class MemoryWorkflowTriggerRepository implements WorkflowTriggerRepository {
  private readonly triggers = new Map<string, WorkflowTriggerRecord>();
  private readonly invocations = new Map<string, TriggerInvocation>();
  constructor(
    private readonly authorize: (
      userId: string,
      workspaceId: string,
      minimum: "viewer" | "editor",
    ) => Promise<void>,
  ) {}
  async create(trigger: WorkflowTriggerRecord) {
    await this.authorize(trigger.createdBy, trigger.workspaceId, "editor");
    this.triggers.set(trigger.id, structuredClone(trigger));
    return structuredClone(trigger);
  }
  async list(userId: string, workflowId: string) {
    const records = [...this.triggers.values()].filter(
      (item) => item.workflowId === workflowId,
    );
    if (records[0])
      await this.authorize(userId, records[0].workspaceId, "viewer");
    return records
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => structuredClone(item));
  }
  async disable(userId: string, triggerId: string, now: string) {
    const trigger = this.triggers.get(triggerId);
    if (!trigger)
      throw new DomainError("TRIGGER_NOT_FOUND", 404, "Trigger 不存在");
    await this.authorize(userId, trigger.workspaceId, "editor");
    trigger.enabled = false;
    trigger.workerId = null;
    trigger.leaseUntil = null;
    trigger.updatedAt = now;
    return structuredClone(trigger);
  }
  async getForToken(triggerId: string, tokenHash: string) {
    const trigger = this.triggers.get(triggerId);
    return trigger?.enabled && trigger.tokenHash === tokenHash
      ? structuredClone(trigger)
      : null;
  }
  async reserveInvocation(input: TriggerInvocation & { maxPerMinute: number }) {
    const key = `${input.triggerId}\0${input.idempotencyKey}`;
    const existing = this.invocations.get(key);
    if (existing)
      return { invocation: structuredClone(existing), replayed: true };
    const since = new Date(Date.parse(input.createdAt) - 60_000).toISOString();
    const count = [...this.invocations.values()].filter(
      (item) => item.triggerId === input.triggerId && item.createdAt > since,
    ).length;
    if (count >= input.maxPerMinute)
      throw new DomainError(
        "TRIGGER_RATE_LIMITED",
        429,
        "Trigger 调用过于频繁",
      );
    const invocation = {
      id: input.id,
      triggerId: input.triggerId,
      idempotencyKey: input.idempotencyKey,
      executionId: input.executionId,
      createdAt: input.createdAt,
    };
    this.invocations.set(key, invocation);
    return { invocation: structuredClone(invocation), replayed: false };
  }
  async claimSchedules(input: {
    workerId: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }) {
    const due = [...this.triggers.values()]
      .filter(
        (item) =>
          item.kind === "schedule" &&
          item.enabled &&
          item.nextRunAt! <= input.now &&
          (!item.leaseUntil || item.leaseUntil <= input.now),
      )
      .sort(
        (a, b) =>
          a.nextRunAt!.localeCompare(b.nextRunAt!) || a.id.localeCompare(b.id),
      )
      .slice(0, input.limit);
    for (const trigger of due) {
      trigger.workerId = input.workerId;
      trigger.leaseUntil = input.leaseUntil;
    }
    return due.map((item) => structuredClone(item));
  }
  async getClaimedSchedule(workerId: string, triggerId: string, now: string) {
    const trigger = this.triggers.get(triggerId);
    return trigger?.kind === "schedule" &&
      trigger.workerId === workerId &&
      Boolean(trigger.leaseUntil && trigger.leaseUntil > now)
      ? structuredClone(trigger)
      : null;
  }
  async completeSchedule(
    workerId: string,
    triggerId: string,
    now: string,
    nextRunAt: string,
  ) {
    const trigger = this.triggers.get(triggerId);
    if (
      !trigger ||
      trigger.workerId !== workerId ||
      !trigger.leaseUntil ||
      trigger.leaseUntil <= now
    )
      throw new DomainError("TRIGGER_LEASE_LOST", 409, "Trigger 租约已失效");
    trigger.nextRunAt = nextRunAt;
    trigger.workerId = null;
    trigger.leaseUntil = null;
    trigger.updatedAt = now;
    return structuredClone(trigger);
  }
}
