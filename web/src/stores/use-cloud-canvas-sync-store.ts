import { create } from "zustand";
import type { CloudConflictResolution, CloudConflictResolutionResult, CloudSyncEvent } from "@/services/cloud-canvas-sync";

type ConflictResolver = (projectId: string, resolution: CloudConflictResolution) => Promise<CloudConflictResolutionResult>;
type CloudCanvasSyncStore = CloudSyncEvent & {
    resolving: boolean;
    update: (event: CloudSyncEvent) => void;
    registerResolver: (resolver: ConflictResolver | null) => void;
    resolveConflict: (projectId: string, resolution: CloudConflictResolution) => Promise<CloudConflictResolutionResult>;
};
let registeredResolver: ConflictResolver | null = null;
export const useCloudCanvasSyncStore = create<CloudCanvasSyncStore>()((set) => ({
    state: "ready",
    resolving: false,
    update: (event) => set({ ...event, conflict: event.conflict }),
    registerResolver: (resolver) => {
        registeredResolver = resolver;
    },
    resolveConflict: async (projectId, resolution) => {
        if (!registeredResolver) throw new Error("CANVAS_CONFLICT_RESOLVER_UNAVAILABLE");
        set({ resolving: true });
        try {
            return await registeredResolver(projectId, resolution);
        } finally {
            set({ resolving: false });
        }
    },
}));
