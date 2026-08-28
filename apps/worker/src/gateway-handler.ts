import type {
  AssetRef,
  GenerationJob,
  ModelCapability,
} from "@infinite-canvas/contracts";
import { validateModelParameters } from "@infinite-canvas/model-gateway";
import { WorkerApiClient } from "./client.js";
import {
  buildOperationRequest,
  buildSubmitRequest,
  buildStreamingSubmitRequest,
  binaryMediaResponse,
  extensionFor,
  isPending,
  normalizePayload,
  redactProviderError,
  safeJson,
  safeRemoteName,
  taskId,
  upstreamStatus,
} from "./provider-runtime.js";
import { materializeInputAssets } from "./input-asset-materializer.js";
import { consumeAndPersistTextStream } from "./provider-sse.js";
import { lookup } from "node:dns/promises";

type ResolveHost = (hostname: string) => Promise<string[]>;
const systemResolveHost: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

export function createModelGatewayHandler(
  fetcher: typeof fetch = fetch,
  resolveHost: ResolveHost = fetcher === fetch
    ? systemResolveHost
    : async () => ["203.0.113.10"],
) {
  return async (
    job: GenerationJob,
    client: WorkerApiClient,
    workerId: string,
    signal?: AbortSignal,
  ) => {
    try {
      if (job.phase === "cancel_requested") {
        await cancel(job, client, workerId, fetcher, signal);
        return;
      }
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
        await poll(job, client, workerId, fetcher, resolveHost, signal);
        return;
      }
      await submit(job, client, workerId, fetcher, resolveHost, signal);
    } catch (error) {
      const message =
        error instanceof Error
          ? redactProviderError(error.message).slice(0, 500)
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
  resolveHost: ResolveHost,
  signal?: AbortSignal,
) {
  const capability = job.capability === "agent" ? "text" : job.capability;
  const resolved = await client.resolveModel(
    capability,
    job.logicalModelId,
    undefined,
    signal,
  );
  const parameters = await materializeInputAssets(
    job.input,
    job,
    client,
    workerId,
    signal,
  );
  const issues = validateModelParameters(
    resolved.binding.capabilityProfile,
    parameters,
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
  const streamingRequest =
    capability === "text"
      ? buildStreamingSubmitRequest(resolved, parameters)
      : null;
  const request =
    streamingRequest || buildSubmitRequest(resolved, capability, parameters);
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
  if (
    streamingRequest &&
    (resolved.protocol.adapter === "openai-compatible" ||
      resolved.protocol.adapter === "gemini")
  ) {
    const submitted = await client.transition(
      workerId,
      submitting.id,
      "submitted",
      {
        provider: resolved.protocol.adapter,
        channelId: resolved.channel.id,
      },
      signal,
    );
    const payload = await consumeAndPersistTextStream({
      response,
      adapter: resolved.protocol.adapter,
      client,
      workerId,
      jobId: job.id,
      signal,
    });
    await complete(
      submitted,
      payload,
      capability,
      client,
      workerId,
      fetcher,
      signal,
    );
    await reportHealth(client, resolved.upstreamModel.id, "success", signal);
    return;
  }
  const binary = await binaryMediaResponse(response, capability);
  const rawPayload = binary ? {} : await safeJson(response);
  const payload = normalizePayload(resolved, rawPayload, capability);
  const upstreamTaskId = taskId(payload, resolved);
  const status = upstreamStatus(payload, resolved);
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
    resolveHost,
  );
  await reportHealth(client, resolved.upstreamModel.id, "success", signal);
}

async function poll(
  job: GenerationJob,
  client: WorkerApiClient,
  workerId: string,
  fetcher: typeof fetch,
  resolveHost: ResolveHost,
  signal?: AbortSignal,
) {
  if (!job.upstreamTaskId || !job.channelId)
    throw new Error("Polling job has no immutable upstream identity");
  const capability = job.capability === "agent" ? "text" : job.capability;
  const resolved = await client.resolveModel(
    capability,
    job.logicalModelId,
    job.channelId,
    signal,
  );
  if (resolved.channel.id !== job.channelId)
    throw new Error("Resolved channel differs from submitted channel");
  const request = buildOperationRequest(
    resolved,
    capability,
    "poll",
    job.upstreamTaskId,
  );
  let response: Response;
  try {
    response = await fetcher(request.url, { ...request.init, signal });
  } catch (error) {
    await reportHealth(client, resolved.upstreamModel.id, "failure", signal);
    throw error;
  }
  if (!response.ok) {
    await reportHealth(client, resolved.upstreamModel.id, "failure", signal);
    throw new Error(`Provider poll failed with HTTP ${response.status}`);
  }
  const payload = normalizePayload(
    resolved,
    await safeJson(response),
    capability,
  );
  const status = upstreamStatus(payload, resolved);
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
  await complete(
    job,
    payload,
    capability,
    client,
    workerId,
    fetcher,
    signal,
    undefined,
    resolveHost,
  );
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

async function cancel(
  job: GenerationJob,
  client: WorkerApiClient,
  workerId: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  if (!job.upstreamTaskId || !job.channelId) {
    await client.transition(workerId, job.id, "cancelled", {}, signal);
    return;
  }
  const capability = job.capability === "agent" ? "text" : job.capability;
  const resolved = await client.resolveModel(
    capability,
    job.logicalModelId,
    job.channelId,
    signal,
  );
  if (
    resolved.channel.id !== job.channelId ||
    !resolved.binding.capabilityProfile.supportsCancel
  ) {
    await client.transition(
      workerId,
      job.id,
      "needs_review",
      {
        errorCode: "UPSTREAM_CANCEL_UNSUPPORTED",
        errorMessage: "上游任务不支持可靠取消，需要人工复核消费状态",
      },
      signal,
    );
    return;
  }
  const request = buildOperationRequest(
    resolved,
    capability,
    "cancel",
    job.upstreamTaskId,
  );
  const response = await fetcher(request.url, { ...request.init, signal });
  if (!response.ok)
    throw new Error(`Provider cancel failed with HTTP ${response.status}`);
  await client.transition(workerId, job.id, "cancelled", {}, signal);
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
  resolveHost: ResolveHost = systemResolveHost,
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
            resolveHost,
          ),
          ...(providerUsage(payload)
            ? { providerUsage: providerUsage(payload) }
            : {}),
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
  const actualUnits = billingActualUnits(payload);
  await client.transition(
    workerId,
    persisting.id,
    "succeeded",
    actualUnits === undefined ? {} : { billingActualUnits: actualUnits },
    signal,
  );
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
  resolveHost: ResolveHost = systemResolveHost,
): Promise<AssetRef[]> {
  const artifacts = binary
    ? [{ bytes: binary, name: `${job.id}.${extensionFor(capability)}` }]
    : await materializeArtifacts(
        payload,
        capability,
        fetcher,
        resolveHost,
        signal,
      );
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
  resolveHost: ResolveHost,
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
        bytes: await downloadPublicMedia(url, fetcher, resolveHost, signal),
        name: safeRemoteName(url, capability, index),
      });
  }
  return artifacts;
}

