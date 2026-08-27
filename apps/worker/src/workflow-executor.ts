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
  client: WorkflowExecutorClient;
  workerId: string;
  signal?: AbortSignal;
}) => Promise<unknown>;
export type WorkflowNodeAdapters = Readonly<
  Record<string, WorkflowNodeAdapter>
>;
type WorkflowExecutorClient = Pick<WorkerApiClient, "transitionWorkflow"> &
  Partial<
    Pick<
      WorkerApiClient,
      "createWorkflowGeneration" | "cancelWorkflowGeneration"
    >
  >;

export class WorkflowAdapterWait {
  constructor(
    readonly wakeAt: string,
    readonly stepKey: string,
    readonly stepInput: unknown,
  ) {}
}
export class WorkflowAdapterComplete {
  constructor(
    readonly output: unknown,
    readonly stepKey: string,
    readonly stepOutput: unknown,
  ) {}
}
export class WorkflowAdapterFailure {
  constructor(
    readonly error: { code: string; message: string },
    readonly stepKey: string,
    readonly stepOutput: unknown,
  ) {}
}

export async function executeWorkflow(
  source: WorkflowWorkerRecord,
  client: WorkflowExecutorClient,
  workerId: string,
  adapters: WorkflowNodeAdapters = builtinWorkflowAdapters,
  signal?: AbortSignal,
) {
  let record = source;
  while (!signal?.aborted) {
    if (record.state.status === "cancel_requested") {
      await cancelChildGenerations(record, client, workerId, signal);
      return client.transitionWorkflow(
        workerId,
        record.state.id,
        record.revision,
        { type: "execution.cancel.complete" },
        signal,
      );
    }
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
              client,
              workerId,
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
      if ("output" in result && result.output instanceof WorkflowAdapterWait) {
        record = await ensureWorkflowStep(
          record,
          client,
          workerId,
          result.nodeId,
          result.output.stepKey,
          result.output.stepInput,
          signal,
        );
        record = await client.transitionWorkflow(
          workerId,
          record.state.id,
          record.revision,
          {
            type: "step.wait",
            nodeId: result.nodeId,
            key: result.output.stepKey,
            wakeAt: result.output.wakeAt,
          },
          signal,
        );
        continue;
      }
      if (
        "output" in result &&
        result.output instanceof WorkflowAdapterComplete
      ) {
        record = await completeWorkflowAdapterStep(
          record,
          client,
          workerId,
          result.nodeId,
          result.output.stepKey,
          result.output.stepOutput,
          signal,
        );
        record = await client.transitionWorkflow(
          workerId,
          record.state.id,
          record.revision,
          {
            type: "node.complete",
            nodeId: result.nodeId,
            output: result.output.output,
          },
          signal,
        );
        continue;
      }
      if (
        "output" in result &&
        result.output instanceof WorkflowAdapterFailure
      ) {
        record = await completeWorkflowAdapterStep(
          record,
          client,
          workerId,
          result.nodeId,
          result.output.stepKey,
          result.output.stepOutput,
          signal,
        );
        record = await failWorkflowAdapterNode(
          record,
          client,
          workerId,
          result.nodeId,
          result.output.error,
          signal,
        );
        continue;
      }
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
    if (isRecord(source) && !Object.hasOwn(source, edge.fromPortId)) continue;
    if (source === undefined) continue;
    const value = isRecord(source) ? source[edge.fromPortId] : source;
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
  "logic.condition": async ({ node, inputs }) => {
    const value = inputs.input;
    return conditionMatches(
      value,
      configValue(node.config, "operator"),
      configValue(node.config, "compare"),
    )
      ? { true: value }
      : { false: value };
  },
  "ai.generate.text": generationAdapter("text"),
  "ai.generate.image": generationAdapter("image"),
  "ai.generate.video": generationAdapter("video"),
  "ai.generate.audio": generationAdapter("audio"),
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

function generationAdapter(
  capability: "text" | "image" | "video" | "audio",
): WorkflowNodeAdapter {
  return async ({ node, inputs, execution, client, workerId, signal }) => {
    if (!client.createWorkflowGeneration)
      throw new WorkflowAdapterError(
        "WORKFLOW_GENERATION_UNAVAILABLE",
        "Worker client cannot create child generation jobs",
      );
    const logicalModelId =
      configValue(node.config, "logicalModelId") ??
      configValue(node.config, "model");
    if (typeof logicalModelId !== "string" || !logicalModelId.trim())
      throw new WorkflowAdapterError(
        "WORKFLOW_MODEL_REQUIRED",
        `Node ${node.id} requires logicalModelId`,
      );
    const configured = configValue(node.config, "parameters");
    const nodeParameters = isRecord(node.config) ? { ...node.config } : {};
    delete nodeParameters.logicalModelId;
    delete nodeParameters.model;
    delete nodeParameters.parameters;
    const parameters = {
      ...nodeParameters,
      ...(isRecord(configured) ? configured : {}),
      ...inputs,
    };
    const attempt = execution.state.nodes[node.id]!.attempt;
    const { job } = await client.createWorkflowGeneration(
      workerId,
      execution.state.id,
      { nodeId: node.id, attempt, capability, logicalModelId, parameters },
      signal,
    );
    const stepOutput = {
      jobId: job.id,
      phase: job.phase,
      billing: job.billing,
    };
    if (job.phase === "succeeded")
      return new WorkflowAdapterComplete(
        { output: job.result },
        "generation",
        stepOutput,
      );
    if (["failed", "cancelled", "needs_review"].includes(job.phase))
      return new WorkflowAdapterFailure(
        {
          code: job.errorCode || `GENERATION_${job.phase.toUpperCase()}`,
          message: job.errorMessage || `Child generation job ${job.phase}`,
        },
        "generation",
        stepOutput,
      );
    return new WorkflowAdapterWait(
      new Date(Date.now() + 2_000).toISOString(),
      "generation",
      { jobId: job.id, capability, attempt },
    );
  };
}

function conditionMatches(value: unknown, operator: unknown, compare: unknown) {
  switch (operator) {
    case "equals":
      return JSON.stringify(value) === JSON.stringify(compare);
    case "not_equals":
      return JSON.stringify(value) !== JSON.stringify(compare);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof value !== "number" || typeof compare !== "number")
        return false;
      if (operator === "gt") return value > compare;
      if (operator === "gte") return value >= compare;
      if (operator === "lt") return value < compare;
      return value <= compare;
    }
    case "contains":
      return typeof value === "string" && typeof compare === "string"
        ? value.includes(compare)
        : Array.isArray(value) &&
            value.some(
              (item) => JSON.stringify(item) === JSON.stringify(compare),
            );
    case "truthy":
    case undefined:
      return Boolean(value);
    default:
      throw new WorkflowAdapterError(
        "WORKFLOW_CONDITION_INVALID",
        `Unsupported condition operator: ${String(operator)}`,
      );
  }
}

