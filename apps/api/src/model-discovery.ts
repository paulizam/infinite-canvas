import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DomainError } from "./domain.js";
import {
  parseVolcengineResourcePackages,
  signedVolcengineQuery,
  summarizeVolcengineResourcePackages,
} from "@infinite-canvas/model-gateway";
import type {
  ModelChannelRuntime,
  ModelGatewayRepository,
} from "./model-gateway-repository.js";

export type DiscoveredModel = { id: string; displayName?: string };

export class ModelDiscoveryService {
  constructor(
    private readonly repository: ModelGatewayRepository,
    private readonly fetcher: typeof fetch = fetch,
    private readonly resolveHost: (
      hostname: string,
    ) => Promise<string[]> = async (hostname) =>
      (await lookup(hostname, { all: true })).map((entry) => entry.address),
  ) {}

  async discover(channelId: string) {
    const runtime = await this.repository.channelRuntime(channelId);
    if (!runtime)
      throw new DomainError(
        "CHANNEL_RUNTIME_UNAVAILABLE",
        409,
        "渠道、协议或凭据未完整配置",
      );
    if (runtime.protocol.adapter === "volcengine") {
      const startedAt = Date.now();
      const inventory = await this.volcengineInventory(channelId, "models");
      return {
        channelId,
        adapter: runtime.protocol.adapter,
        models: parseModels(inventory.payload),
        latencyMs: Date.now() - startedAt,
      };
    }
    const request = await this.request(runtime);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetcher(request.url, {
        method: "GET",
        headers: request.headers,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new DomainError("MODEL_DISCOVERY_FAILED", 502, "无法连接模型渠道");
    }
    if (!response.ok)
      throw new DomainError(
        "MODEL_DISCOVERY_FAILED",
        502,
        `模型渠道返回 HTTP ${response.status}`,
      );
    const payload = await readJsonLimited(response, 2 * 1024 * 1024);
    const models = parseModels(payload);
    return {
      channelId,
      adapter: runtime.protocol.adapter,
      models,
      latencyMs: Date.now() - startedAt,
    };
  }

  async volcengineInventory(
    channelId: string,
    kind: "models" | "resources" | "usage",
  ) {
    const runtime = await this.repository.channelRuntime(channelId);
    if (!runtime || runtime.protocol.adapter !== "volcengine")
      throw new DomainError(
        "VOLCENGINE_CHANNEL_REQUIRED",
        409,
        "渠道未配置为 Volcengine AK/SK",
      );
    const config = { ...runtime.protocol.config, ...runtime.channel.config };
    const defaults = {
      models: "ListFoundationModels",
      resources: "ListResourcePackages",
      usage: "GetResourceUsage",
    } as const;
    const configured = config[`${kind}Action`];
    const request = signedVolcengineQuery({
      baseUrl: runtime.channel.baseUrl,
      secretAccessKey: runtime.apiKey,
      config,
      action: typeof configured === "string" ? configured : defaults[kind],
      version: typeof config.version === "string" ? config.version : undefined,
      allowInsecure: runtime.channel.config.allowInsecure === true,
    });
    await this.assertSafeUrl(
      new URL(request.url),
      runtime.channel.config.allowPrivateNetwork === true,
    );
    let response: Response;
    try {
      response = await this.fetcher(request.url, {
        ...request.init,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new DomainError(
        "VOLCENGINE_QUERY_FAILED",
        502,
        "无法连接 Volcengine 渠道",
      );
    }
    if (!response.ok)
      throw new DomainError(
        "VOLCENGINE_QUERY_FAILED",
        502,
        `Volcengine 渠道返回 HTTP ${response.status}`,
      );
    const payload = await readJsonLimited(response, 2 * 1024 * 1024);
    return {
      channelId,
      kind,
      payload,
      ...(kind === "resources"
        ? {
            resourcePackages: parseVolcengineResourcePackages(payload),
            resourceUsage: summarizeVolcengineResourcePackages(
              parseVolcengineResourcePackages(payload),
            ),
          }
        : {}),
    };
  }

  private async request(runtime: ModelChannelRuntime) {
    const url = new URL(runtime.channel.baseUrl);
    const basePath = url.pathname.replace(/\/+$/, "");
    const path = catalogPath(runtime);
    url.pathname =
      runtime.protocol.adapter === "openai-compatible" &&
      basePath.toLowerCase().endsWith("/v1")
        ? `${basePath}/models`
        : runtime.protocol.adapter === "gemini" &&
            basePath.toLowerCase().endsWith("/v1beta")
          ? `${basePath}/models`
          : `${basePath}${path}`.replace(/\/{2,}/g, "/");
    await this.assertSafeUrl(
      url,
      runtime.channel.config.allowPrivateNetwork === true,
    );
    const headers: Record<string, string> = {};
    if (runtime.protocol.adapter === "gemini")
      headers["x-goog-api-key"] = runtime.apiKey;
    else if (
      runtime.protocol.adapter === "custom" &&
      runtime.protocol.config.auth === "x-api-key"
    )
      headers["x-api-key"] = runtime.apiKey;
    else headers.authorization = `Bearer ${runtime.apiKey}`;
    return { url: url.toString(), headers };
  }

  private async assertSafeUrl(url: URL, allowPrivateNetwork: boolean) {
    if (allowPrivateNetwork) return;
    const addresses = isIP(url.hostname)
      ? [url.hostname]
      : await this.resolveHost(url.hostname).catch(() => []);
    if (!addresses.length || addresses.some(isPrivateAddress))
      throw new DomainError(
        "UNSAFE_CHANNEL_URL",
        400,
        "模型渠道地址不允许访问内网或保留地址",
      );
  }
}

async function readJsonLimited(
  response: Response,
  limit: number,
): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new DomainError("MODEL_CATALOG_TOO_LARGE", 502, "模型目录响应过大");
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit)
        throw new DomainError(
          "MODEL_CATALOG_TOO_LARGE",
          502,
          "模型目录响应过大",
        );
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(
      new TextDecoder().decode(concat(chunks, total)),
    ) as unknown;
  } catch {
    throw new DomainError(
      "MODEL_CATALOG_INVALID",
      502,
      "模型目录返回无效 JSON",
    );
  }
}

