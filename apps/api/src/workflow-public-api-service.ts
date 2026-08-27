import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DomainError, type PlatformRepository } from "./domain.js";
import type { WorkflowExecutionService } from "./workflow-execution-service.js";
import type { WorkflowRepository } from "./workflow-repository.js";
import {
  publicWorkflowApiToken,
  type WorkflowApiScope,
  type WorkflowPublicApiRepository,
} from "./workflow-public-api-repository.js";

export class WorkflowPublicApiService {
  constructor(
    private readonly platform: PlatformRepository,
    private readonly workflows: WorkflowRepository,
    private readonly executions: WorkflowExecutionService,
    private readonly repository: WorkflowPublicApiRepository,
  ) {}
  async create(
    userId: string,
    workflowId: string,
    input: {
      name: string;
      scopes: WorkflowApiScope[];
      version?: number;
      rateLimitPerMinute: number;
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
    const selected = input.version
      ? (await this.workflows.listVersions(userId, workflowId)).find(
          (value) => value.version === input.version,
        )
      : publication.version;
    if (!selected)
      throw new DomainError(
        "WORKFLOW_VERSION_NOT_FOUND",
        404,
        "Workflow 版本不存在",
      );
    const secret = `icwf_${randomBytes(32).toString("base64url")}`;
    const now = new Date().toISOString();
    const record = await this.repository.create({
      id: randomUUID(),
      workflowId,
      workflowVersion: selected.version,
      workspaceId: publication.workflow.workspaceId,
      createdBy: userId,
      name: input.name,
      tokenPrefix: secret.slice(0, 12),
      tokenHash: hash(secret),
      scopes: [...new Set(input.scopes)],
      rateLimitPerMinute: input.rateLimitPerMinute,
      revokedAt: null,
      createdAt: now,
      lastUsedAt: null,
    });
    return { token: publicWorkflowApiToken(record), secret };
  }
  async list(userId: string, workflowId: string) {
    const publication = await this.workflows.getById(userId, workflowId);
    if (!publication)
      throw new DomainError("WORKFLOW_NOT_FOUND", 404, "Workflow 不存在");
    return (await this.repository.list(userId, workflowId)).map(
      publicWorkflowApiToken,
    );
  }
  async listAudit(userId: string, workflowId: string, limit = 50) {
    const publication = await this.workflows.getById(userId, workflowId);
    if (!publication)
      throw new DomainError("WORKFLOW_NOT_FOUND", 404, "Workflow 不存在");
    return this.repository.listAudit(userId, workflowId, limit);
  }
  async revoke(userId: string, tokenId: string) {
    return publicWorkflowApiToken(
      await this.repository.revoke(userId, tokenId, new Date().toISOString()),
    );
  }
  async rotate(userId: string, tokenId: string) {
    const secret = `icwf_${randomBytes(32).toString("base64url")}`;
    const record = await this.repository.rotate(userId, tokenId, {
      id: randomUUID(),
      tokenPrefix: secret.slice(0, 12),
      tokenHash: hash(secret),
      createdAt: new Date().toISOString(),
    });
    return { token: publicWorkflowApiToken(record), secret };
  }
  async invoke(
    secret: string,
    idempotencyKey: string,
    payload: unknown,
    requestId?: string,
  ) {
    const token = await this.authorize(secret, "invoke");
    const reserved = await this.repository.reserve({
      id: randomUUID(),
      tokenId: token.id,
      idempotencyKey,
      executionId: randomUUID(),
      createdAt: new Date().toISOString(),
      maxPerMinute: token.rateLimitPerMinute,
    });
    const execution = await this.executions.create(
      token.createdBy,
      token.workflowId,
      {
        executionId: reserved.invocation.executionId,
        version: token.workflowVersion,
        initialInputs:
          payload && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : { $api: payload },
      },
    );
    await this.repository.audit({
      id: randomUUID(),
      tokenId: token.id,
      action: "invoke",
      executionId: execution.record.state.id,
      requestId,
      createdAt: new Date().toISOString(),
    });
    return {
      executionId: execution.record.state.id,
      status: execution.record.state.status,
      replayed: reserved.replayed || execution.replayed,
    };
  }
  async getExecution(secret: string, executionId: string, requestId?: string) {
    const token = await this.authorize(secret, "read_execution");
    const execution = await this.executions.get(token.createdBy, executionId);
    if (execution.state.workflowId !== token.workflowId)
      throw new DomainError("EXECUTION_NOT_FOUND", 404, "执行不存在");
    await this.repository.audit({
      id: randomUUID(),
      tokenId: token.id,
      action: "read_execution",
      executionId,
      requestId,
      createdAt: new Date().toISOString(),
    });
    return execution;
  }
  private async authorize(secret: string, scope: WorkflowApiScope) {
    const token = await this.repository.getByHash(hash(secret));
    if (!token || !token.scopes.includes(scope))
      throw new DomainError(
        "WORKFLOW_API_UNAUTHORIZED",
        401,
        "Workflow API token 无效或 scope 不足",
      );
    return token;
  }
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
