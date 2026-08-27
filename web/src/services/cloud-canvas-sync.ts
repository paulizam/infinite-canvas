import type { CanvasDocument, CanvasMutation, CanvasOperation } from "@infinite-canvas/contracts";
import { browserCanvasOperationQueue, type CanvasOperationQueue, type QueuedCanvasMutation } from "@/services/cloud-canvas-operation-queue";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CloudApiError, type CloudPlatformClient, type CloudProject } from "@/services/cloud-platform";

export type CloudSyncConflict = { projectId: string; mutationId: string; local: CanvasProject; remote: CanvasProject };
export type CloudConflictResolution = "accept_remote" | "keep_local_copy" | "retry_rebase";
export type CloudConflictResolutionResult = { remote: CanvasProject; localCopy?: CanvasProject };
export type CloudSyncEvent = { projectId?: string; state: "loading" | "ready" | "syncing" | "synced" | "offline" | "conflict" | "error"; message?: string; conflict?: CloudSyncConflict };
type SyncClient = Pick<CloudPlatformClient, "listProjects" | "getProject" | "createProject" | "mutateProject" | "deleteProject">;

export class CloudCanvasSyncEngine {
    private workspaceId = "";
    private revisions = new Map<string, number>();
    private synced = new Map<string, CanvasProject>();
    private latest = new Map<string, CanvasProject>();
    private chains = new Map<string, Promise<void>>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private conflicts = new Map<string, CloudSyncConflict>();
    private stopped = true;
    constructor(
        private readonly client: SyncClient,
        private readonly onEvent: (event: CloudSyncEvent) => void,
        private readonly debounceMs = 500,
        private readonly queue: CanvasOperationQueue = browserCanvasOperationQueue,
    ) {}

    async start(workspaceId: string, cachedProjects: CanvasProject[] = []): Promise<CanvasProject[]> {
        this.stop();
        this.stopped = false;
        this.workspaceId = workspaceId;
        this.latest = new Map(cachedProjects.map((project) => [project.id, project]));
        this.onEvent({ state: "loading" });
        const pending = await this.queue.list(workspaceId);
        try {
            const records = await this.client.listProjects(workspaceId);
            if (this.stopped || this.workspaceId !== workspaceId) return [];
            records.forEach((record) => this.seed(record));
            await this.replay(pending);
            const remaining = await this.queue.list(workspaceId);
            const projects = mergePendingProjects(
                records.map((record) => asProject(record.document)),
                remaining,
                this.conflicts,
                this.synced,
            );
            this.latest = new Map(projects.map((project) => [project.id, project]));
            this.onEvent({ state: this.conflicts.size ? "conflict" : "ready" });
            return projects;
        } catch (error) {
            if (this.stopped) return [];
            for (const entry of pending) {
                this.revisions.set(entry.projectId, entry.baseRevision);
                this.synced.set(entry.projectId, entry.baseDocument);
            }
            this.onEvent({ state: "offline", message: errorText(error) });
            return cachedProjects;
        }
    }
    reconnect() {
        return this.start(this.workspaceId, [...this.latest.values()]);
    }
    observe(projects: CanvasProject[]) {
        if (this.stopped) return;
        const nextIds = new Set(projects.map((project) => project.id));
        this.latest = new Map(projects.map((project) => [project.id, project]));
        for (const project of projects) {
            const base = this.synced.get(project.id);
            if (!this.conflicts.has(project.id) && (!base || fingerprint(project) !== fingerprint(base))) this.schedule(project.id);
        }
        for (const projectId of this.revisions.keys()) if (!nextIds.has(projectId)) this.enqueue(projectId, () => this.removeRemote(projectId));
    }
    async flush(projectId?: string) {
        for (const id of projectId ? [projectId] : [...this.latest.keys()]) {
            const timer = this.timers.get(id);
            if (timer) clearTimeout(timer);
            this.timers.delete(id);
            await this.enqueue(id, () => this.persistLatest(id));
        }
    }
    noteRemoteRevision(projectId: string, revision: number) {
        const current = this.revisions.get(projectId);
        if (current === undefined || revision > current) this.revisions.set(projectId, revision);
    }
    acceptSnapshot(project: CanvasProject) {
        this.revisions.set(project.id, project.revision);
        this.synced.set(project.id, project);
        this.conflicts.delete(project.id);
    }
    async resolveConflict(projectId: string, resolution: CloudConflictResolution): Promise<CloudConflictResolutionResult> {
        const conflict = this.conflicts.get(projectId);
        if (!conflict) throw new Error("CANVAS_CONFLICT_NOT_FOUND");
        const remote = asProject((await this.client.getProject(projectId)).document);
        if (resolution === "retry_rebase") {
            const entry = (await this.queue.list(this.workspaceId)).find((item) => item.mutationId === conflict.mutationId);
            if (!entry) throw new Error("CANVAS_CONFLICT_QUEUE_MISSING");
            if (!canRebase(entry.baseDocument, remote, entry.operations)) {
                const nextConflict = { ...conflict, remote };
                this.conflicts.set(projectId, nextConflict);
                this.onEvent({ projectId, state: "conflict", message: "CANVAS_REBASE_CONFLICT", conflict: nextConflict });
                return { remote };
            }
            this.conflicts.delete(projectId);
            await this.send({ ...entry, baseRevision: remote.revision, baseDocument: remote });
            return { remote: this.synced.get(projectId) || remote };
        }
        await this.queue.remove(this.workspaceId, conflict.mutationId);
        this.conflicts.delete(projectId);
        this.revisions.set(projectId, remote.revision);
        this.synced.set(projectId, remote);
        this.latest.set(projectId, remote);
        let localCopy: CanvasProject | undefined;
        if (resolution === "keep_local_copy") {
            const now = new Date().toISOString();
            localCopy = { ...conflict.local, id: crypto.randomUUID(), revision: 0, title: `${conflict.local.title} (Local copy)`, createdAt: now, updatedAt: now };
            this.latest.set(localCopy.id, localCopy);
        }
        this.onEvent({ projectId, state: "ready" });
        return { remote, localCopy };
    }
    stop() {
        this.stopped = true;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        this.revisions.clear();
        this.synced.clear();
        this.latest.clear();
        this.chains.clear();
        this.conflicts.clear();
    }

