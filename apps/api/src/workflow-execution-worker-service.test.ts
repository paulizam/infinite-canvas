import { describe, expect, it } from "vitest";
import { createWorkflowExecution } from "@infinite-canvas/workflow-runtime";
import type { WorkflowDefinition } from "@infinite-canvas/contracts";
import { MemoryWorkflowExecutionRepository } from "./workflow-execution-repository.js";
import { WorkflowExecutionWorkerService } from "./workflow-execution-worker-service.js";

const definition: WorkflowDefinition = {
  id: "flow",
  schemaVersion: 1,
  name: "Flow",
  nodes: [{ id: "node", type: "test", inputs: [], outputs: [], config: {} }],
  edges: [],
};

describe("WorkflowExecutionWorkerService", () => {
  it("claims and advances a lease-owned execution with revision CAS", async () => {
    const repository = new MemoryWorkflowExecutionRepository(
      async () => undefined,
    );
    const state = createWorkflowExecution({
      id: "run",
      definition,
      workflowVersion: 1,
      now: "2026-01-01T00:00:00.000Z",
    });
    await repository.create({
      state,
      revision: 0,
      workspaceId: "workspace",
      createdBy: "owner",
      definition,
      workerId: null,
      leaseUntil: null,
      nextRunAt: state.createdAt,
    });
    const service = new WorkflowExecutionWorkerService(repository);
    const [claimed] = await service.claim({
      workerId: "worker",
      now: "2026-01-01T00:00:00.000Z",
      leaseUntil: "2026-01-01T00:01:00.000Z",
      limit: 1,
    });
    expect(claimed?.state.nodes.node.status).toBe("ready");
    const running = await service.transition({
      workerId: "worker",
      executionId: "run",
      revision: 0,
      now: "2026-01-01T00:00:01.000Z",
      operation: { type: "node.start", nodeId: "node", input: { value: 1 } },
    });
    expect(running).toMatchObject({
      revision: 1,
      state: { status: "running" },
    });
    await expect(
      service.transition({
        workerId: "worker",
        executionId: "run",
        revision: 0,
        now: "2026-01-01T00:00:02.000Z",
        operation: { type: "node.complete", nodeId: "node" },
      }),
    ).rejects.toMatchObject({ code: "EXECUTION_REVISION_CONFLICT" });
    const complete = await service.transition({
      workerId: "worker",
      executionId: "run",
      revision: 1,
      now: "2026-01-01T00:00:02.000Z",
      operation: {
        type: "node.complete",
        nodeId: "node",
        output: { value: 2 },
      },
    });
    expect(complete).toMatchObject({
      revision: 2,
      state: { status: "succeeded", nodes: { node: { output: { value: 2 } } } },
    });
  });
});
