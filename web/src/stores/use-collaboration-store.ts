import { create } from "zustand";
import type { CollaborationPresence } from "@/services/cloud-collaboration";

type CollaborationStore = {
    statusByProject: Record<string, CollaborationStatus>;
    presenceByProject: Record<string, CollaborationPresence[]>;
    ownClientIdByProject: Record<string, string>;
    publishersByProject: Record<string, PresencePublisher>;
    setStatus: (projectId: string, status: CollaborationStatus) => void;
    setPresence: (projectId: string, presence: CollaborationPresence[]) => void;
    updatePresence: (projectId: string, type: "join" | "update" | "leave", presence: CollaborationPresence) => void;
    registerPublisher: (projectId: string, clientId: string, publisher: PresencePublisher) => void;
    unregisterProject: (projectId: string) => void;
    publishPresence: (projectId: string, cursor: { x: number; y: number } | undefined, selectionIds: string[]) => void;
};

export type CollaborationStatus = "connecting" | "connected" | "disconnected" | "error";
type PresencePublisher = (cursor: { x: number; y: number } | undefined, selectionIds: string[]) => void;

export const useCollaborationStore = create<CollaborationStore>()((set) => ({
    statusByProject: {},
    presenceByProject: {},
    ownClientIdByProject: {},
    publishersByProject: {},
    setStatus: (projectId, status) =>
        set((state) => ({
            statusByProject: { ...state.statusByProject, [projectId]: status },
            presenceByProject: status === "connected" || status === "connecting" ? state.presenceByProject : { ...state.presenceByProject, [projectId]: [] },
        })),
    setPresence: (projectId, presence) => set((state) => ({ presenceByProject: { ...state.presenceByProject, [projectId]: presence } })),
    updatePresence: (projectId, type, presence) =>
        set((state) => {
            const current = state.presenceByProject[projectId] || [];
            const without = current.filter((item) => item.clientId !== presence.clientId);
            return { presenceByProject: { ...state.presenceByProject, [projectId]: type === "leave" ? without : [...without, presence] } };
        }),
    registerPublisher: (projectId, clientId, publisher) =>
        set((state) => ({
            ownClientIdByProject: { ...state.ownClientIdByProject, [projectId]: clientId },
            publishersByProject: { ...state.publishersByProject, [projectId]: publisher },
        })),
    unregisterProject: (projectId) =>
        set((state) => {
            const statusByProject = { ...state.statusByProject };
            const presenceByProject = { ...state.presenceByProject };
            const ownClientIdByProject = { ...state.ownClientIdByProject };
            const publishersByProject = { ...state.publishersByProject };
            delete statusByProject[projectId];
            delete presenceByProject[projectId];
            delete ownClientIdByProject[projectId];
            delete publishersByProject[projectId];
            return { statusByProject, presenceByProject, ownClientIdByProject, publishersByProject };
        }),
    publishPresence: (projectId, cursor, selectionIds) => useCollaborationStore.getState().publishersByProject[projectId]?.(cursor, selectionIds),
}));
