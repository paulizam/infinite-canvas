import { describe, expect, it, vi } from "vitest";
import { WorkerApiClient } from "./client.js";
import { runWorkflowCycle } from "./workflow-runtime.js";

describe("workflow worker cycle", () => {
  it("claims, dispatches and encodes transition resource ids", async () => {
    const execution = { state: { id: "run/one" }, revision: 3 };
    const calls: Array<{ path: string; body: unknown }> = [];
    const fetcher = vi.fn(
      async (request: URL | RequestInfo, init?: RequestInit) => {
        const path = new URL(String(request)).pathname;
        const body = JSON.parse(String(init?.body));
        calls.push({ path, body });
        const data = path.endsWith("/claim")
          ? [execution]
          : path.endsWith("/transition")
            ? execution
            : { renewed: 0 };
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
    const handler = vi.fn(async () => {
      await client.transitionWorkflow("worker", "run/one", 3, {
        type: "execution.cancel.complete",
      });
    });
    expect(
      await runWorkflowCycle({
        client,
        workerId: "worker",
        limit: 4,
        leaseMs: 90_000,
        handler: handler as never,
      }),
    ).toBe(1);
    expect(handler).toHaveBeenCalled();
    expect(calls.map((call) => call.path)).toEqual([
      "/internal/v1/workflow/claim",
      "/internal/v1/workflow/executions/run%2Fone/transition",
    ]);
  });
});
