import { randomUUID } from "node:crypto";
import type {
  AgentCanvasToolOperation,
  AgentRemoteToolCall,
  AgentToolContext,
  CanvasNode,
  CanvasOperation,
} from "@infinite-canvas/contracts";
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
        id?: string;
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
  async toolContext(
    workerId: string,
    runId: string,
  ): Promise<AgentToolContext> {
    const detail = await this.leased(workerId, runId);
    const session = await this.repository.getSession(
      detail.run.createdBy,
      detail.run.sessionId,
      "viewer",
    );
    if (!session)
      throw new DomainError(
        "AGENT_SESSION_NOT_FOUND",
        404,
        "Agent Session 不存在",
      );
    const project = session.projectId
      ? await this.platform.getProject(detail.run.createdBy, session.projectId)
      : null;
    if (
      session.projectId &&
      (!project || project.workspaceId !== detail.run.workspaceId)
    )
      throw new DomainError("PROJECT_NOT_FOUND", 404, "绑定项目不存在");
    const assets = await this.platform.listAssets(
      detail.run.createdBy,
      detail.run.workspaceId,
    );
    return {
      contractVersion: 1,
      project: project
        ? {
            id: project.id,
            revision: project.document.revision,
            document: project.document,
          }
        : null,
      selection: [],
      assets: assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        mimeType: asset.mimeType,
        bytes: asset.bytes,
        originalName: asset.originalName,
      })),
    };
  }
  async executeTool(
    workerId: string,
    runId: string,
    call: AgentRemoteToolCall,
  ) {
    const detail = await this.leased(workerId, runId);
    const session = await this.repository.getSession(
      detail.run.createdBy,
      detail.run.sessionId,
      "editor",
    );
    if (!session?.projectId)
      throw new DomainError(
        "AGENT_PROJECT_REQUIRED",
        409,
        "Agent Run 未绑定 Canvas 项目",
      );
    const project = await this.platform.getProject(
      detail.run.createdBy,
      session.projectId,
    );
    if (!project || project.workspaceId !== detail.run.workspaceId)
      throw new DomainError("PROJECT_NOT_FOUND", 404, "绑定项目不存在");
    const previous = detail.results.find(
      (value) =>
        value.kind === "canvas_operation" &&
        value.payload.toolCallId === call.id,
    );
    if (previous) {
      if (
        JSON.stringify(previous.payload.ops) !== JSON.stringify(call.input.ops)
      )
        throw new DomainError(
          "AGENT_TOOL_IDEMPOTENCY_CONFLICT",
          409,
          "Agent Tool Call 幂等键冲突",
        );
      return { project, replayed: true };
    }
    if (call.expectedRevision !== project.document.revision)
      throw new DomainError(
        "REVISION_CONFLICT",
        409,
        "Canvas revision 已变化，请重新读取后执行",
      );
    if (
      call.input.ops.some(isDeleteToolOperation) &&
      !detail.approvals.some(
        (value) => value.action === "delete" && value.status === "approved",
      )
    ) {
      throw new DomainError(
        "AGENT_APPROVAL_REQUIRED",
        409,
        "删除操作需要 delete approval",
      );
    }
    const operations = normalizeAgentOperations(
      call.input.ops,
      project.document.nodes,
      project.document.connections.map((value) => value.id),
    );
    const mutationId = `agent:${runId}:${call.id}`;
    const mutation = await this.platform.applyProjectMutation(
      detail.run.createdBy,
      project.id,
      {
        mutationId,
        projectId: project.id,
        baseRevision: call.expectedRevision,
        operations,
        clientId: `remote-agent:${runId}`,
        createdAt: new Date().toISOString(),
      },
    );
    await this.transition(workerId, runId, {
      type: "result.add",
      result: {
        kind: "canvas_operation",
        payload: {
          toolCallId: call.id,
          mutationId,
          ops: call.input.ops,
          revision: mutation.project.document.revision,
        },
      },
    });
    return mutation;
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
  private async leased(workerId: string, runId: string) {
    const detail = await this.repository.getLeased(
      workerId,
      runId,
      new Date().toISOString(),
    );
    if (!detail)
      throw new DomainError(
        "AGENT_RUN_LEASE_LOST",
        409,
        "Agent Run 租约已失效",
      );
    return detail;
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
    case "result.add": {
      const existing = operation.result.id
        ? detail.results.find((value) => value.id === operation.result.id)
        : null;
      if (existing) {
        if (
          existing.kind !== operation.result.kind ||
          JSON.stringify(existing.payload) !==
            JSON.stringify(operation.result.payload) ||
          existing.assetId !== (operation.result.assetId || null)
        )
          throw new DomainError(
            "AGENT_RESULT_IDEMPOTENCY_CONFLICT",
            409,
            "Agent Result 幂等键冲突",
          );
        break;
      }
      const approval = requiredApproval(operation.result);
      if (
        approval &&
        !detail.approvals.some(
          (value) => value.action === approval && value.status === "approved",
        )
      )
        throw new DomainError(
          "AGENT_APPROVAL_REQUIRED",
          409,
          `操作需要 ${approval} approval`,
        );
      detail.results.push({
        id: operation.result.id || randomUUID(),
        runId: detail.run.id,
        kind: operation.result.kind,
        payload: sanitizeVisible(operation.result.payload) as Record<
          string,
          unknown
        >,
        assetId: operation.result.assetId || null,
        createdAt: now,
      });
      event("result.created", { kind: operation.result.kind });
      break;
    }
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
        request: sanitizeVisible(operation.request) as Record<string, unknown>,
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
function requiredApproval(
  result: Extract<AgentWorkerOperation, { type: "result.add" }>["result"],
): AgentRunApproval["action"] | null {
  const payload = result.payload;
  const ops = Array.isArray(payload.ops) ? payload.ops : [];
  if (
    result.kind === "canvas_operation" &&
    ops.some(
      (value) =>
        value &&
        typeof value === "object" &&
        ["delete_node", "delete_connections"].includes(
          String((value as { type?: unknown }).type),
        ),
    )
  )
    return "delete";
  if (
    ["image", "video", "audio"].includes(result.kind) &&
    Number(payload.count || 1) > 1
  )
    return "batch_paid_generation";
  if (
    typeof payload.externalUrl === "string" ||
    (typeof payload.url === "string" && /^https?:\/\//i.test(payload.url))
  )
    return "external_access";
  return null;
}

function isDeleteToolOperation(value: AgentCanvasToolOperation) {
  return value.type === "delete_node" || value.type === "delete_connections";
}

function normalizeAgentOperations(
  values: AgentCanvasToolOperation[],
  nodes: CanvasNode[],
  connectionIds: string[],
): CanvasOperation[] {
  if (!values.length || values.length > 200)
    throw new DomainError(
      "AGENT_TOOL_INPUT_INVALID",
      422,
      "Canvas operations 数量无效",
    );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: CanvasOperation[] = [];
  for (const value of values) {
    switch (value.type) {
      case "add_node": {
        const id = value.id || randomUUID();
        if (byId.has(id))
          throw new DomainError(
            "AGENT_TOOL_INPUT_INVALID",
            422,
            "新增节点 ID 已存在",
          );
        const position = value.position || {
          x: finite(value.x, 0),
          y: finite(value.y, 0),
        };
        const node: CanvasNode = {
          id,
          type: text(value.nodeType, "text", 64),
          title: text(value.title, "Untitled", 200),
          position,
          width: positive(value.width, 320),
          height: positive(value.height, 220),
          metadata: safeRecord(value.metadata),
        };
        byId.set(id, node);
        result.push({ type: "node.upsert", node });
        break;
      }
      case "update_node": {
        const current = byId.get(value.id);
        if (!current)
          throw new DomainError(
            "AGENT_TOOL_INPUT_INVALID",
            422,
            "更新节点不存在",
          );
        const patch = safeRecord(value.patch);
        const node: CanvasNode = {
          ...current,
          ...(typeof patch.title === "string"
            ? { title: text(patch.title, current.title, 200) }
            : {}),
          ...(patch.position && typeof patch.position === "object"
            ? { position: position(patch.position, current.position) }
            : {}),
          ...(typeof patch.width === "number"
            ? { width: positive(patch.width, current.width) }
            : {}),
          ...(typeof patch.height === "number"
            ? { height: positive(patch.height, current.height) }
            : {}),
          metadata: {
            ...(current.metadata || {}),
            ...safeRecord(value.metadata),
          },
        };
        byId.set(node.id, node);
        result.push({ type: "node.upsert", node });
        break;
      }
      case "delete_node": {
        const nodeIds = [
          ...new Set([...(value.ids || []), ...(value.id ? [value.id] : [])]),
        ];
        if (!nodeIds.length)
          throw new DomainError(
            "AGENT_TOOL_INPUT_INVALID",
            422,
            "删除节点为空",
          );
        result.push({ type: "node.remove", nodeIds });
        break;
      }
      case "delete_connections": {
        const ids = value.all
          ? connectionIds
          : [
              ...new Set([
                ...(value.ids || []),
                ...(value.id ? [value.id] : []),
              ]),
            ];
        if (!ids.length)
          throw new DomainError(
            "AGENT_TOOL_INPUT_INVALID",
            422,
            "删除连线为空",
          );
        result.push({ type: "connection.remove", connectionIds: ids });
        break;
      }
      case "connect_nodes":
        result.push({
          type: "connection.upsert",
          connection: {
            id: value.id || randomUUID(),
            fromNodeId: value.fromNodeId,
            toNodeId: value.toNodeId,
          },
        });
        break;
      case "set_viewport":
        result.push({
          type: "viewport.set",
          viewport: {
            x: finite(value.viewport.x, 0),
            y: finite(value.viewport.y, 0),
            k: positive(value.viewport.k, 1),
          },
        });
        break;
      case "select_nodes":
      case "run_generation":
        throw new DomainError(
          "AGENT_TOOL_UNSUPPORTED",
          422,
          `${value.type} 不能由远端持久 Worker 执行`,
        );
    }
  }
  return result;
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value as Record<string, unknown>)
    : {};
}
function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function positive(value: unknown, fallback: number) {
  const number = finite(value, fallback);
  return number > 0 && number <= 100_000 ? number : fallback;
}
function text(value: unknown, fallback: string, max: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;
}
function position(value: unknown, fallback: { x: number; y: number }) {
  const record = safeRecord(value);
  return { x: finite(record.x, fallback.x), y: finite(record.y, fallback.y) };
}
