import type { CanvasDocument, CanvasMutation, CanvasOperation } from "@infinite-canvas/contracts";

import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CloudApiError, type CloudPlatformClient, type CloudProject } from "@/services/cloud-platform";

export type CloudSyncEvent = { projectId?: string; state: "loading" | "ready" | "syncing" | "synced" | "conflict" | "error"; message?: string };

export class CloudCanvasSyncEngine {
    private workspaceId = "";
    private revisions = new Map<string, number>();
    private fingerprints = new Map<string, string>();
    private latest = new Map<string, CanvasProject>();
    private chains = new Map<string, Promise<void>>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private conflicts = new Set<string>();
    private stopped = true;

    constructor(
        private readonly client: Pick<CloudPlatformClient, "listProjects" | "createProject" | "mutateProject" | "deleteProject">,
        private readonly onEvent: (event: CloudSyncEvent) => void,
        private readonly debounceMs = 500,
    ) {}

    async start(workspaceId: string): Promise<CanvasProject[]> {
        this.stop();
        this.stopped = false;
        this.workspaceId = workspaceId;
        this.onEvent({ state: "loading" });
        const projects = await this.client.listProjects(workspaceId);
        if (this.stopped || this.workspaceId !== workspaceId) return [];
        for (const project of projects) this.seed(project);
        this.onEvent({ state: "ready" });
        return projects.map((project) => project.document as unknown as CanvasProject);
    }

    observe(projects: CanvasProject[]) {
        if (this.stopped) return;
        const nextIds = new Set(projects.map((project) => project.id));
        this.latest = new Map(projects.map((project) => [project.id, project]));
        for (const project of projects) {
            if (!this.conflicts.has(project.id) && fingerprint(project) !== this.fingerprints.get(project.id)) this.schedule(project.id);
        }
        for (const projectId of this.revisions.keys()) {
            if (!nextIds.has(projectId)) this.enqueue(projectId, () => this.removeRemote(projectId));
        }
    }

    async flush(projectId?: string) {
        const ids = projectId ? [projectId] : [...this.latest.keys()];
        for (const id of ids) {
            const timer = this.timers.get(id);
            if (timer) clearTimeout(timer);
            this.timers.delete(id);
            await this.enqueue(id, () => this.persistLatest(id));
        }
    }

    stop() {
        this.stopped = true;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        this.revisions.clear();
        this.fingerprints.clear();
        this.latest.clear();
        this.chains.clear();
        this.conflicts.clear();
    }

    private seed(project: CloudProject) {
        this.revisions.set(project.id, project.document.revision);
        this.fingerprints.set(project.id, fingerprint(project.document as unknown as CanvasProject));
        this.conflicts.delete(project.id);
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
        const sentFingerprint = fingerprint(project);
        if (sentFingerprint === this.fingerprints.get(projectId)) return;
        this.onEvent({ projectId, state: "syncing" });
        try {
            if (!this.revisions.has(projectId)) {
                const created = await this.client.createProject(this.workspaceId, project.title, project.id, toDocument(project));
                if (this.stopped) return;
                this.seed(created);
            } else {
                const mutation: CanvasMutation = {
                    mutationId: crypto.randomUUID(),
                    projectId,
                    baseRevision: this.revisions.get(projectId)!,
                    clientId: getClientId(),
                    createdAt: new Date().toISOString(),
                    operations: snapshotOperations(project),
                };
                const result = await this.client.mutateProject(projectId, mutation);
                if (this.stopped) return;
                this.revisions.set(projectId, result.project.document.revision);
                this.fingerprints.set(projectId, sentFingerprint);
            }
            this.onEvent({ projectId, state: "synced" });
            const latest = this.latest.get(projectId);
            if (latest && fingerprint(latest) !== this.fingerprints.get(projectId)) this.schedule(projectId);
        } catch (error) {
            const conflict = error instanceof CloudApiError && error.code === "REVISION_CONFLICT";
            if (conflict) this.conflicts.add(projectId);
            this.onEvent({ projectId, state: conflict ? "conflict" : "error", message: error instanceof Error ? error.message : String(error) });
        }
    }

    private async removeRemote(projectId: string) {
        if (this.stopped || !this.revisions.has(projectId)) return;
        try {
            await this.client.deleteProject(projectId);
            this.revisions.delete(projectId);
            this.fingerprints.delete(projectId);
            this.onEvent({ projectId, state: "synced" });
        } catch (error) {
            this.onEvent({ projectId, state: "error", message: error instanceof Error ? error.message : String(error) });
        }
    }
}

function snapshotOperations(project: CanvasProject): CanvasOperation[] {
    return [
        { type: "document.patch", patch: { title: project.title } },
        {
            type: "document.sync",
            patch: {
                nodes: project.nodes as CanvasDocument["nodes"],
                connections: project.connections,
                chatSessions: project.chatSessions,
                activeChatId: project.activeChatId,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo,
                viewport: project.viewport,
            },
        },
    ];
}

function toDocument(project: CanvasProject) {
    return project as unknown as CanvasDocument;
}

function fingerprint(project: CanvasProject) {
    const { revision: _revision, updatedAt: _updatedAt, ...content } = project;
    return JSON.stringify(content);
}

let clientId: string | undefined;
function getClientId() {
    return (clientId ||= crypto.randomUUID());
}
