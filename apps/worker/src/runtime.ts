import type { GenerationJob } from "@infinite-canvas/contracts";
import { WorkerApiClient } from "./client.js";
import { nextPollDelay } from "./poll-policy.js";
import { createModelGatewayHandler } from "./gateway-handler.js";
import { runWorkflowCycle, type WorkflowHandler } from "./workflow-runtime.js";
import type { WorkflowNodeAdapters } from "./workflow-executor.js";
import { runScheduleTriggerCycle } from "./trigger-runtime.js";
import { runAgentCycle, type AgentRunHandler } from "./agent-runtime.js";
import { runDramaRenderCycle } from "./drama-render-runtime.js";

export type JobHandler = (
  job: GenerationJob,
  client: WorkerApiClient,
  workerId: string,
  signal?: AbortSignal,
) => Promise<void>;

export async function runWorkerCycle(input: {
  client: WorkerApiClient;
  workerId: string;
  limit: number;
  leaseMs: number;
  handler?: JobHandler;
  workflowHandler?: WorkflowHandler;
  workflowAdapters?: WorkflowNodeAdapters;
  signal?: AbortSignal;
}) {
  await input.client.heartbeat(input.workerId, [], input.signal);
  const jobs = await input.client.claim(
    input.workerId,
    input.limit,
    input.leaseMs,
    input.signal,
  );
  const heartbeat = setInterval(
    () =>
      void input.client
        .heartbeat(
          input.workerId,
          jobs.map((job) => job.id),
          input.signal,
        )
        .catch((error) =>
          console.error(
            "generation worker heartbeat failed",
            error instanceof Error ? error.message : error,
          ),
        ),
    Math.max(5_000, Math.floor(input.leaseMs / 3)),
  );
  heartbeat.unref?.();
  try {
    await Promise.all(
      jobs.map((job) =>
        (input.handler || createModelGatewayHandler())(
          job,
          input.client,
          input.workerId,
          input.signal,
        ),
      ),
    );
  } finally {
    clearInterval(heartbeat);
  }
  return jobs.length;
}

export async function runWorker(input: {
  client: WorkerApiClient;
  workerId: string;
  limit?: number;
  leaseMs?: number;
  baseDelayMs?: number;
  handler?: JobHandler;
  workflowHandler?: WorkflowHandler;
  workflowAdapters?: WorkflowNodeAdapters;
  agentHandler?: AgentRunHandler;
  ffmpegPath?: string;
  signal?: AbortSignal;
}) {
  let idleBatches = 0;
  while (!input.signal?.aborted) {
    try {
      const [
        generationClaimed,
        workflowClaimed,
        triggerClaimed,
        agentClaimed,
        renderClaimed,
      ] = await Promise.all([
        runWorkerCycle({
          client: input.client,
          workerId: input.workerId,
          limit: input.limit || 10,
          leaseMs: input.leaseMs || 90_000,
          handler: input.handler,
          signal: input.signal,
        }),
        runWorkflowCycle({
          client: input.client,
          workerId: input.workerId,
          limit: input.limit || 10,
          leaseMs: input.leaseMs || 90_000,
          handler: input.workflowHandler,
          adapters: input.workflowAdapters,
          signal: input.signal,
        }),
        runScheduleTriggerCycle({
          client: input.client,
          workerId: input.workerId,
          limit: input.limit || 10,
          leaseMs: input.leaseMs || 90_000,
          signal: input.signal,
        }),
        runAgentCycle({
          client: input.client,
          workerId: input.workerId,
          limit: input.limit || 10,
          leaseMs: input.leaseMs || 90_000,
          handler: input.agentHandler,
          signal: input.signal,
        }),
        runDramaRenderCycle({
          client: input.client,
          workerId: input.workerId,
          limit: input.limit || 10,
          leaseMs: input.leaseMs || 90_000,
          ffmpegPath: input.ffmpegPath,
          signal: input.signal,
        }),
      ]);
      const claimed =
        generationClaimed +
        workflowClaimed +
        triggerClaimed +
        agentClaimed +
        renderClaimed;
      const policy = nextPollDelay({
        claimed,
        idleBatches,
        baseDelayMs: input.baseDelayMs || 500,
      });
      idleBatches = policy.idleBatches;
      await sleep(policy.delayMs, input.signal);
    } catch (error) {
      if (input.signal?.aborted) break;
      console.error(
        "generation worker cycle failed",
        error instanceof Error ? error.message : error,
      );
      await sleep(
        Math.min(10_000, (input.baseDelayMs || 500) * 4),
        input.signal,
      );
    }
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
