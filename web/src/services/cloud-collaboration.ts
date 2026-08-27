import type { CanvasDocument, CanvasOperation } from "@infinite-canvas/contracts";

export type CollaborationPresence = { userId: string; name: string; clientId: string; cursor?: { x: number; y: number }; selectionIds: string[] };
export type CollaborationHandlers = {
    snapshot: (document: CanvasDocument, presence: CollaborationPresence[]) => void;
    mutation: (event: { aggregateVersion: number; payload: { mutationId: string; clientId: string; operations: CanvasOperation[] } }) => void;
    presence: (type: "join" | "update" | "leave", presence: CollaborationPresence) => void;
    status: (status: "connecting" | "connected" | "disconnected" | "error") => void;
};

export class CloudCollaborationClient {
    private socket?: WebSocket;
    private stopped = false;
    private retry = 0;
    private retryTimer?: ReturnType<typeof setTimeout>;

    constructor(
        private readonly url: string,
        private readonly handlers: CollaborationHandlers,
    ) {}

    connect() {
        this.stopped = false;
        this.handlers.status("connecting");
        const socket = new WebSocket(this.url);
        this.socket = socket;
        socket.addEventListener("open", () => {
            this.retry = 0;
            this.handlers.status("connected");
        });
        socket.addEventListener("message", (message) => this.receive(message.data));
        socket.addEventListener("error", () => this.handlers.status("error"));
        socket.addEventListener("close", () => {
            this.handlers.status("disconnected");
            if (!this.stopped) this.retryTimer = setTimeout(() => this.connect(), Math.min(30_000, 500 * 2 ** this.retry++));
        });
    }

    updatePresence(cursor: { x: number; y: number } | undefined, selectionIds: string[]) {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "presence.update", cursor, selectionIds: selectionIds.slice(0, 100) }));
    }

    stop() {
        this.stopped = true;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.socket?.close(1000, "Client closed");
    }

    private receive(raw: unknown) {
        try {
            const event = JSON.parse(String(raw)) as Record<string, unknown>;
            if (event.type === "collaboration.snapshot") this.handlers.snapshot(event.document as CanvasDocument, event.presence as CollaborationPresence[]);
            else if (event.type === "canvas.mutation.applied") this.handlers.mutation(event as never);
            else if (event.type === "presence.join" || event.type === "presence.update" || event.type === "presence.leave") this.handlers.presence(event.type.slice(9) as "join" | "update" | "leave", event.presence as CollaborationPresence);
        } catch {
            this.handlers.status("error");
        }
    }
}

export function collaborationWebSocketUrl(apiBase: string, projectId: string, clientId: string, pageUrl = window.location.href) {
    const base = apiBase || new URL(pageUrl).origin;
    const url = new URL("/api/v1/collaboration", base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("clientId", clientId);
    return url.toString();
}
