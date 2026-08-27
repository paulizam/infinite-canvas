import { create } from "zustand";
import type { CloudConflictResolution, CloudConflictResolutionResult, CloudSyncEvent } from "@/services/cloud-canvas-sync";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

type ConflictResolver = (projectId: string, resolution: CloudConflictResolution) => Promise<CloudConflictResolutionResult>;
type SnapshotAcceptor = (project: CanvasProject) => void;
type CloudCanvasSyncStore = CloudSyncEvent & {
    resolving: boolean;
    update: (event: CloudSyncEvent) => void;
    registerResolver: (resolver: ConflictResolver | null) => void;
    registerSnapshotAcceptor: (acceptor: SnapshotAcceptor | null) => void;
    acceptSnapshot: (project: CanvasProject) => void;
    resolveConflict: (projectId: string, resolution: CloudConflictResolution) => Promise<CloudConflictResolutionResult>;
};
let registeredResolver: ConflictResolver | null = null;
let registeredSnapshotAcceptor: SnapshotAcceptor | null = null;
export const useCloudCanvasSyncStore = create<CloudCanvasSyncStore>()((set) => ({
    state: "ready",
    resolving: false,
    update: (event) => set({ ...event, conflict: event.conflict }),
    registerResolver: (resolver) => {
        registeredResolver = resolver;
    },
    registerSnapshotAcceptor: (acceptor) => {
        registeredSnapshotAcceptor = acceptor;
    },
    acceptSnapshot: (project) => {
        if (!registeredSnapshotAcceptor) throw new Error("CANVAS_SNAPSHOT_ACCEPTOR_UNAVAILABLE");
        registeredSnapshotAcceptor(project);
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
