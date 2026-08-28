import type { ModelCapability } from "@infinite-canvas/contracts";

export type ProviderSpecificAdapter =
  "seedance" | "stable-diffusion" | "media-kit";
type Input = {
  baseUrl: string;
  apiKey: string;
  capability: ModelCapability;
  upstreamModel: string;
  parameters: Record<string, unknown>;
  config: Record<string, unknown>;
  allowInsecure?: boolean;
};

export function buildProviderSpecificRequest(
  adapter: ProviderSpecificAdapter,
  input: Input,
) {
  if (!input.apiKey) throw new Error("Model channel credential is missing");
  if (adapter === "seedance")
    return json(
      input,
      path(input.config.submitPath, "/api/v3/contents/generations/tasks"),
      seedanceBody(input),
    );
  if (adapter === "stable-diffusion") {
    if (input.capability !== "image")
      throw new Error(
        "Stable Diffusion adapter only supports image capability",
      );
    const references = referenceImages(input.parameters);
    const endpoint = references.length
      ? "/sdapi/v1/img2img"
      : "/sdapi/v1/txt2img";
    return json(
      input,
      path(input.config.submitPath, endpoint),
      stableDiffusionBody(input, references),
    );
  }
  if (!["image", "video"].includes(input.capability))
    throw new Error(
      "Media Kit adapter only supports image or video capability",
    );
  return json(input, path(input.config.submitPath, "/v1/media/enhance"), {
    model: input.upstreamModel,
    capability: input.capability,
    ...withoutReserved(input.parameters),
  });
}

export function providerSpecificOperation(
  adapter: ProviderSpecificAdapter,
  input: Omit<Input, "capability" | "upstreamModel" | "parameters"> & {
    operation: "poll" | "cancel";
    taskId: string;
  },
) {
  if (adapter === "stable-diffusion")
    throw new Error("Stable Diffusion adapter is synchronous");
  const fallback =
    adapter === "seedance"
      ? `/api/v3/contents/generations/tasks/{taskId}${input.operation === "cancel" ? "/cancel" : ""}`
      : `/v1/media/tasks/{taskId}${input.operation === "cancel" ? "/cancel" : ""}`;
  const template = path(
    input.config[input.operation === "cancel" ? "cancelPath" : "pollPath"],
    fallback,
  );
  return {
    url: endpoint(
      input.baseUrl,
      template.replace("{taskId}", encodeURIComponent(input.taskId)),
      input.allowInsecure,
    ),
    init: {
      method: input.operation === "cancel" ? "POST" : "GET",
      headers: { authorization: `Bearer ${input.apiKey}` },
    } satisfies RequestInit,
  };
}

export function normalizeProviderSpecificPayload(
  adapter: ProviderSpecificAdapter,
  payload: Record<string, unknown>,
) {
  if (adapter === "stable-diffusion") {
    const images = Array.isArray(payload.images)
      ? payload.images.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return {
      ...payload,
      status: "succeeded",
      data: images.map((base64) => ({ base64 })),
    };
  }
  const data = object(payload.data);
  const task = object(data?.task) || data;
  const status = String(
    payload.status ?? task?.status ?? "succeeded",
  ).toLowerCase();
  const output = object(payload.output) || object(task?.output);
  const urls = [
    output?.url,
    ...(Array.isArray(output?.urls) ? output.urls : []),
  ].filter((value): value is string => typeof value === "string");
  return {
    ...payload,
    status,
    ...(urls.length ? { data: urls.map((url) => ({ url })) } : {}),
  };
}

function seedanceBody(input: Input) {
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: String(input.parameters.prompt || "") },
  ];
  for (const url of referenceImages(input.parameters))
    content.push({ type: "image_url", image_url: { url } });
  return {
    model: input.upstreamModel,
    content,
    ...withoutReserved(input.parameters),
  };
}
function stableDiffusionBody(input: Input, references: string[]) {
  const parameters = withoutReserved(input.parameters);
  return {
    prompt: String(input.parameters.prompt || ""),
    ...(references.length ? { init_images: references } : {}),
    ...(input.upstreamModel
      ? { override_settings: { sd_model_checkpoint: input.upstreamModel } }
      : {}),
    ...parameters,
  };
}
function referenceImages(parameters: Record<string, unknown>) {
  const source = parameters.images ?? parameters.references ?? [];
  return Array.isArray(source)
    ? source.flatMap((value) =>
        typeof value === "string"
          ? [value]
          : typeof object(value)?.url === "string"
            ? [object(value)!.url as string]
            : [],
      )
    : [];
}
function withoutReserved(parameters: Record<string, unknown>) {
  const {
    model: _model,
    prompt: _prompt,
    images: _images,
    references: _references,
    ...rest
  } = parameters;
  return rest;
}
function json(input: Input, pathname: string, body: Record<string, unknown>) {
  return {
    url: endpoint(input.baseUrl, pathname, input.allowInsecure),
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    } satisfies RequestInit,
  };
}
function path(value: unknown, fallback: string) {
  const result = value === undefined ? fallback : value;
  if (
    typeof result !== "string" ||
    !result.startsWith("/") ||
    result.includes("..") ||
    /[?#]/.test(result)
  )
    throw new Error("Provider path is unsafe");
  return result;
}
function endpoint(baseUrl: string, pathname: string, allowInsecure = false) {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Model channel URL cannot contain credentials, query, or fragment",
    );
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:"))
    throw new Error(
      "Model channel URL must use HTTPS unless explicitly enabled",
    );
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${pathname}`.replace(
    /\/{2,}/g,
    "/",
  );
  return url.toString();
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
