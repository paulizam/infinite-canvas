import type { WorkflowDefinition } from "@infinite-canvas/contracts";
import {
  WorkflowValidationError,
  type WorkflowExecutionPlan,
  type WorkflowValidationOptions,
} from "./types.js";
import { validateWorkflow } from "./validator.js";

export function planWorkflowExecution(
  definition: WorkflowDefinition,
  startNodeIds?: readonly string[],
  options?: WorkflowValidationOptions,
): WorkflowExecutionPlan {
  const result = validateWorkflow(definition, options);
  if (!result.valid) throw new WorkflowValidationError(result);
  const all = new Set(definition.nodes.map((node) => node.id));
  const selected = startNodeIds?.length
    ? descendants(definition, startNodeIds)
    : all;
  for (const id of startNodeIds || [])
    if (!all.has(id)) throw new Error(`Unknown start node: ${id}`);
  return {
    definitionId: definition.id,
    selectedNodeIds: result.layers.flat().filter((id) => selected.has(id)),
    layers: result.layers
      .map((layer) => layer.filter((id) => selected.has(id)))
      .filter((layer) => layer.length),
    skipped: result.layers
      .flat()
      .filter((id) => !selected.has(id))
      .map((nodeId) => ({ nodeId, reason: "before_selection" as const })),
  };
}

function descendants(
  definition: WorkflowDefinition,
  starts: readonly string[],
) {
  const adjacency = new Map(
    definition.nodes.map((node) => [node.id, [] as string[]]),
  );
  for (const edge of definition.edges)
    adjacency.get(edge.fromNodeId)?.push(edge.toNodeId);
  const selected = new Set(starts),
    queue = [...starts];
  while (queue.length)
    for (const target of adjacency.get(queue.shift()!) || [])
      if (!selected.has(target)) {
        selected.add(target);
        queue.push(target);
      }
  return selected;
}
