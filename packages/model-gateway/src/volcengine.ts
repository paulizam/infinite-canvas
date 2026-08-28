import { createHash, createHmac } from "node:crypto";
import type { ModelCapability } from "@infinite-canvas/contracts";

export function buildVolcengineRequest(input: {
  baseUrl: string;
  secretAccessKey: string;
  capability: ModelCapability;
  upstreamModel: string;
  parameters: Record<string, unknown>;
  config: Record<string, unknown>;
  now?: Date;
  allowInsecure?: boolean;
}) {
  const { model: _model, ...parameters } = input.parameters;
  const body = JSON.stringify({
    Model: input.upstreamModel,
    Capability: input.capability,
    ...parameters,
  });
  return signedVolcengineRequest({
    ...input,
    body,
    method: "POST",
    action: stringValue(input.config.action, "SubmitTask"),
    version: stringValue(input.config.version, "2022-01-01"),
    path: safePath(input.config.submitPath, "/"),
  });
}

export function signedVolcengineQuery(input: {
  baseUrl: string;
  secretAccessKey: string;
  config: Record<string, unknown>;
  action: string;
  version?: string;
  now?: Date;
  allowInsecure?: boolean;
}) {
  return signedVolcengineRequest({
    ...input,
    method: "GET",
    action: input.action,
    version: input.version || "2022-01-01",
    path: "/",
    body: "",
  });
}

export function buildVolcengineOperation(input: {
  baseUrl: string;
  secretAccessKey: string;
  taskId: string;
  operation: "poll" | "cancel";
  config: Record<string, unknown>;
  now?: Date;
  allowInsecure?: boolean;
}) {
  const body = JSON.stringify({ TaskId: input.taskId });
  return signedVolcengineRequest({
    ...input,
    method: "POST",
    action: stringValue(
      input.config[
        input.operation === "cancel" ? "cancelAction" : "pollAction"
      ],
      input.operation === "cancel" ? "CancelTask" : "GetTask",
    ),
    version: stringValue(input.config.version, "2022-01-01"),
    path: safePath(input.config.operationPath, "/"),
    body,
  });
}

export function normalizeVolcenginePayload(payload: Record<string, unknown>) {
  const result =
    payload.Result &&
    typeof payload.Result === "object" &&
    !Array.isArray(payload.Result)
      ? (payload.Result as Record<string, unknown>)
      : payload;
  const taskId = result.TaskId ?? result.task_id ?? result.id;
  const status = String(
    result.Status ?? result.status ?? (taskId ? "processing" : "succeeded"),
  ).toLowerCase();
  const urls = [
    result.OutputUrl,
    result.Url,
    ...(Array.isArray(result.OutputUrls) ? result.OutputUrls : []),
  ].filter((value): value is string => typeof value === "string");
  return {
    ...payload,
    ...result,
    ...(typeof taskId === "string" ? { id: taskId } : {}),
    status,
    ...(urls.length ? { data: urls.map((url) => ({ url })) } : {}),
  };
}

function signedVolcengineRequest(input: {
  baseUrl: string;
  secretAccessKey: string;
  config: Record<string, unknown>;
  method: "GET" | "POST";
  action: string;
  version: string;
  path: string;
  body: string;
  now?: Date;
  allowInsecure?: boolean;
}) {
  const accessKeyId = stringValue(input.config.accessKeyId);
  if (!accessKeyId || !input.secretAccessKey)
    throw new Error("Volcengine AK/SK credential is incomplete");
  const region = stringValue(input.config.region, "cn-north-1");
  const service = stringValue(input.config.service, "ark");
  const url = safeBase(input.baseUrl, input.allowInsecure);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${input.path}`.replace(
    /\/{2,}/g,
    "/",
  );
  url.searchParams.set("Action", input.action);
  url.searchParams.set("Version", input.version);
  const xDate = (input.now || new Date())
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "");
  const shortDate = xDate.slice(0, 8);
  const contentType = "application/json";
  const canonicalQuery = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  const canonicalHeaders = `content-type:${contentType}\nhost:${url.host}\nx-date:${xDate}\n`;
  const signedHeaders = "content-type;host;x-date";
  const canonicalRequest = [
    input.method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    sha256(input.body),
  ].join("\n");
  const scope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = `HMAC-SHA256\n${xDate}\n${scope}\n${sha256(canonicalRequest)}`;
  const signingKey = hmac(
    hmac(
      hmac(hmac(`VOLC${input.secretAccessKey}`, shortDate), region),
      service,
    ),
    "request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");
  return {
    url: url.toString(),
    init: {
      method: input.method,
      headers: {
        authorization: `HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        "content-type": contentType,
        "x-date": xDate,
      },
      ...(input.method === "POST" ? { body: input.body } : {}),
    } satisfies RequestInit,
  };
}

function safeBase(value: string, allowInsecure = false) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Volcengine URL cannot contain credentials, query, or fragment",
    );
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:"))
    throw new Error("Volcengine URL must use HTTPS");
  return url;
}
function safePath(value: unknown, fallback: string) {
  const path = stringValue(value, fallback);
  if (!path.startsWith("/") || path.includes("..") || /[?#]/.test(path))
    throw new Error("Volcengine path is unsafe");
  return path;
}
function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}
