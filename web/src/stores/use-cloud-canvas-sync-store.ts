import { create } from "zustand";
import type { CloudSyncEvent } from "@/services/cloud-canvas-sync";

type CloudCanvasSyncStore = CloudSyncEvent & { update: (event: CloudSyncEvent) => void };
export const useCloudCanvasSyncStore = create<CloudCanvasSyncStore>()((set) => ({
    state: "ready",
    update: (event) => set(event),
}));
