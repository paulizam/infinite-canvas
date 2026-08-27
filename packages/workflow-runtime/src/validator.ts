import type {
  WorkflowDefinition,
  WorkflowNodeDefinition,
} from "@infinite-canvas/contracts";
import {
  WorkflowValidationError,
  type WorkflowValidationIssue,
  type WorkflowValidationOptions,
  type WorkflowValidationResult,
} from "./types.js";
import { isWorkflowValueTypeCompatible } from "./value-types.js";

export function validateWorkflow(
  definition: WorkflowDefinition,
  options: WorkflowValidationOptions = {},
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  const nodes = uniqueNodes(definition.nodes, issues);
  if (!definition.nodes.length)
    issues.push(
      issue("EMPTY_WORKFLOW", "Workflow must contain at least one node"),
    );
  validateNodes(nodes, options, issues);
  const graph = validateEdges(definition, nodes, issues);
  validateRequiredInputs(nodes, graph.incoming, issues);
  const layers = buildLayers(nodes, graph.adjacency, graph.indegree);
  if (layers.flat().length !== nodes.size) {
    const scheduled = new Set(layers.flat());
    for (const nodeId of nodes.keys())
      if (!scheduled.has(nodeId))
        issues.push(
          issue("CYCLE", "Node participates in a directed cycle", { nodeId }),
        );
  }
  validateReachability(definition, nodes, graph.adjacency, options, issues);
  return {
    valid: !issues.some((item) => item.severity === "error"),
    issues,
    layers,
  };
}

export function topologicalLayers(
  definition: WorkflowDefinition,
  options?: WorkflowValidationOptions,
) {
  const result = validateWorkflow(definition, options);
  if (!result.valid) throw new WorkflowValidationError(result);
  return result.layers;
}

function uniqueNodes(
  source: WorkflowNodeDefinition[],
  issues: WorkflowValidationIssue[],
) {
  const nodes = new Map<string, WorkflowNodeDefinition>();
  for (const node of source) {
    if (nodes.has(node.id))
      issues.push(
        issue("DUPLICATE_NODE_ID", "Node id must be unique", {
          nodeId: node.id,
        }),
      );
    else nodes.set(node.id, node);
  }
  return nodes;
}

function validateNodes(
  nodes: Map<string, WorkflowNodeDefinition>,
  options: WorkflowValidationOptions,
  issues: WorkflowValidationIssue[],
) {
  for (const node of nodes.values()) {
    if (options.knownNodeTypes && !options.knownNodeTypes.has(node.type))
      issues.push(
        issue("UNKNOWN_NODE_TYPE", `Unknown node type: ${node.type}`, {
          nodeId: node.id,
        }),
      );
    validatePorts(node, issues);
    for (const capability of node.requiredCapabilities || [])
      if (
        options.availableCapabilities &&
        !options.availableCapabilities.has(capability)
      )
        issues.push(
          issue(
            "MISSING_CAPABILITY",
            `Capability is unavailable: ${capability}`,
            { nodeId: node.id },
          ),
        );
    for (const credential of node.credentialRefs || [])
      if (
        options.availableCredentials &&
        !options.availableCredentials.has(credential)
      )
        issues.push(
          issue("MISSING_CREDENTIAL", "Referenced credential is unavailable", {
            nodeId: node.id,
          }),
        );
  }
}

function validatePorts(
  node: WorkflowNodeDefinition,
  issues: WorkflowValidationIssue[],
) {
  for (const [kind, ports] of [
    ["input", node.inputs],
    ["output", node.outputs],
  ] as const) {
    const ids = new Set<string>();
    for (const port of ports) {
      if (ids.has(port.id))
        issues.push(
          issue("DUPLICATE_PORT_ID", `${kind} port id must be unique`, {
            nodeId: node.id,
            portId: port.id,
          }),
        );
      ids.add(port.id);
    }
  }
}

