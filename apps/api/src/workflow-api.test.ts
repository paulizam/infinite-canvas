import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
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
import { MemoryWorkflowRepository } from "./workflow-repository.js";
import { WorkflowPublicationService } from "./workflow-service.js";
import { MemoryWorkflowExecutionRepository } from "./workflow-execution-repository.js";
import { WorkflowExecutionService } from "./workflow-execution-service.js";
import { WorkflowExecutionWorkerService } from "./workflow-execution-worker-service.js";
import { MemoryWorkflowTriggerRepository } from "./workflow-trigger-repository.js";
import { WorkflowTriggerService } from "./workflow-trigger-service.js";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  const platform = new MemoryPlatformRepository();
  const jobs = new MemoryGenerationJobRepository();
  const workflowRepository = new MemoryWorkflowRepository(
    (userId, workspaceId, minimum) =>
      platform.requireWorkspaceRole(userId, workspaceId, minimum),
  );
  const executionRepository = new MemoryWorkflowExecutionRepository(
    (userId, workspaceId, minimum) =>
      platform.requireWorkspaceRole(userId, workspaceId, minimum),
  );
  const workflowExecutionService = new WorkflowExecutionService(
    platform,
    workflowRepository,
    executionRepository,
  );
  app = createApp({
    identity: new IdentityService(platform, 60_000),
    workspaces: new WorkspaceService(platform),
    projects: new ProjectService(platform),
    assets: new AssetService(platform, new MemoryAssetBlobStore(), 1024 * 1024),
    jobs: new GenerationJobService(platform, jobs),
    jobRepository: jobs,
    workflows: new WorkflowPublicationService(platform, workflowRepository),
    workflowExecutions: workflowExecutionService,
    workflowWorker: new WorkflowExecutionWorkerService(executionRepository),
    workflowTriggers: new WorkflowTriggerService(
      platform,
      workflowRepository,
      workflowExecutionService,
      new MemoryWorkflowTriggerRepository((userId, workspaceId, minimum) =>
        platform.requireWorkspaceRole(userId, workspaceId, minimum),
      ),
    ),
    workerToken: "test-worker-token-32-characters-long",
    workerStaleMs: 120_000,
    modelGateway: new MemoryModelGatewayRepository(),
    maintenanceToken: "test-maintenance-token-32-characters",
    secureCookies: false,
  });
});

async function register(email: string) {
  const response = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "test-password",
      name: "Workflow",
    }),
  });
  const body = (await response.json()) as {
    data: { workspace: { id: string } };
  };
  return {
    workspaceId: body.data.workspace.id,
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
  };
}
async function createProject(
  owner: Awaited<ReturnType<typeof register>>,
  id: string,
  executable = true,
) {
  const nodes = executable
    ? [
        {
          id: "prompt",
          type: "text",
          title: "Prompt",
          position: { x: 0, y: 0 },
          width: 100,
          height: 100,
          metadata: { content: "hello" },
        },
        {
          id: "generate",
          type: "config",
          title: "Generate",
          position: { x: 200, y: 0 },
          width: 100,
          height: 100,
          metadata: { generationMode: "text", model: "text.default" },
        },
      ]
    : [
        {
          id: "note",
          type: "group",
          title: "Note",
          position: { x: 0, y: 0 },
          width: 100,
          height: 100,
        },
      ];
  const document = {
    id,
    schemaVersion: 4,
    revision: 0,
    title: "Flow",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes,
    connections: executable
      ? [{ id: "edge", fromNodeId: "prompt", toNodeId: "generate" }]
      : [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "dots",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
  };
  const response = await app.request(
    `/api/v1/workspaces/${owner.workspaceId}/projects`,
    {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "Flow", projectId: id, document }),
    },
  );
  expect(response.status).toBe(201);
}

