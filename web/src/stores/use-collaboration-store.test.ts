import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCollaborationStore } from "./use-collaboration-store";

describe("collaboration store", () => {
    beforeEach(() => useCollaborationStore.setState({ statusByProject: {}, presenceByProject: {}, ownClientIdByProject: {}, publishersByProject: {} }));

    it("publishes ephemeral cursor and selection through the registered project client", () => {
        const publisher = vi.fn();
        useCollaborationStore.getState().registerPublisher("p1", "client-me", publisher);
        useCollaborationStore.getState().publishPresence("p1", { x: 3, y: 4 }, ["n1"]);
        expect(publisher).toHaveBeenCalledWith({ x: 3, y: 4 }, ["n1"]);
        expect(useCollaborationStore.getState().ownClientIdByProject.p1).toBe("client-me");
    });

    it("replaces peers by client id and clears ghosts when disconnected", () => {
        const peer = { userId: "u2", name: "Peer", clientId: "c2", selectionIds: [] };
        useCollaborationStore.getState().setPresence("p1", [peer]);
        useCollaborationStore.getState().updatePresence("p1", "update", { ...peer, cursor: { x: 1, y: 2 } });
        expect(useCollaborationStore.getState().presenceByProject.p1).toEqual([{ ...peer, cursor: { x: 1, y: 2 } }]);
        useCollaborationStore.getState().setStatus("p1", "disconnected");
        expect(useCollaborationStore.getState().presenceByProject.p1).toEqual([]);
    });

    it("removes all ephemeral project state on bridge cleanup", () => {
        useCollaborationStore.getState().registerPublisher("p1", "c1", vi.fn());
        useCollaborationStore.getState().setStatus("p1", "connected");
        useCollaborationStore.getState().unregisterProject("p1");
        expect(useCollaborationStore.getState()).toMatchObject({ statusByProject: {}, presenceByProject: {}, ownClientIdByProject: {}, publishersByProject: {} });
    });
});
