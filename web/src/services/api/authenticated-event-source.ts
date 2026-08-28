import { AGENT_TOKEN_HEADER } from "./canvas-agent-auth";

type EventListener = (event: Event) => void;

export type AuthenticatedEventSourceOptions = {
    token: string;
    fetch?: typeof fetch;
    reconnectDelayMs?: number;
};

/** Header-authenticated SSE client used because native EventSource cannot send credentials in headers. */
export class AuthenticatedEventSource {
    onerror: EventListener | null = null;
    onopen: EventListener | null = null;

    private readonly listeners = new Map<string, Set<EventListener>>();
    private readonly fetcher: typeof fetch;
    private readonly token: string;
    private reconnectDelayMs: number;
    private controller: AbortController | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private closed = false;
    private lastEventId = "";

    constructor(
        private readonly url: string,
        options: AuthenticatedEventSourceOptions,
    ) {
        this.fetcher = options.fetch || fetch;
        this.token = options.token;
        this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
        void this.connect();
    }

    addEventListener(type: string, listener: EventListener) {
        const listeners = this.listeners.get(type) || new Set<EventListener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: EventListener) {
        this.listeners.get(type)?.delete(listener);
    }

    close() {
        this.closed = true;
        this.controller?.abort();
        this.controller = null;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    private async connect() {
        if (this.closed) return;
        const controller = new AbortController();
        this.controller = controller;
        try {
            const headers = new Headers({ Accept: "text/event-stream", [AGENT_TOKEN_HEADER]: this.token });
            if (this.lastEventId) headers.set("last-event-id", this.lastEventId);
            const response = await this.fetcher(this.url, { headers, signal: controller.signal, cache: "no-store" });
            if (!response.ok || !response.body) throw new Error(`SSE request failed (${response.status})`);
            this.dispatch("open", new Event("open"));
            await this.consume(response.body);
            if (!this.closed) throw new Error("SSE connection closed");
        } catch (error) {
            if (this.closed || controller.signal.aborted) return;
            this.dispatch("error", typeof ErrorEvent === "undefined" ? new Event("error") : new ErrorEvent("error", { error }));
            this.scheduleReconnect();
        } finally {
            if (this.controller === controller) this.controller = null;
        }
    }

    private async consume(body: ReadableStream<Uint8Array>) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
            while (!this.closed) {
                const { value, done } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                const lines = buffer.split(/\r\n|\r|\n/);
                buffer = lines.pop() || "";
                for (const line of lines) this.parseLine(line);
                if (done) break;
            }
        } finally {
            reader.releaseLock();
        }
    }

    private eventType = "message";
    private dataLines: string[] = [];
    private pendingEventId: string | null = null;

    private parseLine(line: string) {
        if (!line) {
            if (this.dataLines.length) {
                if (this.pendingEventId !== null) this.lastEventId = this.pendingEventId;
                const event = new MessageEvent(this.eventType, { data: this.dataLines.join("\n"), lastEventId: this.lastEventId });
                this.dispatch(this.eventType, event);
            }
            this.eventType = "message";
            this.dataLines = [];
            this.pendingEventId = null;
            return;
        }
        if (line.startsWith(":")) return;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") this.eventType = value || "message";
        else if (field === "data") this.dataLines.push(value);
        else if (field === "id" && !value.includes("\0")) this.pendingEventId = value;
        else if (field === "retry" && /^\d+$/.test(value)) this.reconnectDelayMs = Number(value);
    }

    private dispatch(type: string, event: Event) {
        if (type === "open") this.onopen?.(event);
        if (type === "error") this.onerror?.(event);
        this.listeners.get(type)?.forEach((listener) => listener(event));
    }

    private scheduleReconnect() {
        if (this.closed || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect();
        }, this.reconnectDelayMs);
    }
}
