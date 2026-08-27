import type { GenerationJob } from "@infinite-canvas/contracts";
import { WorkerApiClient } from "./client.js";
import { nextPollDelay } from "./poll-policy.js";

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
        (input.handler || handleWithoutGateway)(
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
  signal?: AbortSignal;
}) {
  let idleBatches = 0;
  while (!input.signal?.aborted) {
    try {
      const claimed = await runWorkerCycle({
        client: input.client,
        workerId: input.workerId,
        limit: input.limit || 10,
        leaseMs: input.leaseMs || 90_000,
        handler: input.handler,
        signal: input.signal,
      });
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

async function handleWithoutGateway(
  job: GenerationJob,
  client: WorkerApiClient,
  workerId: string,
  signal?: AbortSignal,
) {
  if (job.phase === "cancel_requested") {
    await client.transition(workerId, job.id, "cancelled", {}, signal);
    return;
  }
  const current =
    job.phase === "claimed"
      ? await client.transition(workerId, job.id, "submitting", {}, signal)
      : job;
  await client.transition(
    workerId,
    current.id,
    "needs_review",
    {
      errorCode: "MODEL_GATEWAY_UNAVAILABLE",
      errorMessage: "Model Gateway 尚未配置，任务已转人工复核",
    },
    signal,
  );
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
