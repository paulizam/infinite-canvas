import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { AgentRunService } from "./agent-run-service.js";
import { MemoryAgentRunRepository } from "./agent-run-repository.js";
import { AssetService } from "./asset-service.js";
import { MemoryAssetBlobStore } from "./blob-store.js";
import { GenerationJobService } from "./generation-job-service.js";
import { MemoryGenerationJobRepository } from "./generation-job-repository.js";
import { MemoryPlatformRepository } from "./memory-repository.js";
import { MemoryModelGatewayRepository } from "./model-gateway-repository.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";

const workerToken = "test-worker-token-32-characters-long";
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  const platform = new MemoryPlatformRepository();
  const jobs = new MemoryGenerationJobRepository();
  const repository = new MemoryAgentRunRepository(
    (userId, workspaceId, minimum) =>
      platform.requireWorkspaceRole(userId, workspaceId, minimum),
  );
  app = createApp({
    identity: new IdentityService(platform, 60_000),
    workspaces: new WorkspaceService(platform),
    projects: new ProjectService(platform),
    assets: new AssetService(platform, new MemoryAssetBlobStore(), 1024 * 1024),
    jobs: new GenerationJobService(platform, jobs),
    jobRepository: jobs,
    workerToken,
    workerStaleMs: 120_000,
    modelGateway: new MemoryModelGatewayRepository(),
    maintenanceToken: "test-maintenance-token-32-characters",
    secureCookies: false,
    agentRuns: new AgentRunService(platform, repository),
  });
});

