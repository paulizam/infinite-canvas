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
    password: z.string().min(1),
    name: z.string().min(1),
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

const mutationSchema = z.object({
  mutationId: z.string().min(1),
  projectId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  clientId: z.string().min(1),
  createdAt: z.string().min(1),
  operations: z.array(
    z.custom<import("@infinite-canvas/contracts").CanvasOperation>(),
  ),
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
