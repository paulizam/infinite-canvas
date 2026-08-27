import type {
  AssetRef,
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
      if (job.phase === "result_ready") {
        const persisting = await client.transition(
          workerId,
          job.id,
          "persisting",
          {},
          signal,
        );
        await client.transition(
          workerId,
          persisting.id,
          "succeeded",
          {},
          signal,
        );
        return;
      }
      if (job.phase === "persisting") {
        await client.transition(workerId, job.id, "succeeded", {}, signal);
        return;
      }
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
  let response: Response;
  try {
    response = await fetcher(request.url, { ...request.init, signal });
  } catch (error) {
    await reportHealth(client, resolved.upstreamModel.id, "failure", signal);
    throw error;
  }
  if (!response.ok) {
    await reportHealth(client, resolved.upstreamModel.id, "failure", signal);
    throw new Error(`Provider submit failed with HTTP ${response.status}`);
  }
  const binary = await binaryMediaResponse(response, capability);
  const payload = binary ? {} : await safeJson(response);
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
    await reportHealth(client, resolved.upstreamModel.id, "success", signal);
    await client.transition(
      workerId,
      submitted.id,
      "polling",
      { nextRunAt: new Date(Date.now() + 5_000).toISOString() },
      signal,
    );
    return;
  }
  await complete(
    submitted,
    payload,
    capability,
    client,
    workerId,
    fetcher,
    signal,
    binary,
  );
  await reportHealth(client, resolved.upstreamModel.id, "success", signal);
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
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      signal,
      headers: { authorization: `Bearer ${resolved.apiKey}` },
    });
  } catch (error) {
    await reportHealth(client, resolved.upstreamModel.id, "failure", signal);
    throw error;
  }
  if (!response.ok) {
    await reportHealth(client, resolved.upstreamModel.id, "failure", signal);
    throw new Error(`Provider poll failed with HTTP ${response.status}`);
  }
  const payload = await safeJson(response);
  const status = upstreamStatus(payload);
  if (isPending(status)) {
    await reportHealth(client, resolved.upstreamModel.id, "success", signal);
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
    await reportHealth(client, resolved.upstreamModel.id, "failure", signal);
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
  await complete(job, payload, capability, client, workerId, fetcher, signal);
  await reportHealth(client, resolved.upstreamModel.id, "success", signal);
}

async function reportHealth(
  client: WorkerApiClient,
  upstreamModelId: string,
  outcome: "success" | "failure",
  signal?: AbortSignal,
) {
  await client
    .reportModelHealth(upstreamModelId, outcome, signal)
    .catch(() => undefined);
}

async function complete(
  job: GenerationJob,
  payload: Record<string, unknown>,
  capability: ModelCapability,
  client: WorkerApiClient,
  workerId: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
  binary?: Uint8Array,
) {
  const result =
    capability === "text"
      ? payload
      : {
          assets: await persistMediaResult(
            job,
            payload,
            capability,
            client,
            workerId,
            fetcher,
            signal,
            binary,
          ),
        };
  const ready = await client.transition(
    workerId,
    job.id,
    "result_ready",
    { result },
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

async function persistMediaResult(
  job: GenerationJob,
  payload: Record<string, unknown>,
  capability: Exclude<ModelCapability, "text">,
  client: WorkerApiClient,
  workerId: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
  binary?: Uint8Array,
): Promise<AssetRef[]> {
  const artifacts = binary
    ? [{ bytes: binary, name: `${job.id}.${extensionFor(capability)}` }]
    : await materializeArtifacts(payload, capability, fetcher, signal);
  if (!artifacts.length)
    throw new Error(`Provider returned no ${capability} artifact`);
  const refs: AssetRef[] = [];
  for (const artifact of artifacts)
    refs.push(
      await client.persistAsset(
        workerId,
        job.id,
        artifact.bytes,
        artifact.name,
        signal,
      ),
    );
  return refs;
}

async function materializeArtifacts(
  payload: Record<string, unknown>,
  capability: Exclude<ModelCapability, "text">,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  const items = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.output)
      ? payload.output
      : [payload];
  const artifacts: Array<{ bytes: Uint8Array; name: string }> = [];
  for (const [index, raw] of items.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const encoded = item.b64_json ?? item.base64 ?? item.audio;
    if (typeof encoded === "string" && encoded.trim()) {
      artifacts.push({
        bytes: Uint8Array.from(Buffer.from(encoded, "base64")),
        name: `${capability}-${index + 1}.${extensionFor(capability)}`,
      });
      continue;
    }
    const url = item.url ?? item.uri ?? item.download_url;
    if (typeof url === "string" && url.trim())
      artifacts.push({
        bytes: await downloadPublicMedia(url, fetcher, signal),
        name: safeRemoteName(url, capability, index),
      });
  }
  return artifacts;
}

async function downloadPublicMedia(
  value: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  let url = publicMediaUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(url, { signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3)
        throw new Error("Provider media redirect is invalid");
      url = publicMediaUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok)
      throw new Error(
        `Provider media download failed with HTTP ${response.status}`,
      );
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error("Provider media redirect limit exceeded");
}

function publicMediaUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Provider media URL must be credential-free HTTPS");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^(127\.|10\.|169\.254\.|192\.168\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
    throw new Error("Provider media URL targets a private host");
  return url;
}

async function binaryMediaResponse(
  response: Response,
  capability: ModelCapability,
) {
  if (capability !== "audio") return undefined;
  const type = response.headers.get("content-type")?.toLowerCase() || "";
  if (type.includes("json")) return undefined;
  return new Uint8Array(await response.arrayBuffer());
}

function extensionFor(capability: Exclude<ModelCapability, "text">) {
  return capability === "image"
    ? "png"
    : capability === "video"
      ? "mp4"
      : "mp3";
}
function safeRemoteName(
  value: string,
  capability: Exclude<ModelCapability, "text">,
  index: number,
) {
  const name = new URL(value).pathname.split("/").at(-1);
  return name && /^[a-zA-Z0-9._-]{1,160}$/.test(name)
    ? name
    : `${capability}-${index + 1}.${extensionFor(capability)}`;
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
