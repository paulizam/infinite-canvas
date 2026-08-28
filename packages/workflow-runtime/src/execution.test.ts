import type { WorkflowDefinition } from "@infinite-canvas/contracts";
import { describe, expect, it } from "vitest";
import {
  cancelWorkflowExecution,
  completeWorkflowStep,
  completeWorkflowNode,
  completeWorkflowCancellation,
  createWorkflowExecution,
  failWorkflowNode,
  failWorkflowStep,
  resumeWorkflowExecution,
  retryWorkflowNode,
  startWorkflowNode,
  startWorkflowStep,
  waitWorkflowStep,
  waitWorkflowNode,
} from "./execution.js";

const definition: WorkflowDefinition = {
  id: "flow",
  schemaVersion: 1,
  name: "Flow",
  nodes: ["a", "b", "c"].map((id) => ({
    id,
    type: `test.${id}`,
    inputs: id === "a" ? [] : [{ id: "in", valueType: "string" }],
    outputs: [{ id: "out", valueType: "string" }],
    config: {},
  })),
  edges: [
    {
      id: "a-b",
      fromNodeId: "a",
      fromPortId: "out",
      toNodeId: "b",
      toPortId: "in",
    },
    {
      id: "b-c",
      fromNodeId: "b",
      fromPortId: "out",
      toNodeId: "c",
      toPortId: "in",
    },
  ],
};
const at = (second: number) =>
  `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;

describe("durable workflow execution state", () => {
  it("propagates inactive conditional ports as deterministic skips and rejoins an active branch [WFL-005]", () => {
    const branch: WorkflowDefinition = {
      id: "branch",
      schemaVersion: 1,
      name: "Branch",
      nodes: [
        {
          id: "source",
          type: "source",
          inputs: [],
          outputs: [{ id: "value", valueType: "string" }],
          config: {},
        },
        {
          id: "condition",
          type: "logic.condition",
          inputs: [{ id: "input", valueType: "string" }],
          outputs: [
            { id: "true", valueType: "string" },
            { id: "false", valueType: "string" },
          ],
          config: {},
        },
        {
          id: "yes",
          type: "yes",
          inputs: [{ id: "input", valueType: "string" }],
          outputs: [{ id: "out", valueType: "string" }],
          config: {},
        },
        {
          id: "no",
          type: "no",
          inputs: [{ id: "input", valueType: "string" }],
          outputs: [{ id: "out", valueType: "string" }],
          config: {},
        },
        {
          id: "join",
          type: "join",
          inputs: [{ id: "items", valueType: "string", multiple: true }],
          outputs: [],
          config: {},
        },
      ],
      edges: [
        {
          id: "source-condition",
          fromNodeId: "source",
          fromPortId: "value",
          toNodeId: "condition",
          toPortId: "input",
        },
        {
          id: "condition-yes",
          fromNodeId: "condition",
          fromPortId: "true",
          toNodeId: "yes",
          toPortId: "input",
        },
        {
          id: "condition-no",
          fromNodeId: "condition",
          fromPortId: "false",
          toNodeId: "no",
          toPortId: "input",
        },
        {
          id: "yes-join",
          fromNodeId: "yes",
          fromPortId: "out",
          toNodeId: "join",
          toPortId: "items",
        },
        {
          id: "no-join",
          fromNodeId: "no",
          fromPortId: "out",
          toNodeId: "join",
          toPortId: "items",
        },
      ],
    };
    let state = createWorkflowExecution({
      id: "branch-run",
      definition: branch,
      workflowVersion: 1,
      now: at(0),
    });
    state = startWorkflowNode(state, branch, "source", {}, at(1));
    state = completeWorkflowNode(
      state,
      branch,
      "source",
      { value: "go" },
      at(2),
    );
    state = startWorkflowNode(
      state,
      branch,
      "condition",
      { input: "go" },
      at(3),
    );
    state = completeWorkflowNode(
      state,
      branch,
      "condition",
      { true: "go" },
      at(4),
    );
    expect(state.nodes).toMatchObject({
      yes: { status: "ready" },
      no: { status: "skipped", skipReason: "condition_false" },
      join: { status: "pending" },
    });
    state = startWorkflowNode(state, branch, "yes", { input: "go" }, at(5));
    state = completeWorkflowNode(state, branch, "yes", { out: "yes" }, at(6));
    expect(state.nodes.join.status).toBe("ready");
    state = startWorkflowNode(state, branch, "join", { items: ["yes"] }, at(7));
    state = completeWorkflowNode(state, branch, "join", {}, at(8));
    expect(state.status).toBe("succeeded");
    expect(state.events).toContainEqual(
      expect.objectContaining({
        type: "node.skipped",
        nodeId: "no",
        data: expect.objectContaining({ reason: "condition_false" }),
      }),
    );
  });

  it("runs deterministic layers and records snapshots and monotonic timeline [WFL-006]", () => {
    let state = createWorkflowExecution({
      id: "run",
      definition,
      workflowVersion: 2,
      now: at(0),
    });
    expect(state.nodes.a.status).toBe("ready");
    state = startWorkflowNode(state, definition, "a", { prompt: "hi" }, at(1));
    state = completeWorkflowNode(state, definition, "a", { out: "one" }, at(2));
    expect(state.nodes.b.status).toBe("ready");
    state = startWorkflowNode(state, definition, "b", { in: "one" }, at(3));
    state = completeWorkflowNode(state, definition, "b", { out: "two" }, at(4));
    state = startWorkflowNode(state, definition, "c", { in: "two" }, at(5));
    state = completeWorkflowNode(state, definition, "c", {}, at(6));
    expect(state.status).toBe("succeeded");
    expect(state.nodes.a.input).toEqual({ prompt: "hi" });
    expect(state.events.map((event) => event.sequence)).toEqual(
      state.events.map((_, index) => index + 1),
    );
  });

  it("supports selected-node execution and explicit single-node retry [WFL-004]", () => {
    let state = createWorkflowExecution({
      id: "run",
      definition,
      workflowVersion: 1,
      startNodeIds: ["b"],
      maxAttempts: 1,
      now: at(0),
    });
    expect(state.nodes.a).toMatchObject({
      status: "skipped",
      skipReason: "before_selection",
    });
    state = startWorkflowNode(state, definition, "b", {}, at(1));
    state = failWorkflowNode(
      state,
      definition,
      "b",
      { code: "UPSTREAM", message: "failed" },
      at(2),
    );
    expect(state.status).toBe("failed");
    state = retryWorkflowNode(state, definition, "b", at(3));
    expect(state).toMatchObject({
      status: "queued",
      nodes: { b: { status: "ready", attempt: 1 } },
    });
  });

  it("persists sleep/event waits and resumes after restart [WFL-007]", () => {
    let state = createWorkflowExecution({
      id: "run",
      definition,
      workflowVersion: 1,
      startNodeIds: ["c"],
      now: at(0),
    });
    state = startWorkflowNode(state, definition, "c", {}, at(1));
    state = waitWorkflowNode(state, definition, "c", at(2), { wakeAt: at(5) });
    const restored = JSON.parse(JSON.stringify(state));
    expect(
      resumeWorkflowExecution(restored, definition, at(4)).nodes.c.status,
    ).toBe("waiting");
    state = resumeWorkflowExecution(restored, definition, at(5));
    expect(state.nodes.c.status).toBe("ready");
    state = startWorkflowNode(state, definition, "c", {}, at(6));
    state = waitWorkflowNode(state, definition, "c", at(7), {
      eventKey: "approved",
    });
    expect(
      resumeWorkflowExecution(state, definition, at(8), "approved").nodes.c
        .status,
    ).toBe("ready");
  });

  it("cancels queued work immediately and active work cooperatively", () => {
    const queued = createWorkflowExecution({
      id: "queued",
      definition,
      workflowVersion: 1,
      now: at(0),
    });
    expect(cancelWorkflowExecution(queued, definition, at(1)).status).toBe(
      "cancelled",
    );
    const running = startWorkflowNode(
      createWorkflowExecution({
        id: "running",
        definition,
        workflowVersion: 1,
        now: at(0),
      }),
      definition,
      "a",
      {},
      at(1),
    );
    expect(cancelWorkflowExecution(running, definition, at(2))).toMatchObject({
      status: "cancel_requested",
      nodes: { b: { status: "cancelled" } },
    });
    const requested = cancelWorkflowExecution(running, definition, at(2));
    expect(
      completeWorkflowCancellation(requested, definition, at(3)).status,
    ).toBe("cancelled");
  });

  it("replays completed durable steps and resumes sleeping sub-steps without incrementing the node attempt", () => {
    let state = createWorkflowExecution({
      id: "steps",
      definition,
      workflowVersion: 1,
      startNodeIds: ["c"],
      now: at(0),
    });
    state = startWorkflowNode(state, definition, "c", {}, at(1));
    state = startWorkflowStep(state, "c", "fetch", { url: "safe" }, at(2));
    state = completeWorkflowStep(state, "c", "fetch", { value: 1 }, at(3));
    const replayed = startWorkflowStep(
      state,
      "c",
      "fetch",
      { url: "changed" },
      at(4),
    );
    expect(replayed.nodes.c.steps.fetch).toMatchObject({
      status: "succeeded",
      output: { value: 1 },
      attempt: 1,
    });
    state = startWorkflowStep(replayed, "c", "approval", {}, at(5));
    state = waitWorkflowStep(state, definition, "c", "approval", at(6), {
      eventKey: "approved",
    });
    state = resumeWorkflowExecution(
      JSON.parse(JSON.stringify(state)),
      definition,
      at(7),
      "approved",
    );
    expect(state.nodes.c).toMatchObject({
      status: "ready",
      attempt: 1,
      steps: { approval: { status: "running" } },
    });
    state = startWorkflowNode(state, definition, "c", undefined, at(8));
    expect(state.nodes.c.attempt).toBe(1);
  });

  it("retries failed sub-steps durably and propagates terminal step errors", () => {
    let state = startWorkflowNode(
      createWorkflowExecution({
        id: "steps",
        definition,
        workflowVersion: 1,
        startNodeIds: ["c"],
        now: at(0),
      }),
      definition,
      "c",
      {},
      at(1),
    );
    state = startWorkflowStep(state, "c", "provider", {}, at(2), 2);
    state = failWorkflowStep(
      state,
      definition,
      "c",
      "provider",
      { code: "TEMP", message: "retry" },
      at(3),
      at(5),
    );
    state = resumeWorkflowExecution(state, definition, at(5));
    state = startWorkflowNode(state, definition, "c", undefined, at(6));
    state = startWorkflowStep(state, "c", "provider", {}, at(7));
    state = failWorkflowStep(
      state,
      definition,
      "c",
      "provider",
      { code: "FINAL", message: "failed" },
      at(8),
    );
    expect(state).toMatchObject({
      status: "failed",
      nodes: {
        c: {
          status: "failed",
          error: { code: "FINAL" },
          steps: { provider: { attempt: 2, status: "failed" } },
        },
      },
    });
  });
});
