import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedEventSource } from "./authenticated-event-source";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AuthenticatedEventSource", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("parses chunked named SSE events and authenticates with a header", async () => {
        let stream!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
            start: (controller) => {
                stream = controller;
            },
        });
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
        const source = new AuthenticatedEventSource("http://127.0.0.1:17371/events?clientId=client-1", { token: "top-secret", fetch: fetcher });
        const events: MessageEvent[] = [];
        source.addEventListener("hello", (event) => events.push(event as MessageEvent));
        await tick();
        stream.enqueue(new TextEncoder().encode("event: hel"));
        stream.enqueue(new TextEncoder().encode('lo\nid: 7\ndata: {"ok":'));
        stream.enqueue(new TextEncoder().encode("true}\n\n"));
        await tick();

        expect(events).toHaveLength(1);
        expect(events[0].data).toBe('{"ok":true}');
        expect(events[0].lastEventId).toBe("7");
        const [url, init] = fetcher.mock.calls[0];
        expect(String(url)).not.toContain("top-secret");
        expect(new Headers(init?.headers).get("x-canvas-agent-token")).toBe("top-secret");
        source.close();
    });

    it("reports failure, reconnects, and aborts the active request on close", async () => {
        vi.useFakeTimers();
        const signals: AbortSignal[] = [];
        const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
            signals.push(init!.signal as AbortSignal);
            if (signals.length === 1) return new Response(null, { status: 503 });
            return await new Promise<Response>((_resolve, reject) => init!.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
        });
        const source = new AuthenticatedEventSource("http://127.0.0.1:17371/events", { token: "top-secret", fetch: fetcher, reconnectDelayMs: 20 });
        const onerror = vi.fn();
        source.onerror = onerror;
        await vi.advanceTimersByTimeAsync(0);
        expect(onerror).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(20);
        expect(fetcher).toHaveBeenCalledTimes(2);
        source.close();
        expect(signals[1].aborted).toBe(true);
    });
});
