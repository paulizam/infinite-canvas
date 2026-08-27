import { randomUUID } from "node:crypto";
import {
  cancelWorkflowExecution,
  createWorkflowExecution,
  resumeWorkflowExecution,
  retryWorkflowNode,
} from "@infinite-canvas/workflow-runtime";
import { DomainError, type PlatformRepository } from "./domain.js";
import type { WorkflowExecutionRepository } from "./workflow-execution-repository.js";
import type { WorkflowRepository } from "./workflow-repository.js";

export class WorkflowExecutionService {
  constructor(
    private readonly platform: PlatformRepository,
    private readonly workflows: WorkflowRepository,
    private readonly executions: WorkflowExecutionRepository,
  ) {}
  async create(
    userId: string,
    workflowId: string,
    input: {
      executionId?: string;
      version?: number;
      startNodeIds?: string[];
      initialInputs?: Record<string, unknown>;
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
    const versions = input.version
      ? await this.workflows.listVersions(userId, workflowId)
      : [];
    const version = input.version
      ? versions.find((item) => item.version === input.version)
      : publication.version;
    if (!version)
      throw new DomainError(
        "WORKFLOW_VERSION_NOT_FOUND",
        404,
        "Workflow 版本不存在",
      );
    let state;
    try {
      state = createWorkflowExecution({
        id: input.executionId || randomUUID(),
        definition: version.definition,
        workflowVersion: version.version,
        startNodeIds: input.startNodeIds,
        initialInputs: input.initialInputs,
        now: new Date().toISOString(),
      });
    } catch (error) {
      throw new DomainError(
        "INVALID_EXECUTION_SELECTION",
        422,
        error instanceof Error ? error.message : "执行范围无效",
      );
    }
    return this.executions.create({
      state,
      revision: 0,
      workspaceId: publication.workflow.workspaceId,
      createdBy: userId,
      definition: version.definition,
      workerId: null,
      leaseUntil: null,
      nextRunAt: state.createdAt,
    });
  }
  async get(userId: string, executionId: string) {
    const record = await this.executions.get(userId, executionId);
    if (!record)
      throw new DomainError("EXECUTION_NOT_FOUND", 404, "执行不存在");
    return record;
  }
  async cancel(userId: string, executionId: string) {
    const record = await this.editable(userId, executionId);
    if (record.state.status === "cancelled") return record;
    const publication = await this.workflows.getById(
      userId,
      record.state.workflowId,
    );
    if (!publication)
      throw new DomainError("WORKFLOW_NOT_FOUND", 404, "Workflow 不存在");
    const version = (
      await this.workflows.listVersions(userId, record.state.workflowId)
    ).find((item) => item.version === record.state.workflowVersion);
    if (!version)
      throw new DomainError(
        "WORKFLOW_VERSION_NOT_FOUND",
        404,
        "Workflow 版本不存在",
      );
    try {
      return await this.executions.save(
        userId,
        {
          ...record,
          state: cancelWorkflowExecution(
            record.state,
            version.definition,
            new Date().toISOString(),
          ),
        },
        record.revision,
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "EXECUTION_NOT_CANCELLABLE",
        409,
        error instanceof Error ? error.message : "执行不可取消",
      );
    }
  }
  async retryNode(userId: string, executionId: string, nodeId: string) {
    const record = await this.editable(userId, executionId);
    const versions = await this.workflows.listVersions(
      userId,
      record.state.workflowId,
    );
    const version = versions.find(
      (item) => item.version === record.state.workflowVersion,
    );
    if (!version)
      throw new DomainError(
        "WORKFLOW_VERSION_NOT_FOUND",
        404,
        "Workflow 版本不存在",
      );
    try {
      return await this.executions.save(
        userId,
        {
          ...record,
          state: retryWorkflowNode(
            record.state,
            version.definition,
            nodeId,
            new Date().toISOString(),
          ),
        },
        record.revision,
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "NODE_NOT_RETRYABLE",
        409,
        error instanceof Error ? error.message : "节点不可重试",
      );
    }
  }
  async signal(userId: string, executionId: string, eventKey: string) {
    const record = await this.editable(userId, executionId);
    try {
      const now = new Date().toISOString();
      const state = resumeWorkflowExecution(
        record.state,
        record.definition,
        now,
        eventKey,
      );
      if (state.events.length === record.state.events.length)
        throw new Error("No node is waiting for this event");
      return await this.executions.save(
        userId,
        { ...record, state },
        record.revision,
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "EVENT_NOT_WAITING",
        409,
        error instanceof Error ? error.message : "没有节点等待该事件",
      );
    }
  }
  private async editable(userId: string, executionId: string) {
    const record = await this.get(userId, executionId);
    await this.platform.requireWorkspaceRole(
      userId,
      record.workspaceId,
      "editor",
    );
    return record;
  }
}