async function downloadPublicMedia(
  value: string,
  fetcher: typeof fetch,
  resolveHost: ResolveHost,
  signal?: AbortSignal,
) {
  let url = publicMediaUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    await assertPublicMediaHost(url, resolveHost);
    const timeout = AbortSignal.timeout(30_000);
    const response = await fetcher(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "manual",
    });
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
    return readMediaLimited(response, 64 * 1024 * 1024);
  }
  throw new Error("Provider media redirect limit exceeded");
}

async function assertPublicMediaHost(url: URL, resolveHost: ResolveHost) {
  const addresses = await resolveHost(url.hostname);
  if (!addresses.length || addresses.some(isPrivateAddress))
    throw new Error("Provider media URL resolves to a private host");
}

function isPrivateAddress(value: string) {
  const host = value.toLowerCase().replace(/^::ffff:/, "");
  return (
    host === "::" ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe8") ||
    host.startsWith("fe9") ||
    host.startsWith("fea") ||
    host.startsWith("feb") ||
    /^(127\.|10\.|169\.254\.|192\.168\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

async function readMediaLimited(response: Response, limit: number) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new Error("Provider media exceeds 64MiB limit");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("Provider media exceeds 64MiB limit");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
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

function providerUsage(payload: Record<string, unknown>) {
  const usage = payload.usage ?? payload.usageMetadata;
  return usage && typeof usage === "object" && !Array.isArray(usage)
    ? (usage as Record<string, unknown>)
    : undefined;
}
function billingActualUnits(payload: Record<string, unknown>) {
  const usage = providerUsage(payload);
  const value = payload.billing_units ?? usage?.billing_units;
  const units = Number(value);
  return Number.isSafeInteger(units) && units >= 0 ? units : undefined;
}