    private seed(record: CloudProject) {
        const project = asProject(record.document);
        this.revisions.set(record.id, project.revision);
        this.synced.set(record.id, project);
        this.conflicts.delete(record.id);
    }
    private schedule(projectId: string) {
        const previous = this.timers.get(projectId);
        if (previous) clearTimeout(previous);
        this.timers.set(
            projectId,
            setTimeout(() => {
                this.timers.delete(projectId);
                void this.enqueue(projectId, () => this.persistLatest(projectId));
            }, this.debounceMs),
        );
    }
    private enqueue(projectId: string, task: () => Promise<void>) {
        const chain = (this.chains.get(projectId) || Promise.resolve()).then(task, task);
        this.chains.set(projectId, chain);
        return chain.finally(() => {
            if (this.chains.get(projectId) === chain) this.chains.delete(projectId);
        });
    }
    private async persistLatest(projectId: string) {
        if (this.stopped || this.conflicts.has(projectId)) return;
        const project = this.latest.get(projectId);
        if (!project) return;
        const base = this.synced.get(projectId);
        if (!base) return this.createRemote(project);
        const operations = diffCanvasOperations(base, project);
        if (!operations.length) return;
        const entry: QueuedCanvasMutation = {
            mutationId: crypto.randomUUID(),
            workspaceId: this.workspaceId,
            projectId,
            baseRevision: this.revisions.get(projectId) ?? base.revision,
            baseDocument: base,
            localDocument: project,
            operations,
            createdAt: new Date().toISOString(),
        };
        await this.queue.put(entry);
        this.onEvent({ projectId, state: "syncing" });
        await this.send(entry);
    }
    private async send(entry: QueuedCanvasMutation) {
        try {
            const result = await this.client.mutateProject(entry.projectId, toMutation(entry));
            if (this.stopped) return;
            await this.queue.remove(this.workspaceId, entry.mutationId);
            const remote = asProject(result.project.document);
            this.revisions.set(entry.projectId, remote.revision);
            this.synced.set(entry.projectId, { ...entry.localDocument, revision: remote.revision, updatedAt: remote.updatedAt });
            this.onEvent({ projectId: entry.projectId, state: "synced" });
            const latest = this.latest.get(entry.projectId);
            if (latest && fingerprint(latest) !== fingerprint(this.synced.get(entry.projectId)!)) this.schedule(entry.projectId);
        } catch (error) {
            if (isConflict(error)) return this.rebase(entry);
            this.onEvent({ projectId: entry.projectId, state: "offline", message: errorText(error) });
        }
    }
    private async rebase(entry: QueuedCanvasMutation) {
        try {
            const remoteRecord = await this.client.getProject(entry.projectId);
            const remote = asProject(remoteRecord.document);
            if (!canRebase(entry.baseDocument, remote, entry.operations)) {
                const conflict = { projectId: entry.projectId, mutationId: entry.mutationId, local: entry.localDocument, remote };
                this.conflicts.set(entry.projectId, conflict);
                this.onEvent({ projectId: entry.projectId, state: "conflict", message: "CANVAS_REBASE_CONFLICT", conflict });
                return;
            }
            const rebased = { ...entry, baseRevision: remote.revision, baseDocument: remote };
            await this.queue.put(rebased);
            const result = await this.client.mutateProject(entry.projectId, toMutation(rebased));
            if (this.stopped) return;
            await this.queue.remove(this.workspaceId, entry.mutationId);
            const resultDocument = asProject(result.project.document);
            this.revisions.set(entry.projectId, resultDocument.revision);
            this.synced.set(entry.projectId, { ...entry.localDocument, revision: resultDocument.revision, updatedAt: resultDocument.updatedAt });
            this.onEvent({ projectId: entry.projectId, state: "synced" });
        } catch (error) {
            if (isConflict(error)) {
                const latestRemote = asProject((await this.client.getProject(entry.projectId)).document);
                const conflict = { projectId: entry.projectId, mutationId: entry.mutationId, local: entry.localDocument, remote: latestRemote };
                this.conflicts.set(entry.projectId, conflict);
                this.onEvent({ projectId: entry.projectId, state: "conflict", message: "CANVAS_REBASE_CONFLICT", conflict });
            } else this.onEvent({ projectId: entry.projectId, state: "offline", message: errorText(error) });
        }
    }
    private async replay(entries: QueuedCanvasMutation[]) {
        for (const entry of entries) {
            if (this.stopped) return;
            this.latest.set(entry.projectId, entry.localDocument);
            await this.send(entry);
        }
    }
    private async createRemote(project: CanvasProject) {
        this.onEvent({ projectId: project.id, state: "syncing" });
        try {
            const created = await this.client.createProject(this.workspaceId, project.title, project.id, toDocument(project));
            if (this.stopped) return;
            this.seed(created);
            this.onEvent({ projectId: project.id, state: "synced" });
        } catch (error) {
            this.onEvent({ projectId: project.id, state: "offline", message: errorText(error) });
        }
    }
    private async removeRemote(projectId: string) {
        if (this.stopped || !this.revisions.has(projectId)) return;
        try {
            await this.client.deleteProject(projectId);
            this.revisions.delete(projectId);
            this.synced.delete(projectId);
            this.onEvent({ projectId, state: "synced" });
        } catch (error) {
            this.onEvent({ projectId, state: "offline", message: errorText(error) });
        }
    }
}

