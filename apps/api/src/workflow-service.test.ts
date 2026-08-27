import type { CanvasDocument } from "@infinite-canvas/contracts";
import { compileCanvasWorkflow } from "@infinite-canvas/workflow-runtime";
import { describe, expect, it } from "vitest";
import { BUILTIN_WORKFLOW_RULES } from "./workflow-service.js";

describe("builtin Workflow publication rules", () => {
  it("compiles an explicitly ported condition fork without guessing a branch", () => {
    const document: CanvasDocument = {
      id: "canvas",
      schemaVersion: 4,
      revision: 1,
      title: "Conditional",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nodes: [
        {
          id: "source",
          type: "text",
          title: "Source",
          position: { x: 0, y: 0 },
          width: 100,
          height: 100,
          metadata: { content: "yes" },
        },
        {
          id: "condition",
          type: "config",
          title: "Condition",
          position: { x: 100, y: 0 },
          width: 100,
          height: 100,
          metadata: {
            workflowMode: "condition",
            conditionOperator: "equals",
            conditionValue: "yes",
          },
        },
        {
          id: "yes",
          type: "config",
          title: "Yes",
          position: { x: 200, y: -50 },
          width: 100,
          height: 100,
          metadata: { generationMode: "text", model: "text.default" },
        },
        {
          id: "no",
          type: "config",
          title: "No",
          position: { x: 200, y: 50 },
          width: 100,
          height: 100,
          metadata: { generationMode: "text", model: "text.default" },
        },
      ],
      connections: [
        { id: "source-condition", fromNodeId: "source", toNodeId: "condition" },
        {
          id: "condition-yes",
          fromNodeId: "condition",
          fromPortId: "true",
          toNodeId: "yes",
        },
        {
          id: "condition-no",
          fromNodeId: "condition",
          fromPortId: "false",
          toNodeId: "no",
        },
      ],
      chatSessions: [],
      activeChatId: null,
      backgroundMode: "dots",
      showImageInfo: false,
      viewport: { x: 0, y: 0, k: 1 },
    };
    const result = compileCanvasWorkflow(document, BUILTIN_WORKFLOW_RULES, {
      workflowId: "workflow",
    });
    expect(result.publishable).toBe(true);
    expect(
      result.definition.nodes.find((node) => node.id === "condition"),
    ).toMatchObject({
      type: "logic.condition",
      config: { operator: "equals", compare: "yes" },
    });
    expect(
      result.definition.edges
        .filter((edge) => edge.fromNodeId === "condition")
        .map((edge) => edge.fromPortId)
        .sort(),
    ).toEqual(["false", "true"]);
  });
});