function concat(chunks: Uint8Array[], total: number) {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function catalogPath(runtime: ModelChannelRuntime) {
  if (runtime.protocol.adapter === "gemini") return "/v1beta/models";
  if (runtime.protocol.adapter === "openai-compatible") return "/v1/models";
  const value = runtime.protocol.config.modelCatalogPath;
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.includes("..") ||
    /[?#]/.test(value)
  )
    throw new DomainError(
      "MODEL_CATALOG_UNSUPPORTED",
      422,
      "Custom 协议未配置安全的模型目录路径",
    );
  return value;
}

function parseModels(value: unknown): DiscoveredModel[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const result =
    record.Result &&
    typeof record.Result === "object" &&
    !Array.isArray(record.Result)
      ? (record.Result as Record<string, unknown>)
      : undefined;
  const source = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : Array.isArray(result?.Models)
        ? result.Models
        : Array.isArray(result?.Items)
          ? result.Items
          : [];
  const models = source.flatMap((item): DiscoveredModel[] => {
    if (typeof item === "string" && item.trim())
      return [{ id: normalizeId(item) }];
    if (!item || typeof item !== "object") return [];
    const model = item as Record<string, unknown>;
    const raw = [model.id, model.name, model.modelId].find(
      (entry) => typeof entry === "string" && entry.trim(),
    ) as string | undefined;
    if (!raw) return [];
    const displayName =
      typeof model.displayName === "string" ? model.displayName : undefined;
    return [{ id: normalizeId(raw), ...(displayName ? { displayName } : {}) }];
  });
  return [...new Map(models.map((model) => [model.id, model])).values()].slice(
    0,
    10_000,
  );
}

function normalizeId(value: string) {
  return value
    .trim()
    .replace(/^models\//i, "")
    .slice(0, 500);
}

function isPrivateAddress(address: string) {
  if (
    address === "::1" ||
    address === "::" ||
    /^f[cd]/i.test(address) ||
    /^fe[89ab]/i.test(address)
  )
    return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) return false;
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}
