import { describe, expect, it, vi } from "vitest";
import { createAgentModelHandler, runAgentCycle } from "./agent-runtime.js";
import type { AgentWorkerRun, AgentWorkerOperation } from "./agent-types.js";
import type { WorkerApiClient } from "./client.js";

const run = (patch: Partial<AgentWorkerRun["run"]> = {}): AgentWorkerRun => ({
  run: {
    id: "run-1",
    workspaceId: "workspace-1",
    prompt: "Write a launch line",
    attachments: [],
    modelId: "text-default",
    parameters: { temperature: 0.4 },
    skillPolicy: {},
    attempt: 1,
    maxAttempts: 3,
    status: "claimed",
    ...patch,
  },
  events: [],
  subtasks: [],
  results: [],
  approvals: [],
});

describe("Agent Worker runtime", () => {
  it("claims, heartbeats and dispatches injectable remote adapters", async () => {
    const value = run();
    const client = {
      claimAgentRuns: vi.fn(async () => [value]),
      heartbeatAgentRuns: vi.fn(async () => ({ renewed: 1 })),
    } as unknown as WorkerApiClient;
    const handler = vi.fn(async () => undefined);
    expect(
      await runAgentCycle({
        client,
        workerId: "worker-a",
        limit: 5,
        leaseMs: 90_000,
        handler,
      }),
    ).toBe(1);
    expect(handler).toHaveBeenCalledWith(value, client, "worker-a", undefined);
  });

  it("routes a text model, persists visible output and discards provider reasoning", async () => {
    const operations: AgentWorkerOperation[] = [];
    const client = {
      transitionAgentRun: vi.fn(
        async (
          _workerId: string,
          _runId: string,
          operation: AgentWorkerOperation,
        ) => {
          operations.push(operation);
          return run();
        },
      ),
      resolveModel: vi.fn(async () => ({
        logicalModel: {
          id: "text-default",
          name: "Text",
          capability: "text",
          enabled: true,
          isDefault: true,
        },
        binding: {
          id: "binding",
          logicalModelId: "text-default",
          upstreamModelId: "upstream",
          priority: 1,
          enabled: true,
          capabilityProfile: { capability: "text", parameters: [] },
        },
        upstreamModel: {
          id: "upstream",
          channelId: "channel",
          modelId: "gpt-test",
          name: "GPT",
          capabilities: ["text"],
          enabled: true,
        },
        channel: {
          id: "channel",
          protocolId: "protocol",
          name: "Channel",
          baseUrl: "https://provider.example",
          enabled: true,
          config: {},
        },
        protocol: {
          id: "protocol",
          name: "OpenAI",
          adapter: "openai-compatible",
          enabled: true,
          config: {},
        },
        apiKey: "provider-secret",
      })),
      reportModelHealth: vi.fn(async () => ({ accepted: true })),
    } as unknown as WorkerApiClient;
    const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "gpt-test",
        messages: [{ role: "user", content: "Write a launch line" }],
      });
      return new Response(
        [
          'data: {"choices":[{"delta":{"reasoning_content":"private plan"}}]}',
          'data: {"choices":[{"delta":{"content":"Launch boldly"}}]}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    await createAgentModelHandler(fetcher as typeof fetch)(
      run(),
      client,
      "worker-a",
    );
    expect(operations).toContainEqual({
      type: "event.append",
      eventType: "output.delta",
      data: { text: "Launch boldly" },
    });
    expect(operations).toContainEqual({
      type: "result.add",
      result: { kind: "text", payload: { text: "Launch boldly" } },
    });
    expect(operations.at(-1)).toEqual({ type: "run.complete" });
    expect(JSON.stringify(operations)).not.toContain("private plan");
  });

  it("fails closed when advanced inputs require a remote adapter", async () => {
    const operations: AgentWorkerOperation[] = [];
    const client = {
      transitionAgentRun: vi.fn(
        async (
          _workerId: string,
          _runId: string,
          operation: AgentWorkerOperation,
        ) => {
          operations.push(operation);
          return run();
        },
      ),
      reportModelHealth: vi.fn(),
    } as unknown as WorkerApiClient;
    await createAgentModelHandler()(
      run({ attachments: [{ assetId: "asset-1", kind: "image" }] }),
      client,
      "worker-a",
    );
    expect(operations).toEqual([
      {
        type: "run.fail",
        error: expect.objectContaining({
          code: "REMOTE_AGENT_ADAPTER_REQUIRED",
        }),
      },
    ]);
  });

  it("does not resubmit an ambiguous Provider attempt after lease takeover", async () => {
    const operations: AgentWorkerOperation[] = [];
    const client = {
      transitionAgentRun: vi.fn(
        async (
          _workerId: string,
          _runId: string,
          operation: AgentWorkerOperation,
        ) => {
          operations.push(operation);
          return run();
        },
      ),
      reportModelHealth: vi.fn(),
    } as unknown as WorkerApiClient;
    const recovered = run();
    recovered.events = [{ type: "run.started" }];
    await createAgentModelHandler()(recovered, client, "worker-b");
    expect(operations).toEqual([
      {
        type: "run.fail",
        error: expect.objectContaining({ code: "AGENT_AMBIGUOUS_RECOVERY" }),
      },
    ]);
  });
});
