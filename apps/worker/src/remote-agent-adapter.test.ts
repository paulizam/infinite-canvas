import { describe, expect, it, vi } from "vitest";
import type { AgentToolContext } from "@infinite-canvas/contracts";
import type { AgentWorkerOperation, AgentWorkerRun } from "./agent-types.js";
import type { WorkerApiClient } from "./client.js";
import { createRemoteTeamAgentHandler } from "./remote-agent-adapter.js";

const detail = (approved = false): AgentWorkerRun => ({
  run: {
    id: "run-remote",
    workspaceId: "workspace-1",
    prompt: "Create campaign nodes",
    attachments: [{ assetId: "asset-1", kind: "image" }],
    modelId: "team-model",
    parameters: {},
    skillPolicy: { allow: ["marketing"] },
    attempt: 1,
    maxAttempts: 3,
    status: "claimed",
  },
  events: approved ? [{ type: "run.started" }] : [],
  subtasks: [],
  results: [],
  approvals: approved ? [{ action: "delete", status: "approved" }] : [],
});
const context: AgentToolContext = {
  contractVersion: 1,
  project: {
    id: "project-1",
    revision: 0,
    document: {
      id: "project-1",
      schemaVersion: 4,
      revision: 0,
      title: "Canvas",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      nodes: [],
      connections: [],
      chatSessions: [],
      activeChatId: null,
      backgroundMode: "lines",
      showImageInfo: false,
      viewport: { x: 0, y: 0, k: 1 },
    },
  },
  selection: [],
  assets: [],
};

function client(operations: AgentWorkerOperation[]) {
  return {
    transitionAgentRun: vi.fn(
      async (
        _worker: string,
        _run: string,
        operation: AgentWorkerOperation,
      ) => {
        operations.push(operation);
        return detail();
      },
    ),
    getAgentToolContext: vi.fn(async () => context),
    executeAgentTool: vi.fn(async () => ({
      project: { document: { revision: 1 } },
      replayed: false,
    })),
  } as unknown as WorkerApiClient;
}

describe("Remote team Agent adapter", () => {
  it("sends the versioned shared contract and persists tools, visible events, mixed-media results and final text [AGT-004] [AGT-005] [AGT-007] [AGT-011]", async () => {
    const operations: AgentWorkerOperation[] = [];
    const api = client(operations);
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          authorization: "Bearer remote-agent-test-token-32-characters",
          "x-agent-contract-version": "1",
        });
        const body = JSON.parse(String(init?.body)) as {
          contractVersion: number;
          tools: Array<{ name: string }>;
          run: { attachments: unknown[]; skillPolicy: unknown };
        };
        expect(body.contractVersion).toBe(1);
        expect(body.tools.map((tool) => tool.name)).toEqual([
          "canvas_get_state",
          "canvas_apply_ops",
        ]);
        expect(body.run.attachments).toHaveLength(1);
        expect(body.run.skillPolicy).toEqual({ allow: ["marketing"] });
        return Response.json({
          events: [{ type: "status", data: { message: "Building campaign" } }],
          toolCalls: [
            {
              id: "tool-1",
              name: "canvas_apply_ops",
              expectedRevision: 0,
              input: {
                ops: [{ type: "add_node", nodeType: "text", title: "Launch" }],
              },
            },
          ],
          results: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              kind: "drama_item",
              payload: { scene: 1 },
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              kind: "image",
              payload: { assetId: "asset-1" },
              assetId: "asset-1",
            },
          ],
          finalText: "Campaign ready",
          done: true,
        });
      },
    );
    await createRemoteTeamAgentHandler({
      url: "https://agents.example/team",
      token: "remote-agent-test-token-32-characters",
      fetcher: fetcher as typeof fetch,
    })(detail(), api, "worker-a");
    expect(api.executeAgentTool).toHaveBeenCalledWith(
      "worker-a",
      "run-remote",
      expect.objectContaining({ id: "tool-1" }),
      undefined,
    );
    expect(operations).toContainEqual({
      type: "event.append",
      eventType: "status",
      data: { message: "Building campaign" },
    });
    expect(operations).toContainEqual({
      type: "result.add",
      result: {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "drama_item",
        payload: { scene: 1 },
      },
    });
    expect(operations).toContainEqual({
      type: "result.add",
      result: expect.objectContaining({
        kind: "text",
        payload: { text: "Campaign ready" },
      }),
    });
    expect(operations.at(-1)).toEqual({ type: "run.complete" });
  });

  it("pauses destructive shared tools for approval and resumes after approval [AGT-010]", async () => {
    const response = async () =>
      Response.json({
        toolCalls: [
          {
            id: "delete-1",
            name: "canvas_apply_ops",
            expectedRevision: 0,
            input: { ops: [{ type: "delete_node", ids: ["node-1"] }] },
          },
        ],
        done: true,
      });
    const firstOps: AgentWorkerOperation[] = [],
      first = client(firstOps);
    const handler = createRemoteTeamAgentHandler({
      url: "https://agents.example",
      token: "remote-agent-test-token-32-characters",
      fetcher: vi.fn(response) as typeof fetch,
    });
    await handler(detail(), first, "worker-a");
    expect(firstOps.at(-1)).toMatchObject({
      type: "approval.request",
      action: "delete",
    });
    expect(first.executeAgentTool).not.toHaveBeenCalled();
    const resumedOps: AgentWorkerOperation[] = [],
      resumed = client(resumedOps);
    await handler(detail(true), resumed, "worker-b");
    expect(resumed.executeAgentTool).toHaveBeenCalledOnce();
    expect(resumedOps.at(-1)).toEqual({ type: "run.complete" });
  });

  it("preflights paid result approval before performing any side effect", async () => {
    const operations: AgentWorkerOperation[] = [],
      api = client(operations);
    const fetcher = vi.fn(async () =>
      Response.json({
        toolCalls: [
          {
            id: "safe-tool",
            name: "canvas_apply_ops",
            expectedRevision: 0,
            input: { ops: [{ type: "add_node", title: "Should wait" }] },
          },
        ],
        results: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            kind: "image",
            payload: { count: 4 },
          },
        ],
        done: true,
      }),
    );
    await createRemoteTeamAgentHandler({
      url: "https://agents.example",
      token: "remote-agent-test-token-32-characters",
      fetcher: fetcher as typeof fetch,
    })(detail(), api, "worker-a");
    expect(operations.at(-1)).toMatchObject({
      type: "approval.request",
      action: "batch_paid_generation",
    });
    expect(api.executeAgentTool).not.toHaveBeenCalled();
  });

  it("rejects unsafe configuration and fails closed on oversized or invalid responses", async () => {
    expect(() =>
      createRemoteTeamAgentHandler({
        url: "http://agents.example",
        token: "remote-agent-test-token-32-characters",
      }),
    ).toThrow(/HTTPS/);
    expect(() =>
      createRemoteTeamAgentHandler({
        url: "https://user@agents.example",
        token: "remote-agent-test-token-32-characters",
      }),
    ).toThrow(/without credentials/);
    const operations: AgentWorkerOperation[] = [],
      api = client(operations);
    await createRemoteTeamAgentHandler({
      url: "https://agents.example",
      token: "remote-agent-test-token-32-characters",
      fetcher: vi.fn(
        async () =>
          new Response("x", {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": String(2 * 1024 * 1024 + 1),
            },
          }),
      ) as typeof fetch,
    })(detail(), api, "worker-a");
    expect(operations.at(-1)).toMatchObject({
      type: "run.fail",
      error: { code: "REMOTE_AGENT_RESPONSE_TOO_LARGE" },
    });
  });
});
