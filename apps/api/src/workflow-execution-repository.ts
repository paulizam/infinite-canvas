import type { WorkflowExecutionState } from "@infinite-canvas/workflow-runtime";
import type { WorkflowDefinition } from "@infinite-canvas/contracts";
import { DomainError } from "./domain.js";

export type WorkflowExecutionRecord = {
  state: WorkflowExecutionState;
  revision: number;
  workspaceId: string;
  createdBy: string;
  definition: WorkflowDefinition;
  workerId: string | null;
  leaseUntil: string | null;
  nextRunAt: string;
};
export interface WorkflowExecutionRepository {
  create(
    record: WorkflowExecutionRecord,
  ): Promise<{ record: WorkflowExecutionRecord; replayed: boolean }>;
  get(
    userId: string,
    executionId: string,
  ): Promise<WorkflowExecutionRecord | null>;
  save(
    userId: string,
    record: WorkflowExecutionRecord,
    expectedRevision: number,
  ): Promise<WorkflowExecutionRecord>;
}

export class MemoryWorkflowExecutionRepository implements WorkflowExecutionRepository {
  private readonly records = new Map<string, WorkflowExecutionRecord>();
  constructor(
    private readonly authorize: (
      userId: string,
      workspaceId: string,
      minimum: "viewer" | "editor",
    ) => Promise<void>,
  ) {}
  async create(record: WorkflowExecutionRecord) {
    await this.authorize(record.createdBy, record.workspaceId, "editor");
    const existing = this.records.get(record.state.id);
    if (existing) {
      if (!sameExecutionCreation(existing, record))
        throw new DomainError(
          "EXECUTION_ID_CONFLICT",
          409,
          "executionId 已用于其他执行请求",
        );
      return { record: structuredClone(existing), replayed: true };
    }
    this.records.set(record.state.id, structuredClone(record));
    return { record: structuredClone(record), replayed: false };
  }
  async get(userId: string, executionId: string) {
    const record = this.records.get(executionId);
    if (!record) return null;
    try {
      await this.authorize(userId, record.workspaceId, "viewer");
    } catch {
      return null;
    }
    return structuredClone(record);
  }
  async save(
    userId: string,
    record: WorkflowExecutionRecord,
    expectedRevision: number,
  ) {
    const current = this.records.get(record.state.id);
    if (!current)
      throw new DomainError("EXECUTION_NOT_FOUND", 404, "执行不存在");
    await this.authorize(userId, current.workspaceId, "editor");
    if (!sameExecutionCreation(current, record))
      throw new DomainError(
        "EXECUTION_IDENTITY_CONFLICT",
        409,
        "执行身份或初始快照不可修改",
      );
    if (current.revision !== expectedRevision)
      throw new DomainError("EXECUTION_REVISION_CONFLICT", 409, "执行版本冲突");
    const saved = {
      ...structuredClone(record),
      revision: expectedRevision + 1,
    };
    this.records.set(record.state.id, saved);
    return structuredClone(saved);
  }
}

export function sameExecutionCreation(
  left: WorkflowExecutionRecord,
  right: WorkflowExecutionRecord,
) {
  return (
    left.createdBy === right.createdBy &&
    left.workspaceId === right.workspaceId &&
    left.state.workflowId === right.state.workflowId &&
    left.state.workflowVersion === right.state.workflowVersion &&
    canonical(left.definition) === canonical(right.definition) &&
    canonical(left.state.selectedNodeIds) ===
      canonical(right.state.selectedNodeIds) &&
    canonical(left.state.initialInputs) === canonical(right.state.initialInputs)
  );
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
