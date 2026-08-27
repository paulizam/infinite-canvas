import type { WorkerApiClient } from "./client.js";

export async function runScheduleTriggerCycle(input: {
  client: WorkerApiClient;
  workerId: string;
  limit: number;
  leaseMs: number;
  signal?: AbortSignal;
}) {
  const triggers = await input.client.claimScheduleTriggers(
    input.workerId,
    input.limit,
    input.leaseMs,
    input.signal,
  );
  await Promise.all(
    triggers.map((trigger) =>
      input.client.dispatchScheduleTrigger(
        input.workerId,
        trigger.id,
        input.signal,
      ),
    ),
  );
  return triggers.length;
}
