import { Hono } from "hono";
import { z } from "zod";
import type { AdminActor } from "./admin-repository.js";
import type { AdminService } from "./admin-service.js";
import type { ModelGatewayRepository } from "./model-gateway-repository.js";
import type { ModelDiscoveryService } from "./model-discovery.js";
import type { CommerceService } from "./commerce-service.js";
import type { PaymentService } from "./payment-service.js";
import type { AdminMfaService } from "./admin-mfa-service.js";

type Env = {
  Variables: {
    requestId: string;
    user?: import("./domain.js").PublicUser;
    sessionToken?: string;
  };
};
export function createAdminApi(
  service: AdminService,
  mode: "maintenance" | "user" = "maintenance",
  domains?: {
    modelGateway: ModelGatewayRepository;
    modelDiscovery: ModelDiscoveryService;
    commerce?: CommerceService;
    payments?: PaymentService;
    mfa?: AdminMfaService;
  },
) {
  const app = new Hono<Env>();
  if (mode === "user")
    app.use("*", async (c, next) => {
      const user = c.get("user");
      if (!user) throw new Error("Authenticated user context missing");
      await service.requireAdmin(user.id);
      if (domains?.mfa && !c.req.path.includes("/mfa/"))
        await domains.mfa.authorize(user.id, c.get("sessionToken") || "");
      await next();
    });
  if (mode === "user" && domains?.mfa) {
    app.get("/mfa/status", async (c) =>
      ok(
        c,
        await domains.mfa!.status(
          c.get("user")!.id,
          c.get("sessionToken") || "",
        ),
      ),
    );
    app.post("/mfa/enroll", async (c) =>
      ok(
        c,
        await domains.mfa!.begin(
          c.get("user")!.id,
          c.get("user")!.email,
          c.get("sessionToken") || "",
        ),
        201,
      ),
    );
    app.post("/mfa/confirm", async (c) =>
      ok(
        c,
        await domains.mfa!.confirm(
          c.get("user")!.id,
          c.get("sessionToken") || "",
          mfaCode.parse(await c.req.json()).code,
        ),
      ),
    );
    app.post("/mfa/verify", async (c) =>
      ok(
        c,
        await domains.mfa!.verify(
          c.get("user")!.id,
          c.get("sessionToken") || "",
          mfaVerify.parse(await c.req.json()),
        ),
      ),
    );
  }
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
  if (domains) {
    app.get("/models/catalog", async (c) =>
      ok(c, await domains.modelGateway.catalog()),
    );
    app.put("/models/protocols/:id", async (c) => {
      const id = z.string().trim().min(1).max(160).parse(c.req.param("id")),
        value = await domains.modelGateway.saveProtocol({
          ...protocolBody.parse(await c.req.json()),
          id,
        });
      await service.record(
        actor(c),
        "model.protocol.update",
        "model_protocol",
        id,
      );
      return ok(c, value);
    });
    app.put("/models/channels/:id", async (c) => {
      const id = z.uuid().parse(c.req.param("id")),
        value = await domains.modelGateway.saveChannel({
          ...channelBody.parse(await c.req.json()),
          id,
          credentialConfigured: false,
        });
      await service.record(
        actor(c),
        "model.channel.update",
        "model_channel",
        id,
        { credentialConfigured: value.credentialConfigured },
      );
      return ok(c, value);
    });
    app.post("/models/channels/:id/:action", async (c) => {
      const id = z.uuid().parse(c.req.param("id")),
        action = z.enum(["test", "discover"]).parse(c.req.param("action")),
        result = await domains.modelDiscovery.discover(id);
      await service.record(
        actor(c),
        `model.channel.${action}`,
        "model_channel",
        id,
        { modelCount: result.models.length, latencyMs: result.latencyMs },
      );
      return ok(
        c,
        action === "test"
          ? {
              ok: true,
              modelCount: result.models.length,
              latencyMs: result.latencyMs,
            }
          : result,
      );
    });
    app.put("/models/upstream/:id", async (c) => {
      const id = z.uuid().parse(c.req.param("id")),
        value = await domains.modelGateway.saveUpstreamModel({
          ...upstreamBody.parse(await c.req.json()),
          id,
        });
      await service.record(
        actor(c),
        "model.upstream.update",
        "upstream_model",
        id,
      );
      return ok(c, value);
    });
    app.put("/models/logical/:id", async (c) => {
      const id = z.string().trim().min(1).max(160).parse(c.req.param("id")),
        value = await domains.modelGateway.saveLogicalModel({
          ...logicalBody.parse(await c.req.json()),
          id,
        });
      await service.record(
        actor(c),
        "model.logical.update",
        "logical_model",
        id,
      );
      return ok(c, value);
    });
    app.put("/models/bindings/:id", async (c) => {
      const id = z.uuid().parse(c.req.param("id")),
        value = await domains.modelGateway.saveBinding({
          ...bindingBody.parse(await c.req.json()),
          id,
        });
      await service.record(
        actor(c),
        "model.binding.update",
        "model_binding",
        id,
      );
      return ok(c, value);
    });
  }
  if (domains?.commerce) {
    app.get("/commerce", async (c) =>
      ok(c, {
        products: await domains.commerce!.products(false),
        promotions: await domains.commerce!.promotions(false),
        codes: await domains.commerce!.codes(),
        referrals: await domains.commerce!.referrals(),
      }),
    );
    app.put("/commerce/products", async (c) => {
      const value = await domains.commerce!.saveProduct(
        productBody.parse(await c.req.json()),
      );
      await service.record(
        actor(c),
        "commerce.product.update",
        "billing_product",
        value.id,
      );
      return ok(c, value);
    });
    app.put("/commerce/promotions", async (c) => {
      const value = await domains.commerce!.savePromotion(
        promotionBody.parse(await c.req.json()),
      );
      await service.record(
        actor(c),
        "commerce.promotion.update",
        "billing_promotion",
        value.id,
      );
      return ok(c, value);
    });
    app.post("/commerce/codes", async (c) => {
      const value = await domains.commerce!.createCode(
        codeBody.parse(await c.req.json()),
      );
      await service.record(
        actor(c),
        "commerce.code.create",
        "billing_code",
        value.id,
        { kind: value.kind },
      );
      return ok(c, value, 201);
    });
  }
  if (domains?.payments) {
    app.get("/commerce/orders", async (c) =>
      ok(
        c,
        await domains.payments!.orders(
          orderStatus.optional().parse(c.req.query("status")),
          Number(c.req.query("limit") || 100),
        ),
      ),
    );
    app.get("/commerce/refunds", async (c) =>
      ok(
        c,
        await domains.payments!.refunds(
          refundStatus.optional().parse(c.req.query("status")),
          Number(c.req.query("limit") || 100),
        ),
      ),
    );
    app.post("/commerce/refunds", async (c) => {
      const x = adminRefundBody.parse(await c.req.json()),
        value = await domains.payments!.refund(x.userId, x);
      await service.record(
        actor(c),
        "commerce.refund.create",
        "billing_order",
        x.orderId,
      );
      return ok(c, value, 201);
    });
    app.post("/commerce/orders/expire", async (c) =>
      ok(c, { expired: await domains.payments!.expire() }),
    );
    app.post("/commerce/reconciliation", async (c) => {
      const x = reconciliationBody.parse(await c.req.json());
      const value = await domains.payments!.reconcile(x.date, x.lines);
      await service.record(
        actor(c),
        "commerce.reconcile",
        "billing_reconciliation",
        x.date,
      );
      return ok(c, value);
    });
    app.get("/commerce/report", async (c) =>
      ok(
        c,
        await domains.payments!.report(
          z.iso.datetime().parse(c.req.query("from")),
          z.iso.datetime().parse(c.req.query("to")),
        ),
      ),
    );
  }
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
const capability = z.enum(["text", "image", "video", "audio"]);
const mfaCode = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
const mfaVerify = z
  .object({
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recoveryCode: z.string().trim().min(10).max(100).optional(),
  })
  .strict()
  .refine((x) => !!x.code !== !!x.recoveryCode, "必须且只能提供验证码或恢复码");
const protocolBody = z
  .object({
    name: z.string().trim().min(1).max(160),
    adapter: z.enum([
      "openai-compatible",
      "gemini",
      "seedance",
      "stable-diffusion",
      "media-kit",
      "custom",
    ]),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const channelBody = z
  .object({
    name: z.string().trim().min(1).max(160),
    protocolId: z.string().trim().min(1).max(160),
    baseUrl: z.url().max(2000),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()).default({}),
    apiKey: z.string().min(1).max(8000).optional(),
    clearCredential: z.boolean().optional(),
  })
  .strict()
  .superRefine((x, c) => {
    const u = new URL(x.baseUrl);
    if (u.username || u.password || u.search || u.hash)
      c.addIssue({
        code: "custom",
        message: "URL 不能包含凭据、query 或 fragment",
        path: ["baseUrl"],
      });
    if (
      u.protocol !== "https:" &&
      !(u.protocol === "http:" && x.config.allowInsecure === true)
    )
      c.addIssue({
        code: "custom",
        message: "渠道默认必须使用 HTTPS",
        path: ["baseUrl"],
      });
  })
  .refine((x) => !(x.apiKey && x.clearCredential), "不能同时设置和清除凭据");
const upstreamBody = z
  .object({
    channelId: z.uuid(),
    modelId: z.string().trim().min(1).max(500),
    capability,
    enabled: z.boolean(),
    healthState: z.enum(["healthy", "degraded", "cooldown", "disabled"]),
    cooldownUntil: z.iso.datetime().nullable(),
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const logicalBody = z
  .object({
    name: z.string().trim().min(1).max(160),
    capability,
    enabled: z.boolean(),
    isDefault: z.boolean(),
  })
  .strict();
const bindingBody = z
  .object({
    logicalModelId: z.string().trim().min(1).max(160),
    upstreamModelId: z.uuid(),
    enabled: z.boolean(),
    priority: z.number().int().nonnegative(),
    weight: z.number().int().min(1).max(10000),
    capabilityProfile: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const productBody = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-z0-9_-]{2,80}$/i),
    name: z.string().trim().min(1).max(160),
    description: z.string().max(4000).optional(),
    units: z.number().int().safe().nonnegative(),
    priceMinor: z.number().int().safe().nonnegative(),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
    active: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const promotionBody = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(160),
    discountBps: z.number().int().min(0).max(10000),
    bonusUnits: z.number().int().safe().nonnegative(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    active: z.boolean(),
    productId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((x) => x.endsAt > x.startsAt, "促销结束时间必须晚于开始时间");
const codeBody = z
  .object({
    kind: z.enum(["coupon", "cdk"]),
    label: z.string().trim().min(1).max(160),
    discountBps: z.number().int().min(0).max(10000),
    bonusUnits: z.number().int().safe().nonnegative(),
    maxRedemptions: z.number().int().positive().max(1000000),
    perUserLimit: z.number().int().positive().max(100),
    startsAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    active: z.boolean(),
  })
  .strict()
  .refine((x) => x.expiresAt > x.startsAt, "兑换码过期时间必须晚于开始时间");
const orderStatus = z.enum([
  "pending",
  "paid",
  "fulfilled",
  "expired",
  "cancelled",
  "refund_pending",
  "refunded",
  "refund_failed",
  "needs_review",
]);
const refundStatus = z.enum(["pending", "succeeded", "failed", "needs_review"]);
const adminRefundBody = z
  .object({
    userId: z.uuid(),
    orderId: z.uuid(),
    idempotencyKey: z.string().trim().min(8).max(200),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
const reconciliationBody = z
  .object({
    date: z.iso.date(),
    lines: z
      .array(
        z
          .object({
            providerTransactionId: z.string().trim().min(1).max(200),
            amountMinor: z.number().int().safe().positive(),
          })
          .strict(),
      )
      .max(10000),
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
