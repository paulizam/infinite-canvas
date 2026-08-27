import { describe, expect, it, vi } from "vitest";
import { WorkerApiClient } from "./client";

describe("WorkerApiClient Agent Run protocol", () => {
  it("authenticates and encodes claim, heartbeat and transition requests", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ data: [], requestId: "agent-worker" }),
    );
    const client = new WorkerApiClient(
      "https://api.example/base",
      "test-worker-token-32-characters-long",
      fetcher as typeof fetch,
    );
    await client.claimAgentRuns("worker/a", 4, 90_000);
    await client.heartbeatAgentRuns("worker/a", ["run/a"], 60_000);
    await client.transitionAgentRun("worker/a", "run/a", {
      type: "run.complete",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      new URL("https://api.example/internal/v1/agent/claim"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-worker-token-32-characters-long",
        }),
        body: JSON.stringify({
          workerId: "worker/a",
          limit: 4,
          leaseMs: 90_000,
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      new URL("https://api.example/internal/v1/agent/heartbeat"),
      expect.objectContaining({
        body: JSON.stringify({
          workerId: "worker/a",
          runIds: ["run/a"],
          leaseMs: 60_000,
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      new URL("https://api.example/internal/v1/agent/runs/run%2Fa/transition"),
      expect.objectContaining({
        body: JSON.stringify({
          workerId: "worker/a",
          operation: { type: "run.complete" },
        }),
      }),
    );
  });
});
