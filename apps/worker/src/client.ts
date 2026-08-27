import type {
  AssetRef,
  GenerationJob,
  GenerationJobPhase,
  ResolvedModelCandidate,
  AgentRemoteToolCall,
  AgentToolContext,
} from "@infinite-canvas/contracts";
import type {
  WorkflowWorkerOperation,
  WorkflowWorkerRecord,
} from "./workflow-types.js";
import type { AgentWorkerOperation, AgentWorkerRun } from "./agent-types.js";
import type { DramaRenderJob } from "./drama-render-types.js";

export type WorkerResolvedModel = ResolvedModelCandidate & { apiKey: string };
export type WorkerScheduleTrigger = {
  id: string;
  nextRunAt: string;
  kind: "schedule";
};

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
  claimDramaRenders(
    workerId: string,
    limit: number,
    leaseMs: number,
    signal?: AbortSignal,
  ) {
    return this.request<DramaRenderJob[]>(
      "/internal/v1/drama-render/claim",
      { workerId, limit, leaseMs },
      signal,
    );
  }
  heartbeatDramaRenders(
    workerId: string,
    renderIds: string[],
    signal?: AbortSignal,
  ) {
    return this.request<{ renewed: number }>(
      "/internal/v1/drama-render/heartbeat",
      { workerId, renderIds },
      signal,
    );
  }
  transitionDramaRender(
    workerId: string,
    id: string,
    status: "running" | "succeeded" | "failed" | "cancelled",
    patch: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    return this.request<DramaRenderJob>(
      `/internal/v1/drama-render/jobs/${encodeURIComponent(id)}/transition`,
      { workerId, status, patch },
      signal,
    );
  }
  async readDramaRenderAsset(
    workerId: string,
    id: string,
    assetId: string,
    signal?: AbortSignal,
  ) {
    const response = await this.fetcher(
      new URL(
        `/internal/v1/drama-render/jobs/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`,
        this.origin,
      ),
      {
        signal,
        headers: {
          authorization: `Bearer ${this.token}`,
          "x-worker-id": workerId,
        },
      },
    );
    if (!response.ok)
      throw new Error(`DRAMA_RENDER_ASSET_READ_ERROR: HTTP ${response.status}`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType:
        response.headers.get("content-type")?.split(";", 1)[0] ||
        "application/octet-stream",
    };
  }
  async persistDramaRenderOutput(
    workerId: string,
    id: string,
    bytes: Uint8Array,
    name: string,
    signal?: AbortSignal,
  ) {
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    const response = await this.fetcher(
      new URL(
        `/internal/v1/drama-render/jobs/${encodeURIComponent(id)}/output`,
        this.origin,
      ),
      {
        method: "POST",
        signal,
        headers: {
          authorization: `Bearer ${this.token}`,
          "x-worker-id": workerId,
          "x-file-name": name,
          "content-type": "application/octet-stream",
        },
        body: body.buffer,
      },
    );
    const payload = (await response.json()) as {
      data?: { asset: { id: string; mimeType: string } };
      error?: { code?: string; message?: string };
    };
    if (!response.ok || !payload.data)
      throw new Error(
        `${payload.error?.code || "DRAMA_RENDER_OUTPUT_ERROR"}: ${payload.error?.message || response.statusText}`,
      );
    return payload.data.asset;
  }
  claimWorkflows(
    workerId: string,
    limit: number,
    leaseMs: number,
    signal?: AbortSignal,
  ) {
    return this.request<WorkflowWorkerRecord[]>(
      "/internal/v1/workflow/claim",
      { workerId, limit, leaseMs },
      signal,
    );
  }
  heartbeatWorkflows(
    workerId: string,
    executionIds: string[],
    signal?: AbortSignal,
  ) {
    return this.request<{ renewed: number }>(
      "/internal/v1/workflow/heartbeat",
      { workerId, executionIds },
      signal,
    );
  }
  claimAgentRuns(
    workerId: string,
    limit: number,
    leaseMs: number,
    signal?: AbortSignal,
  ) {
    return this.request<AgentWorkerRun[]>(
      "/internal/v1/agent/claim",
      { workerId, limit, leaseMs },
      signal,
    );
  }
  heartbeatAgentRuns(
    workerId: string,
    runIds: string[],
    leaseMs = 90_000,
    signal?: AbortSignal,
  ) {
    return this.request<{ renewed: number }>(
      "/internal/v1/agent/heartbeat",
      { workerId, runIds, leaseMs },
      signal,
    );
  }
  transitionAgentRun(
    workerId: string,
    runId: string,
    operation: AgentWorkerOperation,
    signal?: AbortSignal,
  ) {
    return this.request<AgentWorkerRun>(
      `/internal/v1/agent/runs/${encodeURIComponent(runId)}/transition`,
      { workerId, operation },
      signal,
    );
  }
  getAgentToolContext(workerId: string, runId: string, signal?: AbortSignal) {
    return this.request<AgentToolContext>(
      `/internal/v1/agent/runs/${encodeURIComponent(runId)}/context`,
      { workerId },
      signal,
    );
  }
  executeAgentTool(
    workerId: string,
    runId: string,
    call: AgentRemoteToolCall,
    signal?: AbortSignal,
  ) {
    return this.request<{
      project: { document: { revision: number } };
      replayed: boolean;
    }>(
      `/internal/v1/agent/runs/${encodeURIComponent(runId)}/tools`,
      { workerId, call },
      signal,
    );
  }
  transitionWorkflow(
    workerId: string,
    executionId: string,
    revision: number,
    operation: WorkflowWorkerOperation,
    signal?: AbortSignal,
  ) {
    return this.request<WorkflowWorkerRecord>(
      `/internal/v1/workflow/executions/${encodeURIComponent(executionId)}/transition`,
      { workerId, revision, operation },
      signal,
    );
  }
  createWorkflowGeneration(
    workerId: string,
    executionId: string,
    input: {
      nodeId: string;
      attempt: number;
      capability: "text" | "image" | "video" | "audio";
      logicalModelId: string;
      parameters: Record<string, unknown>;
    },
    signal?: AbortSignal,
  ) {
    return this.request<{ job: GenerationJob; replayed: boolean }>(
      `/internal/v1/workflow/executions/${encodeURIComponent(executionId)}/generation`,
      { workerId, ...input },
      signal,
    );
  }
  cancelWorkflowGeneration(
    workerId: string,
    executionId: string,
    input: {
      nodeId: string;
      attempt: number;
      capability: "text" | "image" | "video" | "audio";
    },
    signal?: AbortSignal,
  ) {
    return this.request<GenerationJob | null>(
      `/internal/v1/workflow/executions/${encodeURIComponent(executionId)}/generation/cancel`,
      { workerId, ...input },
      signal,
    );
  }
  claimScheduleTriggers(
    workerId: string,
    limit: number,
    leaseMs: number,
    signal?: AbortSignal,
  ) {
    return this.request<WorkerScheduleTrigger[]>(
      "/internal/v1/workflow/triggers/schedules/claim",
      { workerId, limit, leaseMs },
      signal,
    );
  }
  dispatchScheduleTrigger(
    workerId: string,
    triggerId: string,
    signal?: AbortSignal,
  ) {
    return this.request(
      `/internal/v1/workflow/triggers/schedules/${encodeURIComponent(triggerId)}/dispatch`,
      { workerId },
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
  appendEvent(
    workerId: string,
    jobId: string,
    type: "text.delta" | "text.reasoning.delta",
    delta: string,
    signal?: AbortSignal,
  ) {
    return this.request(
      `/internal/v1/generation/jobs/${encodeURIComponent(jobId)}/events`,
      { workerId, type, delta },
      signal,
    );
  }
  resolveModel(
    capability: "text" | "image" | "video" | "audio",
    logicalModelId: string,
    preferredChannelId?: string,
    signal?: AbortSignal,
  ) {
    return this.request<WorkerResolvedModel>(
      "/internal/v1/model-gateway/resolve",
      { capability, logicalModelId, preferredChannelId },
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
  async readAsset(
    workerId: string,
    jobId: string,
    assetId: string,
    signal?: AbortSignal,
  ) {
    const response = await this.fetcher(
      new URL(
        `/internal/v1/generation/jobs/${encodeURIComponent(jobId)}/assets/${encodeURIComponent(assetId)}`,
        this.origin,
      ),
      {
        method: "GET",
        signal,
        headers: {
          authorization: `Bearer ${this.token}`,
          "x-worker-id": workerId,
        },
      },
    );
    if (!response.ok)
      throw new Error(`ASSET_READ_ERROR: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mimeType =
      response.headers.get("content-type")?.split(";", 1)[0] ||
      "application/octet-stream";
    return { bytes, mimeType };
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
