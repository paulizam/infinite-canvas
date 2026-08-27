import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { PublicUser } from "./domain.js";
import { DomainError } from "./domain.js";
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
  secureCookies: boolean;
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
    const input = z
      .object({ title: z.string().min(1) })
      .parse(await c.req.json());
    return c.json(
      {
        data: await services.projects.create(
          c.get("user").id,
          c.req.param("workspaceId"),
          input.title,
        ),
        requestId: requestId(c),
      },
      201,
    );
  });
  app.get("/api/v1/projects/:projectId", async (c) => {
    const project = await services.projects.get(
      c.get("user").id,
      c.req.param("projectId"),
    );
    if (!project) throw new DomainError("PROJECT_NOT_FOUND", 404, "项目不存在");
    return c.json({ data: project, requestId: requestId(c) });
  });
  app.post("/api/v1/projects/:projectId/mutations", async (c) => {
    const input = mutationSchema.parse(await c.req.json());
    return c.json({
      data: await services.projects.mutate(
        c.get("user").id,
        c.req.param("projectId"),
        input,
      ),
      requestId: requestId(c),
    });
  });
  return app;
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
