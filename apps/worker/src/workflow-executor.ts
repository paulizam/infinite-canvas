import type { WorkflowNodeDefinition } from "@infinite-canvas/contracts";
import type { WorkerApiClient } from "./client.js";
import type {
  WorkflowWorkerOperation,
  WorkflowWorkerRecord,
} from "./workflow-types.js";

export type WorkflowNodeAdapter = (input: {
  node: WorkflowNodeDefinition;
  inputs: Record<string, unknown>;
  execution: WorkflowWorkerRecord;
  signal?: AbortSignal;
}) => Promise<unknown>;
export type WorkflowNodeAdapters = Readonly<
  Record<string, WorkflowNodeAdapter>
>;

export async function executeWorkflow(
  source: WorkflowWorkerRecord,
  client: Pick<WorkerApiClient, "transitionWorkflow">,
  workerId: string,
  adapters: WorkflowNodeAdapters = builtinWorkflowAdapters,
  signal?: AbortSignal,
) {
  let record = source;
  while (!signal?.aborted) {
    if (record.state.status === "cancel_requested")
      return client.transitionWorkflow(
        workerId,
        record.state.id,
        record.revision,
        { type: "execution.cancel.complete" },
        signal,
      );
    if (
      ["waiting", "succeeded", "failed", "cancelled"].includes(
        record.state.status,
      )
    )
      return record;
    const runnable = record.state.selectedNodeIds
      .map((id) => record.state.nodes[id]!)
      .filter((node) => node.status === "ready" || node.status === "running");
    if (!runnable.length) return record;

    const started = new Map<string, Record<string, unknown>>();
    for (const execution of runnable) {
      const inputs =
        execution.status === "running" && isRecord(execution.input)
          ? execution.input
          : buildWorkflowNodeInputs(record, execution.nodeId);
      started.set(execution.nodeId, inputs);
      if (execution.status === "ready")
        record = await client.transitionWorkflow(
          workerId,
          record.state.id,
          record.revision,
          { type: "node.start", nodeId: execution.nodeId, input: inputs },
          signal,
        );
    }

    const results = await Promise.all(
      runnable.map(async (execution) => {
        const node = record.definition.nodes.find(
          (item) => item.id === execution.nodeId,
        )!;
        try {
          const adapter = adapters[node.type];
          if (!adapter)
            throw new WorkflowAdapterError(
              "WORKFLOW_NODE_UNSUPPORTED",
              `No trusted adapter for ${node.type}`,
            );
          return {
            nodeId: node.id,
            output: await adapter({
              node,
              inputs: started.get(node.id)!,
              execution: record,
              signal,
            }),
          } as const;
        } catch (error) {
          return { nodeId: node.id, error: normalizeError(error) } as const;
        }
      }),
    );
    for (const result of results) {
      const node = record.state.nodes[result.nodeId]!;
      let operation: WorkflowWorkerOperation;
      if (result.error) {
        operation = {
          type: "node.fail",
          nodeId: result.nodeId,
          error: result.error,
          ...(node.attempt < node.maxAttempts
            ? {
                retryAt: new Date(
                  Date.now() + Math.min(60_000, 2 ** node.attempt * 1_000),
                ).toISOString(),
              }
            : {}),
        };
      } else {
        operation = {
          type: "node.complete",
          nodeId: result.nodeId,
          output: result.output,
        };
      }
      record = await client.transitionWorkflow(
        workerId,
        record.state.id,
        record.revision,
        operation,
        signal,
      );
    }
  }
  return record;
}

export function buildWorkflowNodeInputs(
  record: WorkflowWorkerRecord,
  nodeId: string,
) {
  const node = record.definition.nodes.find((item) => item.id === nodeId);
  if (!node)
    throw new WorkflowAdapterError(
      "WORKFLOW_NODE_UNKNOWN",
      `Unknown node ${nodeId}`,
    );
  const initial = record.state.initialInputs[nodeId];
  const inputs: Record<string, unknown> = isRecord(initial)
    ? { ...initial }
    : initial === undefined
      ? {}
      : { input: initial };
  for (const edge of record.definition.edges.filter(
    (item) => item.toNodeId === nodeId,
  )) {
    const source = record.state.nodes[edge.fromNodeId]?.output;
    const value =
      isRecord(source) && Object.hasOwn(source, edge.fromPortId)
        ? source[edge.fromPortId]
        : source;
    const port = node.inputs.find((item) => item.id === edge.toPortId);
    if (port?.multiple)
      inputs[edge.toPortId] = [
        ...(Array.isArray(inputs[edge.toPortId])
          ? (inputs[edge.toPortId] as unknown[])
          : []),
        value,
      ];
    else inputs[edge.toPortId] = value;
  }
  return inputs;
}

export const builtinWorkflowAdapters: WorkflowNodeAdapters = {
  "canvas.text": async ({ node, inputs }) => ({
    output: configValue(node.config, "value") ?? inputs.input,
  }),
  "canvas.image": async ({ node, inputs }) => ({
    output: configValue(node.config, "asset") ?? inputs.input,
  }),
  "canvas.video": async ({ node, inputs }) => ({
    output: configValue(node.config, "asset") ?? inputs.input,
  }),
  "canvas.audio": async ({ node, inputs }) => ({
    output: configValue(node.config, "asset") ?? inputs.input,
  }),
};

class WorkflowAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function normalizeError(error: unknown) {
  return {
    code:
      error instanceof WorkflowAdapterError
        ? error.code
        : "WORKFLOW_NODE_FAILED",
    message: (error instanceof Error
      ? error.message
      : "Workflow node failed"
    ).slice(0, 2_000),
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function configValue(config: unknown, key: string) {
  return isRecord(config) ? config[key] : undefined;
}