export function diffCanvasOperations(base: CanvasProject, local: CanvasProject): CanvasOperation[] {
    const operations: CanvasOperation[] = [];
    const patch: Extract<CanvasOperation, { type: "document.patch" }>["patch"] = {};
    if (base.title !== local.title) patch.title = local.title;
    if (base.backgroundMode !== local.backgroundMode) patch.backgroundMode = local.backgroundMode;
    if (base.showImageInfo !== local.showImageInfo) patch.showImageInfo = local.showImageInfo;
    if (base.activeChatId !== local.activeChatId) patch.activeChatId = local.activeChatId;
    if (Object.keys(patch).length) operations.push({ type: "document.patch", patch });
    if (!same(base.viewport, local.viewport)) operations.push({ type: "viewport.set", viewport: local.viewport });
    const baseConnections = new Map(base.connections.map((item) => [item.id, item]));
    const localConnections = new Map(local.connections.map((item) => [item.id, item]));
    const removedConnections = [...baseConnections.keys()].filter((id) => !localConnections.has(id));
    if (removedConnections.length) operations.push({ type: "connection.remove", connectionIds: removedConnections });
    const baseNodes = new Map(base.nodes.map((item) => [item.id, item]));
    const localNodes = new Map(local.nodes.map((item) => [item.id, item]));
    const removedNodes = [...baseNodes.keys()].filter((id) => !localNodes.has(id));
    if (removedNodes.length) operations.push({ type: "node.remove", nodeIds: removedNodes });
    for (const node of local.nodes) if (!same(baseNodes.get(node.id), node)) operations.push({ type: "node.upsert", node: node as CanvasDocument["nodes"][number] });
    for (const connection of local.connections) if (!same(baseConnections.get(connection.id), connection)) operations.push({ type: "connection.upsert", connection });
    if (!same(base.chatSessions, local.chatSessions)) operations.push({ type: "document.sync", patch: { chatSessions: local.chatSessions } });
    return operations;
}

