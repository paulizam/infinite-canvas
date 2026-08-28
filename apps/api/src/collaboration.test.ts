import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  CANVAS_SCHEMA_VERSION,
  type CanvasMutation,
} from "@infinite-canvas/contracts";
import { CollaborationHub } from "./collaboration.js";
import type { ProjectRecord, PublicUser } from "./domain.js";

class FakeSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  sent: unknown[] = [];
  closed?: { code: number; reason: string };
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
    this.emit("close");
  }
}

function user(id: string): PublicUser {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    createdAt: "2026-08-27T00:00:00.000Z",
  };
}
function project(id: string): ProjectRecord {
  const now = "2026-08-27T00:00:00.000Z";
  return {
    id,
    workspaceId: "workspace-1",
    ownerId: "u1",
    createdAt: now,
    updatedAt: now,
    document: {
      id,
      schemaVersion: CANVAS_SCHEMA_VERSION,
      revision: 3,
      title: id,
      createdAt: now,
      updatedAt: now,
      nodes: [],
      connections: [],
      chatSessions: [],
      activeChatId: null,
      backgroundMode: "lines",
      showImageInfo: false,
      viewport: { x: 0, y: 0, k: 1 },
    },
  };
}
function connect(
  hub: CollaborationHub,
  socket: FakeSocket,
  userId: string,
  projectId: string,
) {
  hub.connectAuthorized(
    socket as unknown as WebSocket,
    user(userId),
    project(projectId),
    `client-${userId}`,
  );
}

describe("CollaborationHub", () => {
  it("[COL-001] isolates rooms and broadcasts canonical mutations only inside a project", () => {
    const hub = new CollaborationHub(
      null as never,
      null as never,
      new Set(["http://localhost:3000"]),
    );
    const first = new FakeSocket();
    const second = new FakeSocket();
    const outsider = new FakeSocket();
    connect(hub, first, "u1", "p1");
    connect(hub, second, "u2", "p1");
    connect(hub, outsider, "u3", "p2");
    const mutation: CanvasMutation = {
      mutationId: "m1",
      projectId: "p1",
      baseRevision: 2,
      clientId: "client-u1",
      createdAt: new Date().toISOString(),
      operations: [{ type: "document.patch", patch: { title: "Changed" } }],
    };
    hub.publishMutation(project("p1"), mutation);
    expect(first.sent).toContainEqual(
      expect.objectContaining({
        type: "canvas.mutation.applied",
        aggregateId: "p1",
        aggregateVersion: 3,
      }),
    );
    expect(second.sent).toContainEqual(
      expect.objectContaining({
        type: "canvas.mutation.applied",
        aggregateId: "p1",
      }),
    );
    expect(outsider.sent).not.toContainEqual(
      expect.objectContaining({ type: "canvas.mutation.applied" }),
    );
  });

  it("[COL-004] broadcasts ephemeral presence without changing the project snapshot", () => {
    const hub = new CollaborationHub(null as never, null as never, new Set());
    const first = new FakeSocket();
    const second = new FakeSocket();
    connect(hub, first, "u1", "p1");
    connect(hub, second, "u2", "p1");
    first.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "presence.update",
          cursor: { x: 4, y: 8 },
          selectionIds: ["n1"],
        }),
      ),
    );
    expect(second.sent.at(-1)).toEqual(
      expect.objectContaining({
        type: "presence.update",
        presence: expect.objectContaining({
          cursor: { x: 4, y: 8 },
          selectionIds: ["n1"],
        }),
      }),
    );
  });

  it("closes clients that exceed the presence message rate", () => {
    const hub = new CollaborationHub(null as never, null as never, new Set());
    const socket = new FakeSocket();
    connect(hub, socket, "u1", "p1");
    const message = Buffer.from(
      JSON.stringify({ type: "presence.update", selectionIds: [] }),
    );
    for (let index = 0; index < 31; index++) socket.emit("message", message);
    expect(socket.closed).toEqual({
      code: 1008,
      reason: "Rate limit exceeded",
    });
  });
});
