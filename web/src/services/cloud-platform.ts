import type { BillingEstimate, BillingLedgerEntry, BillingWallet, CanvasDocument, CanvasMutation, GenerationCapability, GenerationJob, LogicalModel, WorkflowDefinition } from "@infinite-canvas/contracts";

export type CloudUser = { id: string; email: string; name: string; createdAt: string };
export type CloudWorkspace = { id: string; name: string; createdAt: string; role: "owner" | "admin" | "editor" | "viewer" };
export type CloudWorkspaceRecord = Omit<CloudWorkspace, "role">;
export type CloudProject = {
    id: string;
    workspaceId: string;
    ownerId: string;
    document: CanvasDocument;
    createdAt: string;
    updatedAt: string;
};
export type CloudAsset = {
    id: string;
    workspaceId: string;
    mimeType: string;
    bytes: number;
    originalName: string;
    createdAt: string;
};
export type WorkflowCompileIssue = {
    code: string;
    severity: "error" | "warning";
    message: string;
    canvasNodeId?: string;
    canvasConnectionId?: string;
    workflowNodeId?: string;
    workflowEdgeId?: string;
    portId?: string;
};
export type CloudWorkflow = {
    id: string;
    workspaceId: string;
    projectId: string;
    name: string;
    currentVersion: number;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
};
export type CloudWorkflowVersion = {
    workflowId: string;
    version: number;
    projectRevision: number;
    publicationId: string;
    definition: unknown;
    sourceMapping: { nodes: Record<string, string>; edges: Record<string, string> };
    warnings: WorkflowCompileIssue[];
    publishedBy: string;
    createdAt: string;
};
export type CloudWorkflowPublication = { workflow: CloudWorkflow; version: CloudWorkflowVersion; replayed: boolean };
export type WorkflowPublishResult = {
    compile: { publishable: boolean; definition: unknown; sourceMapping: CloudWorkflowVersion["sourceMapping"]; issues: WorkflowCompileIssue[] };
    publication: CloudWorkflowPublication | null;
};
export type CloudWorkflowExecutionEvent = { sequence: number; type: string; createdAt: string; nodeId?: string; stepKey?: string; data?: Record<string, unknown> };
export type CloudWorkflowNodeExecution = {
    nodeId: string;
    status: "pending" | "ready" | "running" | "waiting" | "succeeded" | "failed" | "skipped" | "cancelled";
    attempt: number;
    maxAttempts: number;
    input?: unknown;
    output?: unknown;
    error?: { code: string; message: string };
    skipReason?: string;
    startedAt?: string;
    completedAt?: string;
    steps: Record<string, { status: string; attempt: number; input?: unknown; output?: unknown; error?: { code: string; message: string } }>;
};
export type CloudWorkflowExecution = {
    id: string;
    workflowId: string;
    workflowVersion: number;
    status: "queued" | "running" | "waiting" | "cancel_requested" | "succeeded" | "failed" | "cancelled";
    selectedNodeIds: string[];
    initialInputs: Record<string, unknown>;
    nodes: Record<string, CloudWorkflowNodeExecution>;
    events: CloudWorkflowExecutionEvent[];
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
};
export type CloudWorkflowExecutionRecord = {
    state: CloudWorkflowExecution;
    revision: number;
    workspaceId: string;
    createdBy: string;
    definition: WorkflowDefinition;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Envelope<T> = { data: T; requestId: string };

export class CloudApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly requestId?: string,
    ) {
        super(message);
    }
}

export class CloudPlatformClient {
    constructor(
        private readonly baseUrl = "",
        private readonly fetcher: FetchLike = fetch,
    ) {}

    register(input: { email: string; password: string; name: string }) {
        return this.request<{ user: CloudUser; workspace: CloudWorkspaceRecord }>("/api/v1/auth/register", { method: "POST", body: JSON.stringify(input) });
    }

    login(email: string, password: string) {
        return this.request<{ user: CloudUser }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    }

    logout() {
        return this.request<{ ok: true }>("/api/v1/auth/logout", { method: "POST" });
    }

    me() {
        return this.request<CloudUser>("/api/v1/me");
    }

    listWorkspaces() {
        return this.request<CloudWorkspace[]>("/api/v1/workspaces");
    }

