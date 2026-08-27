import type { WorkflowDefinition } from "@infinite-canvas/contracts";
import {
  cancelWorkflowExecution,
  completeWorkflowCancellation,
  completeWorkflowNode,
  completeWorkflowStep,
  createWorkflowExecution,
  failWorkflowNode,
  resumeWorkflowExecution,
  startWorkflowNode,
  startWorkflowStep,
  waitWorkflowStep,
} from "@infinite-canvas/workflow-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  buildWorkflowNodeInputs,
  executeWorkflow,
} from "./workflow-executor.js";
import type {
  WorkflowWorkerOperation,
  WorkflowWorkerRecord,
} from "./workflow-types.js";

const definition: WorkflowDefinition = {
  id: "flow",
  schemaVersion: 1,
  name: "Flow",
  nodes: [
    {
      id: "a",
      type: "test.source",
      inputs: [],
      outputs: [{ id: "out", valueType: "string" }],
      config: {},
    },
    {
      id: "b",
      type: "test.sink",
      inputs: [{ id: "items", valueType: "string", multiple: true }],
      outputs: [{ id: "out", valueType: "string" }],
      config: {},
    },
  ],
  edges: [
    {
      id: "a-b",
      fromNodeId: "a",
      fromPortId: "out",
      toNodeId: "b",
      toPortId: "items",
    },
  ],
};

function recordFor(flow = definition): WorkflowWorkerRecord {
  return {
    state: createWorkflowExecution({
      id: "run/id",
      definition: flow,
      workflowVersion: 1,
      initialInputs: { b: { fixed: true, items: ["seed"] } },
      now: "2026-01-01T00:00:00.000Z",
    }),
    definition: flow,
    revision: 0,
    workspaceId: "workspace",
    createdBy: "user",
    workerId: "worker",
    leaseUntil: "2026-01-01T00:01:00.000Z",
    nextRunAt: "2026-01-01T00:00:00.000Z",
  };
}

function transitioningClient(
  source: WorkflowWorkerRecord,
  extra: Record<string, unknown> = {},
) {
  let current = source;
  const operations: WorkflowWorkerOperation[] = [];
  const transitionWorkflow = vi.fn(
    async (
      _worker: string,
      _id: string,
      revision: number,
      operation: WorkflowWorkerOperation,
    ) => {
      expect(revision).toBe(current.revision);
      operations.push(operation);
      const at = new Date(
        Date.parse("2026-01-01T00:00:01.000Z") + operations.length,
      ).toISOString();
      if (operation.type === "node.start")
        current.state = startWorkflowNode(
          current.state,
          current.definition,
          operation.nodeId,
          operation.input,
          at,
        );
      if (operation.type === "node.complete")
        current.state = completeWorkflowNode(
          current.state,
          current.definition,
          operation.nodeId,
          operation.output,
          at,
        );
      if (operation.type === "node.fail")
        current.state = failWorkflowNode(
          current.state,
          current.definition,
          operation.nodeId,
          operation.error,
          at,
          operation.retryAt,
        );
      if (operation.type === "step.start")
        current.state = startWorkflowStep(
          current.state,
          operation.nodeId,
          operation.key,
          operation.input,
          at,
          operation.maxAttempts,
        );
      if (operation.type === "step.complete")
        current.state = completeWorkflowStep(
          current.state,
          operation.nodeId,
          operation.key,
          operation.output,
          at,
        );
      if (operation.type === "step.wait")
        current.state = waitWorkflowStep(
          current.state,
          current.definition,
          operation.nodeId,
          operation.key,
          at,
          { wakeAt: operation.wakeAt, eventKey: operation.eventKey },
        );
      if (operation.type === "execution.cancel.complete")
        current.state = completeWorkflowCancellation(
          current.state,
          current.definition,
          at,
        );
      current = { ...current, revision: current.revision + 1 };
      return current;
    },
  );
  return {
    client: { transitionWorkflow, ...extra },
    operations,
    current: () => current,
  };
}

