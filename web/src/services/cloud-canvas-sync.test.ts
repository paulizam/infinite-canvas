import { describe, expect, it, vi } from "vitest";
import { CANVAS_SCHEMA_VERSION } from "@infinite-canvas/contracts";
import { CloudApiError, type CloudProject } from "./cloud-platform";
import { CloudCanvasSyncEngine, type CloudSyncEvent } from "./cloud-canvas-sync";
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
        createProject: vi.fn(async (_workspaceId: string, _title: string, _id?: string, document?: never) => cloud(document as unknown as CanvasProject)),
        mutateProject: vi.fn(async (id: string, mutation: { baseRevision: number }) => ({ project: cloud(project(id, "Saved", mutation.baseRevision + 1)), replayed: false })),
        deleteProject: vi.fn(async () => ({ ok: true as const })),
    };
}

describe("CloudCanvasSyncEngine", () => {
    it("loads a workspace and uses the remote revision independently from local revisions", async () => {
        const client = fakeClient([cloud(project())]);
        const engine = new CloudCanvasSyncEngine(client, vi.fn(), 0);
        await engine.start("w1");
        engine.observe([{ ...project(), title: "Changed", revision: 99 }]);
        await engine.flush("p1");
        expect(client.mutateProject).toHaveBeenCalledWith("p1", expect.objectContaining({ baseRevision: 2, operations: expect.arrayContaining([expect.objectContaining({ type: "document.patch", patch: { title: "Changed" } })]) }));
    });

    it("creates new cloud projects with the stable local id and snapshot", async () => {
        const client = fakeClient();
        const engine = new CloudCanvasSyncEngine(client, vi.fn(), 0);
        await engine.start("w1");
        engine.observe([project("local-nanoid")]);
        await engine.flush("local-nanoid");
        expect(client.createProject).toHaveBeenCalledWith("w1", "Canvas", "local-nanoid", expect.objectContaining({ id: "local-nanoid" }));
    });

    it("stops retrying a conflicted project without overwriting local content", async () => {
        const client = fakeClient([cloud(project())]);
        client.mutateProject.mockRejectedValue(new CloudApiError(409, "REVISION_CONFLICT", "conflict"));
        const events: CloudSyncEvent[] = [];
        const engine = new CloudCanvasSyncEngine(client, (event) => events.push(event), 0);
        await engine.start("w1");
        const changed = { ...project(), title: "Local" };
        engine.observe([changed]);
        await engine.flush("p1");
        engine.observe([{ ...changed, title: "Still local" }]);
        await engine.flush("p1");
        expect(client.mutateProject).toHaveBeenCalledTimes(1);
        expect(events.at(-1)?.state).toBe("conflict");
    });
});
