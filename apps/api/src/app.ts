import { Hono, type Context } from "hono";
import { timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { PublicUser } from "./domain.js";
import { DomainError } from "./domain.js";
import type { AssetService } from "./asset-service.js";
import type { GenerationJobService } from "./generation-job-service.js";
import type { GenerationJobRepository } from "./generation-job-repository.js";
import type { ModelGatewayRepository } from "./model-gateway-repository.js";
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
  workerToken: string;
  workerStaleMs: number;
  modelGateway: ModelGatewayRepository;
  maintenanceToken: string;
  secureCookies: boolean;
  collaboration?: {
    publishMutation: (
      project: import("./domain.js").ProjectRecord,
      mutation: import("@infinite-canvas/contracts").CanvasMutation,
    ) => void;
  };
};

export function createApp(services: AppServices) {
  const app = new Hono<ApiEnv>();
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
  app.get("/api/v1/projects/:projectId", async (c) => {
    const project = await services.projects.get(
      c.get("user").id,
      c.req.param("projectId"),
    );
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    return c.json({ data: project, requestId: requestId(c) });
  });
  app.delete("/api/v1/projects/:projectId", async (c) => {
    await services.projects.delete(c.get("user").id, c.req.param("projectId"));
    return c.json({ data: { ok: true }, requestId: requestId(c) });
  });
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
    return c.json({ data: job, requestId: requestId(c) });
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
  app.put("/internal/v1/maintenance/model-protocols/:id", async (c) => {
    const input = protocolSchema.parse(await c.req.json());
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
const createGenerationJobSchema = z.object({
  capability: z.enum(["text", "image", "video", "audio", "agent"]),
  logicalModelId: z.string().trim().min(1).max(160),
  clientRequestId: z.string().trim().min(1).max(160),
  parameters: z.record(z.string(), z.unknown()),
});
const workerClaimSchema = z.object({
  workerId: z.string().trim().min(1).max(160),
  limit: z.number().int().min(1).max(50).default(20),
  leaseMs: z.number().int().default(90_000),
});
const workerHeartbeatSchema = z.object({
  workerId: z.string().trim().min(1).max(160),
  jobIds: z.array(z.uuid()).max(50),
});
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
    })
    .strict(),
});
const modelCapabilitySchema = z.enum(["text", "image", "video", "audio"]);
const resolveModelSchema = z.object({
  capability: modelCapabilitySchema,
  logicalModelId: z.string().trim().min(1).max(160),
  preferredChannelId: z.uuid().optional(),
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
function requestId(c: Context<ApiEnv>) {
  return c.get("requestId");
}
