import type {
  AssetRef,
  GenerationJob,
  GenerationJobPhase,
  ResolvedModelCandidate,
} from "@infinite-canvas/contracts";

export type WorkerResolvedModel = ResolvedModelCandidate & { apiKey: string };

export class WorkerApiClient {
  private readonly origin: string;
  constructor(
    origin: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(origin);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    )
      throw new Error(
        "WORKER_API_ORIGIN must be an HTTP(S) origin without credentials",
      );
    this.origin = url.origin;
    if (token.length < 32)
      throw new Error("WORKER_TOKEN must contain at least 32 characters");
  }
  claim(
    workerId: string,
    limit: number,
    leaseMs: number,
    signal?: AbortSignal,
  ) {
    return this.request<GenerationJob[]>(
      "/internal/v1/generation/claim",
      { workerId, limit, leaseMs },
      signal,
    );
  }
  heartbeat(workerId: string, jobIds: string[], signal?: AbortSignal) {
    return this.request<{ renewed: number }>(
      "/internal/v1/generation/heartbeat",
      { workerId, jobIds },
      signal,
    );
  }
  transition(
    workerId: string,
    jobId: string,
    phase: GenerationJobPhase,
    patch: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    return this.request<GenerationJob>(
      `/internal/v1/generation/jobs/${encodeURIComponent(jobId)}/transition`,
      { workerId, phase, patch },
      signal,
    );
  }
  resolveModel(
    capability: "text" | "image" | "video" | "audio",
    logicalModelId: string,
    signal?: AbortSignal,
  ) {
    return this.request<WorkerResolvedModel>(
      "/internal/v1/model-gateway/resolve",
      { capability, logicalModelId },
      signal,
    );
  }
  reportModelHealth(
    upstreamModelId: string,
    outcome: "success" | "failure",
    signal?: AbortSignal,
  ) {
    return this.request<{ accepted: true }>(
      "/internal/v1/model-gateway/health",
      { upstreamModelId, outcome },
      signal,
    );
  }
  async persistAsset(
    workerId: string,
    jobId: string,
    bytes: Uint8Array,
    originalName: string,
    signal?: AbortSignal,
  ): Promise<AssetRef> {
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    const response = await this.fetcher(
      new URL(
        `/internal/v1/generation/jobs/${encodeURIComponent(jobId)}/assets`,
        this.origin,
      ),
      {
        method: "POST",
        signal,
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/octet-stream",
          "x-worker-id": workerId,
          "x-file-name": originalName,
        },
        body: body.buffer,
      },
    );
    const payload = (await response.json()) as {
      data?: { asset: { id: string; mimeType: string } };
      error?: { code?: string; message?: string };
      requestId?: string;
    };
    if (!response.ok || !payload.data?.asset)
      throw new Error(
        `${payload.error?.code || "ASSET_PERSIST_ERROR"}: ${payload.error?.message || response.statusText} (${payload.requestId || "no-request-id"})`,
      );
    return {
      assetId: payload.data.asset.id,
      mimeType: payload.data.asset.mimeType,
    };
  }
  private async request<T>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.fetcher(new URL(path, this.origin), {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      data?: T;
      error?: { code?: string; message?: string };
      requestId?: string;
    };
    if (!response.ok || payload.data === undefined)
      throw new Error(
        `${payload.error?.code || "WORKER_API_ERROR"}: ${payload.error?.message || response.statusText} (${payload.requestId || "no-request-id"})`,
      );
    return payload.data;
  }
}
