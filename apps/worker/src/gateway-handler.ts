import type {
  GenerationJob,
  ModelCapability,
} from "@infinite-canvas/contracts";
import {
  buildOpenAiCompatibleRequest,
  openAiCompatibleEndpoint,
  validateModelParameters,
} from "@infinite-canvas/model-gateway";
import { WorkerApiClient, type WorkerResolvedModel } from "./client.js";

export function createModelGatewayHandler(fetcher: typeof fetch = fetch) {
  return async (
    job: GenerationJob,
    client: WorkerApiClient,
    workerId: string,
    signal?: AbortSignal,
  ) => {
    if (job.phase === "cancel_requested") {
      await client.transition(workerId, job.id, "cancelled", {}, signal);
      return;
    }
    try {
      if (job.phase === "submitted" || job.phase === "polling") {
        await poll(job, client, workerId, fetcher, signal);
        return;
      }
      await submit(job, client, workerId, fetcher, signal);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Model Gateway execution failed";
      await client.transition(
        workerId,
        job.id,
        "needs_review",
        { errorCode: "GATEWAY_EXECUTION_ERROR", errorMessage: message },
        signal,
      );
    }
  };
}

async function submit(
  job: GenerationJob,
  client: WorkerApiClient,
  workerId: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  const capability = job.capability === "agent" ? "text" : job.capability;
  const resolved = await client.resolveModel(
    capability,
    job.logicalModelId,
    signal,
  );
  const issues = validateModelParameters(
    resolved.binding.capabilityProfile,
    job.input,
  );
  if (issues.length) {
    await client.transition(
      workerId,
      job.id,
      "failed",
      {
        errorCode: "INVALID_MODEL_PARAMETERS",
        errorMessage: issues
          .map((issue) => `${issue.field}:${issue.code}`)
          .join(","),
      },
      signal,
    );
    return;
  }
  const submitting =
    job.phase === "claimed"
      ? await client.transition(workerId, job.id, "submitting", {}, signal)
      : job;
  if (resolved.protocol.adapter !== "openai-compatible")
    throw new Error(
      `Unsupported protocol adapter: ${resolved.protocol.adapter}`,
    );
  const request = buildOpenAiCompatibleRequest({
    baseUrl: resolved.channel.baseUrl,
    apiKey: resolved.apiKey,
    capability,
    upstreamModel: resolved.upstreamModel.modelId,
    parameters: job.input,
    allowInsecure: resolved.channel.config.allowInsecure === true,
  });
  const response = await fetcher(request.url, { ...request.init, signal });
  if (!response.ok)
    throw new Error(`Provider submit failed with HTTP ${response.status}`);
  const payload = await safeJson(response);
  const upstreamTaskId = taskId(payload);
  const status = upstreamStatus(payload);
  const submitted = await client.transition(
    workerId,
    submitting.id,
    "submitted",
    {
      upstreamTaskId,
      provider: resolved.protocol.adapter,
      channelId: resolved.channel.id,
      nextRunAt: new Date(Date.now() + 5_000).toISOString(),
    },
    signal,
  );
  if (upstreamTaskId && isPending(status)) {
    await client.transition(
      workerId,
      submitted.id,
      "polling",
      { nextRunAt: new Date(Date.now() + 5_000).toISOString() },
      signal,
    );
    return;
  }
  await complete(submitted, payload, client, workerId, signal);
}

async function poll(
  job: GenerationJob,
  client: WorkerApiClient,
  workerId: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  if (!job.upstreamTaskId || !job.channelId)
    throw new Error("Polling job has no immutable upstream identity");
  const capability = job.capability === "agent" ? "text" : job.capability;
  const resolved = await client.resolveModel(
    capability,
    job.logicalModelId,
    signal,
  );
  if (resolved.channel.id !== job.channelId)
    throw new Error("Resolved channel differs from submitted channel");
  const url = pollingUrl(resolved, capability, job.upstreamTaskId);
  const response = await fetcher(url, {
    method: "GET",
    signal,
    headers: { authorization: `Bearer ${resolved.apiKey}` },
  });
  if (!response.ok)
    throw new Error(`Provider poll failed with HTTP ${response.status}`);
  const payload = await safeJson(response);
  const status = upstreamStatus(payload);
  if (isPending(status)) {
    await client.transition(
      workerId,
      job.id,
      "polling",
      { nextRunAt: new Date(Date.now() + 10_000).toISOString() },
      signal,
    );
    return;
  }
  if (["failed", "error", "cancelled"].includes(status)) {
    await client.transition(
      workerId,
      job.id,
      "failed",
      {
        errorCode: "UPSTREAM_FAILED",
        errorMessage: `Upstream status: ${status}`,
      },
      signal,
    );
    return;
  }
  await complete(job, payload, client, workerId, signal);
}

async function complete(
  job: GenerationJob,
  payload: Record<string, unknown>,
  client: WorkerApiClient,
  workerId: string,
  signal?: AbortSignal,
) {
  const ready = await client.transition(
    workerId,
    job.id,
    "result_ready",
    { result: payload },
    signal,
  );
  const persisting = await client.transition(
    workerId,
    ready.id,
    "persisting",
    {},
    signal,
  );
  await client.transition(workerId, persisting.id, "succeeded", {}, signal);
}
function pollingUrl(
  resolved: WorkerResolvedModel,
  capability: ModelCapability,
  id: string,
) {
  const create = new URL(
    openAiCompatibleEndpoint(
      resolved.channel.baseUrl,
      capability,
      resolved.channel.config.allowInsecure === true,
    ),
  );
  create.pathname = `${create.pathname.replace(/\/(chat\/completions|images\/generations|videos\/generations|audio\/speech)$/i, "")}/videos/${encodeURIComponent(id)}`;
  return create.toString();
}
async function safeJson(response: Response) {
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Provider returned a malformed JSON object");
  return value as Record<string, unknown>;
}
function taskId(value: Record<string, unknown>) {
  const data =
    value.data && typeof value.data === "object"
      ? (value.data as Record<string, unknown>)
      : undefined;
  const id = value.id ?? value.task_id ?? value.taskId ?? data?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}
function upstreamStatus(value: Record<string, unknown>) {
  return String(
    value.status ??
      (value.data as Record<string, unknown> | undefined)?.status ??
      "succeeded",
  ).toLowerCase();
}
function isPending(status: string) {
  return [
    "queued",
    "pending",
    "submitted",
    "processing",
    "in_progress",
    "running",
  ].includes(status);
}
