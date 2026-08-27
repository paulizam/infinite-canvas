import { useEffect } from "react";
import { CloudCanvasSyncEngine } from "@/services/cloud-canvas-sync";
import { cloudPlatform } from "@/services/cloud-platform";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCloudCanvasSyncStore } from "@/stores/use-cloud-canvas-sync-store";
import { useCloudSessionStore } from "@/stores/use-cloud-session-store";

export function CloudCanvasBridge() {
    const status = useCloudSessionStore((state) => state.status);
    const workspaceId = useCloudSessionStore((state) => state.activeWorkspaceId);
    const hydrated = useCanvasStore((state) => state.hydrated);

    useEffect(() => {
        if (status !== "authenticated" || !workspaceId || !hydrated) return;
        const engine = new CloudCanvasSyncEngine(cloudPlatform, useCloudCanvasSyncStore.getState().update);
        let unsubscribe: (() => void) | undefined;
        void engine
            .start(workspaceId)
            .then((projects) => {
                useCanvasStore.getState().replaceProjects(projects);
                unsubscribe = useCanvasStore.subscribe((state, previous) => {
                    if (state.projects !== previous.projects) engine.observe(state.projects);
                });
            })
            .catch((error) => useCloudCanvasSyncStore.getState().update({ state: "error", message: error instanceof Error ? error.message : String(error) }));
        return () => {
            unsubscribe?.();
            engine.stop();
        };
    }, [hydrated, status, workspaceId]);
    return null;
}
