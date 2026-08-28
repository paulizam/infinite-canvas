import { beforeEach, describe, expect, it, vi } from "vitest";
import { canvasStorageName } from "@/lib/canvas/canvas-storage-scope";

const persisted = vi.hoisted(() => new Map<string, string>());
vi.mock("@/i18n", () => ({ default: { t: () => "Untitled" } }));
vi.mock("@/services/cloud-platform", () => ({ cloudModeEnabled: false }));
vi.mock("@/lib/localforage-storage", () => ({
    localForageStorage: {
        getItem: vi.fn(async (key: string) => persisted.get(key) || null),
        setItem: vi.fn(async (key: string, value: string) => void persisted.set(key, value)),
        removeItem: vi.fn(async (key: string) => void persisted.delete(key)),
    },
}));

import { useCanvasStore } from "./use-canvas-store";

describe("canvas storage namespace", () => {
    it("keeps Local mode on the legacy key", () => expect(canvasStorageName("canvas", false, null)).toBe("canvas"));
    it("isolates every Server workspace", () => {
        expect(canvasStorageName("canvas", true, "workspace-a")).toBe("canvas:cloud:workspace-a");
        expect(canvasStorageName("canvas", true, "workspace-b")).toBe("canvas:cloud:workspace-b");
    });
});

describe("[BAS-002][CAN-001] Local canvas lifecycle", () => {
    beforeEach(() => {
        persisted.clear();
        useCanvasStore.setState({ projects: [], hydrated: true });
    });

    it("creates, renames, imports and deletes projects without an account", () => {
        const local = useCanvasStore.getState();
        const id = local.createProject("Offline draft");
        local.renameProject(id, "Renamed offline draft");
        expect(useCanvasStore.getState().openProject(id)?.title).toBe("Renamed offline draft");
        const importedId = local.importProject({ id: "foreign", title: "Imported", nodes: [], connections: [] });
        expect(importedId).not.toBe("foreign");
        expect(useCanvasStore.getState().openProject(importedId)?.title).toBe("Imported");
        local.deleteProjects([id]);
        expect(useCanvasStore.getState().openProject(id)).toBeNull();
    });

    it("persists Local projects and rehydrates them after a simulated refresh", async () => {
        vi.useFakeTimers();
        try {
            const id = useCanvasStore.getState().createProject("Persistent draft");
            await vi.advanceTimersByTimeAsync(450);
            expect(persisted.has("infinite-canvas:canvas_store")).toBe(true);
            useCanvasStore.setState({ projects: [], hydrated: false });
            await useCanvasStore.persist.rehydrate();
            expect(useCanvasStore.getState().openProject(id)?.title).toBe("Persistent draft");
        } finally {
            vi.useRealTimers();
        }
    });
});
