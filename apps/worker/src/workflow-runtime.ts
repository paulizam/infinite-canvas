import type { WorkerApiClient } from "./client.js";
import {
  executeWorkflow,
  type WorkflowNodeAdapters,
} from "./workflow-executor.js";
import type { WorkflowWorkerRecord } from "./workflow-types.js";

export type WorkflowHandler = (
  execution: WorkflowWorkerRecord,
  client: WorkerApiClient,
  workerId: string,
  signal?: AbortSignal,
) => Promise<unknown>;

export async function runWorkflowCycle(input: {
  client: WorkerApiClient;
  workerId: string;
  limit: number;
  leaseMs: number;
  handler?: WorkflowHandler;
  adapters?: WorkflowNodeAdapters;
  signal?: AbortSignal;
}) {
  const executions = await input.client.claimWorkflows(
    input.workerId,
    input.limit,
    input.leaseMs,
    input.signal,
  );
  const heartbeat = setInterval(
    () =>
      void input.client
        .heartbeatWorkflows(
          input.workerId,
          executions.map((execution) => execution.state.id),
          input.signal,
        )
        .catch((error) =>
          console.error(
            "workflow worker heartbeat failed",
            error instanceof Error ? error.message : error,
          ),
        ),
    Math.max(5_000, Math.floor(input.leaseMs / 3)),
  );
  heartbeat.unref?.();
  try {
    await Promise.all(
      executions.map((execution) =>
        input.handler
          ? input.handler(execution, input.client, input.workerId, input.signal)
          : executeWorkflow(
              execution,
              input.client,
              input.workerId,
              input.adapters,
              input.signal,
            ),
      ),
    );
  } finally {
    clearInterval(heartbeat);
  }
  return executions.length;
}
