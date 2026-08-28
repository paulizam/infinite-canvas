import { describe, expect, it, vi } from "vitest";
import { CANVAS_SCHEMA_VERSION, type CanvasMutation } from "@infinite-canvas/contracts";
import { CloudApiError, type CloudProject } from "./cloud-platform";
import { canRebase, CloudCanvasSyncEngine, diffCanvasOperations, type CloudSyncEvent } from "./cloud-canvas-sync";
import type { CanvasOperationQueue, QueuedCanvasCommand } from "./cloud-canvas-operation-queue";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

function project(id = "p1", title = "Canvas", revision = 2): CanvasProject {
    const now = "2026-08-27T00:00:00.000Z";
    return { id, schemaVersion: CANVAS_SCHEMA_VERSION, revision, title, createdAt: now, updatedAt: now, nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
}
function cloud(document: CanvasProject): CloudProject {
    return { id: document.id, workspaceId: "w1", ownerId: "u1", document: document as never, createdAt: document.createdAt, updatedAt: document.updatedAt };
}
function fakeClient(initial: CloudProject[] = []) {
    return {
        listProjects: vi.fn(async () => initial),
        getProject: vi.fn(async (id: string) => initial.find((item) => item.id === id) || cloud(project(id))),
        createProject: vi.fn(async (_workspaceId: string, _title: string, _id?: string, document?: never) => cloud(document as unknown as CanvasProject)),
        mutateProject: vi.fn(async (id: string, mutation: CanvasMutation) => ({ project: cloud(project(id, "Saved", mutation.baseRevision + 1)), replayed: false })),
        deleteProject: vi.fn(async () => ({ ok: true as const })),
    };
}

class MemoryQueue implements CanvasOperationQueue {
    entries: QueuedCanvasCommand[] = [];
    async list(workspaceId: string) {
        return this.entries.filter((entry) => entry.workspaceId === workspaceId);
    }
    async put(entry: QueuedCanvasCommand) {
        this.entries = [...this.entries.filter((item) => item.commandId !== entry.commandId), entry];
    }
    async remove(workspaceId: string, commandId: string) {
        this.entries = this.entries.filter((entry) => entry.workspaceId !== workspaceId || entry.commandId !== commandId);
    }
}

describe("CloudCanvasSyncEngine", () => {
    it("[CAN-015] synchronizes project organization metadata", () => {
        const base = project();
        const operations = diffCanvasOperations(base, { ...base, folderId: "campaign", favorite: true, coverUrl: "https://cdn.example/cover.png", lastOpenedAt: "2026-08-28T00:00:00.000Z", templateId: "storyboard" });
        expect(operations).toEqual([{ type: "document.patch", patch: { folderId: "campaign", favorite: true, coverUrl: "https://cdn.example/cover.png", lastOpenedAt: "2026-08-28T00:00:00.000Z", templateId: "storyboard" } }]);
    });

    it("persists after the default 500ms quiet window [COL-003]", async () => {
        vi.useFakeTimers();
        try {
            const client = fakeClient([cloud(project())]);
            const engine = new CloudCanvasSyncEngine(client, vi.fn(), undefined, new MemoryQueue());
            await engine.start("w1");
            engine.observe([{ ...project(), title: "Debounced edit" }]);
            await vi.advanceTimersByTimeAsync(499);
            expect(client.mutateProject).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(client.mutateProject).toHaveBeenCalledTimes(1);
            engine.stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it("flushes debounced persistence before shutdown [COL-003]", async () => {
        const client = fakeClient([cloud(project())]);
        const engine = new CloudCanvasSyncEngine(client, vi.fn(), 60_000, new MemoryQueue());
        await engine.start("w1");
        engine.observe([{ ...project(), title: "Last client edit" }]);
        await engine.shutdown();
        expect(client.mutateProject).toHaveBeenCalledWith("p1", expect.objectContaining({ operations: expect.arrayContaining([expect.objectContaining({ type: "document.patch", patch: { title: "Last client edit" } })]) }));
    });

    it("loads a workspace and uses the remote revision independently from local revisions", async () => {
        const client = fakeClient([cloud(project())]);
        const engine = new CloudCanvasSyncEngine(client, vi.fn(), 0, new MemoryQueue());
        await engine.start("w1");
        engine.observe([{ ...project(), title: "Changed", revision: 99 }]);
        await engine.flush("p1");
        expect(client.mutateProject).toHaveBeenCalledWith("p1", expect.objectContaining({ baseRevision: 2, operations: expect.arrayContaining([expect.objectContaining({ type: "document.patch", patch: { title: "Changed" } })]) }));
    });

    it("creates new cloud projects with the stable local id and snapshot without mutating the local source [BAS-010]", async () => {
        const client = fakeClient();
        const engine = new CloudCanvasSyncEngine(client, vi.fn(), 0, new MemoryQueue());
        await engine.start("w1");
        engine.observe([project("local-nanoid")]);
        await engine.flush("local-nanoid");
        expect(client.createProject).toHaveBeenCalledWith("w1", "Canvas", "local-nanoid", expect.objectContaining({ id: "local-nanoid" }));
    });

    it("stops retrying a conflicted project without overwriting local content", async () => {
        const client = fakeClient([cloud(project())]);
        client.mutateProject.mockRejectedValue(new CloudApiError(409, "REVISION_CONFLICT", "conflict"));
        const events: CloudSyncEvent[] = [];
        const engine = new CloudCanvasSyncEngine(client, (event) => events.push(event), 0, new MemoryQueue());
        await engine.start("w1");
        const changed = { ...project(), title: "Local" };
        engine.observe([changed]);
        await engine.flush("p1");
        engine.observe([{ ...changed, title: "Still local" }]);
        await engine.flush("p1");
        expect(client.mutateProject).toHaveBeenCalledTimes(2);
        expect(events.at(-1)?.state).toBe("conflict");
    });

    it("writes before sending and replays the same mutation id after restart [COL-006]", async () => {
        const queue = new MemoryQueue();
        const offline = fakeClient([cloud(project())]);
        offline.mutateProject.mockRejectedValue(new Error("offline"));
        const first = new CloudCanvasSyncEngine(offline, vi.fn(), 0, queue);
        await first.start("w1");
        first.observe([{ ...project(), title: "Durable local" }]);
        await first.flush("p1");
        expect(queue.entries).toHaveLength(1);
        const queued = queue.entries[0];
        expect(queued.kind).toBe("mutation");
        const mutationId = queued.kind === "mutation" ? queued.mutationId : "";
        first.stop();
        const online = fakeClient([cloud(project())]);
        const second = new CloudCanvasSyncEngine(online, vi.fn(), 0, queue);
        const restored = await second.start("w1");
        expect(online.mutateProject).toHaveBeenCalledWith("p1", expect.objectContaining({ mutationId }));
        expect(queue.entries).toEqual([]);
        expect(restored[0].title).toBe("Durable local");
    });

    it("durably replays offline project creation and deletion", async () => {
        const createQueue = new MemoryQueue();
        const local = project("local-project");
        const offlineCreate = fakeClient();
        offlineCreate.createProject.mockRejectedValue(new Error("offline"));
        const creator = new CloudCanvasSyncEngine(offlineCreate, vi.fn(), 0, createQueue);
        await creator.start("w1");
        creator.observe([local]);
        await creator.flush(local.id);
        expect(createQueue.entries).toEqual([expect.objectContaining({ kind: "create", projectId: local.id })]);
        creator.stop();
        const onlineCreate = fakeClient();
        const resumedCreator = new CloudCanvasSyncEngine(onlineCreate, vi.fn(), 0, createQueue);
        const createdProjects = await resumedCreator.start("w1", [local]);
        expect(onlineCreate.createProject).toHaveBeenCalledWith("w1", local.title, local.id, expect.objectContaining({ id: local.id }));
        expect(createdProjects.map((item) => item.id)).toContain(local.id);
        expect(createQueue.entries).toEqual([]);

        const deleteQueue = new MemoryQueue();
        const offlineDelete = fakeClient([cloud(project())]);
        offlineDelete.deleteProject.mockRejectedValue(new Error("offline"));
        const deleter = new CloudCanvasSyncEngine(offlineDelete, vi.fn(), 0, deleteQueue);
        await deleter.start("w1");
        deleter.observe([]);
        await deleter.flush("p1");
        expect(deleteQueue.entries).toEqual([expect.objectContaining({ kind: "delete", projectId: "p1" })]);
        deleter.stop();
        const onlineDelete = fakeClient([cloud(project())]);
        const resumedDeleter = new CloudCanvasSyncEngine(onlineDelete, vi.fn(), 0, deleteQueue);
        const remaining = await resumedDeleter.start("w1");
        expect(onlineDelete.deleteProject).toHaveBeenCalledWith("p1");
        expect(remaining).toEqual([]);
        expect(deleteQueue.entries).toEqual([]);
    });

    it("never rewrites an unknown mutation payload and sends later edits only after confirmation", async () => {
        const queue = new MemoryQueue();
        const offline = fakeClient([cloud(project())]);
        offline.mutateProject.mockRejectedValue(new Error("unknown outcome"));
        const first = new CloudCanvasSyncEngine(offline, vi.fn(), 0, queue);
        await first.start("w1");
        first.observe([{ ...project(), title: "First edit" }]);
        await first.flush("p1");
        const firstCommand = queue.entries[0];
        first.observe([{ ...project(), title: "Second edit" }]);
        await first.flush("p1");
        expect(queue.entries).toEqual([firstCommand]);
        first.stop();

        const online = fakeClient([cloud(project())]);
        const resumed = new CloudCanvasSyncEngine(online, vi.fn(), 0, queue);
        const restored = await resumed.start("w1", [{ ...project(), title: "Second edit" }]);
        expect(restored[0].title).toBe("Second edit");
        resumed.observe(restored);
        await resumed.flush("p1");
        expect(online.mutateProject).toHaveBeenCalledTimes(2);
        const calls = online.mutateProject.mock.calls.map((call) => call[1]);
        expect(calls[0].mutationId).not.toBe(calls[1].mutationId);
        expect(calls[0].operations).toContainEqual(expect.objectContaining({ patch: { title: "First edit" } }));
        expect(calls[1].operations).toContainEqual(expect.objectContaining({ patch: { title: "Second edit" } }));
    });

    it("rebases disjoint edits but rejects edits to the same field [COL-006]", () => {
        const base = { ...project(), nodes: [{ id: "a", type: "text", title: "A", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "base" } }] } as CanvasProject;
        const local = { ...base, title: "Local title" };
        const operations = diffCanvasOperations(base, local);
        const unrelatedRemote = { ...base, nodes: [...base.nodes, { id: "b", type: "text", title: "B", position: { x: 1, y: 1 }, width: 100, height: 100 }] } as CanvasProject;
        expect(canRebase(base, unrelatedRemote, operations)).toBe(true);
        expect(canRebase(base, { ...base, title: "Remote title" }, operations)).toBe(false);
    });

    it("preserves local content as a new project when a user resolves a conflict [COL-006]", async () => {
        const queue = new MemoryQueue();
        const base = project();
        const remote = { ...base, revision: 3, title: "Remote title" };
        const client = fakeClient([cloud(base)]);
        client.mutateProject.mockRejectedValue(new CloudApiError(409, "REVISION_CONFLICT", "conflict"));
        client.getProject.mockResolvedValue(cloud(remote));
        const events: CloudSyncEvent[] = [];
        const engine = new CloudCanvasSyncEngine(client, (event) => events.push(event), 0, queue);
        await engine.start("w1");
        engine.observe([{ ...base, title: "Local title" }]);
        await engine.flush("p1");
        expect(events.at(-1)?.state).toBe("conflict");
        const result = await engine.resolveConflict("p1", "keep_local_copy");
        expect(result.remote.title).toBe("Remote title");
        expect(result.localCopy).toMatchObject({ title: "Local title (Local copy)", revision: 0 });
        expect(result.localCopy?.id).not.toBe("p1");
        expect(queue.entries).toEqual([]);
        expect(events.at(-1)?.state).toBe("ready");
    });
});
