import { Hono, type Context } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { parseCustomProtocolConfig } from "@infinite-canvas/model-gateway";
import type { AgentRemoteToolCall } from "@infinite-canvas/contracts";
import type { PublicUser } from "./domain.js";
import { DomainError } from "./domain.js";
import type { AssetService } from "./asset-service.js";
import type { GenerationJobService } from "./generation-job-service.js";
import type { GenerationJobRepository } from "./generation-job-repository.js";
import {
  MemoryGenerationEventRepository,
  type GenerationEventRepository,
} from "./generation-event-repository.js";
import type { ModelGatewayRepository } from "./model-gateway-repository.js";
import type { WorkflowPublicationService } from "./workflow-service.js";
import type { WorkflowExecutionService } from "./workflow-execution-service.js";
import type { WorkflowExecutionWorkerService } from "./workflow-execution-worker-service.js";
import type { WorkflowExecutionRecord } from "./workflow-execution-repository.js";
import type { WorkflowTriggerService } from "./workflow-trigger-service.js";
import type { WorkflowLibraryService } from "./workflow-library-service.js";
import type { WorkflowPublicApiService } from "./workflow-public-api-service.js";
import type { AgentRunService } from "./agent-run-service.js";
import type { DramaService } from "./drama-service.js";
import type { DramaProductionService } from "./drama-production-service.js";
import type { DramaRenderService } from "./drama-render-service.js";
import type { DramaInteropService } from "./drama-interop-service.js";
import { ModelDiscoveryService } from "./model-discovery.js";
import { createModelDiscoveryApi } from "./model-discovery-api.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";

type ApiEnv = {
  Variables: { user: PublicUser; sessionToken: string; requestId: string };
};
export type AppServices = {
  identity: IdentityService;
  workspaces: WorkspaceService;
  projects: ProjectService;
  assets: AssetService;
  jobs: GenerationJobService;
  jobRepository: GenerationJobRepository;
  eventRepository?: GenerationEventRepository;
  workerToken: string;
  workerStaleMs: number;
  modelGateway: ModelGatewayRepository;
  workflows?: WorkflowPublicationService;
  workflowExecutions?: WorkflowExecutionService;
  workflowWorker?: WorkflowExecutionWorkerService;
  workflowTriggers?: WorkflowTriggerService;
  workflowLibrary?: WorkflowLibraryService;
  workflowPublicApi?: WorkflowPublicApiService;
  agentRuns?: AgentRunService;
  drama?: DramaService;
  dramaProduction?: DramaProductionService;
  dramaRender?: DramaRenderService;
  dramaInterop?: DramaInteropService;
  maintenanceToken: string;
  secureCookies: boolean;
  modelDiscovery?: ModelDiscoveryService;
  collaboration?: {
    publishMutation: (
      project: import("./domain.js").ProjectRecord,
      mutation: import("@infinite-canvas/contracts").CanvasMutation,
    ) => void;
    publishSnapshot: (project: import("./domain.js").ProjectRecord) => void;
  };
};