async function register(email: string) {
  const response = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "test-password", name: "Agent" }),
  });
  const body = (await response.json()) as {
    data: { workspace: { id: string } };
  };
  return {
    workspaceId: body.data.workspace.id,
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
  };
}
async function createRun(
  owner: Awaited<ReturnType<typeof register>>,
  projectId?: string,
) {
  const sessionResponse = await app.request(
    `/api/v1/workspaces/${owner.workspaceId}/agent-sessions`,
    {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        title: "Campaign",
        ...(projectId ? { projectId } : {}),
      }),
    },
  );
  const sessionId = ((await sessionResponse.json()) as { data: { id: string } })
    .data.id;
  const response = await app.request(
    `/api/v1/agent-sessions/${sessionId}/runs`,
    {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Create a launch campaign",
        attachments: [],
        skillPolicy: { allow: ["marketing"] },
        maxAttempts: 3,
      }),
    },
  );
  expect(response.status).toBe(202);
  return {
    sessionId,
    detail: ((await response.json()) as { data: { run: { id: string } } }).data,
  };
}
async function worker(path: string, body: unknown, token = workerToken) {
  return app.request(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("Agent Run API", () => {
  it("executes the shared Canvas tool contract inside the worker lease with revision and approval guards", async () => {
    const owner = await register("agent-tools@example.com");
    const projectResponse = await app.request(
      `/api/v1/workspaces/${owner.workspaceId}/projects`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Remote Agent Canvas" }),
      },
    );
    const projectId = (
      (await projectResponse.json()) as { data: { id: string } }
    ).data.id;
    const { detail } = await createRun(owner, projectId);
    const runId = detail.run.id;
    await worker("/internal/v1/agent/claim", {
      workerId: "tool-worker",
      limit: 1,
      leaseMs: 90_000,
    });
    const contextResponse = await worker(
      `/internal/v1/agent/runs/${runId}/context`,
      { workerId: "tool-worker" },
    );
    expect(contextResponse.status).toBe(200);
    expect(
      (
        (await contextResponse.json()) as {
          data: {
            contractVersion: number;
            project: { id: string; revision: number };
          };
        }
      ).data,
    ).toMatchObject({
      contractVersion: 1,
      project: { id: projectId, revision: 0 },
    });
    const addCall = {
      id: "tool-add-1",
      name: "canvas_apply_ops",
      expectedRevision: 0,
      input: {
        ops: [
          {
            type: "add_node",
            id: "remote-node",
            nodeType: "text",
            title: "Remote result",
            metadata: { content: "Created by team Agent" },
          },
        ],
      },
    };
    const applied = await worker(`/internal/v1/agent/runs/${runId}/tools`, {
      workerId: "tool-worker",
      call: addCall,
    });
    expect(applied.status).toBe(200);
    expect(
      (
        (await applied.json()) as {
          data: {
            project: { document: { revision: number } };
            replayed: boolean;
          };
        }
      ).data,
    ).toMatchObject({
      project: { document: { revision: 1 } },
      replayed: false,
    });
    const replayed = await worker(`/internal/v1/agent/runs/${runId}/tools`, {
      workerId: "tool-worker",
      call: addCall,
    });
    expect(
      ((await replayed.json()) as { data: { replayed: boolean } }).data
        .replayed,
    ).toBe(true);
    expect(
      (
        await worker(`/internal/v1/agent/runs/${runId}/tools`, {
          workerId: "tool-worker",
          call: { ...addCall, id: "stale", expectedRevision: 0 },
        })
      ).status,
    ).toBe(409);
    const deleteCall = {
      id: "tool-delete-1",
      name: "canvas_apply_ops",
      expectedRevision: 1,
      input: { ops: [{ type: "delete_node", ids: ["remote-node"] }] },
    };
    expect(
      (
        await worker(`/internal/v1/agent/runs/${runId}/tools`, {
          workerId: "tool-worker",
          call: deleteCall,
        })
      ).status,
    ).toBe(409);
    const approvalResponse = await worker(
      `/internal/v1/agent/runs/${runId}/transition`,
      {
        workerId: "tool-worker",
        operation: {
          type: "approval.request",
          action: "delete",
          request: { toolCallId: deleteCall.id },
        },
      },
    );
    const approvalId = (
      (await approvalResponse.json()) as {
        data: { approvals: Array<{ id: string }> };
      }
    ).data.approvals[0]!.id;
    await app.request(`/api/v1/agent-approvals/${approvalId}/decision`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    await worker("/internal/v1/agent/claim", {
      workerId: "tool-worker-2",
      limit: 1,
      leaseMs: 90_000,
    });
    expect(
      (
        await worker(`/internal/v1/agent/runs/${runId}/tools`, {
          workerId: "tool-worker-2",
          call: deleteCall,
        })
      ).status,
    ).toBe(200);
    const project = await app.request(`/api/v1/projects/${projectId}`, {
      headers: { cookie: owner.cookie },
    });
    expect(
      (
        (await project.json()) as {
          data: { document: { nodes: unknown[]; revision: number } };
        }
      ).data.document,
    ).toMatchObject({ nodes: [], revision: 2 });
  });

  it("claims, streams, pauses for approval and resumes to durable results [AGT-006]", async () => {
    const owner = await register("agent-run@example.com");
    const { detail } = await createRun(owner);
    const runId = detail.run.id;
    expect(
      (
        await worker("/internal/v1/agent/claim", {
          workerId: "agent-worker",
          limit: 1,
          leaseMs: 90_000,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await worker(`/internal/v1/agent/runs/${runId}/transition`, {
          workerId: "agent-worker",
          operation: {
            type: "run.start",
            plan: { steps: ["draft", "render"] },
          },
        })
      ).status,
    ).toBe(200);
    const privateReasoning = await worker(
      `/internal/v1/agent/runs/${runId}/transition`,
      {
        workerId: "agent-worker",
        operation: {
          type: "event.append",
          eventType: "reasoning.delta",
          data: { rationale: "secret" },
        },
      },
    );
    expect(privateReasoning.status).toBe(422);
    expect(
      (
        await worker(`/internal/v1/agent/runs/${runId}/transition`, {
          workerId: "agent-worker",
          operation: {
            type: "result.add",
            result: { kind: "text", payload: { rationale: "private" } },
          },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await worker(`/internal/v1/agent/runs/${runId}/transition`, {
          workerId: "agent-worker",
          operation: {
            type: "result.add",
            result: {
              kind: "canvas_operation",
              payload: { ops: [{ type: "delete_node", id: "node-1" }] },
            },
          },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await worker(`/internal/v1/agent/runs/${runId}/transition`, {
          workerId: "agent-worker",
          operation: {
            type: "subtask.upsert",
            subtask: {
              kind: "generation",
              title: "Draft copy",
              status: "succeeded",
              output: { text: "Launch now" },
            },
          },
        })
      ).status,
    ).toBe(200);
    const textResult = {
      type: "result.add",
      result: {
        id: "33333333-3333-4333-8333-333333333333",
        kind: "text",
        payload: { text: "Launch now" },
      },
    };
    expect(
      (
        await worker(`/internal/v1/agent/runs/${runId}/transition`, {
          workerId: "agent-worker",
          operation: textResult,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await worker(`/internal/v1/agent/runs/${runId}/transition`, {
          workerId: "agent-worker",
          operation: textResult,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await worker(`/internal/v1/agent/runs/${runId}/transition`, {
          workerId: "agent-worker",
          operation: {
            ...textResult,
            result: { ...textResult.result, payload: { text: "Changed" } },
          },
        })
      ).status,
    ).toBe(409);
    const approvalResponse = await worker(
      `/internal/v1/agent/runs/${runId}/transition`,
      {
        workerId: "agent-worker",
        operation: {
          type: "approval.request",
          action: "external_access",
          request: { host: "example.com" },
        },
      },
    );
    const waiting = (
      (await approvalResponse.json()) as {
        data: {
          approvals: Array<{ id: string }>;
          run: { status: string; workerId: string | null };
        };
      }
    ).data;
    expect(waiting.run).toMatchObject({
      status: "waiting_approval",
      workerId: null,
    });
    const decision = await app.request(
      `/api/v1/agent-approvals/${waiting.approvals[0]!.id}/decision`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ decision: "approved" }),
      },
    );
    expect(decision.status).toBe(200);
    await worker("/internal/v1/agent/claim", {
      workerId: "agent-worker-2",
      limit: 1,
      leaseMs: 90_000,
    });
    expect(
      (
        await worker(`/internal/v1/agent/runs/${runId}/transition`, {
          workerId: "agent-worker-2",
          operation: { type: "run.complete" },
        })
      ).status,
    ).toBe(200);
    const fetched = await app.request(`/api/v1/agent-runs/${runId}`, {
      headers: { cookie: owner.cookie },
    });
    const final = (
      (await fetched.json()) as {
        data: {
          run: { status: string };
          results: unknown[];
          events: Array<{ type: string }>;
        };
      }
    ).data;
    expect(final.run.status).toBe("succeeded");
    expect(final.results).toHaveLength(1);
    expect(final.events.map((value) => value.type)).toContain(
      "approval.approved",
    );
    const stream = await app.request(
      `/api/v1/agent-runs/${runId}/events?after=0`,
      { headers: { cookie: owner.cookie } },
    );
    const text = await stream.text();
    expect(text).toContain("event: run.succeeded");
    expect(text).not.toContain("secret");
  });

  it("enforces worker auth, tenant isolation and explicit failure retry", async () => {
    const owner = await register("agent-owner@example.com");
    const outsider = await register("agent-outsider@example.com");
    const { detail } = await createRun(owner);
    const runId = detail.run.id;
    expect(
      (
        await worker(
          "/internal/v1/agent/claim",
          { workerId: "bad", limit: 1, leaseMs: 90_000 },
          "wrong-token-that-is-at-least-32-characters",
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(`/api/v1/agent-runs/${runId}`, {
          headers: { cookie: outsider.cookie },
        })
      ).status,
    ).toBe(404);
    await worker("/internal/v1/agent/claim", {
      workerId: "agent-worker",
      limit: 1,
      leaseMs: 90_000,
    });
    await worker(`/internal/v1/agent/runs/${runId}/transition`, {
      workerId: "agent-worker",
      operation: {
        type: "run.fail",
        error: { code: "UPSTREAM_TIMEOUT", message: "timeout" },
      },
    });
    const retried = await app.request(`/api/v1/agent-runs/${runId}/retry`, {
      method: "POST",
      headers: { cookie: owner.cookie },
    });
    expect(retried.status).toBe(202);
    expect(
      (
        (await retried.json()) as {
          data: { run: { attempt: number; status: string } };
        }
      ).data.run,
    ).toMatchObject({ attempt: 2, status: "queued" });
  });
});
