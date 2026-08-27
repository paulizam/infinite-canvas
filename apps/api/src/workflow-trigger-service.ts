import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DomainError, type PlatformRepository } from "./domain.js";
import type { WorkflowExecutionService } from "./workflow-execution-service.js";
import type { WorkflowRepository } from "./workflow-repository.js";
import type {
  WorkflowTriggerKind,
  WorkflowTriggerRecord,
  WorkflowTriggerRepository,
} from "./workflow-trigger-repository.js";

export class WorkflowTriggerService {
  constructor(
    private readonly platform: PlatformRepository,
    private readonly workflows: WorkflowRepository,
    private readonly executions: WorkflowExecutionService,
    private readonly triggers: WorkflowTriggerRepository,
  ) {}
  async create(
    userId: string,
    workflowId: string,
    input: {
      kind: WorkflowTriggerKind;
      targetNodeId: string;
      version?: number;
      config: Record<string, unknown>;
      nextRunAt?: string;
    },
  ) {
    const publication = await this.workflows.getById(userId, workflowId);
    if (!publication)
      throw new DomainError("WORKFLOW_NOT_FOUND", 404, "Workflow 不存在");
    await this.platform.requireWorkspaceRole(
      userId,
      publication.workflow.workspaceId,
      "editor",
    );
    const version = input.version
      ? (await this.workflows.listVersions(userId, workflowId)).find(
          (item) => item.version === input.version,
        )
      : publication.version;
    if (!version)
      throw new DomainError(
        "WORKFLOW_VERSION_NOT_FOUND",
        404,
        "Workflow 版本不存在",
      );
    if (
      !version.definition.nodes.some((node) => node.id === input.targetNodeId)
    )
      throw new DomainError(
        "WORKFLOW_NODE_NOT_FOUND",
        404,
        "Trigger 目标节点不存在",
      );
    const now = new Date().toISOString();
    const token =
      input.kind === "schedule" ? null : randomBytes(32).toString("base64url");
    const trigger = await this.triggers.create({
      id: randomUUID(),
      workflowId,
      workflowVersion: version.version,
      workspaceId: publication.workflow.workspaceId,
      createdBy: userId,
      kind: input.kind,
      targetNodeId: input.targetNodeId,
      tokenHash: token ? hash(token) : null,
      config: structuredClone(input.config),
      enabled: true,
      nextRunAt: input.kind === "schedule" ? input.nextRunAt || now : null,
      workerId: null,
      leaseUntil: null,
      createdAt: now,
      updatedAt: now,
    });
    return { trigger: publicTrigger(trigger), token };
  }
  async list(userId: string, workflowId: string) {
    const publication = await this.workflows.getById(userId, workflowId);
    if (!publication)
      throw new DomainError("WORKFLOW_NOT_FOUND", 404, "Workflow 不存在");
    return (await this.triggers.list(userId, workflowId)).map(publicTrigger);
  }
  async disable(userId: string, triggerId: string) {
    return publicTrigger(
      await this.triggers.disable(userId, triggerId, new Date().toISOString()),
    );
  }
  async invokeExternal(
    triggerId: string,
    token: string,
    idempotencyKey: string,
    payload: unknown,
  ) {
    const trigger = await this.triggers.getForToken(triggerId, hash(token));
    if (!trigger || trigger.kind === "schedule")
      throw new DomainError("TRIGGER_NOT_FOUND", 404, "Trigger 不存在");
    return this.invoke(trigger, idempotencyKey, payload);
  }
  async claimSchedules(workerId: string, limit: number, leaseMs: number) {
    const now = new Date();
    return this.triggers.claimSchedules({
      workerId,
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
      limit,
    });
  }
  async dispatchSchedule(workerId: string, triggerId: string) {
    const now = new Date().toISOString();
    const claimed = await this.triggers.getClaimedSchedule(
      workerId,
      triggerId,
      now,
    );
    if (!claimed)
      throw new DomainError("TRIGGER_LEASE_LOST", 409, "Trigger 租约已失效");
    const scheduledFor = claimed.nextRunAt!;
    const result = await this.invoke(
      claimed,
      `schedule:${scheduledFor}`,
      claimed.config.payload ?? {},
    );
    const intervalSeconds = Number(claimed.config.intervalSeconds);
    const nextRunAt = new Date(
      Date.parse(scheduledFor) + intervalSeconds * 1_000,
    ).toISOString();
    await this.triggers.completeSchedule(
      workerId,
      claimed.id,
      new Date().toISOString(),
      nextRunAt,
    );
    return result;
  }
  private async invoke(
    trigger: WorkflowTriggerRecord,
    idempotencyKey: string,
    payload: unknown,
  ) {
    const now = new Date().toISOString();
    const executionId = randomUUID();
    const reserved = await this.triggers.reserveInvocation({
      id: randomUUID(),
      triggerId: trigger.id,
      idempotencyKey,
      executionId,
      createdAt: now,
      maxPerMinute: Number(trigger.config.rateLimitPerMinute || 60),
    });
    const execution = await this.executions.create(
      trigger.createdBy,
      trigger.workflowId,
      {
        executionId: reserved.invocation.executionId,
        version: trigger.workflowVersion,
        startNodeIds: [trigger.targetNodeId],
        initialInputs: { [trigger.targetNodeId]: payload },
      },
    );
    return {
      ...execution,
      invocationId: reserved.invocation.id,
      replayed: reserved.replayed || execution.replayed,
    };
  }
}

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function publicTrigger(trigger: WorkflowTriggerRecord) {
  const {
    tokenHash: _tokenHash,
    workerId: _workerId,
    leaseUntil: _leaseUntil,
    ...value
  } = trigger;
  return value;
}
