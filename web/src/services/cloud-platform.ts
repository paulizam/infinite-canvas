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
export type CloudProjectCheckpoint = {
    id: string;
    projectId: string;
    workspaceId: string;
    name: string;
    description: string;
    sourceRevision: number;
    snapshot: CanvasDocument;
    createdBy: string;
    createdAt: string;
};
export type CloudAsset = {
    id: string;
    workspaceId: string;
    mimeType: string;
    kind: "image" | "video" | "audio";
    bytes: number;
    originalName: string;
    createdAt: string;
};
export type OperationalPrompt = {
    id: string;
    title: string;
    content: string;
    category: string;
    tags: string[];
    targets: ("agent" | "canvas" | "drama")[];
    revision: number;
    updatedAt: string;
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
    projectId: string | null;
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
export type CloudWorkflowFolder = { id: string; workspaceId: string; name: string; createdAt: string; updatedAt: string };
export type CloudWorkflowLibraryMetadata = {
    workflowId: string;
    workspaceId: string;
    folderId: string | null;
    coverAssetId: string | null;
    description: string;
    tags: string[];
    isTemplate: boolean;
    updatedAt: string;
};
export type CloudWorkflowLibrary = {
    folders: CloudWorkflowFolder[];
    workflows: Array<{ workflow: CloudWorkflow; metadata: CloudWorkflowLibraryMetadata }>;
};
export type CloudWorkflowBundle = {
    format: "infinite-canvas.workflow";
    formatVersion: 1;
    exportedAt: string;
    workflow: { name: string; description: string; tags: string[] };
    version: { number: number; definition: WorkflowDefinition };
    checksum: string;
};
export type CloudWorkflowApiScope = "invoke" | "read_execution";
export type CloudWorkflowApiToken = {
    id: string;
    workflowId: string;
    workflowVersion: number;
    workspaceId: string;
    createdBy: string;
    name: string;
    tokenPrefix: string;
    scopes: CloudWorkflowApiScope[];
    rateLimitPerMinute: number;
    revokedAt: string | null;
    createdAt: string;
    lastUsedAt: string | null;
};
export type CloudWorkflowApiCredential = { token: CloudWorkflowApiToken; secret: string };
export type CloudWorkflowApiAuditEvent = { id: string; tokenId: string; tokenName: string; action: CloudWorkflowApiScope; executionId: string | null; requestId: string | null; createdAt: string };
export type CloudAgentSession = { id: string; workspaceId: string; projectId: string | null; createdBy: string; title: string; createdAt: string; updatedAt: string };
export type CloudAgentRun = {
    id: string;
    sessionId: string;
    workspaceId: string;
    createdBy: string;
    prompt: string;
    attachments: Array<{ assetId: string; kind: "image" | "video" | "audio" | "file" }>;
    modelId: string | null;
    parameters: Record<string, unknown>;
    skillPolicy: Record<string, unknown>;
    plan: unknown;
    status: "queued" | "claimed" | "running" | "waiting_approval" | "succeeded" | "failed" | "cancelled";
    attempt: number;
    maxAttempts: number;
    error: { code: string; message: string } | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
};
export type CloudAgentRunDetail = {
    run: CloudAgentRun;
    events: Array<{ sequence: number; type: string; data: Record<string, unknown>; createdAt: string }>;
    subtasks: Array<{ id: string; kind: string; title: string; status: string; output: unknown; error: unknown }>;
    results: Array<{ id: string; kind: string; payload: Record<string, unknown>; assetId: string | null }>;
    approvals: Array<{ id: string; action: "delete" | "batch_paid_generation" | "external_access"; status: "pending" | "approved" | "declined"; request: Record<string, unknown> }>;
};
export type CloudDramaProject = {
    id: string;
    workspaceId: string;
    ownerId: string;
    title: string;
    sourceText: string;
    sourceAssetId: string | null;
    revision: number;
    createdAt: string;
    updatedAt: string;
};
export type CloudDramaScriptVersion = {
    id: string;
    projectId: string;
    workspaceId: string;
    version: number;
    content: string;
    segments: unknown[];
    analysis: Record<string, unknown>;
    reviewStatus: "draft" | "reviewing" | "approved" | "rejected";
    operation: "import" | "revision" | "split" | "merge" | "analysis";
    createdBy: string;
    createdAt: string;
};
export type CloudDramaEntity = {
    id: string;
    projectId: string;
    workspaceId: string;
    kind: "character" | "scene" | "prop";
    name: string;
    description: string;
    prompt: string;
    referenceAssetId: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
};
export type CloudDramaShot = {
    id: string;
    projectId: string;
    workspaceId: string;
    title: string;
    prompt: string;
    framing: string;
    cameraMovement: string;
    durationMs: number;
    sortOrder: number;
    currentVersion: number;
    createdAt: string;
    updatedAt: string;
};
export type CloudDramaDetail = { project: CloudDramaProject; scripts: CloudDramaScriptVersion[]; entities: CloudDramaEntity[]; shots: CloudDramaShot[] };
export type CloudDramaGeneration = {
    id: string;
    projectId: string;
    workspaceId: string;
    shotId: string;
    generationJobId: string;
    capability: "image" | "video";
    selectedAssetId: string | null;
    selected: boolean;
    createdBy: string;
    createdAt: string;
};
export type CloudDramaTimelineItem = {
    id: string;
    projectId: string;
    workspaceId: string;
    shotId: string | null;
    kind: "dialogue" | "voice" | "bgm" | "subtitle";
    textContent: string;
    voice: string;
    assetId: string | null;
    startMs: number;
    endMs: number;
    sortOrder: number;
    createdBy: string;
    createdAt: string;
};
export type CloudDramaReview = {
    id: string;
    projectId: string;
    workspaceId: string;
    shotId: string;
    status: "pending" | "approved" | "changes_requested";
    comment: string;
    reviewerId: string;
    createdAt: string;
};
export type CloudDramaProductionState = { generations: CloudDramaGeneration[]; timeline: CloudDramaTimelineItem[]; reviews: CloudDramaReview[] };
export type CloudDramaProductionMutationResult = { revision: number; state: CloudDramaProductionState; replayed: boolean };
export type CloudDramaRenderJob = {
    id: string;
    projectId: string;
    workspaceId: string;
    ownerId: string;
    kind: "ffmpeg" | "jianying";
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    progress: number;
    attempt: number;
    retryOf: string | null;
    input: { assetIds: string[]; timeline: unknown[]; settings: Record<string, unknown> };
    outputAssetId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    workerId: string | null;
    leaseUntil: string | null;
    mutationId: string;
    createdAt: string;
    updatedAt: string;
};
export type CloudDramaRenderVersion = { id: string; projectId: string; workspaceId: string; renderJobId: string; version: number; kind: "ffmpeg" | "jianying"; assetId: string; createdBy: string; createdAt: string };
export type CloudDramaRenderState = { jobs: CloudDramaRenderJob[]; versions: CloudDramaRenderVersion[] };
export type CloudDramaMutationResult = { detail: CloudDramaDetail; replayed: boolean };
type DramaMutationBase = { expectedRevision: number; mutationId: string };
export type CloudDramaTransferTarget =
    | { type: "entity"; kind: CloudDramaEntity["kind"]; name: string; description?: string; prompt?: string; sortOrder: number }
    | { type: "timeline"; shotId?: string; kind: CloudDramaTimelineItem["kind"]; textContent?: string; voice?: string; startMs: number; endMs: number; sortOrder: number };

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

    installationStatus() {
        return this.request<{ installed: boolean }>("/api/v1/install/status");
    }

    install(input: { token: string; email: string; password: string; name: string }) {
        return this.request<{ user: CloudUser; workspace: CloudWorkspaceRecord }>("/api/v1/install", { method: "POST", body: JSON.stringify(input) });
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

    listProjectCheckpoints(projectId: string) {
        return this.request<CloudProjectCheckpoint[]>(`/api/v1/projects/${encodeURIComponent(projectId)}/checkpoints`);
    }

    createProjectCheckpoint(projectId: string, input: { name: string; description?: string }) {
        return this.request<CloudProjectCheckpoint>(`/api/v1/projects/${encodeURIComponent(projectId)}/checkpoints`, { method: "POST", body: JSON.stringify(input) });
    }

    getProjectCheckpoint(projectId: string, checkpointId: string) {
        return this.request<CloudProjectCheckpoint>(`/api/v1/projects/${encodeURIComponent(projectId)}/checkpoints/${encodeURIComponent(checkpointId)}`);
    }

    deleteProjectCheckpoint(projectId: string, checkpointId: string) {
        return this.request<{ ok: true }>(`/api/v1/projects/${encodeURIComponent(projectId)}/checkpoints/${encodeURIComponent(checkpointId)}`, { method: "DELETE" });
    }

    restoreProjectCheckpoint(projectId: string, checkpointId: string, expectedRevision: number) {
        return this.request<CloudProject>(`/api/v1/projects/${encodeURIComponent(projectId)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`, {
            method: "POST",
            body: JSON.stringify({ expectedRevision }),
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

    getWorkflowLibrary(workspaceId: string) {
        return this.request<CloudWorkflowLibrary>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/workflow-library`);
    }

    createWorkflowFolder(workspaceId: string, name: string) {
        return this.request<CloudWorkflowFolder>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/workflow-folders`, {
            method: "POST",
            body: JSON.stringify({ name }),
        });
    }

    deleteWorkflowFolder(folderId: string) {
        return this.request<{ ok: true }>(`/api/v1/workflow-folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
    }

    updateWorkflowLibrary(workflowId: string, patch: Partial<Pick<CloudWorkflowLibraryMetadata, "folderId" | "coverAssetId" | "description" | "tags" | "isTemplate">>) {
        return this.request<CloudWorkflowLibraryMetadata>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/library`, {
            method: "PATCH",
            body: JSON.stringify(patch),
        });
    }

    exportWorkflow(workflowId: string, version?: number) {
        const query = version ? `?version=${version}` : "";
        return this.request<CloudWorkflowBundle>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/export${query}`);
    }

    importWorkflow(workspaceId: string, bundle: CloudWorkflowBundle, name?: string) {
        return this.request<CloudWorkflowPublication>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/workflows/import`, {
            method: "POST",
            body: JSON.stringify({ bundle, ...(name ? { name } : {}) }),
        });
    }

    instantiateWorkflowTemplate(workflowId: string, name?: string) {
        return this.request<CloudWorkflowPublication>(`/api/v1/workflow-templates/${encodeURIComponent(workflowId)}/instantiate`, {
            method: "POST",
            body: JSON.stringify(name ? { name } : {}),
        });
    }

    listWorkflowApiTokens(workflowId: string) {
        return this.request<CloudWorkflowApiToken[]>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/api-tokens`);
    }

    listWorkflowApiAudit(workflowId: string, limit = 50) {
        return this.request<CloudWorkflowApiAuditEvent[]>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/api-audit?limit=${limit}`);
    }

    createWorkflowApiToken(workflowId: string, input: { name: string; scopes: CloudWorkflowApiScope[]; version?: number; rateLimitPerMinute: number }) {
        return this.request<CloudWorkflowApiCredential>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/api-tokens`, {
            method: "POST",
            body: JSON.stringify(input),
        });
    }

    rotateWorkflowApiToken(tokenId: string) {
        return this.request<CloudWorkflowApiCredential>(`/api/v1/workflow-api-tokens/${encodeURIComponent(tokenId)}/rotate`, { method: "POST" });
    }

    revokeWorkflowApiToken(tokenId: string) {
        return this.request<CloudWorkflowApiToken>(`/api/v1/workflow-api-tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" });
    }

    listAgentSessions(workspaceId: string) {
        return this.request<CloudAgentSession[]>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/agent-sessions`);
    }
    createAgentSession(workspaceId: string, input: { title: string; projectId?: string }) {
        return this.request<CloudAgentSession>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/agent-sessions`, { method: "POST", body: JSON.stringify(input) });
    }
    listAgentRuns(sessionId: string) {
        return this.request<CloudAgentRun[]>(`/api/v1/agent-sessions/${encodeURIComponent(sessionId)}/runs`);
    }
    createAgentRun(sessionId: string, input: { prompt: string; attachments?: CloudAgentRun["attachments"]; modelId?: string; parameters?: Record<string, unknown>; skillPolicy?: Record<string, unknown>; maxAttempts?: number }) {
        return this.request<CloudAgentRunDetail>(`/api/v1/agent-sessions/${encodeURIComponent(sessionId)}/runs`, { method: "POST", body: JSON.stringify(input) });
    }
    getAgentRun(runId: string) {
        return this.request<CloudAgentRunDetail>(`/api/v1/agent-runs/${encodeURIComponent(runId)}`);
    }
    cancelAgentRun(runId: string) {
        return this.request<CloudAgentRunDetail>(`/api/v1/agent-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    }
    retryAgentRun(runId: string) {
        return this.request<CloudAgentRunDetail>(`/api/v1/agent-runs/${encodeURIComponent(runId)}/retry`, { method: "POST" });
    }
    decideAgentApproval(approvalId: string, decision: "approved" | "declined") {
        return this.request<CloudAgentRunDetail>(`/api/v1/agent-approvals/${encodeURIComponent(approvalId)}/decision`, { method: "POST", body: JSON.stringify({ decision }) });
    }

    listDramaProjects(workspaceId: string) {
        return this.request<CloudDramaProject[]>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/drama-projects`);
    }
    createDramaProject(workspaceId: string, input: { title: string; sourceText?: string; sourceAssetId?: string }) {
        return this.request<CloudDramaDetail>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/drama-projects`, { method: "POST", body: JSON.stringify(input) });
    }
    getDramaProject(dramaId: string) {
        return this.request<CloudDramaDetail>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}`);
    }
    updateDramaProject(dramaId: string, input: DramaMutationBase & { title: string; sourceText?: string; sourceAssetId?: string | null }) {
        return this.request<CloudDramaMutationResult>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}`, { method: "PATCH", body: JSON.stringify(input) });
    }
    addDramaScriptVersion(dramaId: string, input: DramaMutationBase & { content: string; segments?: unknown[]; analysis?: Record<string, unknown>; reviewStatus: CloudDramaScriptVersion["reviewStatus"]; operation: Exclude<CloudDramaScriptVersion["operation"], "import"> }) {
        return this.request<CloudDramaMutationResult>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/script-versions`, { method: "POST", body: JSON.stringify(input) });
    }
    addDramaEntity(dramaId: string, input: DramaMutationBase & { kind: CloudDramaEntity["kind"]; name: string; description?: string; prompt?: string; referenceAssetId?: string; sortOrder: number }) {
        return this.request<CloudDramaMutationResult>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/entities`, { method: "POST", body: JSON.stringify(input) });
    }
    addDramaShot(dramaId: string, input: DramaMutationBase & { title: string; prompt?: string; framing?: string; cameraMovement?: string; durationMs: number; sortOrder: number }) {
        return this.request<CloudDramaMutationResult>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/shots`, { method: "POST", body: JSON.stringify(input) });
    }
    getDramaProduction(dramaId: string) {
        return this.request<CloudDramaProductionState>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/production`);
    }
    createDramaGeneration(dramaId: string, input: DramaMutationBase & { shotId: string; capability: "image" | "video"; logicalModelId: string; parameters: Record<string, unknown> }) {
        return this.request<CloudDramaProductionMutationResult>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/generations`, { method: "POST", body: JSON.stringify(input) });
    }
    selectDramaGeneration(dramaId: string, input: DramaMutationBase & { generationId: string; assetId: string }) {
        return this.request<CloudDramaProductionMutationResult>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/generation-selection`, { method: "POST", body: JSON.stringify(input) });
    }
    addDramaTimelineItem(dramaId: string, input: DramaMutationBase & { shotId?: string; kind: CloudDramaTimelineItem["kind"]; textContent?: string; voice?: string; assetId?: string; startMs: number; endMs: number; sortOrder: number }) {
        return this.request<CloudDramaProductionMutationResult>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/timeline`, { method: "POST", body: JSON.stringify(input) });
    }
    addDramaReview(dramaId: string, input: DramaMutationBase & { shotId: string; status: CloudDramaReview["status"]; comment?: string }) {
        return this.request<CloudDramaProductionMutationResult>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/reviews`, { method: "POST", body: JSON.stringify(input) });
    }
    listDramaRenders(dramaId: string) {
        return this.request<CloudDramaRenderState>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/renders`);
    }
    createDramaRender(dramaId: string, input: DramaMutationBase & { kind: CloudDramaRenderJob["kind"]; settings: Record<string, unknown> }) {
        return this.request<{ job: CloudDramaRenderJob; replayed: boolean }>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/renders`, { method: "POST", body: JSON.stringify(input) });
    }
    retryDramaRender(renderId: string, mutationId: string) {
        return this.request<CloudDramaRenderJob>(`/api/v1/drama-renders/${encodeURIComponent(renderId)}/retry`, { method: "POST", body: JSON.stringify({ mutationId }) });
    }
    sendDramaAssetToCanvas(dramaId: string, input: { canvasProjectId: string; assetId: string; expectedCanvasRevision: number; mutationId: string; title?: string; position: { x: number; y: number } }) {
        return this.request<{ node: unknown; mutation: { project: CloudProject; replayed: boolean } }>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/transfers/to-canvas`, { method: "POST", body: JSON.stringify(input) });
    }
    importDramaFromAsset(dramaId: string, input: { assetId: string; expectedDramaRevision: number; mutationId: string; target: CloudDramaTransferTarget }) {
        return this.request<CloudDramaMutationResult | CloudDramaProductionMutationResult>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/transfers/from-asset`, { method: "POST", body: JSON.stringify(input) });
    }
    importDramaFromCanvas(dramaId: string, input: { canvasProjectId: string; nodeId: string; expectedDramaRevision: number; mutationId: string; target: CloudDramaTransferTarget }) {
        return this.request<CloudDramaMutationResult | CloudDramaProductionMutationResult>(`/api/v1/drama-projects/${encodeURIComponent(dramaId)}/transfers/from-canvas`, { method: "POST", body: JSON.stringify(input) });
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

    listAssets(workspaceId: string) {
        return this.request<CloudAsset[]>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/assets`);
    }

    listOperationalPrompts(category?: string, tag?: string) {
        const query = new URLSearchParams();
        if (category?.trim()) query.set("category", category.trim());
        if (tag?.trim()) query.set("tag", tag.trim());
        return this.request<OperationalPrompt[]>(`/api/public/v1/prompts${query.size ? `?${query}` : ""}`);
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

export const cloudApiBaseUrl = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "";
export const cloudPlatform = new CloudPlatformClient(cloudApiBaseUrl);
export const cloudModeEnabled = import.meta.env.VITE_PLATFORM_MODE === "server";
