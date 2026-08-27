import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import type { CanvasMutation } from "@infinite-canvas/contracts";
import { z } from "zod";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { ProjectRecord, PublicUser } from "./domain.js";
import type { IdentityService, ProjectService } from "./services.js";

type Presence = {
  userId: string;
  name: string;
  clientId: string;
  cursor?: { x: number; y: number };
  selectionIds: string[];
};
type Client = {
  socket: WebSocket;
  user: PublicUser;
  project: ProjectRecord;
  presence: Presence;
  windowStartedAt: number;
  messageCount: number;
};

const presenceSchema = z.object({
  type: z.literal("presence.update"),
  cursor: z
    .object({ x: z.number().finite(), y: z.number().finite() })
    .optional(),
  selectionIds: z.array(z.string().min(1).max(128)).max(100).default([]),
});

export class CollaborationHub {
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
  });
  private readonly rooms = new Map<string, Set<Client>>();

  constructor(
    private readonly identity: IdentityService,
    private readonly projects: ProjectService,
    private readonly allowedOrigins: ReadonlySet<string>,
  ) {}

  attach(server: Server) {
    server.on(
      "upgrade",
      (request, socket, head) => void this.upgrade(request, socket, head),
    );
  }

  publishMutation(project: ProjectRecord, mutation: CanvasMutation) {
    this.broadcast(project.id, {
      eventId: crypto.randomUUID(),
      type: "canvas.mutation.applied",
      aggregateId: project.id,
      aggregateVersion: project.document.revision,
      occurredAt: new Date().toISOString(),
      tenantId: project.workspaceId,
      payload: {
        mutationId: mutation.mutationId,
        clientId: mutation.clientId,
        operations: mutation.operations,
      },
    });
  }

  connectAuthorized(
    socket: WebSocket,
    user: PublicUser,
    project: ProjectRecord,
    clientId: string,
  ) {
    const client: Client = {
      socket,
      user,
      project,
      presence: {
        userId: user.id,
        name: user.name,
        clientId,
        selectionIds: [],
      },
      windowStartedAt: Date.now(),
      messageCount: 0,
    };
    const room = this.rooms.get(project.id) || new Set<Client>();
    room.add(client);
    this.rooms.set(project.id, room);
    this.send(socket, {
      type: "collaboration.snapshot",
      projectId: project.id,
      revision: project.document.revision,
      document: project.document,
      presence: [...room].map((peer) => peer.presence),
    });
    this.broadcast(
      project.id,
      { type: "presence.join", presence: client.presence },
      client,
    );
    socket.on("message", (data) => this.receive(client, data));
    socket.on("close", () => this.disconnect(client));
    socket.on("error", () => this.disconnect(client));
  }

  private async upgrade(
    request: import("node:http").IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) {
    try {
      const origin = request.headers.origin || "";
      if (!this.allowedOrigins.has(origin))
        return rejectUpgrade(socket, 403, "Origin not allowed");
      const url = new URL(
        request.url || "/",
        `http://${request.headers.host || "localhost"}`,
      );
      if (url.pathname !== "/api/v1/collaboration")
        return rejectUpgrade(socket, 404, "Not found");
      const projectId = url.searchParams.get("projectId")?.trim();
      const clientId = url.searchParams.get("clientId")?.trim();
      if (
        !projectId ||
        projectId.length > 128 ||
        !clientId ||
        clientId.length > 128
      )
        return rejectUpgrade(socket, 400, "Invalid parameters");
      const user = await this.identity.authenticate(
        readCookie(request.headers.cookie, "ic_session"),
      );
      const project = await this.projects.get(user.id, projectId);
      if (!project) return rejectUpgrade(socket, 404, "Project not found");
      this.wss.handleUpgrade(request, socket, head, (webSocket) =>
        this.connectAuthorized(webSocket, user, project, clientId),
      );
    } catch {
      rejectUpgrade(socket, 401, "Unauthorized");
    }
  }

  private receive(client: Client, data: RawData) {
    const now = Date.now();
    if (now - client.windowStartedAt >= 1_000) {
      client.windowStartedAt = now;
      client.messageCount = 0;
    }
    if (++client.messageCount > 30)
      return client.socket.close(1008, "Rate limit exceeded");
    try {
      const update = presenceSchema.parse(JSON.parse(data.toString()));
      client.presence = {
        ...client.presence,
        cursor: update.cursor,
        selectionIds: update.selectionIds,
      };
      this.broadcast(
        client.project.id,
        { type: "presence.update", presence: client.presence },
        client,
      );
    } catch {
      client.socket.close(1008, "Invalid message");
    }
  }

  private disconnect(client: Client) {
    const room = this.rooms.get(client.project.id);
    if (!room?.delete(client)) return;
    if (!room.size) this.rooms.delete(client.project.id);
    else
      this.broadcast(client.project.id, {
        type: "presence.leave",
        presence: client.presence,
      });
  }

  private broadcast(projectId: string, event: unknown, exclude?: Client) {
    for (const client of this.rooms.get(projectId) || [])
      if (client !== exclude) this.send(client.socket, event);
  }

  private send(socket: WebSocket, event: unknown) {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(event));
  }
}

function readCookie(header: string | undefined, name: string) {
  for (const entry of header?.split(";") || []) {
    const [key, ...parts] = entry.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return undefined;
}

function rejectUpgrade(socket: Duplex, status: number, message: string) {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}