function validateEdges(
  definition: WorkflowDefinition,
  nodes: Map<string, WorkflowNodeDefinition>,
  issues: WorkflowValidationIssue[],
) {
  const adjacency = new Map(
    [...nodes.keys()].map((id) => [id, new Set<string>()]),
  );
  const indegree = new Map([...nodes.keys()].map((id) => [id, 0]));
  const incoming = new Map<string, number>();
  const edgeIds = new Set<string>();
  for (const edge of definition.edges) {
    if (edgeIds.has(edge.id))
      issues.push(
        issue("DUPLICATE_EDGE_ID", "Edge id must be unique", {
          edgeId: edge.id,
        }),
      );
    edgeIds.add(edge.id);
    const from = nodes.get(edge.fromNodeId),
      to = nodes.get(edge.toNodeId);
    if (!from || !to) {
      issues.push(
        issue("UNKNOWN_EDGE_NODE", "Edge endpoint does not exist", {
          edgeId: edge.id,
        }),
      );
      continue;
    }
    if (from.id === to.id)
      issues.push(
        issue("SELF_EDGE", "Self edges are not executable", {
          edgeId: edge.id,
          nodeId: from.id,
        }),
      );
    const output = from.outputs.find((port) => port.id === edge.fromPortId);
    const input = to.inputs.find((port) => port.id === edge.toPortId);
    if (!output || !input) {
      issues.push(
        issue("UNKNOWN_EDGE_PORT", "Edge port does not exist", {
          edgeId: edge.id,
          nodeId: !output ? from.id : to.id,
          portId: !output ? edge.fromPortId : edge.toPortId,
        }),
      );
      continue;
    }
    if (!isWorkflowValueTypeCompatible(output.valueType, input.valueType))
      issues.push(
        issue(
          "TYPE_MISMATCH",
          `${output.valueType} cannot feed ${input.valueType}`,
          { edgeId: edge.id, nodeId: to.id, portId: input.id },
        ),
      );
    const key = `${to.id}\0${input.id}`;
    const count = (incoming.get(key) || 0) + 1;
    incoming.set(key, count);
    if (count > 1 && !input.multiple)
      issues.push(
        issue("MULTIPLE_INPUT", "Input accepts only one connection", {
          edgeId: edge.id,
          nodeId: to.id,
          portId: input.id,
        }),
      );
    if (!adjacency.get(from.id)!.has(to.id)) {
      adjacency.get(from.id)!.add(to.id);
      indegree.set(to.id, indegree.get(to.id)! + 1);
    }
  }
  return { adjacency, indegree, incoming };
}

function validateRequiredInputs(
  nodes: Map<string, WorkflowNodeDefinition>,
  incoming: Map<string, number>,
  issues: WorkflowValidationIssue[],
) {
  for (const node of nodes.values())
    for (const port of node.inputs) {
      const configured =
        isRecord(node.config) &&
        Object.hasOwn(node.config, port.id) &&
        node.config[port.id] !== null &&
        node.config[port.id] !== undefined;
      if (
        port.required &&
        !incoming.get(`${node.id}\0${port.id}`) &&
        !configured
      )
        issues.push(
          issue(
            "MISSING_REQUIRED_INPUT",
            "Required input is neither connected nor configured",
            { nodeId: node.id, portId: port.id },
          ),
        );
    }
}

function buildLayers(
  nodes: Map<string, WorkflowNodeDefinition>,
  adjacency: Map<string, Set<string>>,
  sourceIndegree: Map<string, number>,
) {
  const indegree = new Map(sourceIndegree),
    layers: string[][] = [];
  let ready = [...nodes.keys()].filter((id) => indegree.get(id) === 0).sort();
  while (ready.length) {
    layers.push(ready);
    const next = new Set<string>();
    for (const id of ready)
      for (const target of adjacency.get(id) || []) {
        const degree = indegree.get(target)! - 1;
        indegree.set(target, degree);
        if (degree === 0) next.add(target);
      }
    ready = [...next].sort();
  }
  return layers;
}

function validateReachability(
  definition: WorkflowDefinition,
  nodes: Map<string, WorkflowNodeDefinition>,
  adjacency: Map<string, Set<string>>,
  options: WorkflowValidationOptions,
  issues: WorkflowValidationIssue[],
) {
  const entries = options.entryNodeIds || definition.entryNodeIds;
  if (!entries?.length) return;
  const reached = new Set<string>(),
    queue: string[] = [];
  for (const id of entries)
    if (!nodes.has(id))
      issues.push(
        issue("UNKNOWN_ENTRY_NODE", "Entry node does not exist", {
          nodeId: id,
        }),
      );
    else if (!reached.has(id)) {
      reached.add(id);
      queue.push(id);
    }
  while (queue.length)
    for (const target of adjacency.get(queue.shift()!) || [])
      if (!reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
  for (const id of nodes.keys())
    if (!reached.has(id))
      issues.push(
        issue(
          "UNREACHABLE_NODE",
          "Node is unreachable from workflow entries",
          { nodeId: id },
          options.unreachableSeverity || "error",
        ),
      );
}

function issue(
  code: WorkflowValidationIssue["code"],
  message: string,
  target: Partial<WorkflowValidationIssue> = {},
  severity: "error" | "warning" = "error",
): WorkflowValidationIssue {
  return { code, severity, message, ...target };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
