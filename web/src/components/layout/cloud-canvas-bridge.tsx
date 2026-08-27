import { useEffect } from "react";
import { CloudCanvasSyncEngine } from "@/services/cloud-canvas-sync";
import { getCloudClientId } from "@/services/cloud-canvas-sync";
import { CloudCollaborationClient, collaborationWebSocketUrl } from "@/services/cloud-collaboration";
import { cloudPlatform } from "@/services/cloud-platform";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCloudCanvasSyncStore } from "@/stores/use-cloud-canvas-sync-store";
import { useCloudSessionStore } from "@/stores/use-cloud-session-store";
import { useCollaborationStore } from "@/stores/use-collaboration-store";

export function CloudCanvasBridge() {
    const status = useCloudSessionStore((state) => state.status);
    const workspaceId = useCloudSessionStore((state) => state.activeWorkspaceId);
    const hydrated = useCanvasStore((state) => state.hydrated);

    useEffect(() => {
        if (status !== "authenticated" || !workspaceId || !hydrated) return;
        const engine = new CloudCanvasSyncEngine(cloudPlatform, useCloudCanvasSyncStore.getState().update);
        const collaboration = new Map<string, CloudCollaborationClient>();
        let unsubscribe: (() => void) | undefined;
        const ensureCollaboration = (projectIds: string[]) => {
            for (const [projectId, client] of collaboration) if (!projectIds.includes(projectId)) { client.stop(); collaboration.delete(projectId); }
            for (const projectId of projectIds) {
                if (collaboration.has(projectId)) continue;
                const clientId = getCloudClientId();
                const client = new CloudCollaborationClient(
                    collaborationWebSocketUrl((import.meta.env.VITE_API_BASE as string | undefined) || "", projectId, clientId),
                    {
                        snapshot: (document, presence) => {
                            const project = document as unknown as import("@/stores/canvas/use-canvas-store").CanvasProject;
                            engine.acceptSnapshot(project);
                            const state = useCanvasStore.getState();
                            state.replaceProjects(state.projects.map((item) => (item.id === projectId ? project : item)));
                            useCollaborationStore.getState().setPresence(projectId, presence);
                        },
                        mutation: (event) => {
                            if (event.payload.clientId === clientId) return;
                            engine.noteRemoteRevision(projectId, event.aggregateVersion);
                            useCanvasStore.getState().applyOperations(projectId, event.payload.operations);
                        },
                        presence: (type, presence) => useCollaborationStore.getState().updatePresence(projectId, type, presence),
                        status: (connectionStatus) => useCollaborationStore.getState().setStatus(projectId, connectionStatus),
                    },
                );
                collaboration.set(projectId, client);
                client.connect();
            }
        };
        void engine
            .start(workspaceId)
            .then((projects) => {
                useCanvasStore.getState().replaceProjects(projects);
                ensureCollaboration(projects.map((project) => project.id));
                unsubscribe = useCanvasStore.subscribe((state, previous) => {
                    if (state.projects !== previous.projects) {
                        engine.observe(state.projects);
                        ensureCollaboration(state.projects.map((project) => project.id));
                    }
                });
            })
            .catch((error) => useCloudCanvasSyncStore.getState().update({ state: "error", message: error instanceof Error ? error.message : String(error) }));
        return () => {
            unsubscribe?.();
            for (const client of collaboration.values()) client.stop();
            engine.stop();
        };
    }, [hydrated, status, workspaceId]);
    return null;
}
