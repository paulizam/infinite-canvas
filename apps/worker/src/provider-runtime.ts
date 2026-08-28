import type { ModelCapability } from "@infinite-canvas/contracts";
import {
  buildCustomProtocolRequest,
  buildGeminiRequest,
  buildOpenAiCompatibleRequest,
  openAiCompatibleEndpoint,
  parseCustomProtocolConfig,
  providerOperationRequest,
  buildProviderSpecificRequest,
  providerSpecificOperation,
  normalizeProviderSpecificPayload,
  buildVolcengineRequest,
  buildVolcengineOperation,
  normalizeVolcenginePayload,
} from "@infinite-canvas/model-gateway";
import type { WorkerResolvedModel } from "./client.js";

const PROVIDER_REQUEST_TIMEOUT_MS = 120_000;
export const MAX_PROVIDER_JSON_BYTES = 64 * 1024 * 1024;

export function providerFetch(
  fetcher: typeof fetch,
  url: string | URL,
  init: RequestInit,
  signal?: AbortSignal,
) {
  const timeoutSignal = AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS);
  return fetcher(url, {
    ...init,
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
  });
}

export function buildSubmitRequest(
  resolved: WorkerResolvedModel,
  capability: ModelCapability,
  parameters: Record<string, unknown>,
) {
  const input = {
    baseUrl: resolved.channel.baseUrl,
    apiKey: resolved.apiKey,
    capability,
    upstreamModel: resolved.upstreamModel.modelId,
    parameters,
    allowInsecure: resolved.channel.config.allowInsecure === true,
  };
  if (resolved.protocol.adapter === "gemini") return buildGeminiRequest(input);
  if (resolved.protocol.adapter === "volcengine")
    return buildVolcengineRequest({
      ...input,
      secretAccessKey: resolved.apiKey,
      config: { ...resolved.protocol.config, ...resolved.channel.config },
    });
  if (
    ["seedance", "stable-diffusion", "media-kit"].includes(
      resolved.protocol.adapter,
    )
  )
    return buildProviderSpecificRequest(
      resolved.protocol.adapter as
        "seedance" | "stable-diffusion" | "media-kit",
      {
        ...input,
        config: { ...resolved.protocol.config, ...resolved.channel.config },
      },
    );
  if (resolved.protocol.adapter === "custom")
    return buildCustomProtocolRequest({
      ...input,
      config: resolved.protocol.config,
    });
  return buildOpenAiCompatibleRequest(input);
}

export function buildStreamingSubmitRequest(
  resolved: WorkerResolvedModel,
  parameters: Record<string, unknown>,
) {
  if (resolved.protocol.adapter === "custom") return null;
  const normalized = { ...parameters };
  if (normalized.reasoning_effort === "auto")
    delete normalized.reasoning_effort;
  const request = buildSubmitRequest(resolved, "text", normalized);
  if (resolved.protocol.adapter === "gemini") {
    const url = new URL(
      request.url.replace(":generateContent", ":streamGenerateContent"),
    );
    url.searchParams.set("alt", "sse");
    return { ...request, url: url.toString() };
  }
  const body = JSON.parse(String(request.init.body)) as Record<string, unknown>;
  return {
    ...request,
    init: {
      ...request.init,
      body: JSON.stringify({
        ...body,
        stream: true,
        stream_options: { include_usage: true },
      }),
    },
  };
}

export function buildOperationRequest(
  resolved: WorkerResolvedModel,
  capability: ModelCapability,
  operation: "poll" | "cancel",
  taskId: string,
) {
  if (resolved.protocol.adapter === "volcengine")
    return buildVolcengineOperation({
      baseUrl: resolved.channel.baseUrl,
      secretAccessKey: resolved.apiKey,
      taskId,
      operation,
      config: { ...resolved.protocol.config, ...resolved.channel.config },
      allowInsecure: resolved.channel.config.allowInsecure === true,
    });
  if (resolved.protocol.adapter === "openai-compatible")
    return {
      url: openAiOperationUrl(resolved, capability, taskId, operation),
      init: {
        method: operation === "cancel" ? "POST" : "GET",
        headers: { authorization: `Bearer ${resolved.apiKey}` },
      } satisfies RequestInit,
    };
  if (
    ["seedance", "stable-diffusion", "media-kit"].includes(
      resolved.protocol.adapter,
    )
  )
    return providerSpecificOperation(
      resolved.protocol.adapter as
        "seedance" | "stable-diffusion" | "media-kit",
      {
        baseUrl: resolved.channel.baseUrl,
        apiKey: resolved.apiKey,
        config: { ...resolved.protocol.config, ...resolved.channel.config },
        allowInsecure: resolved.channel.config.allowInsecure === true,
        operation,
        taskId,
      },
    );
  return providerOperationRequest({
    baseUrl: resolved.channel.baseUrl,
    apiKey: resolved.apiKey,
    adapter: resolved.protocol.adapter as "gemini" | "custom",
    operation,
    taskId,
    config: resolved.protocol.config,
    allowInsecure: resolved.channel.config.allowInsecure === true,
  });
}