export function canRebase(base: CanvasProject, remote: CanvasProject, operations: CanvasOperation[]) {
    const baseNodes = new Map(base.nodes.map((item) => [item.id, item]));
    const remoteNodes = new Map(remote.nodes.map((item) => [item.id, item]));
    const baseConnections = new Map(base.connections.map((item) => [item.id, item]));
    const remoteConnections = new Map(remote.connections.map((item) => [item.id, item]));
    for (const operation of operations) {
        if (operation.type === "node.upsert" && !same(baseNodes.get(operation.node.id), remoteNodes.get(operation.node.id))) return false;
        if (operation.type === "node.remove" && operation.nodeIds.some((id) => !same(baseNodes.get(id), remoteNodes.get(id)))) return false;
        if (operation.type === "connection.upsert" && !same(baseConnections.get(operation.connection.id), remoteConnections.get(operation.connection.id))) return false;
        if (operation.type === "connection.remove" && operation.connectionIds.some((id) => !same(baseConnections.get(id), remoteConnections.get(id)))) return false;
        if (operation.type === "viewport.set" && !same(base.viewport, remote.viewport)) return false;
        if (operation.type === "document.patch" && Object.keys(operation.patch).some((key) => !same(base[key as keyof CanvasProject], remote[key as keyof CanvasProject]))) return false;
        if (operation.type === "document.sync" && Object.keys(operation.patch).some((key) => !same(base[key as keyof CanvasProject], remote[key as keyof CanvasProject]))) return false;
    }
    return true;
}

function toMutation(entry: QueuedCanvasMutation): CanvasMutation {
    return { mutationId: entry.mutationId, projectId: entry.projectId, baseRevision: entry.baseRevision, clientId: getCloudClientId(), createdAt: entry.createdAt, operations: entry.operations };
}
function mergePendingProjects(remote: CanvasProject[], pending: QueuedCanvasMutation[], conflicts: Map<string, CloudSyncConflict>, synced: Map<string, CanvasProject>) {
    const merged = new Map(remote.map((project) => [project.id, synced.get(project.id) || project]));
    for (const entry of pending) merged.set(entry.projectId, entry.localDocument);
    return [...merged.values()];
}
function asProject(document: CanvasDocument) {
    return document as unknown as CanvasProject;
}
function toDocument(project: CanvasProject) {
    return project as unknown as CanvasDocument;
}
function fingerprint(project: CanvasProject) {
    const { revision: _revision, updatedAt: _updatedAt, ...content } = project;
    return JSON.stringify(content);
}
function same(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function isConflict(error: unknown) {
    return error instanceof CloudApiError && error.code === "REVISION_CONFLICT";
}
function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
let clientId: string | undefined;
export function getCloudClientId() {
    return (clientId ||= crypto.randomUUID());
}
