import type { ModelCapability } from "@infinite-canvas/contracts";

type RequestInput = {
  baseUrl: string;
  apiKey: string;
  capability: ModelCapability;
  upstreamModel: string;
  parameters: Record<string, unknown>;
  allowInsecure?: boolean;
};

export type CustomProtocolConfig = {
  submitPath: string;
  pollPath?: string;
  cancelPath?: string;
  auth?: "bearer" | "x-api-key";
  modelField?: string;
  parameterMap?: Record<string, string>;
  staticBody?: Record<string, unknown>;
  taskIdPath?: string;
  statusPath?: string;
};

export function buildGeminiRequest(input: RequestInput) {
  if (input.capability === "video") return buildGeminiVideoRequest(input);
  const url = providerEndpoint(
    input.baseUrl,
    `/v1beta/models/${encodeURIComponent(input.upstreamModel)}:generateContent`,
    input.allowInsecure,
  );
  const supplied = input.parameters.contents;
  const prompt = input.parameters.prompt;
  const contents = Array.isArray(supplied)
    ? supplied
    : [
        {
          role: "user",
          parts: [{ text: typeof prompt === "string" ? prompt : "" }],
        },
      ];
  const generationConfig = objectValue(input.parameters.generationConfig);
  if (input.capability === "image")
    generationConfig.responseModalities = ["TEXT", "IMAGE"];
  if (input.capability === "audio") {
    generationConfig.responseModalities = ["AUDIO"];
    const speechConfig = objectValue(input.parameters.speechConfig);
    if (Object.keys(speechConfig).length)
      generationConfig.speechConfig = speechConfig;
  }
  return jsonRequest(url, input.apiKey, "x-goog-api-key", {
    contents,
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    ...(input.parameters.systemInstruction
      ? { systemInstruction: input.parameters.systemInstruction }
      : {}),
  });
}

function buildGeminiVideoRequest(input: RequestInput) {
  const url = providerEndpoint(
    input.baseUrl,
    `/v1beta/models/${encodeURIComponent(input.upstreamModel)}:predictLongRunning`,
    input.allowInsecure,
  );
  const {
    prompt: _prompt,
    contents: _contents,
    model: _model,
    ...parameters
  } = input.parameters;
  return jsonRequest(url, input.apiKey, "x-goog-api-key", {
    instances: [
      {
        prompt:
          typeof input.parameters.prompt === "string"
            ? input.parameters.prompt
            : "",
      },
    ],
    parameters,
  });
}

export function buildCustomProtocolRequest(
  input: RequestInput & { config: Record<string, unknown> },
) {
  const config = parseCustomProtocolConfig(input.config);
  const body: Record<string, unknown> = { ...config.staticBody };
  const map = config.parameterMap || {};
  for (const [source, target] of Object.entries(map))
    if (Object.hasOwn(input.parameters, source))
      body[target] = input.parameters[source];
  body[config.modelField || "model"] = input.upstreamModel;
  return jsonRequest(
    providerEndpoint(input.baseUrl, config.submitPath, input.allowInsecure),
    input.apiKey,
    config.auth === "x-api-key" ? "x-api-key" : "authorization",
    body,
  );
}

export function providerOperationRequest(input: {
  baseUrl: string;
  apiKey: string;
  adapter: "gemini" | "custom";
  operation: "poll" | "cancel";
  taskId: string;
  config: Record<string, unknown>;
  allowInsecure?: boolean;
}) {
  if (input.adapter === "gemini") {
    const id = input.taskId.split("/").map(encodeURIComponent).join("/");
    return {
      url: providerEndpoint(
        input.baseUrl,
        `/v1beta/${id}${input.operation === "cancel" ? ":cancel" : ""}`,
        input.allowInsecure,
      ),
      init: {
        method: input.operation === "cancel" ? "POST" : "GET",
        headers: { "x-goog-api-key": input.apiKey },
      } satisfies RequestInit,
    };
  }
  const config = parseCustomProtocolConfig(input.config);
  const template =
    input.operation === "cancel" ? config.cancelPath : config.pollPath;
  if (!template)
    throw new Error(`Custom protocol has no ${input.operation} path`);
  const path = template.replace("{taskId}", encodeURIComponent(input.taskId));
  const header = config.auth === "x-api-key" ? "x-api-key" : "authorization";
  return {
    url: providerEndpoint(input.baseUrl, path, input.allowInsecure),
    init: {
      method: input.operation === "cancel" ? "POST" : "GET",
      headers: credentialHeader(header, input.apiKey),
    } satisfies RequestInit,
  };
}

