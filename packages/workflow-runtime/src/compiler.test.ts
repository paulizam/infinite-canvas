import type {
  CanvasDocument,
  CanvasNode,
  WorkflowNodeSchema,
} from "@infinite-canvas/contracts";
import { describe, expect, it } from "vitest";
import { compileCanvasWorkflow, type WorkflowCompileRule } from "./compiler.js";

const schema = (
  type: string,
  inputs: WorkflowNodeSchema["inputs"],
  outputs: WorkflowNodeSchema["outputs"],
  extra: Partial<WorkflowNodeSchema> = {},
): WorkflowNodeSchema => ({
  type,
  schemaVersion: 1,
  inputs,
  outputs,
  ...extra,
});
const sourceRule: WorkflowCompileRule = {
  canvasNodeType: "text",
  schema: schema("core.constant", [], [{ id: "value", valueType: "string" }]),
  defaultOutputPortId: "value",
  configBindings: { value: "content" },
};
const transformRule: WorkflowCompileRule = {
  canvasNodeType: "config",
  schema: schema(
    "ai.rewrite",
    [{ id: "prompt", valueType: "string", required: true }],
    [{ id: "text", valueType: "string" }],
    { requiredCapabilities: ["ai:text"], credentialSlots: ["model"] },
  ),
  defaultInputPortId: "prompt",
  defaultOutputPortId: "text",
  configBindings: { model: "model", prompt: "prompt" },
  credentialBindings: { model: "credentialId" },
};
const node = (
  id: string,
  type: string,
  metadata: Record<string, unknown> = {},
): CanvasNode => ({
  id,
  type,
  title: id,
  position: { x: 0, y: 0 },
  width: 100,
  height: 100,
  metadata,
});
const canvas = (
  nodes: CanvasNode[],
  connections: CanvasDocument["connections"] = [],
): CanvasDocument => ({
  id: "canvas-1",
  schemaVersion: 4,
  revision: 1,
  title: "Published flow",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  nodes,
  connections,
  chatSessions: [],
  activeChatId: null,
  backgroundMode: "dots",
  showImageInfo: true,
  viewport: { x: 0, y: 0, k: 1 },
});

