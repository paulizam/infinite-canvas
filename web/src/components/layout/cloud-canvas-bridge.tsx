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
        useCloudCanvasSyncStore.getState().registerResolver(async (projectId, resolution) => {
            const result = await engine.resolveConflict(projectId, resolution);
            const state = useCanvasStore.getState();
            const projects = state.projects.map((project) => (project.id === projectId ? result.remote : project));
            state.replaceProjects(result.localCopy ? [result.localCopy, ...projects] : projects);
            return result;
        });
        useCloudCanvasSyncStore.getState().registerSnapshotAcceptor((project) => {
            engine.acceptSnapshot(project);
            const state = useCanvasStore.getState();
            state.replaceProjects(state.projects.map((item) => (item.id === project.id ? project : item)));
        });
        const collaboration = new Map<string, CloudCollaborationClient>();
        let unsubscribe: (() => void) | undefined;
        const replaceFromRemote = (projects: import("@/stores/canvas/use-canvas-store").CanvasProject[]) => {
            if (!projects.length) return;
            useCanvasStore.getState().replaceProjects(projects);
            ensureCollaboration(projects.map((project) => project.id));
        };
        const ensureCollaboration = (projectIds: string[]) => {
            for (const [projectId, client] of collaboration) {
                if (projectIds.includes(projectId)) continue;
                client.stop();
                collaboration.delete(projectId);
                useCollaborationStore.getState().unregisterProject(projectId);
            }
            for (const projectId of projectIds) {
                if (collaboration.has(projectId)) continue;
                const clientId = getCloudClientId();
                const client = new CloudCollaborationClient(collaborationWebSocketUrl((import.meta.env.VITE_API_BASE as string | undefined) || "", projectId, clientId), {
                    snapshot: (document, presence) => {
                        const project = document as unknown as import("@/stores/canvas/use-canvas-store").CanvasProject;
                        useCloudCanvasSyncStore.getState().acceptSnapshot(project);
                        useCollaborationStore.getState().setPresence(projectId, presence);
                    },
                    mutation: (event) => {
                        if (event.payload.clientId === clientId) return;
                        engine.noteRemoteRevision(projectId, event.aggregateVersion);
                        useCanvasStore.getState().applyOperations(projectId, event.payload.operations);
                    },
                    presence: (type, presence) => useCollaborationStore.getState().updatePresence(projectId, type, presence),
                    status: (connectionStatus) => useCollaborationStore.getState().setStatus(projectId, connectionStatus),
                });
                collaboration.set(projectId, client);
                useCollaborationStore.getState().registerPublisher(projectId, clientId, (cursor, selectionIds) => client.updatePresence(cursor, selectionIds));
                client.connect();
            }
        };
        void engine
            .start(workspaceId, useCanvasStore.getState().projects)
            .then((projects) => {
                replaceFromRemote(projects);
                unsubscribe = useCanvasStore.subscribe((state, previous) => {
                    if (state.projects !== previous.projects) {
                        engine.observe(state.projects);
                        ensureCollaboration(state.projects.map((project) => project.id));
                    }
                });
            })
            .catch((error) => useCloudCanvasSyncStore.getState().update({ state: "error", message: error instanceof Error ? error.message : String(error) }));
        const reconnect = () =>
            void engine
                .reconnect()
                .then(replaceFromRemote)
                .catch((error) => useCloudCanvasSyncStore.getState().update({ state: "error", message: error instanceof Error ? error.message : String(error) }));
        window.addEventListener("online", reconnect);
        return () => {
            useCloudCanvasSyncStore.getState().registerResolver(null);
            useCloudCanvasSyncStore.getState().registerSnapshotAcceptor(null);
            window.removeEventListener("online", reconnect);
            unsubscribe?.();
            for (const [projectId, client] of collaboration) {
                client.stop();
                useCollaborationStore.getState().unregisterProject(projectId);
            }
            engine.stop();
        };
    }, [hydrated, status, workspaceId]);
    return null;
}
