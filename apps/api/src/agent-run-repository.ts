import { DomainError } from "./domain.js";

export type AgentRunStatus =
  | "queued"
  | "claimed"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";
export type AgentSessionRecord = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  createdBy: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};
export type AgentRunRecord = {
  id: string;
  sessionId: string;
  workspaceId: string;
  createdBy: string;
  prompt: string;
  attachments: Array<{
    assetId: string;
    kind: "image" | "video" | "audio" | "file";
  }>;
  modelId: string | null;
  parameters: Record<string, unknown>;
  skillPolicy: Record<string, unknown>;
  plan: unknown;
  status: AgentRunStatus;
  attempt: number;
  maxAttempts: number;
  workerId: string | null;
  leaseUntil: string | null;
  lastHeartbeatAt: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export type AgentRunEvent = {
  runId: string;
  sequence: number;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
};
export type AgentRunSubtask = {
  id: string;
  runId: string;
  kind: string;
  title: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  input: unknown;
  output: unknown;
  error: unknown;
  createdAt: string;
  updatedAt: string;
};
export type AgentRunResult = {
  id: string;
  runId: string;
  kind:
    | "text"
    | "image"
    | "video"
    | "audio"
    | "asset"
    | "canvas_operation"
    | "drama_item";
  payload: Record<string, unknown>;
  assetId: string | null;
  createdAt: string;
};
export type AgentRunApproval = {
  id: string;
  runId: string;
  action: "delete" | "batch_paid_generation" | "external_access";
  status: "pending" | "approved" | "declined";
  request: Record<string, unknown>;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
};
export type AgentRunDetail = {
  run: AgentRunRecord;
  events: AgentRunEvent[];
  subtasks: AgentRunSubtask[];
  results: AgentRunResult[];
  approvals: AgentRunApproval[];
};

export interface AgentRunRepository {
  createSession(record: AgentSessionRecord): Promise<AgentSessionRecord>;
  listSessions(
    userId: string,
    workspaceId: string,
  ): Promise<AgentSessionRecord[]>;
  getSession(
    userId: string,
    sessionId: string,
    minimum: "viewer" | "editor",
  ): Promise<AgentSessionRecord | null>;
  createRun(
    record: AgentRunRecord,
    event: AgentRunEvent,
  ): Promise<AgentRunDetail>;
  listRuns(userId: string, sessionId: string): Promise<AgentRunRecord[]>;
  getRun(userId: string, runId: string): Promise<AgentRunDetail | null>;
  cancel(userId: string, runId: string, now: string): Promise<AgentRunDetail>;
  retry(
    userId: string,
    runId: string,
    replacement: AgentRunRecord,
    event: AgentRunEvent,
  ): Promise<AgentRunDetail>;
  claim(input: {
    workerId: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }): Promise<AgentRunDetail[]>;
  heartbeat(
    workerId: string,
    runIds: string[],
    now: string,
    leaseUntil: string,
  ): Promise<number>;
  getLeased(
    workerId: string,
    runId: string,
    now: string,
  ): Promise<AgentRunDetail | null>;
  saveWorker(input: {
    workerId: string;
    run: AgentRunRecord;
    events: AgentRunEvent[];
    subtasks: AgentRunSubtask[];
    results: AgentRunResult[];
    approvals: AgentRunApproval[];
    now: string;
  }): Promise<AgentRunDetail>;
  decideApproval(
    userId: string,
    approvalId: string,
    decision: "approved" | "declined",
    now: string,
  ): Promise<AgentRunDetail>;
}

export class MemoryAgentRunRepository implements AgentRunRepository {
  private readonly sessions = new Map<string, AgentSessionRecord>();
  private readonly details = new Map<string, AgentRunDetail>();
  constructor(
    private readonly authorize: (
      userId: string,
      workspaceId: string,
      minimum: "viewer" | "editor",
    ) => Promise<void>,
  ) {}
  async createSession(record: AgentSessionRecord) {
    await this.authorize(record.createdBy, record.workspaceId, "editor");
    this.sessions.set(record.id, structuredClone(record));
    return structuredClone(record);
  }
  async listSessions(userId: string, workspaceId: string) {
    await this.authorize(userId, workspaceId, "viewer");
    return [...this.sessions.values()]
      .filter((value) => value.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(clone);
  }
  async getSession(
    userId: string,
    sessionId: string,
    minimum: "viewer" | "editor",
  ) {
    const value = this.sessions.get(sessionId);
    if (!value) return null;
    try {
      await this.authorize(userId, value.workspaceId, minimum);
    } catch {
      return null;
    }
    return clone(value);
  }
  async createRun(record: AgentRunRecord, event: AgentRunEvent) {
    const detail = {
      run: clone(record),
      events: [clone(event)],
      subtasks: [],
      results: [],
      approvals: [],
    };
    this.details.set(record.id, detail);
    return clone(detail);
  }
  async listRuns(userId: string, sessionId: string) {
    const session = await this.getSession(userId, sessionId, "viewer");
    if (!session) return [];
    return [...this.details.values()]
      .map((value) => value.run)
      .filter((value) => value.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }
  async getRun(userId: string, runId: string) {
    const value = this.details.get(runId);
    if (!value) return null;
    try {
      await this.authorize(userId, value.run.workspaceId, "viewer");
    } catch {
      return null;
    }
    return clone(value);
  }
  async cancel(userId: string, runId: string, now: string) {
    const value = await this.editable(userId, runId);
    if (["succeeded", "failed", "cancelled"].includes(value.run.status))
      return clone(value);
    value.run = {
      ...value.run,
      status: "cancelled",
      workerId: null,
      leaseUntil: null,
      updatedAt: now,
      completedAt: now,
    };
    this.event(value, "run.cancelled", {}, now);
    return clone(value);
  }
  async retry(
    userId: string,
    runId: string,
    replacement: AgentRunRecord,
    event: AgentRunEvent,
  ) {
    const value = await this.editable(userId, runId);
    if (value.run.status !== "failed")
      throw new DomainError(
        "AGENT_RUN_NOT_RETRYABLE",
        409,
        "Agent Run 不可重试",
      );
    const detail = {
      run: clone(replacement),
      events: [clone(event)],
      subtasks: [],
      results: [],
      approvals: [],
    };
    this.details.set(replacement.id, detail);
    return clone(detail);
  }
  async claim(input: {
    workerId: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }) {
    const values = [...this.details.values()]
      .filter(
        (value) =>
          value.run.status === "queued" ||
          (["claimed", "running"].includes(value.run.status) &&
            Boolean(value.run.leaseUntil && value.run.leaseUntil <= input.now)),
      )
      .sort((a, b) => a.run.createdAt.localeCompare(b.run.createdAt))
      .slice(0, input.limit);
    for (const value of values) {
      value.run.status = "claimed";
      value.run.workerId = input.workerId;
      value.run.leaseUntil = input.leaseUntil;
      value.run.lastHeartbeatAt = input.now;
      value.run.updatedAt = input.now;
      this.event(value, "run.claimed", { workerId: input.workerId }, input.now);
    }
    return values.map(clone);
  }
  async heartbeat(
    workerId: string,
    runIds: string[],
    now: string,
    leaseUntil: string,
  ) {
    let count = 0;
    for (const id of runIds) {
      const value = this.details.get(id);
      if (
        value?.run.workerId === workerId &&
        value.run.leaseUntil &&
        value.run.leaseUntil > now
      ) {
        value.run.lastHeartbeatAt = now;
        value.run.leaseUntil = leaseUntil;
        count++;
      }
    }
    return count;
  }
  async getLeased(workerId: string, runId: string, now: string) {
    const value = this.details.get(runId);
    return value?.run.workerId === workerId &&
      Boolean(value.run.leaseUntil && value.run.leaseUntil > now)
      ? clone(value)
      : null;
  }
  async saveWorker(input: {
    workerId: string;
    run: AgentRunRecord;
    events: AgentRunEvent[];
    subtasks: AgentRunSubtask[];
    results: AgentRunResult[];
    approvals: AgentRunApproval[];
    now: string;
  }) {
    const current = this.details.get(input.run.id);
    if (
      !current ||
      current.run.workerId !== input.workerId ||
      !current.run.leaseUntil ||
      current.run.leaseUntil <= input.now
    )
      throw new DomainError(
        "AGENT_RUN_LEASE_LOST",
        409,
        "Agent Run 租约已失效",
      );
    const terminal = [
      "waiting_approval",
      "succeeded",
      "failed",
      "cancelled",
    ].includes(input.run.status);
    const detail = {
      run: {
        ...clone(input.run),
        workerId: terminal ? null : input.workerId,
        leaseUntil: terminal ? null : current.run.leaseUntil,
      },
      events: clone(input.events),
      subtasks: clone(input.subtasks),
      results: clone(input.results),
      approvals: clone(input.approvals),
    };
    this.details.set(input.run.id, detail);
    return clone(detail);
  }
  async decideApproval(
    userId: string,
    approvalId: string,
    decision: "approved" | "declined",
    now: string,
  ) {
    const value = [...this.details.values()].find((detail) =>
      detail.approvals.some((approval) => approval.id === approvalId),
    );
    if (!value)
      throw new DomainError("AGENT_APPROVAL_NOT_FOUND", 404, "Approval 不存在");
    try {
      await this.authorize(userId, value.run.workspaceId, "editor");
    } catch {
      throw new DomainError("AGENT_APPROVAL_NOT_FOUND", 404, "Approval 不存在");
    }
    const approval = value.approvals.find((item) => item.id === approvalId)!;
    if (approval.status !== "pending") return clone(value);
    Object.assign(approval, {
      status: decision,
      decidedBy: userId,
      decidedAt: now,
    });
    value.run.status = decision === "approved" ? "queued" : "failed";
    value.run.workerId = null;
    value.run.leaseUntil = null;
    value.run.updatedAt = now;
    if (decision === "declined") {
      value.run.error = {
        code: "APPROVAL_DECLINED",
        message: "用户拒绝了高风险操作",
      };
      value.run.completedAt = now;
    }
    this.event(value, `approval.${decision}`, { approvalId }, now);
    return clone(value);
  }
  private async editable(userId: string, runId: string) {
    const value = this.details.get(runId);
    if (!value)
      throw new DomainError("AGENT_RUN_NOT_FOUND", 404, "Agent Run 不存在");
    try {
      await this.authorize(userId, value.run.workspaceId, "editor");
    } catch {
      throw new DomainError("AGENT_RUN_NOT_FOUND", 404, "Agent Run 不存在");
    }
    return value;
  }
  private event(
    detail: AgentRunDetail,
    type: string,
    data: Record<string, unknown>,
    now: string,
  ) {
    detail.events.push({
      runId: detail.run.id,
      sequence: detail.events.length + 1,
      type,
      data,
      createdAt: now,
    });
  }
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
