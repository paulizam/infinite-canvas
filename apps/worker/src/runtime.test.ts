import { describe, expect, it, vi } from "vitest";
import type { GenerationJob } from "@infinite-canvas/contracts";
import { WorkerApiClient } from "./client.js";
import { nextPollDelay } from "./poll-policy.js";
import { runWorkerCycle } from "./runtime.js";

const job = {
  id: "d6fd33a3-a722-45bf-96f3-4e14ea9eb721",
  phase: "claimed",
} as GenerationJob;

describe("generation worker runtime", () => {
  it("backs off while idle and resets after work", () => {
    expect(
      nextPollDelay({ claimed: 0, idleBatches: 3, baseDelayMs: 100 }),
    ).toEqual({ delayMs: 800, idleBatches: 4 });
    expect(
      nextPollDelay({ claimed: 1, idleBatches: 8, baseDelayMs: 100 }),
    ).toEqual({ delayMs: 250, idleBatches: 0 });
  });

  it("heartbeats, claims and dispatches one batch", async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(
      async (request: URL | RequestInfo, init?: RequestInit) => {
        const url = new URL(String(request));
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ path: url.pathname, body });
        const data = url.pathname.endsWith("/claim") ? [job] : { renewed: 0 };
        return new Response(JSON.stringify({ data, requestId: "test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const client = new WorkerApiClient(
      "http://127.0.0.1:3001",
      "test-worker-token-32-characters-long",
      fetcher as typeof fetch,
    );
    const handler = vi.fn(async () => undefined);
    expect(
      await runWorkerCycle({
        client,
        workerId: "worker-a",
        limit: 5,
        leaseMs: 90_000,
        handler,
      }),
    ).toBe(1);
    expect(calls.map((call) => call.path)).toEqual([
      "/internal/v1/generation/heartbeat",
      "/internal/v1/generation/claim",
    ]);
    expect(handler).toHaveBeenCalledWith(job, client, "worker-a", undefined);
  });

  it("rejects credential-bearing API origins and weak tokens", () => {
    expect(
      () =>
        new WorkerApiClient("https://user:pass@example.com", "x".repeat(32)),
    ).toThrow(/without credentials/);
    expect(() => new WorkerApiClient("https://example.com", "short")).toThrow(
      /32/,
    );
  });
});
