import { create } from "zustand";

import { cloudModeEnabled, cloudPlatform, type CloudUser, type CloudWorkspace } from "@/services/cloud-platform";

const ACTIVE_WORKSPACE_KEY = "infinite-canvas:active-workspace";
type SessionStatus = "local" | "loading" | "guest" | "authenticated" | "error";

type CloudSessionStore = {
    status: SessionStatus;
    user: CloudUser | null;
    workspaces: CloudWorkspace[];
    activeWorkspaceId: string | null;
    error: string | null;
    initialize: () => Promise<void>;
    login: (email: string, password: string) => Promise<void>;
    register: (input: { email: string; password: string; name: string }) => Promise<void>;
    logout: () => Promise<void>;
    setActiveWorkspace: (workspaceId: string) => void;
};

async function loadAuthenticatedState(set: (patch: Partial<CloudSessionStore>) => void) {
    const [user, workspaces] = await Promise.all([cloudPlatform.me(), cloudPlatform.listWorkspaces()]);
    const storedId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    const activeWorkspaceId = workspaces.some((workspace) => workspace.id === storedId) ? storedId : workspaces[0]?.id || null;
    if (activeWorkspaceId) localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeWorkspaceId);
    set({ status: "authenticated", user, workspaces, activeWorkspaceId, error: null });
}

export const useCloudSessionStore = create<CloudSessionStore>()((set) => ({
    status: cloudModeEnabled ? "loading" : "local",
    user: null,
    workspaces: [],
    activeWorkspaceId: null,
    error: null,
    initialize: async () => {
        if (!cloudModeEnabled) return set({ status: "local" });
        set({ status: "loading", error: null });
        try {
            await loadAuthenticatedState(set);
        } catch (error) {
            const status = error instanceof Error && "status" in error ? Number(error.status) : 0;
            set({ status: status === 401 ? "guest" : "error", user: null, workspaces: [], activeWorkspaceId: null, error: status === 401 ? null : error instanceof Error ? error.message : String(error) });
        }
    },
    login: async (email, password) => {
        set({ status: "loading", error: null });
        try {
            await cloudPlatform.login(email, password);
            await loadAuthenticatedState(set);
        } catch (error) {
            set({ status: "guest", error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    },
    register: async (input) => {
        set({ status: "loading", error: null });
        try {
            await cloudPlatform.register(input);
            await loadAuthenticatedState(set);
        } catch (error) {
            set({ status: "guest", error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    },
    logout: async () => {
        try {
            await cloudPlatform.logout();
        } finally {
            localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
            set({ status: "guest", user: null, workspaces: [], activeWorkspaceId: null, error: null });
        }
    },
    setActiveWorkspace: (workspaceId) => {
        localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);
        set({ activeWorkspaceId: workspaceId });
    },
}));