    listProjects(workspaceId: string) {
        return this.request<CloudProject[]>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`);
    }

    createProject(workspaceId: string, title: string, projectId?: string, document?: CanvasDocument) {
        return this.request<CloudProject>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`, {
            method: "POST",
            body: JSON.stringify({ title, projectId, document }),
        });
    }

    getProject(projectId: string) {
        return this.request<CloudProject>(`/api/v1/projects/${encodeURIComponent(projectId)}`);
    }

    deleteProject(projectId: string) {
        return this.request<{ ok: true }>(`/api/v1/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    }

    mutateProject(projectId: string, mutation: CanvasMutation) {
        return this.request<{ project: CloudProject; replayed: boolean }>(`/api/v1/projects/${encodeURIComponent(projectId)}/mutations`, {
            method: "POST",
            body: JSON.stringify(mutation),
        });
    }

    publishWorkflow(projectId: string, input: { publicationId: string; expectedProjectRevision: number; name?: string; entryNodeIds?: string[] }) {
        return this.request<WorkflowPublishResult>(`/api/v1/projects/${encodeURIComponent(projectId)}/workflows/publish`, { method: "POST", body: JSON.stringify(input) }, [422]);
    }

    getProjectWorkflow(projectId: string) {
        return this.request<CloudWorkflowPublication | null>(`/api/v1/projects/${encodeURIComponent(projectId)}/workflow`);
    }

    listWorkflowVersions(workflowId: string) {
        return this.request<CloudWorkflowVersion[]>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/versions`);
    }

    listWorkflowExecutions(workflowId: string) {
        return this.request<CloudWorkflowExecutionRecord[]>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/executions`);
    }

    createWorkflowExecution(workflowId: string, input: { executionId: string; version?: number; startNodeIds?: string[]; initialInputs?: Record<string, unknown> }) {
        return this.request<{ record: CloudWorkflowExecutionRecord; replayed: boolean }>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/executions`, {
            method: "POST",
            body: JSON.stringify(input),
        });
    }

    getWorkflowExecution(executionId: string) {
        return this.request<CloudWorkflowExecutionRecord>(`/api/v1/workflow-executions/${encodeURIComponent(executionId)}`);
    }

    cancelWorkflowExecution(executionId: string) {
        return this.request<CloudWorkflowExecutionRecord>(`/api/v1/workflow-executions/${encodeURIComponent(executionId)}/cancel`, { method: "POST" });
    }

    retryWorkflowNode(executionId: string, nodeId: string) {
        return this.request<CloudWorkflowExecutionRecord>(`/api/v1/workflow-executions/${encodeURIComponent(executionId)}/nodes/${encodeURIComponent(nodeId)}/retry`, { method: "POST" });
    }

    listModels() {
        return this.request<LogicalModel[]>("/api/v1/models");
    }

    estimateGeneration(logicalModelId: string, capability: GenerationCapability, parameters: Record<string, unknown>) {
        return this.request<BillingEstimate>(`/api/v1/models/${encodeURIComponent(logicalModelId)}/estimate`, {
            method: "POST",
            body: JSON.stringify({ capability, parameters }),
        });
    }

    getBillingWallet() {
        return this.request<BillingWallet>("/api/v1/billing/wallet");
    }

    listBillingLedger() {
        return this.request<BillingLedgerEntry[]>("/api/v1/billing/ledger");
    }

    listGenerationJobs(workspaceId: string) {
        return this.request<GenerationJob[]>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/generation-jobs`);
    }

    async uploadAsset(workspaceId: string, blob: Blob, originalName: string, signal?: AbortSignal) {
        const response = await this.fetcher(`${this.baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/assets`, {
            method: "POST",
            credentials: "include",
            signal,
            headers: { "content-type": blob.type || "application/octet-stream", "x-file-name": originalName },
            body: blob,
        });
        const payload = (await response.json().catch(() => null)) as (Envelope<{ asset: CloudAsset; deduplicated: boolean }> & { error?: { code?: string; message?: string } }) | null;
        if (!response.ok) throw new CloudApiError(response.status, payload?.error?.code || "ASSET_UPLOAD_FAILED", payload?.error?.message || response.statusText, payload?.requestId);
        if (!payload?.data?.asset) throw new CloudApiError(response.status, "INVALID_RESPONSE", "Cloud API returned an invalid asset response");
        return payload.data;
    }

    createGenerationJob(
        workspaceId: string,
        input: {
            capability: GenerationCapability;
            logicalModelId: string;
            clientRequestId: string;
            parameters: Record<string, unknown>;
        },
        signal?: AbortSignal,
    ) {
        return this.request<{ job: GenerationJob; replayed: boolean }>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/generation-jobs`, {
            method: "POST",
            body: JSON.stringify(input),
            signal,
        });
    }

    getGenerationJob(jobId: string, signal?: AbortSignal) {
        return this.request<GenerationJob>(`/api/v1/generation-jobs/${encodeURIComponent(jobId)}`, { signal });
    }

    async openGenerationEvents(jobId: string, afterId = 0, signal?: AbortSignal) {
        const response = await this.fetcher(`${this.baseUrl}/api/v1/generation-jobs/${encodeURIComponent(jobId)}/events?after=${afterId}`, {
            credentials: "include",
            signal,
            headers: { accept: "text/event-stream" },
        });
        if (!response.ok) throw new CloudApiError(response.status, "GENERATION_EVENTS_FAILED", response.statusText);
        return response;
    }

    cancelGenerationJob(jobId: string, signal?: AbortSignal) {
        return this.request<GenerationJob>(`/api/v1/generation-jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", signal });
    }

    retryGenerationJob(jobId: string) {
        return this.request<GenerationJob>(`/api/v1/generation-jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
    }

    assetContentUrl(assetId: string) {
        return `${this.baseUrl}/api/v1/assets/${encodeURIComponent(assetId)}/content`;
    }

    async downloadAsset(assetId: string, signal?: AbortSignal) {
        const response = await this.fetcher(this.assetContentUrl(assetId), { credentials: "include", signal });
        if (!response.ok) throw new CloudApiError(response.status, "ASSET_DOWNLOAD_FAILED", response.statusText);
        return response.blob();
    }

    private async request<T>(path: string, init: RequestInit = {}, acceptedStatuses: readonly number[] = []): Promise<T> {
        const response = await this.fetcher(`${this.baseUrl}${path}`, {
            ...init,
            credentials: "include",
            headers: { "content-type": "application/json", ...init.headers },
        });
        const payload = (await response.json().catch(() => null)) as (Envelope<T> & { error?: { code?: string; message?: string } }) | null;
        if (!response.ok && !acceptedStatuses.includes(response.status)) {
            throw new CloudApiError(response.status, payload?.error?.code || "HTTP_ERROR", payload?.error?.message || response.statusText, payload?.requestId);
        }
        if (!payload || !("data" in payload)) throw new CloudApiError(response.status, "INVALID_RESPONSE", "Cloud API returned an invalid response");
        return payload.data;
    }
}

export const cloudPlatform = new CloudPlatformClient((import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "");
export const cloudModeEnabled = import.meta.env.VITE_PLATFORM_MODE === "server";
