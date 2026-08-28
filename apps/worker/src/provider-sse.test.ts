import { describe, expect, it, vi } from "vitest";
import { consumeProviderSse, MAX_SSE_BYTES } from "./provider-sse.js";

describe("provider SSE", () => {
  it("parses OpenAI text, reasoning and usage across chunks", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"hello"}}],"usage":{"total_tokens":3}}\n\ndata: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });
    const deltas: unknown[] = [];
    const result = await consumeProviderSse(
      new Response(body),
      "openai-compatible",
      async (delta) => {
        deltas.push(delta);
      },
    );
    expect(deltas).toEqual([
      { reasoning: "think" },
      { text: "hello", usage: { total_tokens: 3 } },
    ]);
    expect(result.usage).toEqual({ total_tokens: 3 });
  });
  it("rejects malformed frames without leaking raw content", async () => {
    const response = new Response("data: {bad}\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
    await expect(
      consumeProviderSse(response, "gemini", vi.fn()),
    ).rejects.toThrow("malformed SSE JSON");
  });
  it("rejects oversized streams even when frames contain no output text", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_SSE_BYTES + 1));
        controller.close();
      },
    });
    await expect(
      consumeProviderSse(new Response(body), "openai-compatible", vi.fn()),
    ).rejects.toThrow("SSE response exceeds limit");
  });
});
