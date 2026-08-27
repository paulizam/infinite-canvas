import { create } from "zustand";
import type { CollaborationPresence } from "@/services/cloud-collaboration";

type CollaborationStore = {
    statusByProject: Record<string, string>;
    presenceByProject: Record<string, CollaborationPresence[]>;
    setStatus: (projectId: string, status: string) => void;
    setPresence: (projectId: string, presence: CollaborationPresence[]) => void;
    updatePresence: (projectId: string, type: "join" | "update" | "leave", presence: CollaborationPresence) => void;
};
export const useCollaborationStore = create<CollaborationStore>()((set) => ({
    statusByProject: {},
    presenceByProject: {},
    setStatus: (projectId, status) => set((state) => ({ statusByProject: { ...state.statusByProject, [projectId]: status } })),
    setPresence: (projectId, presence) => set((state) => ({ presenceByProject: { ...state.presenceByProject, [projectId]: presence } })),
    updatePresence: (projectId, type, presence) => set((state) => {
        const current = state.presenceByProject[projectId] || [];
        const without = current.filter((item) => item.clientId !== presence.clientId);
        return { presenceByProject: { ...state.presenceByProject, [projectId]: type === "leave" ? without : [...without, presence] } };
    }),
}));