describe("Workflow publication API", () => {
  it("publishes a trusted typed definition and idempotently replays the immutable version", async () => {
    const owner = await register("workflow-owner@example.com");
    await createProject(owner, "project-flow");
    const url = "/api/v1/projects/project-flow/workflows/publish";
    const publish = (publicationId: string, expectedProjectRevision = 0) =>
      app.request(url, {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          publicationId,
          expectedProjectRevision,
          entryNodeIds: ["prompt"],
        }),
      });
    const first = await publish("publish-1");
    expect(first.status).toBe(201);
    const firstData = (
      (await first.json()) as {
        data: {
          publication: {
            workflow: { id: string };
            version: { version: number; definition: { nodes: unknown[] } };
          };
        };
      }
    ).data.publication;
    expect(firstData.version).toMatchObject({ version: 1 });
    expect(firstData.version.definition.nodes).toHaveLength(2);
    const replay = await publish("publish-1");
    expect(replay.status).toBe(200);
    const replayData = (
      (await replay.json()) as {
        data: {
          publication: {
            workflow: { id: string };
            version: { version: number };
          };
          compile: { definition: { id: string } };
        };
      }
    ).data;
    expect(replayData.publication.version.version).toBe(1);
    expect(replayData.compile.definition.id).toBe(firstData.workflow.id);
    const mutation = await app.request(
      "/api/v1/projects/project-flow/mutations",
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          mutationId: "workflow-change-1",
          projectId: "project-flow",
          baseRevision: 0,
          clientId: "test",
          createdAt: new Date().toISOString(),
          operations: [{ type: "document.patch", patch: { title: "Flow v2" } }],
        }),
      },
    );
    expect(mutation.status).toBe(200);
    const second = await publish("publish-2", 1);
    expect(second.status).toBe(201);
    expect(
      (
        (await second.json()) as {
          data: {
            publication: {
              version: { version: number; projectRevision: number };
            };
          };
        }
      ).data.publication.version,
    ).toMatchObject({ version: 2, projectRevision: 1 });
    const versions = await app.request(
      `/api/v1/workflows/${firstData.workflow.id}/versions`,
      { headers: { cookie: owner.cookie } },
    );
    expect(
      (
        (await versions.json()) as { data: Array<{ version: number }> }
      ).data.map((version) => version.version),
    ).toEqual([2, 1]);

    const executionId = "11111111-1111-4111-8111-111111111111";
    const execution = await app.request(
      `/api/v1/workflows/${firstData.workflow.id}/executions`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          executionId,
          startNodeIds: ["generate"],
          initialInputs: { generate: { input: "snapshot" } },
        }),
      },
    );
    expect(execution.status).toBe(201);
    expect(
      (
        (await execution.json()) as {
          data: {
            record: {
              state: {
                status: string;
                initialInputs: unknown;
                nodes: Record<string, { status: string; skipReason?: string }>;
              };
            };
          };
        }
      ).data.record.state,
    ).toMatchObject({
      status: "queued",
      initialInputs: { generate: { input: "snapshot" } },
      nodes: {
        prompt: { status: "skipped", skipReason: "before_selection" },
        generate: { status: "ready" },
      },
    });
    const history = await app.request(
      `/api/v1/workflows/${firstData.workflow.id}/executions`,
      { headers: { cookie: owner.cookie } },
    );
    expect(history.status).toBe(200);
    expect(
      (
        (await history.json()) as {
          data: Array<{ state: { id: string } }>;
        }
      ).data.map((record) => record.state.id),
    ).toEqual([executionId]);
    expect(
      (
        await app.request(
          `/api/v1/workflows/${firstData.workflow.id}/executions`,
          {
            method: "POST",
            headers: {
              cookie: owner.cookie,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              executionId,
              startNodeIds: ["generate"],
              initialInputs: { generate: { input: "snapshot" } },
            }),
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `/api/v1/workflows/${firstData.workflow.id}/executions`,
          {
            method: "POST",
            headers: {
              cookie: owner.cookie,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              executionId,
              startNodeIds: ["generate"],
              initialInputs: { generate: { input: "different" } },
            }),
          },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request(`/api/v1/workflow-executions/${executionId}`, {
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `/api/v1/workflow-executions/${executionId}/nodes/generate/retry`,
          { method: "POST", headers: { cookie: owner.cookie } },
        )
      ).status,
    ).toBe(409);
    const cancelled = await app.request(
      `/api/v1/workflow-executions/${executionId}/cancel`,
      { method: "POST", headers: { cookie: owner.cookie } },
    );
    expect(cancelled.status).toBe(200);
    expect(
      ((await cancelled.json()) as { data: { state: { status: string } } }).data
        .state.status,
    ).toBe("cancelled");
    const cancelledReplay = await app.request(
      `/api/v1/workflow-executions/${executionId}/cancel`,
      { method: "POST", headers: { cookie: owner.cookie } },
    );
    expect(
      ((await cancelledReplay.json()) as { data: { revision: number } }).data
        .revision,
    ).toBe(1);
    const workerExecutionId = "22222222-2222-4222-8222-222222222222";
    expect(
      (
        await app.request(
          `/api/v1/workflows/${firstData.workflow.id}/executions`,
          {
            method: "POST",
            headers: {
              cookie: owner.cookie,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              executionId: workerExecutionId,
              startNodeIds: ["generate"],
            }),
          },
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request("/internal/v1/workflow/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workerId: "worker", limit: 1 }),
        })
      ).status,
    ).toBe(401);
    const workerHeaders = {
      authorization: "Bearer test-worker-token-32-characters-long",
      "content-type": "application/json",
    };
    const claim = await app.request("/internal/v1/workflow/claim", {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({ workerId: "worker", limit: 1 }),
    });
    expect(claim.status).toBe(200);
    expect(
      (
        (await claim.json()) as { data: Array<{ state: { id: string } }> }
      ).data.at(0)?.state.id,
    ).toBe(workerExecutionId);
    const transition = (revision: number, operation: unknown) =>
      app.request(
        `/internal/v1/workflow/executions/${workerExecutionId}/transition`,
        {
          method: "POST",
          headers: workerHeaders,
          body: JSON.stringify({ workerId: "worker", revision, operation }),
        },
      );
    expect(
      (await transition(0, { type: "node.start", nodeId: "generate" })).status,
    ).toBe(200);
    const createChild = (capability = "text") =>
      app.request(
        `/internal/v1/workflow/executions/${workerExecutionId}/generation`,
        {
          method: "POST",
          headers: workerHeaders,
          body: JSON.stringify({
            workerId: "worker",
            nodeId: "generate",
            attempt: 1,
            capability,
            logicalModelId: "text.default",
            parameters: { input: "hello" },
          }),
        },
      );
    const child = await createChild();
    expect(child.status).toBe(200);
    const childData = (
      (await child.json()) as {
        data: {
          job: { id: string; billing: { state: string } };
          replayed: boolean;
        };
      }
    ).data;
    expect(childData).toMatchObject({
      replayed: false,
      job: { billing: { state: "free" } },
    });
    const childReplay = await createChild();
    expect(
      (
        (await childReplay.json()) as {
          data: { job: { id: string }; replayed: boolean };
        }
      ).data,
    ).toEqual({
      job: expect.objectContaining({ id: childData.job.id }),
      replayed: true,
    });
    expect((await createChild("image")).status).toBe(409);
    const childCancelled = await app.request(
      `/internal/v1/workflow/executions/${workerExecutionId}/generation/cancel`,
      {
        method: "POST",
        headers: workerHeaders,
        body: JSON.stringify({
          workerId: "worker",
          nodeId: "generate",
          attempt: 1,
          capability: "text",
        }),
      },
    );
    expect(childCancelled.status).toBe(200);
    expect(
      ((await childCancelled.json()) as { data: { phase: string } }).data.phase,
    ).toBe("cancel_requested");
    const completed = await transition(1, {
      type: "node.complete",
      nodeId: "generate",
      output: { text: "done" },
    });
    expect(
      ((await completed.json()) as { data: { state: { status: string } } }).data
        .state.status,
    ).toBe("succeeded");
    const waitingExecutionId = "33333333-3333-4333-8333-333333333333";
    await app.request(`/api/v1/workflows/${firstData.workflow.id}/executions`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        executionId: waitingExecutionId,
        startNodeIds: ["generate"],
      }),
    });
    await app.request("/internal/v1/workflow/claim", {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({ workerId: "waiter", limit: 1 }),
    });
    const waitingTransition = (revision: number, operation: unknown) =>
      app.request(
        `/internal/v1/workflow/executions/${waitingExecutionId}/transition`,
        {
          method: "POST",
          headers: workerHeaders,
          body: JSON.stringify({ workerId: "waiter", revision, operation }),
        },
      );
    expect(
      (
        await waitingTransition(0, {
          type: "node.start",
          nodeId: "generate",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await waitingTransition(1, {
          type: "node.wait",
          nodeId: "generate",
          eventKey: "approved",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `/api/v1/workflow-executions/${waitingExecutionId}/signals/approved`,
          { method: "POST", headers: { cookie: owner.cookie } },
        )
      ).status,
    ).toBe(200);
    const reclaimed = await app.request("/internal/v1/workflow/claim", {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({ workerId: "rescuer", limit: 1 }),
    });
    expect(
      (
        (await reclaimed.json()) as { data: Array<{ state: { id: string } }> }
      ).data.at(0)?.state.id,
    ).toBe(waitingExecutionId);
    const outsider = await register("workflow-execution-outsider@example.com");
    expect(
      (
        await app.request(`/api/v1/workflow-executions/${executionId}`, {
          headers: { cookie: outsider.cookie },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/v1/workflows/${firstData.workflow.id}/executions`,
          { headers: { cookie: outsider.cookie } },
        )
      ).status,
    ).toBe(404);
    const triggerResponse = await app.request(
      `/api/v1/workflows/${firstData.workflow.id}/triggers`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          kind: "webhook",
          targetNodeId: "generate",
          config: { rateLimitPerMinute: 1 },
        }),
      },
    );
    expect(triggerResponse.status).toBe(201);
    const trigger = (
      (await triggerResponse.json()) as {
        data: { trigger: { id: string }; token: string };
      }
    ).data;
    const invoke = (key: string, token = trigger.token) =>
      app.request(`/api/v1/workflow-triggers/${trigger.trigger.id}/invoke`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": key,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt: "from webhook" }),
      });
    const invoked = await invoke("webhook-event-0001");
    expect(invoked.status).toBe(202);
    const invokedData = (
      (await invoked.json()) as {
        data: {
          record: { state: { id: string; initialInputs: unknown } };
          replayed: boolean;
        };
      }
    ).data;
    expect(invokedData).toMatchObject({
      replayed: false,
      record: {
        state: { initialInputs: { generate: { prompt: "from webhook" } } },
      },
    });
    const replayed = await invoke("webhook-event-0001");
    expect(
      (
        (await replayed.json()) as {
          data: { record: { state: { id: string } }; replayed: boolean };
        }
      ).data,
    ).toMatchObject({
      replayed: true,
      record: { state: { id: invokedData.record.state.id } },
    });
    expect((await invoke("webhook-event-0002")).status).toBe(429);
    const listedTriggers = await app.request(
      `/api/v1/workflows/${firstData.workflow.id}/triggers`,
      { headers: { cookie: owner.cookie } },
    );
    expect(JSON.stringify(await listedTriggers.json())).not.toContain(
      "tokenHash",
    );
    expect(
      (
        await app.request(`/api/v1/workflow-triggers/${trigger.trigger.id}`, {
          method: "DELETE",
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(200);
    expect((await invoke("webhook-event-0003")).status).toBe(404);
  });

  it("returns compile diagnostics without persisting an invalid Canvas", async () => {
    const owner = await register("workflow-invalid@example.com");
    await createProject(owner, "project-invalid", false);
    const response = await app.request(
      "/api/v1/projects/project-invalid/workflows/publish",
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          publicationId: "invalid-1",
          expectedProjectRevision: 0,
        }),
      },
    );
    expect(response.status).toBe(422);
    const data = (
      (await response.json()) as {
        data: {
          publication: null;
          compile: { issues: Array<{ code: string }> };
        };
      }
    ).data;
    expect(data.publication).toBeNull();
    expect(data.compile.issues.map((issue) => issue.code)).toContain(
      "EMPTY_WORKFLOW",
    );
  });

  it("rejects stale revisions and hides projects across tenants", async () => {
    const owner = await register("workflow-secure@example.com");
    await createProject(owner, "project-secure");
    const outsider = await register("workflow-outsider@example.com");
    const body = JSON.stringify({
      publicationId: "secure-1",
      expectedProjectRevision: 1,
    });
    expect(
      (
        await app.request("/api/v1/projects/project-secure/workflows/publish", {
          method: "POST",
          headers: { cookie: owner.cookie, "content-type": "application/json" },
          body,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request("/api/v1/projects/project-secure/workflows/publish", {
          method: "POST",
          headers: {
            cookie: outsider.cookie,
            "content-type": "application/json",
          },
          body,
        })
      ).status,
    ).toBe(404);
  });
});
