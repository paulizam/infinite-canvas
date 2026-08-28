import type {
  WorkflowDefinition,
  WorkflowNodeDefinition,
} from "@infinite-canvas/contracts";
import { describe, expect, it } from "vitest";
import {
  isWorkflowValueTypeCompatible,
  planWorkflowExecution,
  topologicalLayers,
  validateWorkflow,
  WorkflowValidationError,
} from "./index.js";

const node = (
  id: string,
  inputs: WorkflowNodeDefinition["inputs"] = [],
  outputs: WorkflowNodeDefinition["outputs"] = [],
): WorkflowNodeDefinition => ({
  id,
  type: `test.${id}`,
  inputs,
  outputs,
  config: {},
});
const workflow = (
  nodes: WorkflowNodeDefinition[],
  edges: WorkflowDefinition["edges"] = [],
  entryNodeIds?: string[],
): WorkflowDefinition => ({
  id: "workflow-1",
  schemaVersion: 1,
  name: "Test",
  nodes,
  edges,
  entryNodeIds,
});
const edge = (
  id: string,
  fromNodeId: string,
  fromPortId: string,
  toNodeId: string,
  toPortId: string,
) => ({ id, fromNodeId, fromPortId, toNodeId, toPortId });

describe("workflow value types", () => {
  it("supports unions, arrays, any targets and media asset covariance [WFL-001]", () => {
    expect(isWorkflowValueTypeCompatible("image", "asset")).toBe(true);
    expect(isWorkflowValueTypeCompatible("image[]", "asset[]")).toBe(true);
    expect(
      isWorkflowValueTypeCompatible("string|number", "number|string|boolean"),
    ).toBe(true);
    expect(isWorkflowValueTypeCompatible("any", "string")).toBe(false);
    expect(isWorkflowValueTypeCompatible("video", "image")).toBe(false);
  });
});

describe("workflow validation", () => {
  it("builds deterministic parallel topological layers", () => {
    const definition = workflow(
      [
        node("a", [], [{ id: "out", valueType: "string" }]),
        node("b", [], [{ id: "out", valueType: "string" }]),
        node("c", [
          { id: "left", valueType: "string", required: true },
          { id: "right", valueType: "string", required: true },
        ]),
      ],
      [
        edge("a-c", "a", "out", "c", "left"),
        edge("b-c", "b", "out", "c", "right"),
      ],
    );
    expect(validateWorkflow(definition)).toMatchObject({
      valid: true,
      layers: [["a", "b"], ["c"]],
    });
    expect(topologicalLayers(definition)).toEqual([["a", "b"], ["c"]]);
  });

  it("reports cycles, missing ports, incompatible types and input cardinality [WFL-002]", () => {
    const definition = workflow(
      [
        node(
          "a",
          [{ id: "back", valueType: "string" }],
          [{ id: "out", valueType: "image" }],
        ),
        node(
          "b",
          [{ id: "in", valueType: "string" }],
          [{ id: "out", valueType: "string" }],
        ),
      ],
      [
        edge("a-b", "a", "out", "b", "in"),
        edge("a-b-2", "a", "out", "b", "in"),
        edge("b-a", "b", "out", "a", "back"),
        edge("bad-port", "a", "missing", "b", "in"),
      ],
    );
    const result = validateWorkflow(definition);
    expect(result.valid).toBe(false);
    expect(new Set(result.issues.map((item) => item.code))).toEqual(
      new Set([
        "TYPE_MISMATCH",
        "MULTIPLE_INPUT",
        "CYCLE",
        "UNKNOWN_EDGE_PORT",
      ]),
    );
    expect(() => topologicalLayers(definition)).toThrow(
      WorkflowValidationError,
    );
  });

  it("accepts configured required inputs and rejects missing ones", () => {
    const configured = node("configured", [
      { id: "prompt", valueType: "string", required: true },
    ]);
    configured.config = { prompt: "hello" };
    const missing = node("missing", [
      { id: "prompt", valueType: "string", required: true },
    ]);
    const result = validateWorkflow(workflow([configured, missing]));
    expect(
      result.issues.filter((item) => item.code === "MISSING_REQUIRED_INPUT"),
    ).toMatchObject([{ nodeId: "missing", portId: "prompt" }]);
  });

  it("validates node catalog, capabilities, credentials and explicit reachability", () => {
    const start = node("start", [], [{ id: "out", valueType: "string" }]);
    start.requiredCapabilities = ["ai:text"];
    start.credentialRefs = ["provider:key"];
    const result = validateWorkflow(
      workflow([start, node("orphan")], [], ["start"]),
      {
        knownNodeTypes: new Set(["test.start"]),
        availableCapabilities: new Set(),
        availableCredentials: new Set(),
      },
    );
    expect(new Set(result.issues.map((item) => item.code))).toEqual(
      new Set([
        "UNKNOWN_NODE_TYPE",
        "MISSING_CAPABILITY",
        "MISSING_CREDENTIAL",
        "UNREACHABLE_NODE",
      ]),
    );
  });

  it("rejects duplicate identifiers and dangling endpoints", () => {
    const duplicate = node("same");
    duplicate.inputs = [
      { id: "x", valueType: "string" },
      { id: "x", valueType: "string" },
    ];
    const result = validateWorkflow(
      workflow(
        [duplicate, node("same")],
        [
          edge("dangling", "same", "x", "ghost", "in"),
          edge("dangling", "same", "x", "ghost", "in"),
        ],
      ),
    );
    expect(new Set(result.issues.map((item) => item.code))).toEqual(
      new Set([
        "DUPLICATE_NODE_ID",
        "DUPLICATE_PORT_ID",
        "DUPLICATE_EDGE_ID",
        "UNKNOWN_EDGE_NODE",
      ]),
    );
  });
});

describe("workflow execution planning", () => {
  it("selects a node and all descendants while recording deterministic skips", () => {
    const definition = workflow(
      [
        node("a", [], [{ id: "out", valueType: "string" }]),
        node(
          "b",
          [{ id: "in", valueType: "string" }],
          [{ id: "out", valueType: "string" }],
        ),
        node("c", [{ id: "in", valueType: "string" }]),
      ],
      [edge("a-b", "a", "out", "b", "in"), edge("b-c", "b", "out", "c", "in")],
    );
    expect(planWorkflowExecution(definition, ["b"])).toEqual({
      definitionId: "workflow-1",
      selectedNodeIds: ["b", "c"],
      layers: [["b"], ["c"]],
      skipped: [{ nodeId: "a", reason: "before_selection" }],
    });
    expect(() => planWorkflowExecution(definition, ["missing"])).toThrow(
      "Unknown start node",
    );
  });
});
