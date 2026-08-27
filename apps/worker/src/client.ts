import type {
  GenerationJob,
  GenerationJobPhase,
} from "@infinite-canvas/contracts";

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
