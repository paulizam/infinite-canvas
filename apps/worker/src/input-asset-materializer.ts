import type { GenerationJob } from "@infinite-canvas/contracts";
import type { WorkerApiClient } from "./client.js";

const MAX_UNIQUE_ASSETS = 16;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export async function materializeInputAssets(
  value: unknown,
  job: GenerationJob,
  client: WorkerApiClient,
  workerId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const cache = new Map<string, Promise<string>>();
  let totalBytes = 0;
  const visit = async (input: unknown): Promise<unknown> => {
    if (Array.isArray(input)) return Promise.all(input.map(visit));
    if (!input || typeof input !== "object") return input;
    const record = input as Record<string, unknown>;
    if (typeof record.assetId === "string") {
      const cached = cache.get(record.assetId);
      if (cached) return cached;
      if (cache.size >= MAX_UNIQUE_ASSETS)
        throw new Error(
          "Generation input assets exceed the safe materialization limit",
        );
      const pending = (async () => {
        const asset = await client.readAsset(
          workerId,
          job.id,
          record.assetId as string,
          signal,
        );
        totalBytes += asset.bytes.byteLength;
        if (totalBytes > MAX_TOTAL_BYTES)
          throw new Error(
            "Generation input assets exceed the safe materialization limit",
          );
        return `data:${asset.mimeType};base64,${Buffer.from(asset.bytes).toString("base64")}`;
      })();
      cache.set(record.assetId, pending);
      return pending.catch((error) => {
        cache.delete(record.assetId as string);
        throw error;
      });
    }
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record))
      output[key] = await visit(child);
    return output;
  };
  return (await visit(value)) as Record<string, unknown>;
}