export function createApp(services: AppServices) {
  const app = new Hono<ApiEnv>();
  const eventRepository =
    services.eventRepository || new MemoryGenerationEventRepository();
  const modelDiscovery =
    services.modelDiscovery || new ModelDiscoveryService(services.modelGateway);
  app.onError((error, c) => {
    const id = c.get("requestId") || crypto.randomUUID();
    if (error instanceof DomainError)
      return c.json(
        { error: { code: error.code, message: error.message }, requestId: id },
        error.status,
      );
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "请求参数无效",
            details: error.issues,
          },
          requestId: id,
        },
        400,
      );
    console.error(error);
    return c.json(
      {
        error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" },
        requestId: id,
      },
      500,
    );
  });
  app.use("*", async (c, next) => {
    const id = c.req.header("x-request-id") || crypto.randomUUID();
    c.set("requestId", id);
    c.header("x-request-id", id);
    await next();
  });
  app.get("/health", (c) =>
    c.json({ data: { status: "ok" }, requestId: requestId(c) }),
  );
  app.get("/health/worker", async (c) => {
    const lastHeartbeatAt =
      await services.jobRepository.latestWorkerHeartbeat();
    const healthy = Boolean(
      lastHeartbeatAt &&
      Date.now() - Date.parse(lastHeartbeatAt) <= services.workerStaleMs,
    );
    return c.json(
      {
        data: {
          healthy,
          lastHeartbeatAt,
          staleAfterMs: services.workerStaleMs,
        },
        requestId: requestId(c),
      },
      healthy ? 200 : 503,
    );
  });

  const registerSchema = z.object({
    email: z.email(),
    password: z.string().min(8).max(128),
    name: z.string().trim().min(1).max(80),
  });
  app.post("/api/v1/auth/register", async (c) => {
    const input = registerSchema.parse(await c.req.json());
    const result = await services.identity.register(input);
    writeSession(c, result.token, services.secureCookies);
    return c.json(
      {
        data: { user: result.user, workspace: result.workspace },
        requestId: requestId(c),
      },
      201,
    );
  });
  const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
  });
  app.post("/api/v1/auth/login", async (c) => {
    const input = loginSchema.parse(await c.req.json());
    const result = await services.identity.login(input.email, input.password);
    writeSession(c, result.token, services.secureCookies);
    return c.json({ data: { user: result.user }, requestId: requestId(c) });
  });
  app.post("/api/v1/auth/logout", async (c) => {
    await services.identity.logout(getCookie(c, "ic_session"));
    deleteCookie(c, "ic_session", { path: "/" });
    return c.json({ data: { ok: true }, requestId: requestId(c) });
  });
  if (services.workflowTriggers)
    app.post("/api/v1/workflow-triggers/:triggerId/invoke", async (c) => {
      const length = Number(c.req.header("content-length") || 0);
      if (length > 1024 * 1024)
        throw new DomainError(
          "TRIGGER_PAYLOAD_TOO_LARGE",
          422,
          "Trigger payload 超过 1 MiB",
        );
      const token = c.req
        .header("authorization")
        ?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)?.[1];
      const idempotencyKey = c.req.header("idempotency-key")?.trim();
      if (
        !token ||
        !idempotencyKey ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 200
      )
        throw new DomainError(
          "TRIGGER_AUTH_REQUIRED",
          401,
          "Trigger token 或幂等键无效",
        );
      const raw = await c.req.text();
      if (Buffer.byteLength(raw) > 1024 * 1024)
        throw new DomainError(
          "TRIGGER_PAYLOAD_TOO_LARGE",
          422,
          "Trigger payload 超过 1 MiB",
        );
      let payload: unknown;
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        throw new DomainError(
          "INVALID_TRIGGER_PAYLOAD",
          422,
          "Trigger payload 必须是 JSON",
        );
      }
      return c.json(
        {
          data: await services.workflowTriggers!.invokeExternal(
            c.req.param("triggerId"),
            token,
            idempotencyKey,
            payload,
          ),
          requestId: requestId(c),
        },
        202,
      );
    });
  if (services.workflowPublicApi) {
    app.post("/api/v1/public/workflows/invoke", async (c) => {
      const { secret, idempotencyKey } = publicWorkflowCredentials(c);
      const raw = await readBoundedJson(
        c,
        1024 * 1024,
        "WORKFLOW_API_PAYLOAD_TOO_LARGE",
      );
      return c.json(
        {
          data: await services.workflowPublicApi!.invoke(
            secret,
            idempotencyKey,
            raw,
            requestId(c),
          ),
          requestId: requestId(c),
        },
        202,
      );
    });
    app.get("/api/v1/public/workflow-executions/:executionId", async (c) => {
      const { secret } = publicWorkflowCredentials(c, false);
      return c.json({
        data: await services.workflowPublicApi!.getExecution(
          secret,
          c.req.param("executionId"),
          requestId(c),
        ),
        requestId: requestId(c),
      });
    });
  }

  app.use("/api/v1/*", async (c, next) => {
    const token = getCookie(c, "ic_session");
    const user = await services.identity.authenticate(token);
    c.set("user", user);
    c.set("sessionToken", token!);
    await next();
  });
  app.get("/api/v1/me", (c) =>
    c.json({ data: c.get("user"), requestId: requestId(c) }),
  );
  if (services.drama) {
    app.get("/api/v1/workspaces/:workspaceId/drama-projects", async (c) =>
      c.json({
        data: await services.drama!.list(
          c.get("user").id,
          c.req.param("workspaceId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/workspaces/:workspaceId/drama-projects", async (c) =>
      c.json(
        {
          data: await services.drama!.create(
            c.get("user").id,
            c.req.param("workspaceId"),
            dramaCreateSchema.parse(await c.req.json()),
          ),
          requestId: requestId(c),
        },
        201,
      ),
    );
    app.get("/api/v1/drama-projects/:dramaId", async (c) =>
      c.json({
        data: await services.drama!.get(
          c.get("user").id,
          c.req.param("dramaId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.patch("/api/v1/drama-projects/:dramaId", async (c) =>
      c.json({
        data: await services.drama!.update(
          c.get("user").id,
          c.req.param("dramaId"),
          dramaUpdateSchema.parse(await c.req.json()),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/drama-projects/:dramaId/script-versions", async (c) =>
      c.json(
        {
          data: await services.drama!.addScript(
            c.get("user").id,
            c.req.param("dramaId"),
            dramaScriptSchema.parse(await c.req.json()),
          ),
          requestId: requestId(c),
        },
        201,
      ),
    );
    app.post("/api/v1/drama-projects/:dramaId/entities", async (c) =>
      c.json(
        {
          data: await services.drama!.addEntity(
            c.get("user").id,
            c.req.param("dramaId"),
            dramaEntitySchema.parse(await c.req.json()),
          ),
          requestId: requestId(c),
        },
        201,
      ),
    );
    app.post("/api/v1/drama-projects/:dramaId/shots", async (c) =>
      c.json(
        {
          data: await services.drama!.addShot(
            c.get("user").id,
            c.req.param("dramaId"),
            dramaShotSchema.parse(await c.req.json()),
          ),
          requestId: requestId(c),
        },
        201,
      ),
    );
  }
  if (services.dramaProduction) {
    app.get("/api/v1/drama-projects/:dramaId/production", async (c) =>
      c.json({
        data: await services.dramaProduction!.get(
          c.get("user").id,
          c.req.param("dramaId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/drama-projects/:dramaId/generations", async (c) =>
      c.json(
        {
          data: await services.dramaProduction!.generate(
            c.get("user").id,
            c.req.param("dramaId"),
            dramaGenerationSchema.parse(await c.req.json()),
          ),
          requestId: requestId(c),
        },
        202,
      ),
    );
    app.post(
      "/api/v1/drama-projects/:dramaId/generation-selection",
      async (c) =>
        c.json({
          data: await services.dramaProduction!.select(
            c.get("user").id,
            c.req.param("dramaId"),
            dramaSelectionSchema.parse(await c.req.json()),
          ),
          requestId: requestId(c),
        }),
    );
    app.post("/api/v1/drama-projects/:dramaId/timeline", async (c) =>
      c.json(
        {
          data: await services.dramaProduction!.timeline(
            c.get("user").id,
            c.req.param("dramaId"),
            dramaTimelineSchema.parse(await c.req.json()),
          ),
          requestId: requestId(c),
        },
        201,
      ),
    );
    app.post("/api/v1/drama-projects/:dramaId/reviews", async (c) =>
      c.json(
        {
          data: await services.dramaProduction!.review(
            c.get("user").id,
            c.req.param("dramaId"),
            dramaReviewSchema.parse(await c.req.json()),
          ),
          requestId: requestId(c),
        },
        201,
      ),
    );
  }
  if (services.dramaRender) {
    app.get("/api/v1/drama-projects/:dramaId/renders", async (c) =>
      c.json({
        data: await services.dramaRender!.list(
          c.get("user").id,
          c.req.param("dramaId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/drama-projects/:dramaId/renders", async (c) =>
      c.json(
        {
          data: await services.dramaRender!.create(
            c.get("user").id,
            c.req.param("dramaId"),
            dramaRenderCreateSchema.parse(await c.req.json()),
          ),
          requestId: requestId(c),
        },
        202,
      ),
    );
    app.post("/api/v1/drama-renders/:renderId/retry", async (c) => {
      const x = z
        .object({ mutationId: z.string().trim().min(8).max(200) })
        .strict()
        .parse(await c.req.json());
      return c.json(
        {
          data: await services.dramaRender!.retry(
            c.get("user").id,
            c.req.param("renderId"),
            x.mutationId,
          ),
          requestId: requestId(c),
        },
        202,
      );
    });
  }
  if (services.dramaInterop) {
    app.post("/api/v1/drama-projects/:dramaId/transfers/to-canvas", async (c) =>
      c.json(
        {
          data: await services.dramaInterop!.toCanvas(
            c.get("user").id,
            c.req.param("dramaId"),
            dramaToCanvasSchema.parse(await c.req.json()),
          ),
          requestId: requestId(c),
        },
        201,
      ),
    );
    app.post(
      "/api/v1/drama-projects/:dramaId/transfers/from-canvas",
      async (c) =>
        c.json(
          {
            data: await services.dramaInterop!.fromCanvas(
              c.get("user").id,
              c.req.param("dramaId"),
              dramaFromCanvasSchema.parse(await c.req.json()),
            ),
            requestId: requestId(c),
          },
          201,
        ),
    );
    app.post(
      "/api/v1/drama-projects/:dramaId/transfers/from-asset",
      async (c) =>
        c.json(
          {
            data: await services.dramaInterop!.fromAsset(
              c.get("user").id,
              c.req.param("dramaId"),
              dramaFromAssetSchema.parse(await c.req.json()),
            ),
            requestId: requestId(c),
          },
          201,
        ),
    );
  }
  app.get("/api/v1/workspaces", async (c) =>
    c.json({
      data: await services.workspaces.list(c.get("user").id),
      requestId: requestId(c),
    }),
  );
  app.post("/api/v1/workspaces", async (c) => {
    const input = z
      .object({ name: z.string().min(1) })
      .parse(await c.req.json());
    return c.json(
      {
        data: await services.workspaces.create(c.get("user").id, input.name),
        requestId: requestId(c),
      },
      201,
    );
  });
  app.get("/api/v1/workspaces/:workspaceId/projects", async (c) =>
    c.json({
      data: await services.projects.list(
        c.get("user").id,
        c.req.param("workspaceId"),
      ),
      requestId: requestId(c),
    }),
  );
  app.post("/api/v1/workspaces/:workspaceId/projects", async (c) => {
    const input = createProjectSchema.parse(await c.req.json());
    return c.json(
      {
        data: await services.projects.create(
          c.get("user").id,
          c.req.param("workspaceId"),
          input,
        ),
        requestId: requestId(c),
      },
      201,
    );
  });
  app.get("/api/v1/workspaces/:workspaceId/assets", async (c) =>
    c.json({
      data: await services.assets.list(
        c.get("user").id,
        c.req.param("workspaceId"),
      ),
      requestId: requestId(c),
    }),
  );
  app.post("/api/v1/workspaces/:workspaceId/assets", async (c) => {
    const result = await services.assets.upload(
      c.get("user").id,
      c.req.param("workspaceId"),
      {
        bytes: await services.assets.readUpload(c.req.raw),
        originalName: c.req.header("x-file-name") || "asset",
      },
    );
    return c.json({ data: result, requestId: requestId(c) }, 201);
  });
  app.get("/api/v1/assets/:assetId/content", async (c) => {
    const result = await services.assets.read(
      c.get("user").id,
      c.req.param("assetId"),
    );
    if ("url" in result && result.url) return c.redirect(result.url, 307);
    if (!("bytes" in result) || !result.bytes)
      throw new Error("Blob store returned no readable asset content");
    return c.body(new Uint8Array(result.bytes), 200, {
      "content-type": result.asset.mimeType,
      "content-length": String(result.asset.bytes),
      "cache-control": "private, max-age=300",
      "content-disposition": "inline",
    });
  });
  app.delete("/api/v1/assets/:assetId", async (c) => {
    await services.assets.delete(c.get("user").id, c.req.param("assetId"));
    return c.json({ data: { ok: true }, requestId: requestId(c) });
  });
  app.get("/api/v1/workspaces/:workspaceId/generation-jobs", async (c) =>
    c.json({
      data: await services.jobs.list(
        c.get("user").id,
        c.req.param("workspaceId"),
      ),
      requestId: requestId(c),
    }),
  );
  app.post("/api/v1/workspaces/:workspaceId/generation-jobs", async (c) => {
    const input = createGenerationJobSchema.parse(await c.req.json());
    const result = await services.jobs.create(
      c.get("user").id,
      c.req.param("workspaceId"),
      input,
    );
    return c.json(
      { data: result, requestId: requestId(c) },
      result.replayed ? 200 : 202,
    );
  });
  app.get("/api/v1/generation-jobs/:jobId", async (c) => {
    const job = await services.jobs.get(c.get("user").id, c.req.param("jobId"));
    if (!job) throw new DomainError("JOB_NOT_FOUND", 404, "生成任务不存在");
    return c.json({ data: job, requestId: requestId(c) });
  });
  app.get("/api/v1/generation-jobs/:jobId/events", async (c) => {
    const userId = c.get("user").id;
    const jobId = c.req.param("jobId");
    const job = await services.jobs.get(userId, jobId);
    if (!job) throw new DomainError("JOB_NOT_FOUND", 404, "生成任务不存在");
    const rawCursor =
      c.req.header("last-event-id") || c.req.query("after") || "0";
    const cursor = Number(rawCursor);
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new DomainError("INVALID_EVENT_CURSOR", 400, "事件游标无效");
    c.header("cache-control", "private, no-cache, no-store");
    c.header("x-accel-buffering", "no");
    return streamSSE(c, async (stream) => {
      let afterId = cursor;
      const deadline = Date.now() + 5 * 60_000;
      while (!stream.aborted && Date.now() < deadline) {
        const events = await eventRepository.listForUser(
          userId,
          jobId,
          afterId,
          100,
        );
        for (const event of events) {
          await stream.writeSSE({
            id: String(event.id),
            event: event.type,
            data: JSON.stringify(event),
          });
          afterId = event.id;
          if (event.type === "job.terminal") return;
        }
        if (!events.length) {
          const current = await services.jobs.get(userId, jobId);
          if (!current) return;
          if (isTerminalPhase(current.phase)) {
            await eventRepository.append(
              current.id,
              "job.terminal",
              {
                phase: current.phase,
                status: current.status,
                errorCode: current.errorCode,
                errorMessage: current.errorMessage,
              },
              new Date().toISOString(),
            );
            continue;
          }
          await stream.write(": heartbeat\n\n");
          await stream.sleep(750);
        }
      }
    });
  });
  app.post("/api/v1/generation-jobs/:jobId/cancel", async (c) =>
    c.json({
      data: await services.jobs.cancel(c.get("user").id, c.req.param("jobId")),
      requestId: requestId(c),
    }),
  );
  app.post("/api/v1/generation-jobs/:jobId/retry", async (c) =>
    c.json(
      {
        data: await services.jobs.retry(c.get("user").id, c.req.param("jobId")),
        requestId: requestId(c),
      },
      202,
    ),
  );
  app.get("/api/v1/models", async (c) => {
    const catalog = await services.modelGateway.catalog();
    return c.json({
      data: catalog.logicalModels.filter((model) => model.enabled),
      requestId: requestId(c),
    });
  });
  app.post("/api/v1/models/:logicalModelId/estimate", async (c) => {
    const input = billingEstimateSchema.parse(await c.req.json());
    return c.json({
      data: await services.jobs.estimate(
        c.req.param("logicalModelId"),
        input.capability,
        input.parameters,
      ),
      requestId: requestId(c),
    });
  });
  app.get("/api/v1/billing/wallet", async (c) =>
    c.json({
      data: await services.jobs.wallet(c.get("user").id),
      requestId: requestId(c),
    }),
  );
  app.get("/api/v1/billing/ledger", async (c) =>
    c.json({
      data: await services.jobs.ledger(c.get("user").id, 100),
      requestId: requestId(c),
    }),
  );
  app.get("/api/v1/projects/:projectId", async (c) => {
    const project = await services.projects.get(
      c.get("user").id,
      c.req.param("projectId"),
    );
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    return c.json({ data: project, requestId: requestId(c) });
  });
  app.get("/api/v1/projects/:projectId/checkpoints", async (c) =>
    c.json({
      data: await services.projects.listCheckpoints(
        c.get("user").id,
        c.req.param("projectId"),
      ),
      requestId: requestId(c),
    }),
  );
  app.post("/api/v1/projects/:projectId/checkpoints", async (c) => {
    const input = checkpointCreateSchema.parse(await c.req.json());
    return c.json(
      {
        data: await services.projects.createCheckpoint(
          c.get("user").id,
          c.req.param("projectId"),
          input,
        ),
        requestId: requestId(c),
      },
      201,
    );
  });
  app.get("/api/v1/projects/:projectId/checkpoints/:checkpointId", async (c) =>
    c.json({
      data: await services.projects.getCheckpoint(
        c.get("user").id,
        c.req.param("projectId"),
        c.req.param("checkpointId"),
      ),
      requestId: requestId(c),
    }),
  );
  app.delete(
    "/api/v1/projects/:projectId/checkpoints/:checkpointId",
    async (c) => {
      await services.projects.deleteCheckpoint(
        c.get("user").id,
        c.req.param("projectId"),
        c.req.param("checkpointId"),
      );
      return c.json({ data: { ok: true }, requestId: requestId(c) });
    },
  );
  app.post(
    "/api/v1/projects/:projectId/checkpoints/:checkpointId/restore",
    async (c) => {
      const input = checkpointRestoreSchema.parse(await c.req.json());
      const project = await services.projects.restoreCheckpoint(
        c.get("user").id,
        c.req.param("projectId"),
        c.req.param("checkpointId"),
        input.expectedRevision,
      );
      services.collaboration?.publishSnapshot(project);
      return c.json({
        data: project,
        requestId: requestId(c),
      });
    },
  );
  if (services.workflows) {
    app.post("/api/v1/projects/:projectId/workflows/publish", async (c) => {
      const input = publishWorkflowSchema.parse(await c.req.json());
      const result = await services.workflows!.publish(
        c.get("user").id,
        c.req.param("projectId"),
        input,
      );
      return c.json(
        { data: result, requestId: requestId(c) },
        result.publication ? (result.publication.replayed ? 200 : 201) : 422,
      );
    });
    app.get("/api/v1/projects/:projectId/workflow", async (c) =>
      c.json({
        data: await services.workflows!.getForProject(
          c.get("user").id,
          c.req.param("projectId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.get("/api/v1/workflows/:workflowId/versions", async (c) =>
      c.json({
        data: await services.workflows!.listVersions(
          c.get("user").id,
          c.req.param("workflowId"),
        ),
        requestId: requestId(c),
      }),
    );
  }
  if (services.workflowExecutions) {
    app.get("/api/v1/workflows/:workflowId/executions", async (c) =>
      c.json({
        data: await services.workflowExecutions!.list(
          c.get("user").id,
          c.req.param("workflowId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/workflows/:workflowId/executions", async (c) => {
      const input = createWorkflowExecutionSchema.parse(await c.req.json());
      const result = await services.workflowExecutions!.create(
        c.get("user").id,
        c.req.param("workflowId"),
        input,
      );
      return c.json(
        { data: result, requestId: requestId(c) },
        result.replayed ? 200 : 201,
      );
    });
    app.get("/api/v1/workflow-executions/:executionId", async (c) =>
      c.json({
        data: await services.workflowExecutions!.get(
          c.get("user").id,
          c.req.param("executionId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/workflow-executions/:executionId/cancel", async (c) =>
      c.json({
        data: await services.workflowExecutions!.cancel(
          c.get("user").id,
          c.req.param("executionId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post(
      "/api/v1/workflow-executions/:executionId/nodes/:nodeId/retry",
      async (c) =>
        c.json({
          data: await services.workflowExecutions!.retryNode(
            c.get("user").id,
            c.req.param("executionId"),
            c.req.param("nodeId"),
          ),
          requestId: requestId(c),
        }),
    );
    app.post(
      "/api/v1/workflow-executions/:executionId/signals/:eventKey",
      async (c) =>
        c.json({
          data: await services.workflowExecutions!.signal(
            c.get("user").id,
            c.req.param("executionId"),
            workflowStepKeySchema.parse(c.req.param("eventKey")),
          ),
          requestId: requestId(c),
        }),
    );
  }
  if (services.workflowTriggers) {
    app.get("/api/v1/workflows/:workflowId/triggers", async (c) =>
      c.json({
        data: await services.workflowTriggers!.list(
          c.get("user").id,
          c.req.param("workflowId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/workflows/:workflowId/triggers", async (c) => {
      const input = workflowTriggerCreateSchema.parse(await c.req.json());
      return c.json(
        {
          data: await services.workflowTriggers!.create(
            c.get("user").id,
            c.req.param("workflowId"),
            input,
          ),
          requestId: requestId(c),
        },
        201,
      );
    });
    app.delete("/api/v1/workflow-triggers/:triggerId", async (c) =>
      c.json({
        data: await services.workflowTriggers!.disable(
          c.get("user").id,
          c.req.param("triggerId"),
        ),
        requestId: requestId(c),
      }),
    );
  }
  if (services.workflowLibrary) {
    app.get("/api/v1/workspaces/:workspaceId/workflow-library", async (c) =>
      c.json({
        data: await services.workflowLibrary!.list(
          c.get("user").id,
          c.req.param("workspaceId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/workspaces/:workspaceId/workflow-folders", async (c) => {
      const input = z
        .object({ name: z.string().trim().min(1).max(120) })
        .strict()
        .parse(await c.req.json());
      return c.json(
        {
          data: await services.workflowLibrary!.createFolder(
            c.get("user").id,
            c.req.param("workspaceId"),
            input.name,
          ),
          requestId: requestId(c),
        },
        201,
      );
    });
    app.delete("/api/v1/workflow-folders/:folderId", async (c) => {
      await services.workflowLibrary!.deleteFolder(
        c.get("user").id,
        c.req.param("folderId"),
      );
      return c.json({ data: { ok: true }, requestId: requestId(c) });
    });
    app.patch("/api/v1/workflows/:workflowId/library", async (c) => {
      const input = workflowLibraryPatchSchema.parse(await c.req.json());
      return c.json({
        data: await services.workflowLibrary!.updateMetadata(
          c.get("user").id,
          c.req.param("workflowId"),
          input,
        ),
        requestId: requestId(c),
      });
    });
    app.get("/api/v1/workflows/:workflowId/export", async (c) => {
      const version = c.req.query("version")
        ? z.coerce.number().int().positive().parse(c.req.query("version"))
        : undefined;
      return c.json({
        data: await services.workflowLibrary!.export(
          c.get("user").id,
          c.req.param("workflowId"),
          version,
        ),
        requestId: requestId(c),
      });
    });
    app.post("/api/v1/workspaces/:workspaceId/workflows/import", async (c) => {
      const raw = await c.req.text();
      if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
        throw new DomainError(
          "WORKFLOW_BUNDLE_TOO_LARGE",
          422,
          "Workflow bundle 超过 2 MiB",
        );
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new DomainError(
          "WORKFLOW_BUNDLE_INVALID",
          422,
          "Workflow bundle 不是合法 JSON",
        );
      }
      const input = workflowImportSchema.parse(parsed);
      return c.json(
        {
          data: await services.workflowLibrary!.import(
            c.get("user").id,
            c.req.param("workspaceId"),
            input.bundle,
            input.name,
          ),
          requestId: requestId(c),
        },
        201,
      );
    });
    app.post(
      "/api/v1/workflow-templates/:workflowId/instantiate",
      async (c) => {
        const input = z
          .object({ name: z.string().trim().min(1).max(200).optional() })
          .strict()
          .parse(await c.req.json());
        return c.json(
          {
            data: await services.workflowLibrary!.instantiateTemplate(
              c.get("user").id,
              c.req.param("workflowId"),
              input.name,
            ),
            requestId: requestId(c),
          },
          201,
        );
      },
    );
  }
  if (services.workflowPublicApi) {
    app.get("/api/v1/workflows/:workflowId/api-tokens", async (c) =>
      c.json({
        data: await services.workflowPublicApi!.list(
          c.get("user").id,
          c.req.param("workflowId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.get("/api/v1/workflows/:workflowId/api-audit", async (c) =>
      c.json({
        data: await services.workflowPublicApi!.listAudit(
          c.get("user").id,
          c.req.param("workflowId"),
          z.coerce
            .number()
            .int()
            .min(1)
            .max(200)
            .default(50)
            .parse(c.req.query("limit")),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/workflows/:workflowId/api-tokens", async (c) => {
      const input = workflowApiTokenCreateSchema.parse(await c.req.json());
      return c.json(
        {
          data: await services.workflowPublicApi!.create(
            c.get("user").id,
            c.req.param("workflowId"),
            input,
          ),
          requestId: requestId(c),
        },
        201,
      );
    });
    app.delete("/api/v1/workflow-api-tokens/:tokenId", async (c) =>
      c.json({
        data: await services.workflowPublicApi!.revoke(
          c.get("user").id,
          c.req.param("tokenId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/workflow-api-tokens/:tokenId/rotate", async (c) =>
      c.json({
        data: await services.workflowPublicApi!.rotate(
          c.get("user").id,
          c.req.param("tokenId"),
        ),
        requestId: requestId(c),
      }),
    );
  }
  app.delete("/api/v1/projects/:projectId", async (c) => {
    await services.projects.delete(c.get("user").id, c.req.param("projectId"));
    return c.json({ data: { ok: true }, requestId: requestId(c) });
  });
  if (services.agentRuns) {
    app.get("/api/v1/workspaces/:workspaceId/agent-sessions", async (c) =>
      c.json({
        data: await services.agentRuns!.listSessions(
          c.get("user").id,
          c.req.param("workspaceId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/workspaces/:workspaceId/agent-sessions", async (c) => {
      const input = agentSessionCreateSchema.parse(await c.req.json());
      return c.json(
        {
          data: await services.agentRuns!.createSession(
            c.get("user").id,
            c.req.param("workspaceId"),
            input,
          ),
          requestId: requestId(c),
        },
        201,
      );
    });
    app.get("/api/v1/agent-sessions/:sessionId/runs", async (c) =>
      c.json({
        data: await services.agentRuns!.listRuns(
          c.get("user").id,
          c.req.param("sessionId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/agent-sessions/:sessionId/runs", async (c) => {
      const input = agentRunCreateSchema.parse(await c.req.json());
      return c.json(
        {
          data: await services.agentRuns!.createRun(
            c.get("user").id,
            c.req.param("sessionId"),
            input,
          ),
          requestId: requestId(c),
        },
        202,
      );
    });
    app.get("/api/v1/agent-runs/:runId", async (c) =>
      c.json({
        data: await services.agentRuns!.getRun(
          c.get("user").id,
          c.req.param("runId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/agent-runs/:runId/cancel", async (c) =>
      c.json({
        data: await services.agentRuns!.cancel(
          c.get("user").id,
          c.req.param("runId"),
        ),
        requestId: requestId(c),
      }),
    );
    app.post("/api/v1/agent-runs/:runId/retry", async (c) =>
      c.json(
        {
          data: await services.agentRuns!.retry(
            c.get("user").id,
            c.req.param("runId"),
          ),
          requestId: requestId(c),
        },
        202,
      ),
    );
    app.post("/api/v1/agent-approvals/:approvalId/decision", async (c) => {
      const input = agentApprovalDecisionSchema.parse(await c.req.json());
      return c.json({
        data: await services.agentRuns!.decideApproval(
          c.get("user").id,
          c.req.param("approvalId"),
          input.decision,
        ),
        requestId: requestId(c),
      });
    });
    app.get("/api/v1/agent-runs/:runId/events", async (c) => {
      const userId = c.get("user").id;
      const runId = c.req.param("runId");
      let cursor = Number(
        c.req.header("last-event-id") || c.req.query("after") || 0,
      );
      if (!Number.isSafeInteger(cursor) || cursor < 0)
        throw new DomainError("INVALID_EVENT_CURSOR", 400, "事件游标无效");
      await services.agentRuns!.getRun(userId, runId);
      c.header("cache-control", "private, no-cache, no-store");
      c.header("x-accel-buffering", "no");
      return streamSSE(c, async (stream) => {
        const deadline = Date.now() + 5 * 60_000;
        while (!stream.aborted && Date.now() < deadline) {
          const detail = await services.agentRuns!.getRun(userId, runId);
          const events = detail.events.filter(
            (event) => event.sequence > cursor,
          );
          for (const event of events) {
            await stream.writeSSE({
              id: String(event.sequence),
              event: event.type,
              data: JSON.stringify(event),
            });
            cursor = event.sequence;
          }
          if (["succeeded", "failed", "cancelled"].includes(detail.run.status))
            return;
          if (!events.length) {
            await stream.write(": heartbeat\n\n");
            await stream.sleep(750);
          }
        }
      });
    });
  }
  app.post("/api/v1/projects/:projectId/mutations", async (c) => {
    const input = mutationSchema.parse(await c.req.json());
    const result = await services.projects.mutate(
      c.get("user").id,
      c.req.param("projectId"),
      input,
    );
    if (!result.replayed)
      services.collaboration?.publishMutation(result.project, input);
    return c.json({
      data: result,
      requestId: requestId(c),
    });
  });
  app.use("/internal/v1/generation/*", async (c, next) => {
    requireBearerToken(
      c.req.header("authorization"),
      services.workerToken,
      "Worker",
    );
    await next();
  });
  app.use("/internal/v1/drama-render/*", async (c, next) => {
    requireBearerToken(
      c.req.header("authorization"),
      services.workerToken,
      "Worker",
    );
    await next();
  });
  app.use("/internal/v1/workflow/*", async (c, next) => {
    requireBearerToken(
      c.req.header("authorization"),
      services.workerToken,
      "Worker",
    );
    await next();
  });
  app.use("/internal/v1/agent/*", async (c, next) => {
    requireBearerToken(
      c.req.header("authorization"),
      services.workerToken,
      "Worker",
    );
    await next();
  });
  app.use("/internal/v1/model-gateway/*", async (c, next) => {
    requireBearerToken(
      c.req.header("authorization"),
      services.workerToken,
      "Worker",
    );
    await next();
  });
  app.use("/internal/v1/maintenance/*", async (c, next) => {
    requireBearerToken(
      c.req.header("authorization"),
      services.maintenanceToken,
      "Maintenance",
    );
    await next();
  });
  app.post("/internal/v1/generation/claim", async (c) => {
    const input = workerClaimSchema.parse(await c.req.json());
    const now = new Date();
    const leaseMs = Math.max(30_000, Math.min(300_000, input.leaseMs));
    const jobs = await services.jobRepository.claim({
      workerId: input.workerId,
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
      limit: input.limit,
    });
    return c.json({ data: jobs, requestId: requestId(c) });
  });
  if (services.dramaRender) {
    app.post("/internal/v1/drama-render/claim", async (c) => {
      const x = workerClaimSchema.parse(await c.req.json());
      return c.json({
        data: await services.dramaRender!.claim(x.workerId, x.limit, x.leaseMs),
        requestId: requestId(c),
      });
    });
    app.post("/internal/v1/drama-render/heartbeat", async (c) => {
      const x = dramaRenderHeartbeatSchema.parse(await c.req.json());
      return c.json({
        data: {
          renewed: await services.dramaRender!.heartbeat(
            x.workerId,
            x.renderIds,
          ),
        },
        requestId: requestId(c),
      });
    });
    app.post(
      "/internal/v1/drama-render/jobs/:renderId/transition",
      async (c) => {
        const x = dramaRenderTransitionSchema.parse(await c.req.json());
        return c.json({
          data: await services.dramaRender!.transition(
            x.workerId,
            c.req.param("renderId"),
            x.status,
            x.patch,
          ),
          requestId: requestId(c),
        });
      },
    );
    app.get(
      "/internal/v1/drama-render/jobs/:renderId/assets/:assetId",
      async (c) => {
        const workerId = c.req.header("x-worker-id")?.trim();
        if (!workerId)
          throw new DomainError("WORKER_ID_REQUIRED", 400, "缺少 Worker 标识");
        const x = await services.dramaRender!.readInput(
          workerId,
          c.req.param("renderId"),
          c.req.param("assetId"),
        );
        return c.body(new Uint8Array(x.bytes), 200, {
          "content-type": x.asset.mimeType,
          "content-length": String(x.asset.bytes),
          "cache-control": "no-store",
        });
      },
    );
    app.post("/internal/v1/drama-render/jobs/:renderId/output", async (c) => {
      const workerId = c.req.header("x-worker-id")?.trim();
      if (!workerId)
        throw new DomainError("WORKER_ID_REQUIRED", 400, "缺少 Worker 标识");
      const bytes = await services.assets.readUpload(c.req.raw);
      const x = await services.dramaRender!.persistOutput(
        workerId,
        c.req.param("renderId"),
        bytes,
        c.req.header("x-file-name") || "render-output",
      );
      return c.json({ data: x, requestId: requestId(c) }, 201);
    });
  }
  if (services.workflowWorker) {
    app.post("/internal/v1/workflow/claim", async (c) => {
      const input = workflowWorkerClaimSchema.parse(await c.req.json());
      const now = new Date();
      const leaseMs = Math.max(30_000, Math.min(300_000, input.leaseMs));
      return c.json({
        data: await services.workflowWorker!.claim({
          workerId: input.workerId,
          now: now.toISOString(),
          leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
          limit: input.limit,
        }),
        requestId: requestId(c),
      });
    });
    app.post("/internal/v1/workflow/heartbeat", async (c) => {
      const input = workflowWorkerHeartbeatSchema.parse(await c.req.json());
      const now = new Date();
      const renewed = await services.workflowWorker!.heartbeat(
        input.workerId,
        input.executionIds,
        now.toISOString(),
        new Date(now.getTime() + 90_000).toISOString(),
      );
      return c.json({ data: { renewed }, requestId: requestId(c) });
    });
    app.post(
      "/internal/v1/workflow/executions/:executionId/transition",
      async (c) => {
        const input = workflowWorkerTransitionSchema.parse(await c.req.json());
        return c.json({
          data: await services.workflowWorker!.transition({
            ...input,
            executionId: c.req.param("executionId"),
            now: new Date().toISOString(),
          }),
          requestId: requestId(c),
        });
      },
    );
    app.post(
      "/internal/v1/workflow/executions/:executionId/generation",
      async (c) => {
        const input = workflowGenerationSchema.parse(await c.req.json());
        const executionId = c.req.param("executionId");
        const record = await services.workflowWorker!.getLeased(
          input.workerId,
          executionId,
          new Date().toISOString(),
        );
        requireWorkflowGenerationNode(record, input);
        const clientRequestId = workflowGenerationRequestId(
          executionId,
          input.nodeId,
          input.attempt,
        );
        const result = await services.jobs.create(
          record.createdBy,
          record.workspaceId,
          {
            capability: input.capability,
            logicalModelId: input.logicalModelId,
            clientRequestId,
            parameters: input.parameters,
          },
        );
        if (
          result.job.clientRequestId !== clientRequestId ||
          result.job.capability !== input.capability ||
          result.job.logicalModelId !== input.logicalModelId
        )
          throw new DomainError(
            "WORKFLOW_GENERATION_CONFLICT",
            409,
            "幂等生成请求与已有任务不一致",
          );
        return c.json({ data: result, requestId: requestId(c) });
      },
    );
    app.post(
      "/internal/v1/workflow/executions/:executionId/generation/cancel",
      async (c) => {
        const input = workflowGenerationCancelSchema.parse(await c.req.json());
        const executionId = c.req.param("executionId");
        const record = await services.workflowWorker!.getLeased(
          input.workerId,
          executionId,
          new Date().toISOString(),
        );
        requireWorkflowGenerationNode(record, input);
        const job = await services.jobRepository.getByClientRequest(
          record.createdBy,
          record.workspaceId,
          workflowGenerationRequestId(executionId, input.nodeId, input.attempt),
        );
        if (!job) return c.json({ data: null, requestId: requestId(c) });
        const cancelled = isTerminalPhase(job.phase)
          ? job
          : await services.jobs.cancel(record.createdBy, job.id);
        return c.json({ data: cancelled, requestId: requestId(c) });
      },
    );
  }
  if (services.agentRuns) {
    app.post("/internal/v1/agent/claim", async (c) => {
      const input = agentWorkerClaimSchema.parse(await c.req.json());
      return c.json({
        data: await services.agentRuns!.claim(
          input.workerId,
          input.limit,
          input.leaseMs,
        ),
        requestId: requestId(c),
      });
    });
    app.post("/internal/v1/agent/heartbeat", async (c) => {
      const input = agentWorkerHeartbeatSchema.parse(await c.req.json());
      return c.json({
        data: {
          renewed: await services.agentRuns!.heartbeat(
            input.workerId,
            input.runIds,
            input.leaseMs,
          ),
        },
        requestId: requestId(c),
      });
    });
    app.post("/internal/v1/agent/runs/:runId/transition", async (c) => {
      const input = agentWorkerTransitionSchema.parse(await c.req.json());
      return c.json({
        data: await services.agentRuns!.transition(
          input.workerId,
          c.req.param("runId"),
          input.operation,
        ),
        requestId: requestId(c),
      });
    });
    app.post("/internal/v1/agent/runs/:runId/context", async (c) => {
      const input = agentWorkerIdentitySchema.parse(await c.req.json());
      return c.json({
        data: await services.agentRuns!.toolContext(
          input.workerId,
          c.req.param("runId"),
        ),
        requestId: requestId(c),
      });
    });
    app.post("/internal/v1/agent/runs/:runId/tools", async (c) => {
      const input = agentWorkerToolSchema.parse(await c.req.json());
      const mutation = await services.agentRuns!.executeTool(
        input.workerId,
        c.req.param("runId"),
        input.call as AgentRemoteToolCall,
      );
      services.collaboration?.publishSnapshot(mutation.project);
      return c.json({ data: mutation, requestId: requestId(c) });
    });
  }
  if (services.workflowTriggers) {
    app.post("/internal/v1/workflow/triggers/schedules/claim", async (c) => {
      const input = workflowWorkerClaimSchema.parse(await c.req.json());
      return c.json({
        data: await services.workflowTriggers!.claimSchedules(
          input.workerId,
          input.limit,
          input.leaseMs,
        ),
        requestId: requestId(c),
      });
    });
    app.post(
      "/internal/v1/workflow/triggers/schedules/:triggerId/dispatch",
      async (c) => {
        const input = z
          .object({ workerId: z.string().trim().min(1).max(160) })
          .strict()
          .parse(await c.req.json());
        return c.json({
          data: await services.workflowTriggers!.dispatchSchedule(
            input.workerId,
            c.req.param("triggerId"),
          ),
          requestId: requestId(c),
        });
      },
    );
  }
  app.post("/internal/v1/generation/heartbeat", async (c) => {
    const input = workerHeartbeatSchema.parse(await c.req.json());
    const now = new Date();
    await services.jobRepository.recordWorkerHeartbeat(
      input.workerId,
      now.toISOString(),
    );
    const renewed = await services.jobRepository.heartbeat(
      input.workerId,
      input.jobIds,
      now.toISOString(),
      new Date(now.getTime() + 90_000).toISOString(),
    );
    return c.json({ data: { renewed }, requestId: requestId(c) });
  });
  app.post("/internal/v1/generation/jobs/:jobId/transition", async (c) => {
    const input = workerTransitionSchema.parse(await c.req.json());
    const job = await services.jobRepository.transitionByWorker({
      ...input,
      jobId: c.req.param("jobId"),
      now: new Date().toISOString(),
    });
    if (isTerminalPhase(job.phase))
      await eventRepository
        .append(
          job.id,
          "job.terminal",
          {
            phase: job.phase,
            status: job.status,
            errorCode: job.errorCode,
            errorMessage: job.errorMessage,
          },
          new Date().toISOString(),
        )
        .catch((error) =>
          console.error("generation terminal event append failed", error),
        );
    return c.json({ data: job, requestId: requestId(c) });
  });
  app.post("/internal/v1/generation/jobs/:jobId/events", async (c) => {
    const input = workerEventSchema.parse(await c.req.json());
    const job = await services.jobRepository.getForWorker(
      input.workerId,
      c.req.param("jobId"),
      new Date().toISOString(),
    );
    if (!job) throw new DomainError("JOB_LEASE_LOST", 409, "任务租约已失效");
    if (job.capability !== "text" && job.capability !== "agent")
      throw new DomainError(
        "JOB_EVENT_UNSUPPORTED",
        409,
        "仅文本任务支持增量事件",
      );
    return c.json(
      {
        data: await eventRepository.append(
          job.id,
          input.type,
          { delta: input.delta },
          new Date().toISOString(),
        ),
        requestId: requestId(c),
      },
      201,
    );
  });
  app.post("/internal/v1/generation/jobs/:jobId/assets", async (c) => {
    const workerId = c.req.header("x-worker-id")?.trim();
    if (!workerId)
      throw new DomainError("WORKER_ID_REQUIRED", 400, "缺少 Worker 标识");
    const now = new Date().toISOString();
    const job = await services.jobRepository.getForWorker(
      workerId,
      c.req.param("jobId"),
      now,
    );
    if (!job) throw new DomainError("JOB_LEASE_LOST", 409, "任务租约已失效");
    if (
      !new Set(["submitted", "polling", "result_ready", "persisting"]).has(
        job.phase,
      )
    )
      throw new DomainError(
        "JOB_NOT_READY_FOR_ASSET",
        409,
        "任务尚未进入结果持久化阶段",
      );
    const result = await services.assets.upload(job.ownerId, job.workspaceId, {
      bytes: await services.assets.readUpload(c.req.raw),
      originalName: c.req.header("x-file-name") || `${job.id}-result`,
    });
    return c.json({ data: result, requestId: requestId(c) }, 201);
  });
  app.get("/internal/v1/generation/jobs/:jobId/assets/:assetId", async (c) => {
    const workerId = c.req.header("x-worker-id")?.trim();
    if (!workerId)
      throw new DomainError("WORKER_ID_REQUIRED", 400, "缺少 Worker 标识");
    const job = await services.jobRepository.getForWorker(
      workerId,
      c.req.param("jobId"),
      new Date().toISOString(),
    );
    if (!job) throw new DomainError("JOB_LEASE_LOST", 409, "任务租约已失效");
    const result = await services.assets.readBytes(
      job.ownerId,
      c.req.param("assetId"),
    );
    if (result.asset.workspaceId !== job.workspaceId)
      throw new DomainError("ASSET_NOT_FOUND", 404, "素材不存在");
    return c.body(new Uint8Array(result.bytes), 200, {
      "content-type": result.asset.mimeType,
      "content-length": String(result.asset.bytes),
      "cache-control": "private, no-store",
    });
  });
  app.post("/internal/v1/model-gateway/resolve", async (c) => {
    const input = resolveModelSchema.parse(await c.req.json());
    const resolved = await services.modelGateway.resolve(
      input.capability,
      input.logicalModelId,
      input.preferredChannelId,
    );
    if (!resolved)
      throw new DomainError("MODEL_UNAVAILABLE", 404, "没有可用的模型渠道");
    return c.json({ data: resolved, requestId: requestId(c) });
  });
  app.post("/internal/v1/model-gateway/health", async (c) => {
    const input = modelHealthSchema.parse(await c.req.json());
    await services.modelGateway.reportHealth(
      input.upstreamModelId,
      input.outcome,
      new Date().toISOString(),
    );
    return c.json({ data: { accepted: true }, requestId: requestId(c) });
  });
  app.put("/internal/v1/maintenance/model-protocols/:id", async (c) => {
    const input = protocolSchema.parse(await c.req.json());
    if (input.adapter === "custom") validateCustomProtocol(input.config);
    return c.json({
      data: await services.modelGateway.saveProtocol({
        ...input,
        id: c.req.param("id"),
      }),
      requestId: requestId(c),
    });
  });
  app.put("/internal/v1/maintenance/model-channels/:id", async (c) => {
    const input = channelSchema.parse(await c.req.json());
    return c.json({
      data: await services.modelGateway.saveChannel({
        ...input,
        id: c.req.param("id"),
        credentialConfigured: false,
      }),
      requestId: requestId(c),
    });
  });
  app.route(
    "/internal/v1/maintenance/model-channels",
    createModelDiscoveryApi(modelDiscovery, services.modelGateway),
  );
  app.put("/internal/v1/maintenance/upstream-models/:id", async (c) => {
    const input = upstreamModelSchema.parse(await c.req.json());
    return c.json({
      data: await services.modelGateway.saveUpstreamModel({
        ...input,
        id: c.req.param("id"),
      }),
      requestId: requestId(c),
    });
  });
  app.put("/internal/v1/maintenance/logical-models/:id", async (c) => {
    const input = logicalModelSchema.parse(await c.req.json());
    return c.json({
      data: await services.modelGateway.saveLogicalModel({
        ...input,
        id: c.req.param("id"),
      }),
      requestId: requestId(c),
    });
  });
  app.put("/internal/v1/maintenance/model-bindings/:id", async (c) => {
    const input = bindingSchema.parse(await c.req.json());
    return c.json({
      data: await services.modelGateway.saveBinding({
        ...input,
        id: c.req.param("id"),
      }),
      requestId: requestId(c),
    });
  });
  app.put(
    "/internal/v1/maintenance/billing/price-rules/:logicalModelId",
    async (c) => {
      const input = billingPriceRuleSchema.parse(await c.req.json());
      return c.json({
        data: await services.jobRepository.savePriceRule({
          ...input,
          logicalModelId: c.req.param("logicalModelId"),
          updatedAt: new Date().toISOString(),
        }),
        requestId: requestId(c),
      });
    },
  );
  app.post("/internal/v1/maintenance/billing/wallet-adjustments", async (c) => {
    const input = walletAdjustmentSchema.parse(await c.req.json());
    return c.json({
      data: await services.jobRepository.adjustWallet({
        ...input,
        now: new Date().toISOString(),
      }),
      requestId: requestId(c),
    });
  });
  return app;
}

function requireBearerToken(
  header: string | undefined,
  expected: string,
  subject: string,
) {
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    throw new DomainError("UNAUTHENTICATED", 401, `${subject} 凭据无效`);
}

const idSchema = z.string().min(1).max(128);
const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});
const viewportSchema = positionSchema.extend({
  k: z.number().finite().positive(),
});
const nodeSchema = z
  .object({
    id: idSchema,
    type: z.string().min(1).max(128),
    title: z.string().max(10_000),
    position: positionSchema,
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    schemaVersion: z.number().int().positive().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    pluginRef: z
      .object({ id: idSchema, version: z.string().min(1).max(128) })
      .optional(),
  })
  .passthrough();
const connectionSchema = z.object({
  id: idSchema,
  fromNodeId: idSchema,
  toNodeId: idSchema,
  fromPortId: idSchema.optional(),
  toPortId: idSchema.optional(),
});
const canvasOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("node.upsert"), node: nodeSchema }),
  z.object({
    type: z.literal("node.remove"),
    nodeIds: z.array(idSchema).min(1).max(1_000),
  }),
  z.object({
    type: z.literal("node.move"),
    nodeId: idSchema,
    position: positionSchema,
  }),
  z.object({
    type: z.literal("node.resize"),
    nodeId: idSchema,
    size: z.object({
      width: z.number().finite().positive(),
      height: z.number().finite().positive(),
    }),
  }),
  z.object({
    type: z.literal("connection.upsert"),
    connection: connectionSchema,
  }),
  z.object({
    type: z.literal("connection.remove"),
    connectionIds: z.array(idSchema).min(1).max(1_000),
  }),
  z.object({ type: z.literal("viewport.set"), viewport: viewportSchema }),
  z.object({
    type: z.literal("document.sync"),
    patch: z
      .object({
        nodes: z.array(nodeSchema).max(10_000).optional(),
        connections: z.array(connectionSchema).max(20_000).optional(),
        chatSessions: z.array(z.unknown()).max(10_000).optional(),
        activeChatId: z.string().max(128).nullable().optional(),
        backgroundMode: z.enum(["lines", "dots", "blank"]).optional(),
        showImageInfo: z.boolean().optional(),
        viewport: viewportSchema.optional(),
      })
      .strict(),
  }),
  z.object({
    type: z.literal("document.patch"),
    patch: z
      .object({
        title: z.string().trim().min(1).max(10_000).optional(),
        backgroundMode: z.enum(["lines", "dots", "blank"]).optional(),
        showImageInfo: z.boolean().optional(),
        activeChatId: z.string().max(128).nullable().optional(),
      })
      .strict(),
  }),
]);
const mutationSchema = z.object({
  mutationId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  baseRevision: z.number().int().nonnegative(),
  clientId: z.string().min(1).max(128),
  createdAt: z.iso.datetime(),
  operations: z.array(canvasOperationSchema).min(1).max(1_000),
});
const canvasDocumentSchema = z
  .object({
    id: idSchema,
    schemaVersion: z.literal(4),
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(10_000),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    nodes: z.array(nodeSchema).max(10_000),
    connections: z.array(connectionSchema).max(20_000),
    chatSessions: z.array(z.unknown()).max(10_000),
    activeChatId: z.string().max(128).nullable(),
    backgroundMode: z.enum(["lines", "dots", "blank"]),
    showImageInfo: z.boolean(),
    viewport: viewportSchema,
  })
  .strict();
const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(10_000),
  projectId: idSchema.optional(),
  document: canvasDocumentSchema.optional(),
});
const checkpointCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_000).optional(),
  })
  .strict();
const checkpointRestoreSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();
const createGenerationJobSchema = z.object({
  capability: z.enum(["text", "image", "video", "audio", "agent"]),
  logicalModelId: z.string().trim().min(1).max(160),
  clientRequestId: z.string().trim().min(1).max(160),
  parameters: z.record(z.string(), z.unknown()),
});
const publishWorkflowSchema = z
  .object({
    publicationId: z.string().trim().min(1).max(160),
    expectedProjectRevision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(200).optional(),
    entryNodeIds: z.array(z.string().min(1).max(128)).max(1_000).optional(),
  })
  .strict();
const createWorkflowExecutionSchema = z
  .object({
    executionId: z.uuid().optional(),
    version: z.number().int().positive().optional(),
    startNodeIds: z.array(z.string().min(1).max(160)).max(256).optional(),
    initialInputs: z
      .record(z.string().min(1).max(160), z.unknown())
      .refine(
        (value) =>
          Object.keys(value).length <= 256 &&
          Buffer.byteLength(JSON.stringify(value)) <= 1024 * 1024,
        "initialInputs exceeds limits",
      )
      .optional(),
  })
  .strict();
const workflowTriggerCreateSchema = z
  .object({
    kind: z.enum(["webhook", "form", "email", "schedule"]),
    targetNodeId: z.string().trim().min(1).max(160),
    version: z.number().int().positive().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    nextRunAt: z.iso.datetime().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const rate = value.config.rateLimitPerMinute;
    if (
      rate !== undefined &&
      (!Number.isInteger(rate) || Number(rate) < 1 || Number(rate) > 600)
    )
      context.addIssue({
        code: "custom",
        path: ["config", "rateLimitPerMinute"],
        message: "rateLimitPerMinute must be 1..600",
      });
    if (value.kind === "schedule") {
      const interval = value.config.intervalSeconds;
      if (
        !Number.isInteger(interval) ||
        Number(interval) < 60 ||
        Number(interval) > 2_592_000
      )
        context.addIssue({
          code: "custom",
          path: ["config", "intervalSeconds"],
          message: "intervalSeconds must be 60..2592000",
        });
    }
  });
const workflowApiTokenCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scopes: z
      .array(z.enum(["invoke", "read_execution"]))
      .min(1)
      .max(2)
      .refine(
        (value) => new Set(value).size === value.length,
        "scopes must be unique",
      ),
    version: z.number().int().positive().optional(),
    rateLimitPerMinute: z.number().int().min(1).max(600).default(60),
  })
  .strict();
const workflowPortImportSchema = z
  .object({
    id: z.string().min(1).max(160),
    valueType: z.string().min(1).max(160),
    required: z.boolean().optional(),
    multiple: z.boolean().optional(),
  })
  .strict();
const workflowDefinitionImportSchema = z
  .object({
    id: z.string().min(1).max(160),
    schemaVersion: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(160),
            type: z.string().min(1).max(160),
            inputs: z.array(workflowPortImportSchema).max(100),
            outputs: z.array(workflowPortImportSchema).max(100),
            config: z.unknown(),
            requiredCapabilities: z
              .array(z.string().max(160))
              .max(100)
              .optional(),
            credentialRefs: z.array(z.string().max(160)).max(100).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(1_000),
    edges: z
      .array(
        z
          .object({
            id: z.string().min(1).max(160),
            fromNodeId: z.string().min(1).max(160),
            fromPortId: z.string().min(1).max(160),
            toNodeId: z.string().min(1).max(160),
            toPortId: z.string().min(1).max(160),
          })
          .strict(),
      )
      .max(5_000),
    entryNodeIds: z.array(z.string().min(1).max(160)).max(1_000).optional(),
  })
  .strict();
const workflowBundleSchema = z
  .object({
    format: z.literal("infinite-canvas.workflow"),
    formatVersion: z.literal(1),
    exportedAt: z.iso.datetime(),
    workflow: z
      .object({
        name: z.string().trim().min(1).max(200),
        description: z.string().max(2_000),
        tags: z.array(z.string().trim().min(1).max(80)).max(20),
      })
      .strict(),
    version: z
      .object({
        number: z.number().int().positive(),
        definition: workflowDefinitionImportSchema,
      })
      .strict(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const workflowImportSchema = z
  .object({
    bundle: workflowBundleSchema,
    name: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
const workflowLibraryPatchSchema = z
  .object({
    folderId: z.uuid().nullable().optional(),
    coverAssetId: z.uuid().nullable().optional(),
    description: z.string().max(2_000).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    isTemplate: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  );
const workerClaimSchema = z.object({
  workerId: z.string().trim().min(1).max(160),
  limit: z.number().int().min(1).max(50).default(20),
  leaseMs: z.number().int().default(90_000),
});
const workerHeartbeatSchema = z.object({
  workerId: z.string().trim().min(1).max(160),
  jobIds: z.array(z.uuid()).max(50),
});
const workflowWorkerClaimSchema = z.object({
  workerId: z.string().trim().min(1).max(160),
  limit: z.number().int().min(1).max(50).default(20),
  leaseMs: z.number().int().min(1).max(300_000).default(90_000),
});
const workflowWorkerHeartbeatSchema = z.object({
  workerId: z.string().trim().min(1).max(160),
  executionIds: z.array(z.uuid()).max(50),
});
const agentSessionCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
const agentRunCreateSchema = z
  .object({
    prompt: z.string().trim().min(1).max(20_000),
    attachments: z
      .array(
        z
          .object({
            assetId: z.uuid(),
            kind: z.enum(["image", "video", "audio", "file"]),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    modelId: z.string().trim().min(1).max(160).optional(),
    parameters: z.record(z.string(), z.unknown()).default({}),
    skillPolicy: z.record(z.string(), z.unknown()).default({}),
    maxAttempts: z.number().int().min(1).max(10).default(3),
  })
  .strict()
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value)) <= 1024 * 1024,
    "Agent Run input exceeds 1 MiB",
  );
const agentApprovalDecisionSchema = z
  .object({ decision: z.enum(["approved", "declined"]) })
  .strict();
const agentWorkerClaimSchema = z
  .object({
    workerId: z.string().trim().min(1).max(160),
    limit: z.number().int().min(1).max(50).default(20),
    leaseMs: z.number().int().min(30_000).max(300_000).default(90_000),
  })
  .strict();
const agentWorkerHeartbeatSchema = z
  .object({
    workerId: z.string().trim().min(1).max(160),
    runIds: z.array(z.uuid()).max(50),
    leaseMs: z.number().int().min(30_000).max(300_000).default(90_000),
  })
  .strict();
const agentWorkerOperationSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("run.start"), plan: z.unknown().optional() })
    .strict(),
  z
    .object({
      type: z.literal("event.append"),
      eventType: z.string().trim().min(1).max(160),
      data: z.record(z.string(), z.unknown()).default({}),
    })
    .strict(),
  z
    .object({
      type: z.literal("subtask.upsert"),
      subtask: z
        .object({
          id: z.uuid().optional(),
          kind: z.string().trim().min(1).max(160),
          title: z.string().trim().min(1).max(500),
          status: z.enum([
            "pending",
            "running",
            "succeeded",
            "failed",
            "skipped",
          ]),
          input: z.unknown().optional(),
          output: z.unknown().optional(),
          error: z.unknown().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("result.add"),
      result: z
        .object({
          id: z.uuid().optional(),
          kind: z.enum([
            "text",
            "image",
            "video",
            "audio",
            "asset",
            "canvas_operation",
            "drama_item",
          ]),
          payload: z.record(z.string(), z.unknown()),
          assetId: z.uuid().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("approval.request"),
      action: z.enum(["delete", "batch_paid_generation", "external_access"]),
      request: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z.object({ type: z.literal("run.complete") }).strict(),
  z
    .object({
      type: z.literal("run.fail"),
      error: z
        .object({
          code: z.string().trim().min(1).max(160),
          message: z.string().max(2000),
        })
        .strict(),
    })
    .strict(),
]);
const agentWorkerTransitionSchema = z
  .object({
    workerId: z.string().trim().min(1).max(160),
    operation: agentWorkerOperationSchema,
  })
  .strict()
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value)) <= 1024 * 1024,
    "Agent transition exceeds 1 MiB",
  );
const agentWorkerIdentitySchema = z
  .object({ workerId: z.string().trim().min(1).max(160) })
  .strict();
const agentToolRecordSchema = z.record(z.string().max(160), z.unknown());
const agentToolPositionSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();
const agentCanvasToolOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("add_node"),
      nodeType: z.string().trim().min(1).max(64).optional(),
      id: z.string().trim().min(1).max(160).optional(),
      title: z.string().max(200).optional(),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      width: z.number().positive().max(100_000).optional(),
      height: z.number().positive().max(100_000).optional(),
      position: agentToolPositionSchema.optional(),
      metadata: agentToolRecordSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_node"),
      id: z.string().trim().min(1).max(160),
      patch: agentToolRecordSchema.optional(),
      metadata: agentToolRecordSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("delete_node"),
      id: z.string().trim().min(1).max(160).optional(),
      ids: z.array(z.string().trim().min(1).max(160)).max(200).optional(),
    })
    .strict()
    .refine((value) => Boolean(value.id || value.ids?.length)),
  z
    .object({
      type: z.literal("delete_connections"),
      id: z.string().trim().min(1).max(160).optional(),
      ids: z.array(z.string().trim().min(1).max(160)).max(200).optional(),
      all: z.boolean().optional(),
    })
    .strict()
    .refine((value) => Boolean(value.all || value.id || value.ids?.length)),
  z
    .object({
      type: z.literal("connect_nodes"),
      id: z.string().trim().min(1).max(160).optional(),
      fromNodeId: z.string().trim().min(1).max(160),
      toNodeId: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_viewport"),
      viewport: agentToolPositionSchema
        .extend({ k: z.number().positive().max(1000) })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("select_nodes"),
      ids: z.array(z.string().trim().min(1).max(160)).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("run_generation"),
      nodeId: z.string().trim().min(1).max(160),
      mode: z.enum(["text", "image", "video", "audio"]).optional(),
      prompt: z.string().max(100_000).optional(),
    })
    .strict(),
]);
const agentWorkerToolSchema = z
  .object({
    workerId: z.string().trim().min(1).max(160),
    call: z
      .object({
        id: z.string().trim().min(1).max(160),
        name: z.literal("canvas_apply_ops"),
        input: z
          .object({
            ops: z.array(agentCanvasToolOperationSchema).min(1).max(200),
          })
          .strict(),
        expectedRevision: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();
const workflowGenerationCapabilitySchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
]);
const workflowGenerationSchema = z
  .object({
    workerId: z.string().trim().min(1).max(160),
    nodeId: z.string().trim().min(1).max(160),
    attempt: z.number().int().positive(),
    capability: workflowGenerationCapabilitySchema,
    logicalModelId: z.string().trim().min(1).max(160),
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();
const workflowGenerationCancelSchema = workflowGenerationSchema.pick({
  workerId: true,
  nodeId: true,
  attempt: true,
  capability: true,
});
const workflowErrorSchema = z.object({
  code: z.string().trim().min(1).max(160),
  message: z.string().max(2_000),
});
const workflowNodeIdSchema = z.string().trim().min(1).max(160);
const workflowStepKeySchema = z.string().trim().min(1).max(160);
const workflowWorkerOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("node.start"),
      nodeId: workflowNodeIdSchema,
      input: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("node.complete"),
      nodeId: workflowNodeIdSchema,
      output: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("node.fail"),
      nodeId: workflowNodeIdSchema,
      error: workflowErrorSchema,
      retryAt: z.iso.datetime().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("node.wait"),
      nodeId: workflowNodeIdSchema,
      wakeAt: z.iso.datetime().optional(),
      eventKey: z.string().trim().min(1).max(160).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("node.skip"),
      nodeId: workflowNodeIdSchema,
      reason: z.enum(["condition_false", "upstream_skipped"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("step.start"),
      nodeId: workflowNodeIdSchema,
      key: workflowStepKeySchema,
      input: z.unknown().optional(),
      maxAttempts: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("step.complete"),
      nodeId: workflowNodeIdSchema,
      key: workflowStepKeySchema,
      output: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("step.fail"),
      nodeId: workflowNodeIdSchema,
      key: workflowStepKeySchema,
      error: workflowErrorSchema,
      retryAt: z.iso.datetime().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("step.wait"),
      nodeId: workflowNodeIdSchema,
      key: workflowStepKeySchema,
      wakeAt: z.iso.datetime().optional(),
      eventKey: z.string().trim().min(1).max(160).optional(),
    })
    .strict(),
  z.object({ type: z.literal("execution.cancel.complete") }).strict(),
]);
const workflowWorkerTransitionSchema = z
  .object({
    workerId: z.string().trim().min(1).max(160),
    revision: z.number().int().nonnegative(),
    operation: workflowWorkerOperationSchema,
  })
  .strict()
  .refine(
    (value) =>
      Buffer.byteLength(JSON.stringify(value.operation)) <= 1024 * 1024,
    "operation exceeds limits",
  );
const workerTransitionSchema = z.object({
  workerId: z.string().trim().min(1).max(160),
  phase: z.enum([
    "queued",
    "claimed",
    "submitting",
    "submitted",
    "polling",
    "result_ready",
    "persisting",
    "succeeded",
    "failed",
    "cancel_requested",
    "cancelled",
    "needs_review",
  ]),
  patch: z
    .object({
      upstreamTaskId: z.string().max(500).nullable().optional(),
      provider: z.string().max(80).nullable().optional(),
      channelId: z.string().max(160).nullable().optional(),
      result: z.record(z.string(), z.unknown()).nullable().optional(),
      nextRunAt: z.iso.datetime().optional(),
      errorCode: z.string().max(160).nullable().optional(),
      errorMessage: z.string().max(2000).nullable().optional(),
      billingActualUnits: z.number().int().nonnegative().safe().optional(),
    })
    .strict(),
});
const workerEventSchema = z
  .object({
    workerId: z.string().trim().min(1).max(160),
    type: z.enum(["text.delta", "text.reasoning.delta"]),
    delta: z.string().min(1).max(16_384),
  })
  .strict();
const modelCapabilitySchema = z.enum(["text", "image", "video", "audio"]);
const generationCapabilitySchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
  "agent",
]);
const billingEstimateSchema = z
  .object({
    capability: generationCapabilitySchema,
    parameters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const billingPriceRuleSchema = z
  .object({
    capability: generationCapabilitySchema,
    baseUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    multiplierConfig: z
      .object({
        resolutionPermille: z
          .record(
            z.string().trim().min(1).max(40),
            z.number().int().min(1).max(100_000),
          )
          .optional(),
        durationPermillePerSecond: z
          .number()
          .int()
          .min(0)
          .max(100_000)
          .optional(),
      })
      .strict()
      .default({}),
    enabled: z.boolean(),
  })
  .strict();
const walletAdjustmentSchema = z
  .object({
    userId: z.uuid(),
    amountUnits: z
      .number()
      .int()
      .safe()
      .refine((value) => value !== 0, "adjustment must be non-zero"),
    idempotencyKey: z.string().trim().min(8).max(200),
    note: z.string().trim().min(1).max(500),
  })
  .strict();
const resolveModelSchema = z.object({
  capability: modelCapabilitySchema,
  logicalModelId: z.string().trim().min(1).max(160),
  preferredChannelId: z.uuid().optional(),
});
const modelHealthSchema = z.object({
  upstreamModelId: z.string().uuid(),
  outcome: z.enum(["success", "failure"]),
});
const protocolSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    adapter: z.enum(["openai-compatible", "gemini", "custom"]),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const channelSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    protocolId: z.string().trim().min(1).max(160),
    baseUrl: z.url().max(2_000),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()).default({}),
    apiKey: z.string().min(1).max(8_000).optional(),
    clearCredential: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const url = new URL(value.baseUrl);
    if (url.username || url.password || url.search || url.hash)
      context.addIssue({
        code: "custom",
        message: "渠道 URL 不能包含凭据、query 或 fragment",
        path: ["baseUrl"],
      });
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && value.config.allowInsecure === true)
    )
      context.addIssue({
        code: "custom",
        message: "渠道 URL 默认必须使用 HTTPS",
        path: ["baseUrl"],
      });
  })
  .refine(
    (value) => !(value.apiKey && value.clearCredential),
    "不能同时设置和清除凭据",
  );
const upstreamModelSchema = z
  .object({
    channelId: z.uuid(),
    modelId: z.string().trim().min(1).max(500),
    capability: modelCapabilitySchema,
    enabled: z.boolean(),
    healthState: z.enum(["healthy", "degraded", "cooldown", "disabled"]),
    cooldownUntil: z.iso.datetime().nullable(),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const logicalModelSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    capability: modelCapabilitySchema,
    enabled: z.boolean(),
    isDefault: z.boolean(),
  })
  .strict();
const capabilityProfileSchema = z
  .object({
    supportsReferenceImage: z.boolean().optional(),
    supportsReferenceVideo: z.boolean().optional(),
    supportsReferenceAudio: z.boolean().optional(),
    maxReferenceImages: z.number().int().positive().optional(),
    aspectRatios: z.array(z.string().max(40)).max(100).optional(),
    resolutions: z.array(z.string().max(40)).max(100).optional(),
    durationSeconds: z.array(z.number().positive()).max(100).optional(),
    minDurationSeconds: z.number().positive().optional(),
    maxDurationSeconds: z.number().positive().optional(),
    maxBatchSize: z.number().int().positive().optional(),
    supportsAsync: z.boolean().optional(),
    supportsCancel: z.boolean().optional(),
    supportsWebhook: z.boolean().optional(),
    timeoutMs: z.number().int().positive().max(3_600_000).optional(),
    concurrencyLimit: z.number().int().positive().max(10_000).optional(),
  })
  .strict();
const bindingSchema = z
  .object({
    logicalModelId: z.string().trim().min(1).max(160),
    upstreamModelId: z.uuid(),
    enabled: z.boolean(),
    priority: z.number().int().nonnegative(),
    weight: z.number().int().min(1).max(10_000),
    capabilityProfile: capabilityProfileSchema.default({}),
  })
  .strict();
function workflowGenerationRequestId(
  executionId: string,
  nodeId: string,
  attempt: number,
) {
  const nodeHash = createHash("sha256")
    .update(nodeId)
    .digest("hex")
    .slice(0, 24);
  return `workflow:${executionId}:${nodeHash}:${attempt}`;
}
function requireWorkflowGenerationNode(
  record: WorkflowExecutionRecord,
  input: {
    nodeId: string;
    attempt: number;
    capability: "text" | "image" | "video" | "audio";
  },
) {
  const node = record.definition.nodes.find((item) => item.id === input.nodeId);
  const execution = record.state.nodes[input.nodeId];
  if (!node || !execution)
    throw new DomainError(
      "WORKFLOW_NODE_NOT_FOUND",
      404,
      "Workflow 节点不存在",
    );
  if (node.type !== `ai.generate.${input.capability}`)
    throw new DomainError(
      "WORKFLOW_GENERATION_CAPABILITY_MISMATCH",
      409,
      "Workflow 节点与生成能力不匹配",
    );
  if (
    execution.attempt !== input.attempt ||
    !["running", "waiting"].includes(execution.status)
  )
    throw new DomainError(
      "WORKFLOW_GENERATION_ATTEMPT_STALE",
      409,
      "Workflow 节点 attempt 已失效",
    );
}
function validateCustomProtocol(config: Record<string, unknown>) {
  try {
    parseCustomProtocolConfig(config);
  } catch {
    throw new DomainError(
      "INVALID_CUSTOM_PROTOCOL",
      400,
      "声明式自定义协议配置无效",
    );
  }
}
const dramaMutationBase = {
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().trim().min(8).max(200),
};
const dramaCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    sourceText: z.string().max(2_000_000).optional(),
    sourceAssetId: z.uuid().optional(),
  })
  .strict();
const dramaUpdateSchema = z
  .object({
    ...dramaMutationBase,
    title: z.string().trim().min(1).max(160),
    sourceText: z.string().max(2_000_000).optional(),
    sourceAssetId: z.uuid().nullable().optional(),
  })
  .strict();
const dramaScriptSchema = z
  .object({
    ...dramaMutationBase,
    content: z.string().max(2_000_000),
    segments: z.array(z.unknown()).max(10_000).optional(),
    analysis: z.record(z.string(), z.unknown()).optional(),
    reviewStatus: z.enum(["draft", "reviewing", "approved", "rejected"]),
    operation: z.enum(["revision", "split", "merge", "analysis"]),
  })
  .strict();
const dramaEntitySchema = z
  .object({
    ...dramaMutationBase,
    kind: z.enum(["character", "scene", "prop"]),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(20_000).optional(),
    prompt: z.string().max(20_000).optional(),
    referenceAssetId: z.uuid().optional(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();
const dramaShotSchema = z
  .object({
    ...dramaMutationBase,
    title: z.string().trim().min(1).max(160),
    prompt: z.string().max(20_000).optional(),
    framing: z.string().max(120).optional(),
    cameraMovement: z.string().max(120).optional(),
    durationMs: z.number().int().min(100).max(3_600_000),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();
const dramaGenerationSchema = z
  .object({
    ...dramaMutationBase,
    shotId: z.uuid(),
    capability: z.enum(["image", "video"]),
    logicalModelId: z.string().trim().min(1).max(160),
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();
const dramaSelectionSchema = z
  .object({ ...dramaMutationBase, generationId: z.uuid(), assetId: z.uuid() })
  .strict();
const dramaTimelineSchema = z
  .object({
    ...dramaMutationBase,
    shotId: z.uuid().optional(),
    kind: z.enum(["dialogue", "voice", "bgm", "subtitle"]),
    textContent: z.string().max(20_000).optional(),
    voice: z.string().max(160).optional(),
    assetId: z.uuid().optional(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict()
  .refine((x) => x.endMs > x.startMs, { message: "endMs 必须大于 startMs" });
const dramaReviewSchema = z
  .object({
    ...dramaMutationBase,
    shotId: z.uuid(),
    status: z.enum(["pending", "approved", "changes_requested"]),
    comment: z.string().max(4000).optional(),
  })
  .strict();
const dramaRenderCreateSchema = z
  .object({
    ...dramaMutationBase,
    kind: z.enum(["ffmpeg", "jianying"]),
    settings: z.record(z.string(), z.unknown()),
  })
  .strict();
const dramaRenderHeartbeatSchema = z
  .object({
    workerId: z.string().trim().min(1).max(160),
    renderIds: z.array(z.uuid()).max(100),
  })
  .strict();
const dramaRenderTransitionSchema = z
  .object({
    workerId: z.string().trim().min(1).max(160),
    status: z.enum(["running", "succeeded", "failed", "cancelled"]),
    patch: z
      .object({
        progress: z.number().int().min(0).max(100).optional(),
        outputAssetId: z.uuid().optional(),
        errorCode: z.string().max(160).optional(),
        errorMessage: z.string().max(2000).optional(),
      })
      .strict(),
  })
  .strict();
const dramaTransferTargetSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("entity"),
      kind: z.enum(["character", "scene", "prop"]),
      name: z.string().trim().min(1).max(120),
      description: z.string().max(20_000).optional(),
      prompt: z.string().max(20_000).optional(),
      sortOrder: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("timeline"),
      shotId: z.uuid().optional(),
      kind: z.enum(["dialogue", "voice", "bgm", "subtitle"]),
      textContent: z.string().max(20_000).optional(),
      voice: z.string().max(160).optional(),
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().positive(),
      sortOrder: z.number().int().nonnegative(),
    })
    .strict()
    .refine((x) => x.endMs > x.startMs, { message: "endMs 必须大于 startMs" }),
]);
const dramaToCanvasSchema = z
  .object({
    canvasProjectId: z.string().min(1).max(128),
    assetId: z.uuid(),
    expectedCanvasRevision: z.number().int().nonnegative(),
    mutationId: z.string().trim().min(8).max(128),
    title: z.string().max(160).optional(),
    position: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict(),
  })
  .strict();
const dramaFromAssetSchema = z
  .object({
    assetId: z.uuid(),
    expectedDramaRevision: z.number().int().nonnegative(),
    mutationId: z.string().trim().min(8).max(200),
    target: dramaTransferTargetSchema,
  })
  .strict();
const dramaFromCanvasSchema = z
  .object({
    canvasProjectId: z.string().min(1).max(128),
    nodeId: z.string().min(1).max(128),
    expectedDramaRevision: z.number().int().nonnegative(),
    mutationId: z.string().trim().min(8).max(200),
    target: dramaTransferTargetSchema,
  })
  .strict();
function writeSession(
  c: Parameters<typeof setCookie>[0],
  token: string,
  secure: boolean,
) {
  setCookie(c, "ic_session", token, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
  });
}
function publicWorkflowCredentials(
  c: Context<ApiEnv>,
  requireIdempotency = true,
) {
  const secret = c.req
    .header("authorization")
    ?.match(/^Bearer (icwf_[A-Za-z0-9_-]{43})$/)?.[1];
  const idempotencyKey = c.req.header("idempotency-key")?.trim() || "";
  if (
    !secret ||
    (requireIdempotency &&
      (idempotencyKey.length < 8 || idempotencyKey.length > 200))
  )
    throw new DomainError(
      "WORKFLOW_API_AUTH_REQUIRED",
      401,
      "Workflow API token 或幂等键无效",
    );
  return { secret, idempotencyKey };
}
async function readBoundedJson(
  c: Context<ApiEnv>,
  maxBytes: number,
  tooLargeCode: string,
) {
  const length = Number(c.req.header("content-length") || 0);
  if (Number.isFinite(length) && length > maxBytes)
    throw new DomainError(tooLargeCode, 413, "请求体超过 1 MiB");
  const raw = await c.req.text();
  if (Buffer.byteLength(raw) > maxBytes)
    throw new DomainError(tooLargeCode, 413, "请求体超过 1 MiB");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new DomainError(
      "INVALID_WORKFLOW_API_PAYLOAD",
      422,
      "Workflow API payload 必须是 JSON",
    );
  }
}
function requestId(c: Context<ApiEnv>) {
  return c.get("requestId");
}
function isTerminalPhase(phase: string) {
  return ["succeeded", "failed", "cancelled", "needs_review"].includes(phase);
}
