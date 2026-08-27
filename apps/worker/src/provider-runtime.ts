import type { ModelCapability } from "@infinite-canvas/contracts";
import {
  buildCustomProtocolRequest,
  buildGeminiRequest,
  buildOpenAiCompatibleRequest,
  openAiCompatibleEndpoint,
  parseCustomProtocolConfig,
  providerOperationRequest,
} from "@infinite-canvas/model-gateway";
import type { WorkerResolvedModel } from "./client.js";

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
  if (resolved.protocol.adapter === "custom")
    return buildCustomProtocolRequest({
      ...input,
      config: resolved.protocol.config,
    });
  return buildOpenAiCompatibleRequest(input);
}

export function buildOperationRequest(
  resolved: WorkerResolvedModel,
  capability: ModelCapability,
  operation: "poll" | "cancel",
  taskId: string,
) {
  if (resolved.protocol.adapter === "openai-compatible")
    return {
      url: openAiOperationUrl(resolved, capability, taskId, operation),
      init: {
        method: operation === "cancel" ? "POST" : "GET",
        headers: { authorization: `Bearer ${resolved.apiKey}` },
      } satisfies RequestInit,
    };
  return providerOperationRequest({
    baseUrl: resolved.channel.baseUrl,
    apiKey: resolved.apiKey,
    adapter: resolved.protocol.adapter,
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
  if (resolved.protocol.adapter !== "gemini") return payload;
  if (payload.done === false) return { ...payload, status: "processing" };
  const response = objectAt(payload, "response") || payload;
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
  const value = await response.json();
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
