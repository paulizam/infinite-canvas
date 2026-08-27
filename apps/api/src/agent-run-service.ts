import { randomUUID } from "node:crypto";
import { DomainError, type PlatformRepository } from "./domain.js";
import type {
  AgentRunApproval,
  AgentRunDetail,
  AgentRunEvent,
  AgentRunRepository,
  AgentRunResult,
  AgentRunSubtask,
} from "./agent-run-repository.js";

export type AgentWorkerOperation =
  | { type: "run.start"; plan?: unknown }
  | { type: "event.append"; eventType: string; data: Record<string, unknown> }
  | {
      type: "subtask.upsert";
      subtask: {
        id?: string;
        kind: string;
        title: string;
        status: AgentRunSubtask["status"];
        input?: unknown;
        output?: unknown;
        error?: unknown;
      };
    }
  | {
      type: "result.add";
      result: {
        kind: AgentRunResult["kind"];
        payload: Record<string, unknown>;
        assetId?: string;
      };
    }
  | {
      type: "approval.request";
      action: AgentRunApproval["action"];
      request: Record<string, unknown>;
    }
  | { type: "run.complete" }
  | { type: "run.fail"; error: { code: string; message: string } };

export class AgentRunService {
  constructor(
    private readonly platform: PlatformRepository,
    private readonly repository: AgentRunRepository,
  ) {}
  async createSession(
    userId: string,
    workspaceId: string,
    input: { title: string; projectId?: string },
  ) {
    await this.platform.requireWorkspaceRole(userId, workspaceId, "editor");
    if (input.projectId) {
      const project = await this.platform.getProject(userId, input.projectId);
      if (!project || project.workspaceId !== workspaceId)
        throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    }
    const now = new Date().toISOString();
    return this.repository.createSession({
      id: randomUUID(),
      workspaceId,
      projectId: input.projectId || null,
      createdBy: userId,
      title: input.title,
      createdAt: now,
      updatedAt: now,
    });
  }
  listSessions(userId: string, workspaceId: string) {
    return this.repository.listSessions(userId, workspaceId);
  }
  async createRun(
    userId: string,
    sessionId: string,
    input: {
      prompt: string;
      attachments: Array<{
        assetId: string;
        kind: "image" | "video" | "audio" | "file";
      }>;
      modelId?: string;
      parameters: Record<string, unknown>;
      skillPolicy: Record<string, unknown>;
      maxAttempts: number;
    },
  ) {
    const session = await this.repository.getSession(
      userId,
      sessionId,
      "editor",
    );
    if (!session)
      throw new DomainError(
        "AGENT_SESSION_NOT_FOUND",
        404,
        "Agent Session 不存在",
      );
    for (const attachment of input.attachments) {
      const asset = await this.platform.getAsset(userId, attachment.assetId);
      if (!asset || asset.workspaceId !== session.workspaceId)
        throw new DomainError("ASSET_NOT_FOUND", 404, "附件不存在");
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    return this.repository.createRun(
      {
        id,
        sessionId,
        workspaceId: session.workspaceId,
        createdBy: userId,
        prompt: input.prompt,
        attachments: structuredClone(input.attachments),
        modelId: input.modelId || null,
        parameters: structuredClone(input.parameters),
        skillPolicy: structuredClone(input.skillPolicy),
        plan: null,
        status: "queued",
        attempt: 1,
        maxAttempts: input.maxAttempts,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
      { runId: id, sequence: 1, type: "run.queued", data: {}, createdAt: now },
    );
  }
  listRuns(userId: string, sessionId: string) {
    return this.repository.listRuns(userId, sessionId);
  }
  async getRun(userId: string, runId: string) {
    const detail = await this.repository.getRun(userId, runId);
    if (!detail)
      throw new DomainError("AGENT_RUN_NOT_FOUND", 404, "Agent Run 不存在");
    return detail;
  }
  cancel(userId: string, runId: string) {
    return this.repository.cancel(userId, runId, new Date().toISOString());
  }
  async retry(userId: string, runId: string) {
    const previous = await this.getRun(userId, runId);
    if (
      previous.run.status !== "failed" ||
      previous.run.attempt >= previous.run.maxAttempts
    )
      throw new DomainError(
        "AGENT_RUN_NOT_RETRYABLE",
        409,
        "Agent Run 不可重试",
      );
    const now = new Date().toISOString();
    const id = randomUUID();
    return this.repository.retry(
      userId,
      runId,
      {
        ...previous.run,
        id,
        status: "queued",
        attempt: previous.run.attempt + 1,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        error: null,
        plan: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      },
      {
        runId: id,
        sequence: 1,
        type: "run.retried",
        data: { previousRunId: runId },
        createdAt: now,
      },
    );
  }
  decideApproval(
    userId: string,
    approvalId: string,
    decision: "approved" | "declined",
  ) {
    return this.repository.decideApproval(
      userId,
      approvalId,
      decision,
      new Date().toISOString(),
    );
  }
  claim(workerId: string, limit: number, leaseMs: number) {
    const now = new Date();
    return this.repository.claim({
      workerId,
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
      limit,
    });
  }
  heartbeat(workerId: string, runIds: string[], leaseMs: number) {
    const now = new Date();
    return this.repository.heartbeat(
      workerId,
      runIds,
      now.toISOString(),
      new Date(now.getTime() + leaseMs).toISOString(),
    );
  }
  async transition(
    workerId: string,
    runId: string,
    operation: AgentWorkerOperation,
  ) {
    const now = new Date().toISOString();
    const detail = await this.repository.getLeased(workerId, runId, now);
    if (!detail)
      throw new DomainError(
        "AGENT_RUN_LEASE_LOST",
        409,
        "Agent Run 租约已失效",
      );
    if (operation.type === "result.add" && operation.result.assetId) {
      const asset = await this.platform.getAsset(
        detail.run.createdBy,
        operation.result.assetId,
      );
      if (!asset || asset.workspaceId !== detail.run.workspaceId)
        throw new DomainError("ASSET_NOT_FOUND", 404, "结果 Asset 不存在");
    }
    applyOperation(detail, operation, now);
    return this.repository.saveWorker({ workerId, ...detail, now });
  }
}

function applyOperation(
  detail: AgentRunDetail,
  operation: AgentWorkerOperation,
  now: string,
) {
  const event = (type: string, data: Record<string, unknown> = {}) =>
    detail.events.push({
      runId: detail.run.id,
      sequence: detail.events.length + 1,
      type,
      data,
      createdAt: now,
    });
  if (["succeeded", "failed", "cancelled"].includes(detail.run.status))
    throw new DomainError("AGENT_RUN_TERMINAL", 409, "Agent Run 已结束");
  switch (operation.type) {
    case "run.start":
      detail.run.status = "running";
      detail.run.plan = sanitizeVisible(operation.plan);
      event(
        "run.started",
        operation.plan ? { plan: sanitizeVisible(operation.plan) } : {},
      );
      break;
    case "event.append":
      if (
        /reasoning|chain.?of.?thought|rationale/i.test(operation.eventType) ||
        containsPrivateReasoning(operation.data)
      )
        throw new DomainError(
          "PRIVATE_REASONING_REJECTED",
          422,
          "不得持久化内部推理",
        );
      event(operation.eventType, operation.data);
      break;
    case "subtask.upsert": {
      const existing = detail.subtasks.find(
        (value) => value.id === operation.subtask.id,
      );
      const value = {
        id: operation.subtask.id || randomUUID(),
        runId: detail.run.id,
        kind: operation.subtask.kind,
        title: operation.subtask.title,
        status: operation.subtask.status,
        input: sanitizeVisible(operation.subtask.input),
        output: sanitizeVisible(operation.subtask.output),
        error: sanitizeVisible(operation.subtask.error),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      if (existing) Object.assign(existing, value);
      else detail.subtasks.push(value);
      event("subtask.updated", { subtaskId: value.id, status: value.status });
      break;
    }
    case "result.add":
      detail.results.push({
        id: randomUUID(),
        runId: detail.run.id,
        kind: operation.result.kind,
        payload: operation.result.payload,
        assetId: operation.result.assetId || null,
        createdAt: now,
      });
      event("result.created", { kind: operation.result.kind });
      break;
    case "approval.request": {
      if (detail.approvals.some((value) => value.status === "pending"))
        throw new DomainError(
          "AGENT_APPROVAL_PENDING",
          409,
          "已有待处理 Approval",
        );
      const approval = {
        id: randomUUID(),
        runId: detail.run.id,
        action: operation.action,
        status: "pending" as const,
        request: operation.request,
        requestedAt: now,
        decidedBy: null,
        decidedAt: null,
      };
      detail.approvals.push(approval);
      detail.run.status = "waiting_approval";
      event("approval.requested", {
        approvalId: approval.id,
        action: approval.action,
      });
      break;
    }
    case "run.complete":
      detail.run.status = "succeeded";
      detail.run.completedAt = now;
      event("run.succeeded");
      break;
    case "run.fail":
      detail.run.status = "failed";
      detail.run.error = operation.error;
      detail.run.completedAt = now;
      event("run.failed", { error: operation.error });
      break;
  }
  detail.run.updatedAt = now;
}
function containsPrivateReasoning(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) =>
      /reasoning|chain.?of.?thought|rationale/i.test(key) ||
      containsPrivateReasoning(child),
  );
}
function sanitizeVisible(value: unknown) {
  if (containsPrivateReasoning(value))
    throw new DomainError(
      "PRIVATE_REASONING_REJECTED",
      422,
      "不得持久化内部推理",
    );
  return value === undefined ? null : structuredClone(value);
}