export function normalizePayload(
  resolved: WorkerResolvedModel,
  payload: Record<string, unknown>,
  capability: ModelCapability,
) {
  if (resolved.protocol.adapter === "volcengine")
    return normalizeVolcenginePayload(payload);
  if (
    ["seedance", "stable-diffusion", "media-kit"].includes(
      resolved.protocol.adapter,
    )
  )
    return normalizeProviderSpecificPayload(
      resolved.protocol.adapter as
        "seedance" | "stable-diffusion" | "media-kit",
      payload,
    );
  if (resolved.protocol.adapter !== "gemini") return payload;
  if (payload.done === false) return { ...payload, status: "processing" };
  const response = objectAt(payload, "response") || payload;
  if (capability === "video") {
    const generated = objectAt(response, "generateVideoResponse");
    const samples = [
      ...(Array.isArray(generated?.generatedSamples)
        ? generated.generatedSamples
        : []),
      ...(Array.isArray(response.generatedVideos)
        ? response.generatedVideos
        : []),
    ];
    const data = samples.flatMap((sample) => {
      const video = objectAt(sample, "video");
      const url = video?.uri ?? video?.fileUri;
      return typeof url === "string" ? [{ url }] : [];
    });
    return { data, status: "succeeded" };
  }
  const candidates: unknown[] = Array.isArray(response.candidates)
    ? response.candidates
    : [];
  const parts: unknown[] = candidates.flatMap((candidate: unknown) => {
    const content = objectAt(candidate, "content");
    return Array.isArray(content?.parts) ? content.parts : [];
  });
  if (capability === "text")
    return {
      text: parts
        .map((part: unknown) => objectAt(part)?.text)
        .filter((text: unknown): text is string => typeof text === "string")
        .join(""),
      candidates,
      usageMetadata: response.usageMetadata,
    };
  const data: Array<{ base64?: string; url?: string }> = [];
  for (const part of parts) {
    const inline = objectAt(part, "inlineData");
    const file = objectAt(part, "fileData");
    if (typeof inline?.data === "string") data.push({ base64: inline.data });
    else if (typeof file?.fileUri === "string")
      data.push({ url: file.fileUri });
  }
  return { data, status: "succeeded" };
}

export async function safeJson(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_JSON_BYTES
  )
    throw new Error("Provider JSON response exceeds the size limit");

  if (!response.body)
    throw new Error("Provider returned a malformed JSON object");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_PROVIDER_JSON_BYTES) {
        await reader.cancel();
        throw new Error("Provider JSON response exceeds the size limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Provider JSON response exceeds the size limit"
    )
      throw error;
    throw new Error("Provider returned a malformed JSON object");
  } finally {
    reader.releaseLock();
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Provider returned a malformed JSON object");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Provider returned a malformed JSON object");
  return value as Record<string, unknown>;
}
export function taskId(
  value: Record<string, unknown>,
  resolved: WorkerResolvedModel,
) {
  if (resolved.protocol.adapter === "custom") {
    const config = parseCustomProtocolConfig(resolved.protocol.config);
    const mapped = valueAt(value, config.taskIdPath || "id");
    return typeof mapped === "string" && mapped.trim() ? mapped.trim() : null;
  }
  const data = objectAt(value, "data");
  const id =
    value.id ?? value.name ?? value.task_id ?? value.taskId ?? data?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}
export function upstreamStatus(
  value: Record<string, unknown>,
  resolved: WorkerResolvedModel,
) {
  if (resolved.protocol.adapter === "custom") {
    const config = parseCustomProtocolConfig(resolved.protocol.config);
    return String(
      valueAt(value, config.statusPath || "status") || "succeeded",
    ).toLowerCase();
  }
  return String(
    value.status ?? objectAt(value, "data")?.status ?? "succeeded",
  ).toLowerCase();
}
export function isPending(status: string) {
  return [
    "queued",
    "pending",
    "submitted",
    "processing",
    "in_progress",
    "running",
  ].includes(status);
}
export function redactProviderError(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(
      /\b(api[-_ ]?key|token|authorization)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    );
}

export async function binaryMediaResponse(
  response: Response,
  capability: ModelCapability,
) {
  if (capability !== "audio") return undefined;
  const type = response.headers.get("content-type")?.toLowerCase() || "";
  if (type.includes("json")) return undefined;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 64 * 1024 * 1024)
    throw new Error("Provider media exceeds 64MiB limit");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 64 * 1024 * 1024)
      throw new Error("Provider media exceeds 64MiB limit");
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export function extensionFor(capability: Exclude<ModelCapability, "text">) {
  return capability === "image"
    ? "png"
    : capability === "video"
      ? "mp4"
      : "mp3";
}
export function safeRemoteName(
  value: string,
  capability: Exclude<ModelCapability, "text">,
  index: number,
) {
  const name = new URL(value).pathname.split("/").at(-1);
  return name && /^[a-zA-Z0-9._-]{1,160}$/.test(name)
    ? name
    : `${capability}-${index + 1}.${extensionFor(capability)}`;
}

function openAiOperationUrl(
  resolved: WorkerResolvedModel,
  capability: ModelCapability,
  id: string,
  operation: "poll" | "cancel",
) {
  const url = new URL(
    openAiCompatibleEndpoint(
      resolved.channel.baseUrl,
      capability,
      resolved.channel.config.allowInsecure === true,
    ),
  );
  const root = url.pathname.replace(
    /\/(chat\/completions|images\/generations|videos\/generations|audio\/speech)$/i,
    "",
  );
  url.pathname = `${root}/videos/${encodeURIComponent(id)}${operation === "cancel" ? "/cancel" : ""}`;
  return url.toString();
}
function valueAt(value: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((current, key) => objectAt(current)?.[key], value);
}
function objectAt(
  value: unknown,
  key?: string,
): Record<string, unknown> | undefined {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const selected: unknown = key ? source?.[key] : value;
  return selected && typeof selected === "object" && !Array.isArray(selected)
    ? (selected as Record<string, unknown>)
    : undefined;
}
