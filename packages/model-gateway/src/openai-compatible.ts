import type { ModelCapability } from "@infinite-canvas/contracts";

const PATHS: Record<ModelCapability, string> = {
  text: "chat/completions",
  image: "images/generations",
  video: "videos/generations",
  audio: "audio/speech",
};

export function openAiCompatibleEndpoint(
  baseUrl: string,
  capability: ModelCapability,
  allowInsecure = false,
) {
  const url = new URL(baseUrl.trim());
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Model channel URL cannot contain credentials, query, or fragment",
    );
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:"))
    throw new Error(
      "Model channel URL must use HTTPS unless insecure transport is explicitly enabled",
    );
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath.toLowerCase().endsWith("/v1") ? basePath : `${basePath}/v1`}/${PATHS[capability]}`;
  return url.toString();
}

export function buildOpenAiCompatibleRequest(input: {
  baseUrl: string;
  apiKey: string;
  capability: ModelCapability;
  upstreamModel: string;
  parameters: Record<string, unknown>;
  allowInsecure?: boolean;
}) {
  if (!input.apiKey) throw new Error("Model channel credential is missing");
  return {
    url: openAiCompatibleEndpoint(
      input.baseUrl,
      input.capability,
      input.allowInsecure,
    ),
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...input.parameters, model: input.upstreamModel }),
    } satisfies RequestInit,
  };
}
