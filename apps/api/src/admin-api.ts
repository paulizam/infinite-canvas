import { Hono } from "hono";
import { z } from "zod";
import type { AdminActor } from "./admin-repository.js";
import type { AdminService } from "./admin-service.js";

type Env = {
  Variables: {
    requestId: string;
    user?: import("./domain.js").PublicUser;
  };
};
export function createAdminApi(
  service: AdminService,
  mode: "maintenance" | "user" = "maintenance",
) {
  const app = new Hono<Env>();
  if (mode === "user")
    app.use("*", async (c, next) => {
      const user = c.get("user");
      if (!user) throw new Error("Authenticated user context missing");
      await service.requireAdmin(user.id);
      await next();
    });
  app.get("/dashboard", async (c) => ok(c, await service.dashboard()));
  app.get("/users", async (c) =>
    ok(
      c,
      await service.users(
        c.req.query("q"),
        Number(c.req.query("limit") || 50),
        optionalUuid(c.req.query("cursor")),
      ),
    ),
  );
  app.patch("/users/:id", async (c) =>
    ok(
      c,
      await service.updateUser(
        z.uuid().parse(c.req.param("id")),
        userPatch.parse(await c.req.json()),
        actor(c),
      ),
    ),
  );
  app.post("/users/:id/revoke-sessions", async (c) =>
    ok(
      c,
      await service.revokeSessions(z.uuid().parse(c.req.param("id")), actor(c)),
    ),
  );
  app.get("/jobs", async (c) =>
    ok(
      c,
      await service.jobs(
        {
          status: c.req.query("status"),
          phase: c.req.query("phase"),
          provider: c.req.query("provider"),
          ownerId: optionalUuid(c.req.query("ownerId")),
        },
        Number(c.req.query("limit") || 50),
      ),
    ),
  );
  app.post("/jobs/:id/actions", async (c) =>
    ok(
      c,
      await service.transitionJob(
        z.uuid().parse(c.req.param("id")),
        jobAction.parse(await c.req.json()).action,
        actor(c),
      ),
    ),
  );
  app.get("/storage", async (c) => ok(c, await service.storage()));
  app.get("/audit", async (c) => {
    const values = await service.audit(
      auditFilters(c),
      Number(c.req.query("limit") || 100),
    );
    if (c.req.query("format") === "csv") {
      const rows = [
        "id,actorType,actorId,action,resourceType,resourceId,requestId,createdAt",
        ...values.map((x: any) =>
          [
            x.id,
            x.actorType,
            x.actorId,
            x.action,
            x.resourceType,
            x.resourceId,
            x.requestId,
            x.createdAt,
          ]
            .map(csv)
            .join(","),
        ),
      ];
      return c.body(`\ufeff${rows.join("\n")}`, 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=admin-audit.csv",
        "cache-control": "no-store",
      });
    }
    return ok(c, values);
  });
  app.get("/settings", async (c) => ok(c, await service.settings()));
  app.put("/settings/:namespace/:key", async (c) => {
    const path = settingPath.parse({
        namespace: c.req.param("namespace"),
        key: c.req.param("key"),
      }),
      body = settingBody.parse(await c.req.json());
    return ok(c, await service.saveSetting({ ...path, ...body }, actor(c)));
  });
  app.get("/content", async (c) =>
    ok(c, await service.listContent(optionalKind(c.req.query("kind")))),
  );
  app.put("/content/:id", async (c) =>
    ok(
      c,
      await service.content(
        {
          ...contentBody.parse(await c.req.json()),
          id: z.uuid().parse(c.req.param("id")),
        },
        actor(c),
      ),
    ),
  );
  app.post("/content", async (c) =>
    ok(
      c,
      await service.content(contentBody.parse(await c.req.json()), actor(c)),
      201,
    ),
  );
  return app;
}
const userPatch = z
  .object({
    status: z.enum(["active", "suspended"]).optional(),
    platformRole: z.enum(["user", "admin"]).optional(),
  })
  .strict();
const jobAction = z
  .object({ action: z.enum(["requeue", "cancel", "review"]) })
  .strict();
const settingPath = z.object({
  namespace: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/),
});
const settingBody = z
  .object({
    value: z.unknown().optional(),
    secret: z.string().min(1).max(10000).optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (x) => (x.value === undefined) !== (x.secret === undefined),
    "必须且只能提供 value 或 secret",
  );
const contentBody = z
  .object({
    kind: z.enum(["announcement", "prompt"]),
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(100000),
    status: z.enum(["draft", "published", "archived"]),
    startsAt: z.iso.datetime().nullable().optional(),
    endsAt: z.iso.datetime().nullable().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
const optionalUuid = (x: string | undefined) =>
  x ? z.uuid().parse(x) : undefined;
const optionalKind = (x: string | undefined) =>
  x ? z.enum(["announcement", "prompt"]).parse(x) : undefined;
const actor = (c: any): AdminActor => ({
  type: c.get("user") ? "user" : "maintenance",
  id:
    c.get("user")?.id ||
    (c.req.header("x-admin-actor") || "maintenance").slice(0, 200),
  requestId: c.get("requestId"),
});
const ok = (c: any, data: unknown, status: 200 | 201 = 200) =>
  c.json({ data, requestId: c.get("requestId") }, status);
const auditFilters = (c: any) => ({
  actorId: c.req.query("actorId"),
  action: c.req.query("action"),
  resourceType: c.req.query("resourceType"),
  resourceId: c.req.query("resourceId"),
  requestId: c.req.query("requestId"),
});
function csv(x: unknown) {
  let s = String(x ?? "");
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
