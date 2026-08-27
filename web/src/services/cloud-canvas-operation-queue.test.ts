import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
}));

vi.mock("@/lib/localforage-storage", () => ({ localForageStorage: storage }));

import { BrowserCanvasOperationQueue, type QueuedCanvasCreate } from "./cloud-canvas-operation-queue";

const createCommand = (): QueuedCanvasCreate => ({
    kind: "create",
    commandId: "command-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    createdAt: "2026-08-28T00:00:00.000Z",
    project: { id: "project-1" } as QueuedCanvasCreate["project"],
});

describe("BrowserCanvasOperationQueue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        storage.getItem.mockResolvedValue(null);
        storage.setItem.mockResolvedValue(undefined);
        storage.removeItem.mockResolvedValue(undefined);
    });

    it("uses its in-process fallback when Web Locks is unavailable", async () => {
        vi.stubGlobal("navigator", {});
        const queue = new BrowserCanvasOperationQueue();

        await queue.put(createCommand());

        expect(storage.setItem).toHaveBeenCalledOnce();
    });

    it("serializes storage mutations through a workspace Web Lock", async () => {
        const request = vi.fn(async (_name: string, callback: (lock: object) => Promise<void>) => callback({}));
        vi.stubGlobal("navigator", { locks: { request } });
        const queue = new BrowserCanvasOperationQueue();

        await queue.put(createCommand());

        expect(request).toHaveBeenCalledWith("infinite-canvas:queue:workspace-1", expect.any(Function));
        expect(storage.setItem).toHaveBeenCalledOnce();
    });

    it("migrates legacy mutation entries to durable commands while reading", async () => {
        storage.getItem.mockResolvedValue(
            JSON.stringify([
                {
                    workspaceId: "workspace-1",
                    projectId: "project-1",
                    mutationId: "mutation-1",
                    createdAt: "2026-08-28T00:00:00.000Z",
                    baseRevision: 1,
                    baseDocument: {},
                    localDocument: {},
                    operations: [],
                },
            ]),
        );
        const queue = new BrowserCanvasOperationQueue();

        await expect(queue.list("workspace-1")).resolves.toMatchObject([
            { kind: "mutation", commandId: "mutation-1", mutationId: "mutation-1" },
        ]);
    });
});