export function parseCustomProtocolConfig(value: Record<string, unknown>) {
  const submitPath = pathTemplate(value.submitPath, false)!;
  const config: CustomProtocolConfig = {
    submitPath,
    pollPath: optionalPath(value.pollPath),
    cancelPath: optionalPath(value.cancelPath),
    auth:
      value.auth === "x-api-key" || value.auth === "bearer"
        ? value.auth
        : "bearer",
    modelField: fieldName(value.modelField, "model"),
    parameterMap: stringMap(value.parameterMap),
    staticBody: objectValue(value.staticBody),
    taskIdPath: dottedPath(value.taskIdPath, "id"),
    statusPath: dottedPath(value.statusPath, "status"),
  };
  return config;
}

function jsonRequest(
  url: string,
  apiKey: string,
  header: "authorization" | "x-api-key" | "x-goog-api-key",
  body: Record<string, unknown>,
) {
  if (!apiKey) throw new Error("Model channel credential is missing");
  return {
    url,
    init: {
      method: "POST",
      headers: {
        ...credentialHeader(header, apiKey),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    } satisfies RequestInit,
  };
}
function credentialHeader(header: string, key: string) {
  return { [header]: header === "authorization" ? `Bearer ${key}` : key };
}
function providerEndpoint(
  baseUrl: string,
  path: string,
  allowInsecure = false,
) {
  const base = new URL(baseUrl.trim());
  if (base.username || base.password || base.search || base.hash)
    throw new Error(
      "Model channel URL cannot contain credentials, query, or fragment",
    );
  if (
    base.protocol !== "https:" &&
    !(allowInsecure && base.protocol === "http:")
  )
    throw new Error(
      "Model channel URL must use HTTPS unless explicitly enabled",
    );
  if (!path.startsWith("/") || path.includes("..") || /[?#]/.test(path))
    throw new Error("Provider path must be an absolute safe path");
  base.pathname = `${base.pathname.replace(/\/+$/, "")}${path}`.replace(
    /\/{2,}/g,
    "/",
  );
  return base.toString();
}
function pathTemplate(value: unknown, optional: boolean) {
  if (optional && (value === undefined || value === null || value === ""))
    return undefined;
  if (typeof value !== "string" || !value.startsWith("/"))
    throw new Error("Custom protocol path is required");
  if (value.includes("..") || /[?#]/.test(value))
    throw new Error("Custom protocol path is unsafe");
  return value;
}
function optionalPath(value: unknown) {
  return pathTemplate(value, true);
}
function fieldName(value: unknown, fallback: string) {
  const field = value === undefined ? fallback : value;
  if (
    typeof field !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field) ||
    ["__proto__", "prototype", "constructor"].includes(field)
  )
    throw new Error("Custom protocol field name is invalid");
  return field;
}
function dottedPath(value: unknown, fallback: string) {
  const path = value === undefined ? fallback : value;
  if (
    typeof path !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,7}$/.test(path)
  )
    throw new Error("Custom protocol response path is invalid");
  return path;
}
function stringMap(value: unknown) {
  if (value === undefined) return {};
  const object = objectValue(value);
  return Object.fromEntries(
    Object.entries(object).map(([source, target]) => [
      fieldName(source, source),
      fieldName(target, ""),
    ]),
  );
}
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