async function ensureWorkflowStep(
  record: WorkflowWorkerRecord,
  client: WorkflowExecutorClient,
  workerId: string,
  nodeId: string,
  key: string,
  input: unknown,
  signal?: AbortSignal,
) {
  if (record.state.nodes[nodeId]?.steps[key]) return record;
  return client.transitionWorkflow(
    workerId,
    record.state.id,
    record.revision,
    { type: "step.start", nodeId, key, input },
    signal,
  );
}

async function completeWorkflowAdapterStep(
  record: WorkflowWorkerRecord,
  client: WorkflowExecutorClient,
  workerId: string,
  nodeId: string,
  key: string,
  output: unknown,
  signal?: AbortSignal,
) {
  record = await ensureWorkflowStep(
    record,
    client,
    workerId,
    nodeId,
    key,
    output,
    signal,
  );
  if (record.state.nodes[nodeId]?.steps[key]?.status === "succeeded")
    return record;
  return client.transitionWorkflow(
    workerId,
    record.state.id,
    record.revision,
    { type: "step.complete", nodeId, key, output },
    signal,
  );
}

function failWorkflowAdapterNode(
  record: WorkflowWorkerRecord,
  client: WorkflowExecutorClient,
  workerId: string,
  nodeId: string,
  error: { code: string; message: string },
  signal?: AbortSignal,
) {
  const node = record.state.nodes[nodeId]!;
  return client.transitionWorkflow(
    workerId,
    record.state.id,
    record.revision,
    {
      type: "node.fail",
      nodeId,
      error,
      ...(node.attempt < node.maxAttempts
        ? {
            retryAt: new Date(
              Date.now() + Math.min(60_000, 2 ** node.attempt * 1_000),
            ).toISOString(),
          }
        : {}),
    },
    signal,
  );
}

async function cancelChildGenerations(
  record: WorkflowWorkerRecord,
  client: WorkflowExecutorClient,
  workerId: string,
  signal?: AbortSignal,
) {
  if (!client.cancelWorkflowGeneration) return;
  await Promise.all(
    record.definition.nodes.map(async (definition) => {
      const capability = definition.type.match(
        /^ai\.generate\.(text|image|video|audio)$/,
      )?.[1] as "text" | "image" | "video" | "audio" | undefined;
      const execution = record.state.nodes[definition.id];
      if (!capability || !execution?.attempt) return;
      await client.cancelWorkflowGeneration!(
        workerId,
        record.state.id,
        { nodeId: definition.id, attempt: execution.attempt, capability },
        signal,
      );
    }),
  );
}