describe("Canvas workflow compiler", () => {
  it("compiles declared nodes, sanitized config, typed edges and source mappings", () => {
    const result = compileCanvasWorkflow(
      canvas(
        [
          node("prompt", "text", { content: "hello", ignored: "secret" }),
          node("rewrite", "config", {
            model: "gpt",
            credentialId: "credential-1",
          }),
        ],
        [{ id: "connection-1", fromNodeId: "prompt", toNodeId: "rewrite" }],
      ),
      [sourceRule, transformRule],
      {
        workflowId: "workflow-1",
        canvasEntryNodeIds: ["prompt"],
        validation: {
          availableCapabilities: new Set(["ai:text"]),
          availableCredentials: new Set(["credential-1"]),
        },
      },
    );
    expect(result.publishable).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.definition).toMatchObject({
      id: "workflow-1",
      name: "Published flow",
      entryNodeIds: ["prompt"],
      nodes: [
        { id: "prompt", config: { value: "hello" } },
        {
          id: "rewrite",
          config: { model: "gpt" },
          credentialRefs: ["credential-1"],
        },
      ],
      edges: [{ id: "connection-1", fromPortId: "value", toPortId: "prompt" }],
    });
    expect(result.sourceMapping).toEqual({
      nodes: { prompt: "prompt", rewrite: "rewrite" },
      edges: { "connection-1": "connection-1" },
    });
    expect(
      (result.definition.nodes[0]!.config as Record<string, unknown>).ignored,
    ).toBeUndefined();
  });

  it("skips annotations with warnings but blocks dangling required inputs", () => {
    const result = compileCanvasWorkflow(
      canvas([
        node("note", "sticky"),
        node("rewrite", "config", { credentialId: "credential-1" }),
      ]),
      [transformRule],
      { workflowId: "workflow-1" },
    );
    expect(result.publishable).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NON_EXECUTABLE_NODE",
          severity: "warning",
          canvasNodeId: "note",
        }),
        expect.objectContaining({
          code: "MISSING_REQUIRED_INPUT",
          canvasNodeId: "rewrite",
          portId: "prompt",
        }),
      ]),
    );
  });

  it("rejects ambiguous generic handles instead of guessing a typed port", () => {
    const multiOutput: WorkflowCompileRule = {
      canvasNodeType: "multi",
      schema: schema(
        "core.multi",
        [],
        [
          { id: "one", valueType: "string" },
          { id: "two", valueType: "string" },
        ],
      ),
    };
    const result = compileCanvasWorkflow(
      canvas(
        [
          node("multi", "multi"),
          node("rewrite", "config", { credentialId: "credential-1" }),
        ],
        [{ id: "edge", fromNodeId: "multi", toNodeId: "rewrite" }],
      ),
      [multiOutput, transformRule],
      { workflowId: "workflow-1" },
    );
    expect(result.publishable).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "AMBIGUOUS_OUTPUT_PORT",
          canvasConnectionId: "edge",
        }),
        expect.objectContaining({
          code: "MISSING_REQUIRED_INPUT",
          canvasNodeId: "rewrite",
        }),
      ]),
    );
  });

  it("uses explicit Canvas connection ports for conditional forks", () => {
    const forkRule: WorkflowCompileRule = {
      canvasNodeType: "fork",
      schema: schema(
        "logic.condition",
        [{ id: "input", valueType: "string" }],
        [
          { id: "true", valueType: "string" },
          { id: "false", valueType: "string" },
        ],
      ),
      defaultInputPortId: "input",
    };
    const sinkRule: WorkflowCompileRule = {
      canvasNodeType: "sink",
      schema: schema("sink", [{ id: "input", valueType: "string" }], []),
      defaultInputPortId: "input",
    };
    const result = compileCanvasWorkflow(
      canvas(
        [
          node("source", "text", { content: "yes" }),
          node("fork", "fork"),
          node("sink", "sink"),
        ],
        [
          { id: "into-fork", fromNodeId: "source", toNodeId: "fork" },
          {
            id: "true-edge",
            fromNodeId: "fork",
            fromPortId: "true",
            toNodeId: "sink",
          },
        ],
      ),
      [sourceRule, forkRule, sinkRule],
      { workflowId: "conditional" },
    );
    expect(result.publishable).toBe(true);
    expect(result.definition.edges[1]).toMatchObject({
      fromPortId: "true",
      toPortId: "input",
    });
  });

  it("enforces credential and capability availability without exposing values", () => {
    const result = compileCanvasWorkflow(
      canvas([
        node("rewrite", "config", {
          prompt: "configured",
          credentialId: "credential-private",
        }),
      ]),
      [transformRule],
      {
        workflowId: "workflow-1",
        validation: {
          availableCapabilities: new Set(),
          availableCredentials: new Set(),
        },
      },
    );
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(["MISSING_CAPABILITY", "MISSING_CREDENTIAL"]),
    );
    expect(JSON.stringify(result.issues)).not.toContain("credential-private");
  });

  it("reports missing bindings, invalid JSON config, duplicate rules and skipped connections", () => {
    const brokenRule: WorkflowCompileRule = {
      ...transformRule,
      credentialBindings: {},
      configBindings: { unsafe: "unsafe" },
    };
    const result = compileCanvasWorkflow(
      canvas(
        [
          node("rewrite", "config", { prompt: "configured", unsafe: 1n }),
          node("note", "sticky"),
        ],
        [{ id: "skipped", fromNodeId: "note", toNodeId: "rewrite" }],
      ),
      [brokenRule, brokenRule],
      { workflowId: "workflow-1" },
    );
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_COMPILE_RULE",
        "MISSING_CREDENTIAL_BINDING",
        "INVALID_CONFIG_VALUE",
        "CONNECTION_SKIPPED",
      ]),
    );
  });

  it("rejects duplicate Canvas node ids before source mapping can be overwritten", () => {
    const result = compileCanvasWorkflow(
      canvas([node("same", "text"), node("same", "text")]),
      [sourceRule],
      { workflowId: "workflow-1" },
    );
    expect(result.publishable).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_NODE_ID",
          canvasNodeId: "same",
        }),
      ]),
    );
  });
});
