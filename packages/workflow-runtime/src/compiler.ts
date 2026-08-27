import type {
  CanvasDocument,
  CanvasNode,
  WorkflowDefinition,
  WorkflowNodeSchema,
} from "@infinite-canvas/contracts";
import type {
  WorkflowValidationCode,
  WorkflowValidationOptions,
} from "./types.js";
import { validateWorkflow } from "./validator.js";

export type WorkflowCompileRule = {
  canvasNodeType: string;
  schema: WorkflowNodeSchema;
  defaultInputPortId?: string;
  defaultOutputPortId?: string;
  configBindings?: Record<string, string>;
  credentialBindings?: Record<string, string>;
};

export type WorkflowCompileIssue = {
  code:
    | WorkflowValidationCode
    | "EMPTY_CANVAS"
    | "DUPLICATE_COMPILE_RULE"
    | "NON_EXECUTABLE_NODE"
    | "CONNECTION_SKIPPED"
    | "AMBIGUOUS_INPUT_PORT"
    | "AMBIGUOUS_OUTPUT_PORT"
    | "MISSING_CREDENTIAL_BINDING"
    | "INVALID_CONFIG_VALUE";
  severity: "error" | "warning";
  message: string;
  canvasNodeId?: string;
  canvasConnectionId?: string;
  workflowNodeId?: string;
  workflowEdgeId?: string;
  portId?: string;
};

export type WorkflowSourceMapping = {
  nodes: Record<string, string>;
  edges: Record<string, string>;
};

export type WorkflowCompileResult = {
  publishable: boolean;
  definition: WorkflowDefinition;
  sourceMapping: WorkflowSourceMapping;
  issues: WorkflowCompileIssue[];
};

export type WorkflowCompileOptions = {
  workflowId: string;
  name?: string;
  schemaVersion?: number;
  canvasEntryNodeIds?: readonly string[];
  validation?: Omit<
    WorkflowValidationOptions,
    "knownNodeTypes" | "entryNodeIds"
  >;
};

export function compileCanvasWorkflow(
  canvas: CanvasDocument,
  rules: readonly WorkflowCompileRule[],
  options: WorkflowCompileOptions,
): WorkflowCompileResult {
  const issues: WorkflowCompileIssue[] = [];
  const ruleMap = compileRuleMap(rules, issues);
  const sourceMapping: WorkflowSourceMapping = { nodes: {}, edges: {} };
  const compiledNodes = new Map<string, WorkflowDefinition["nodes"][number]>();
  const canvasNodes = new Map<string, CanvasNode>();
  if (!canvas.nodes.length)
    issues.push(diagnostic("EMPTY_CANVAS", "Canvas contains no nodes"));

  for (const canvasNode of canvas.nodes) {
    if (canvasNodes.has(canvasNode.id)) {
      issues.push(
        diagnostic("DUPLICATE_NODE_ID", "Canvas node id must be unique", {
          canvasNodeId: canvasNode.id,
        }),
      );
      continue;
    }
    canvasNodes.set(canvasNode.id, canvasNode);
    const rule = ruleMap.get(canvasNode.type);
    if (!rule) {
      issues.push(
        diagnostic(
          "NON_EXECUTABLE_NODE",
          `Canvas node type is not executable: ${canvasNode.type}`,
          { canvasNodeId: canvasNode.id },
          "warning",
        ),
      );
      continue;
    }
    const compiled = compileNode(canvasNode, rule, issues);
    compiledNodes.set(compiled.id, compiled);
    sourceMapping.nodes[compiled.id] = canvasNode.id;
  }

  const compiledEdges: WorkflowDefinition["edges"] = [];
  for (const connection of canvas.connections) {
    const from = compiledNodes.get(connection.fromNodeId);
    const to = compiledNodes.get(connection.toNodeId);
    if (!from || !to) {
      issues.push(
        diagnostic(
          "CONNECTION_SKIPPED",
          "Connection touches a non-executable or missing node",
          { canvasConnectionId: connection.id },
          "warning",
        ),
      );
      continue;
    }
    const fromRule = ruleMap.get(canvasNodes.get(from.id)!.type)!;
    const toRule = ruleMap.get(canvasNodes.get(to.id)!.type)!;
    const output = resolvePort(from.outputs, fromRule.defaultOutputPortId);
    const input = resolvePort(to.inputs, toRule.defaultInputPortId);
    if (!output) {
      issues.push(
        diagnostic(
          "AMBIGUOUS_OUTPUT_PORT",
          "Visual source cannot be mapped to exactly one output port",
          { canvasNodeId: from.id, canvasConnectionId: connection.id },
        ),
      );
      continue;
    }
    if (!input) {
      issues.push(
        diagnostic(
          "AMBIGUOUS_INPUT_PORT",
          "Visual target cannot be mapped to exactly one input port",
          { canvasNodeId: to.id, canvasConnectionId: connection.id },
        ),
      );
      continue;
    }
    const edge = {
      id: connection.id,
      fromNodeId: from.id,
      fromPortId: output,
      toNodeId: to.id,
      toPortId: input,
    };
    compiledEdges.push(edge);
    sourceMapping.edges[edge.id] = connection.id;
  }

  const entryNodeIds = options.canvasEntryNodeIds?.filter((id) =>
    compiledNodes.has(id),
  );
  for (const id of options.canvasEntryNodeIds || [])
    if (!compiledNodes.has(id))
      issues.push(
        diagnostic(
          "UNKNOWN_ENTRY_NODE",
          "Canvas entry node is not executable or does not exist",
          { canvasNodeId: id },
        ),
      );
  const definition: WorkflowDefinition = {
    id: options.workflowId,
    schemaVersion: options.schemaVersion || 1,
    name: options.name?.trim() || canvas.title,
    nodes: [...compiledNodes.values()],
    edges: compiledEdges,
    ...(entryNodeIds?.length ? { entryNodeIds: [...entryNodeIds] } : {}),
  };
  const validation = validateWorkflow(definition, {
    ...options.validation,
    knownNodeTypes: new Set(rules.map((rule) => rule.schema.type)),
    entryNodeIds,
  });
  for (const item of validation.issues)
    issues.push({
      code: item.code,
      severity: item.severity,
      message: item.message,
      portId: item.portId,
      canvasNodeId: item.nodeId ? sourceMapping.nodes[item.nodeId] : undefined,
      canvasConnectionId: item.edgeId
        ? sourceMapping.edges[item.edgeId]
        : undefined,
      workflowNodeId: item.nodeId,
      workflowEdgeId: item.edgeId,
    });
  return {
    publishable: !issues.some((item) => item.severity === "error"),
    definition,
    sourceMapping,
    issues,
  };
}

