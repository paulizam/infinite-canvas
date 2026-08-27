import {
  completeWorkflowCancellation,
  completeWorkflowNode,
  completeWorkflowStep,
  failWorkflowNode,
  failWorkflowStep,
  resumeWorkflowExecution,
  skipWorkflowNode,
  startWorkflowNode,
  startWorkflowStep,
  waitWorkflowNode,
  waitWorkflowStep,
} from "@infinite-canvas/workflow-runtime";
import { DomainError } from "./domain.js";
import type {
  WorkflowExecutionLeaseRepository,
  WorkflowExecutionRecord,
} from "./workflow-execution-repository.js";

export type WorkflowWorkerOperation =
  | { type: "node.start"; nodeId: string; input?: unknown }
  | { type: "node.complete"; nodeId: string; output?: unknown }
  | {
      type: "node.fail";
      nodeId: string;
      error: { code: string; message: string };
      retryAt?: string;
    }
  | { type: "node.wait"; nodeId: string; wakeAt?: string; eventKey?: string }
  | {
      type: "node.skip";
      nodeId: string;
      reason: "condition_false" | "upstream_skipped";
    }
  | {
      type: "step.start";
      nodeId: string;
      key: string;
      input?: unknown;
      maxAttempts?: number;
    }
  | { type: "step.complete"; nodeId: string; key: string; output?: unknown }
  | {
      type: "step.fail";
      nodeId: string;
      key: string;
      error: { code: string; message: string };
      retryAt?: string;
    }
  | {
      type: "step.wait";
      nodeId: string;
      key: string;
      wakeAt?: string;
      eventKey?: string;
    }
  | { type: "execution.cancel.complete" };

export class WorkflowExecutionWorkerService {
  constructor(private readonly executions: WorkflowExecutionLeaseRepository) {}
  async claim(input: {
    workerId: string;
    now: string;
    leaseUntil: string;
    limit: number;
  }) {
    const records = await this.executions.claim(input);
    return Promise.all(
      records.map(async (record) => {
        const resumed = resumeWorkflowExecution(
          record.state,
          record.definition,
          input.now,
        );
        if (resumed.events.length === record.state.events.length) return record;
        return this.executions.saveByWorker(
          input.workerId,
          { ...record, state: resumed },
          record.revision,
          input.now,
          nextRunAt(resumed, input.now),
        );
      }),
    );
  }
  heartbeat(
    workerId: string,
    executionIds: string[],
    now: string,
    leaseUntil: string,
  ) {
    return this.executions.heartbeat(workerId, executionIds, now, leaseUntil);
  }
  async transition(input: {
    workerId: string;
    executionId: string;
    revision: number;
    now: string;
    operation: WorkflowWorkerOperation;
  }) {
    const record = await this.executions.getForWorker(
      input.workerId,
      input.executionId,
      input.now,
    );
    if (!record)
      throw new DomainError("EXECUTION_LEASE_LOST", 409, "执行租约已失效");
    if (record.revision !== input.revision)
      throw new DomainError("EXECUTION_REVISION_CONFLICT", 409, "执行版本冲突");
    try {
      const state = applyOperation(record, input.operation, input.now);
      return await this.executions.saveByWorker(
        input.workerId,
        { ...record, state },
        input.revision,
        input.now,
        nextRunAt(state, input.now),
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "INVALID_EXECUTION_TRANSITION",
        409,
        error instanceof Error ? error.message : "执行状态转换无效",
      );
    }
  }
}

function applyOperation(
  record: WorkflowExecutionRecord,
  operation: WorkflowWorkerOperation,
  now: string,
) {
  const { state, definition } = record;
  switch (operation.type) {
    case "node.start":
      return startWorkflowNode(
        state,
        definition,
        operation.nodeId,
        operation.input ?? state.initialInputs[operation.nodeId],
        now,
      );
    case "node.complete":
      return completeWorkflowNode(
        state,
        definition,
        operation.nodeId,
        operation.output,
        now,
      );
    case "node.fail":
      return failWorkflowNode(
        state,
        definition,
        operation.nodeId,
        operation.error,
        now,
        operation.retryAt,
      );
    case "node.wait":
      return waitWorkflowNode(state, definition, operation.nodeId, now, {
        wakeAt: operation.wakeAt,
        eventKey: operation.eventKey,
      });
    case "node.skip":
      return skipWorkflowNode(
        state,
        definition,
        operation.nodeId,
        operation.reason,
        now,
      );
    case "step.start":
      return startWorkflowStep(
        state,
        operation.nodeId,
        operation.key,
        operation.input,
        now,
        operation.maxAttempts,
      );
    case "step.complete":
      return completeWorkflowStep(
        state,
        operation.nodeId,
        operation.key,
        operation.output,
        now,
      );
    case "step.fail":
      return failWorkflowStep(
        state,
        definition,
        operation.nodeId,
        operation.key,
        operation.error,
        now,
        operation.retryAt,
      );
    case "step.wait":
      return waitWorkflowStep(
        state,
        definition,
        operation.nodeId,
        operation.key,
        now,
        { wakeAt: operation.wakeAt, eventKey: operation.eventKey },
      );
    case "execution.cancel.complete":
      return completeWorkflowCancellation(state, definition, now);
  }
}
function nextRunAt(state: WorkflowExecutionRecord["state"], now: string) {
  if (["succeeded", "failed", "cancelled"].includes(state.status)) return now;
  const wakes = Object.values(state.nodes)
    .map((node) => node.wakeAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  return (
    wakes[0] || (state.status === "waiting" ? "9999-12-31T23:59:59.999Z" : now)
  );
}
