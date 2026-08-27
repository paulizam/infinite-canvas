import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { applyCanvasOperations, migrateCanvasDocument } from "@infinite-canvas/canvas-core";
import { CANVAS_SCHEMA_VERSION, type CanvasOperation } from "@infinite-canvas/contracts";
import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    schemaVersion: typeof CANVAS_SCHEMA_VERSION;
    revision: number;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    applyOperations: (id: string, operations: CanvasOperation[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;

const canvasStorage: PersistStorage<PersistedCanvasState> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<PersistedCanvasState>;
        queuedPersistState = parsed.state;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist<CanvasStore, [], [], PersistedCanvasState>(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = i18n.t("canvas.project.untitled")) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    schemaVersion: CANVAS_SCHEMA_VERSION,
                    revision: 0,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project = normalizeProject({ ...source, id: nanoid(), updatedAt: now }, i18n.t("canvas.project.imported"));
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) =>
                        project.id === id
                            ? fromDocument(applyCanvasOperations(toDocument(project), [{ type: "document.patch", patch: { title: title.trim() || project.title } }]))
                            : project,
                    ),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects: projects.map((project) => normalizeProject(project)) }),
            applyOperations: (id, operations) => set((state) => ({ projects: state.projects.map((project) => (project.id === id ? fromDocument(applyCanvasOperations(toDocument(project), operations)) : project)) })),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) =>
                        project.id === id
                            ? fromDocument(applyCanvasOperations(toDocument(project), [{ type: "document.sync", patch: patch as unknown as Extract<CanvasOperation, { type: "document.sync" }>["patch"] }]))
                            : project,
                    ),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            version: CANVAS_SCHEMA_VERSION,
            migrate: (state) => {
                const persisted = state as Partial<PersistedCanvasState>;
                return { projects: (persisted.projects || []).map((project) => normalizeProject(project)) } as PersistedCanvasState;
            },
            storage: canvasStorage,
            partialize: (state) => ({ projects: state.projects }),
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);

function normalizeProject(source: Partial<CanvasProject>, fallbackTitle = "Untitled"): CanvasProject {
    const migrated = migrateCanvasDocument({ ...(source as object), id: source.id || nanoid(), title: source.title || fallbackTitle } as Parameters<typeof migrateCanvasDocument>[0]);
    return fromDocument(migrated);
}

function toDocument(project: CanvasProject): Parameters<typeof applyCanvasOperations>[0] {
    return project as unknown as Parameters<typeof applyCanvasOperations>[0];
}

function fromDocument(document: ReturnType<typeof applyCanvasOperations>): CanvasProject {
    return document as unknown as CanvasProject;
}