function compileRuleMap(
  rules: readonly WorkflowCompileRule[],
  issues: WorkflowCompileIssue[],
) {
  const map = new Map<string, WorkflowCompileRule>();
  for (const rule of rules) {
    if (map.has(rule.canvasNodeType))
      issues.push(
        diagnostic(
          "DUPLICATE_COMPILE_RULE",
          `Duplicate compile rule: ${rule.canvasNodeType}`,
        ),
      );
    else map.set(rule.canvasNodeType, rule);
  }
  return map;
}

function compileNode(
  node: CanvasNode,
  rule: WorkflowCompileRule,
  issues: WorkflowCompileIssue[],
): WorkflowDefinition["nodes"][number] {
  const metadata = node.metadata || {};
  const config: Record<string, unknown> = {};
  for (const [target, source] of Object.entries(rule.configBindings || {})) {
    if (!Object.hasOwn(metadata, source) || metadata[source] === undefined)
      continue;
    try {
      config[target] = jsonClone(metadata[source]);
    } catch {
      issues.push(
        diagnostic(
          "INVALID_CONFIG_VALUE",
          `Config field is not JSON-safe: ${source}`,
          {
            canvasNodeId: node.id,
          },
        ),
      );
    }
  }
  const credentialRefs: string[] = [];
  for (const slot of rule.schema.credentialSlots || []) {
    const metadataKey = rule.credentialBindings?.[slot];
    const value = metadataKey ? metadata[metadataKey] : undefined;
    if (typeof value !== "string" || !value.trim())
      issues.push(
        diagnostic(
          "MISSING_CREDENTIAL_BINDING",
          `Credential slot is not bound: ${slot}`,
          { canvasNodeId: node.id },
        ),
      );
    else credentialRefs.push(value.trim());
  }
  return {
    id: node.id,
    type: rule.schema.type,
    inputs: rule.schema.inputs.map((port) => ({ ...port })),
    outputs: rule.schema.outputs.map((port) => ({ ...port })),
    config,
    requiredCapabilities: [...(rule.schema.requiredCapabilities || [])],
    credentialRefs,
  };
}

function resolvePort(ports: WorkflowNodeSchema["inputs"], explicit?: string) {
  if (explicit)
    return ports.some((port) => port.id === explicit) ? explicit : null;
  return ports.length === 1 ? ports[0]!.id : null;
}

function jsonClone(value: unknown) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("not JSON-safe");
  return JSON.parse(encoded) as unknown;
}

function diagnostic(
  code: WorkflowCompileIssue["code"],
  message: string,
  target: Partial<WorkflowCompileIssue> = {},
  severity: "error" | "warning" = "error",
): WorkflowCompileIssue {
  return { code, severity, message, ...target };
}