describe("workflow executor", () => {
  it("maps output ports and merges initial multiple inputs", () => {
    const record = recordFor();
    record.state.nodes.a.output = { out: "generated" };
    expect(buildWorkflowNodeInputs(record, "b")).toEqual({
      fixed: true,
      items: ["seed", "generated"],
    });
  });

  it("starts a layer before running adapters and commits in stable order", async () => {
    const parallel: WorkflowDefinition = {
      ...definition,
      nodes: definition.nodes.map((node) => ({ ...node, inputs: [] })),
      edges: [],
    };
    const record = recordFor(parallel);
    const api = transitioningClient(record);
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const adapter = vi.fn(async () => {
      entered += 1;
      if (entered === 2) release();
      await gate;
      return { out: "done" };
    });
    await executeWorkflow(record, api.client as never, "worker", {
      "test.source": adapter,
      "test.sink": adapter,
    });
    expect(entered).toBe(2);
    expect(api.operations.map((operation) => operation.type)).toEqual([
      "node.start",
      "node.start",
      "node.complete",
      "node.complete",
    ]);
    expect(api.current().state.status).toBe("succeeded");
  });

  it("replays running work without a duplicate start and normalizes failures", async () => {
    const record = recordFor();
    record.state = startWorkflowNode(
      record.state,
      definition,
      "a",
      { durable: true },
      "2026-01-01T00:00:01.000Z",
    );
    const api = transitioningClient(record);
    await executeWorkflow(record, api.client as never, "worker", {});
    expect(api.operations[0]).toMatchObject({
      type: "node.fail",
      nodeId: "a",
      error: { code: "WORKFLOW_NODE_UNSUPPORTED" },
      retryAt: expect.any(String),
    });
    expect(
      api.operations.filter((operation) => operation.type === "node.start"),
    ).toHaveLength(0);
  });

  it("acknowledges cooperative cancellation without invoking adapters", async () => {
    const record = recordFor();
    record.state = startWorkflowNode(
      record.state,
      definition,
      "a",
      {},
      "2026-01-01T00:00:01.000Z",
    );
    record.state = cancelWorkflowExecution(
      record.state,
      definition,
      "2026-01-01T00:00:02.000Z",
    );
    const api = transitioningClient(record);
    await executeWorkflow(record, api.client as never, "worker", {});
    expect(api.operations).toEqual([{ type: "execution.cancel.complete" }]);
    expect(api.current().state.status).toBe("cancelled");
  });

  it("waits on one idempotent child generation and completes it after restart", async () => {
    const ai: WorkflowDefinition = {
      id: "ai-flow",
      schemaVersion: 1,
      name: "AI",
      nodes: [
        {
          id: "generate",
          type: "ai.generate.image",
          inputs: [{ id: "prompt", valueType: "string" }],
          outputs: [{ id: "asset", valueType: "asset.image" }],
          config: {
            model: "image.default",
            size: "1:1",
          },
        },
      ],
      edges: [],
    };
    const firstRecord = recordFor(ai);
    firstRecord.state.initialInputs = { generate: { prompt: "moon" } };
    const create = vi.fn(async (..._args: unknown[]) => ({
      replayed: false,
      job: {
        id: "job-1",
        phase: "queued",
        billing: {
          state: "reserved",
          estimatedUnits: 3,
          reservedUnits: 3,
          actualUnits: null,
        },
      },
    }));
    const first = transitioningClient(firstRecord, {
      createWorkflowGeneration: create,
    });
    await executeWorkflow(firstRecord, first.client as never, "worker");
    expect(first.operations.map((operation) => operation.type)).toEqual([
      "node.start",
      "step.start",
      "step.wait",
    ]);
    expect(
      first.current().state.nodes.generate.steps.generation.input,
    ).toMatchObject({
      jobId: "job-1",
      attempt: 1,
    });

    const resumedRecord = first.current();
    resumedRecord.state = resumeWorkflowExecution(
      resumedRecord.state,
      ai,
      "9999-01-01T00:00:00.000Z",
    );
    const resumedCreate = vi.fn(async (..._args: unknown[]) => ({
      replayed: true,
      job: {
        id: "job-1",
        phase: "succeeded",
        result: { assetId: "asset-1" },
        billing: {
          state: "settled",
          estimatedUnits: 3,
          reservedUnits: 3,
          actualUnits: 2,
        },
      },
    }));
    const resumed = transitioningClient(resumedRecord, {
      createWorkflowGeneration: resumedCreate,
    });
    await executeWorkflow(resumedRecord, resumed.client as never, "worker");
    expect(resumed.operations.map((operation) => operation.type)).toEqual([
      "node.start",
      "step.complete",
      "node.complete",
    ]);
    expect(resumed.current().state).toMatchObject({
      status: "succeeded",
      nodes: {
        generate: {
          attempt: 1,
          output: { assetId: "asset-1" },
          steps: { generation: { status: "succeeded" } },
        },
      },
    });
    expect(create.mock.calls[0]?.[2]).toMatchObject({
      nodeId: "generate",
      capability: "image",
      logicalModelId: "image.default",
      parameters: { size: "1:1", prompt: "moon" },
    });
    expect(resumedCreate).toHaveBeenCalledTimes(1);
  });

  it("cancels a persisted child job before acknowledging execution cancellation", async () => {
    const ai: WorkflowDefinition = {
      id: "cancel-ai",
      schemaVersion: 1,
      name: "Cancel AI",
      nodes: [
        {
          id: "generate",
          type: "ai.generate.video",
          inputs: [],
          outputs: [{ id: "output", valueType: "video" }],
          config: { model: "video.default" },
        },
      ],
      edges: [],
    };
    const record = recordFor(ai);
    record.state = startWorkflowNode(
      record.state,
      ai,
      "generate",
      {},
      "2026-01-01T00:00:01.000Z",
    );
    record.state = startWorkflowStep(
      record.state,
      "generate",
      "generation",
      { jobId: "job-video", capability: "video", attempt: 1 },
      "2026-01-01T00:00:02.000Z",
    );
    record.state = cancelWorkflowExecution(
      record.state,
      ai,
      "2026-01-01T00:00:03.000Z",
    );
    const cancel = vi.fn(async (..._args: unknown[]) => ({
      phase: "cancelled",
    }));
    const api = transitioningClient(record, {
      cancelWorkflowGeneration: cancel,
    });
    await executeWorkflow(record, api.client as never, "worker");
    expect(cancel).toHaveBeenCalledWith(
      "worker",
      "run/id",
      { nodeId: "generate", attempt: 1, capability: "video" },
      undefined,
    );
    expect(api.operations).toEqual([{ type: "execution.cancel.complete" }]);
  });
});
