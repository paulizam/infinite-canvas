import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createAdminApi } from "./admin-api.js";
import type { AdminRepository } from "./admin-repository.js";
import { AdminService } from "./admin-service.js";
import { CommerceService } from "./commerce-service.js";
import { MemoryCommerceRepository } from "./memory-commerce-repository.js";
import { ModelDiscoveryService } from "./model-discovery.js";
import { MemoryModelGatewayRepository } from "./model-gateway-repository.js";
import { SecretCipher } from "./secret-cipher.js";
import type { PaymentService } from "./payment-service.js";

function adminRepository(): AdminRepository {
  return {
    isAdmin: vi.fn(async () => true),
    recordAudit: vi.fn(async () => undefined),
    dashboard: vi.fn(async () => ({})),
    users: vi.fn(async () => ({ items: [] })),
    updateUser: vi.fn(async () => ({})),
    revokeSessions: vi.fn(async () => ({ revoked: 0 })),
    jobs: vi.fn(async () => []),
    transitionJob: vi.fn(async () => ({})),
    storage: vi.fn(async () => ({})),
    audit: vi.fn(async () => []),
    settings: vi.fn(async () => []),
    saveSetting: vi.fn(async (x, actor) => ({
      namespace: x.namespace,
      key: x.key,
      value: x.value || null,
      secretConfigured: !!x.secret,
      revision: 1,
      updatedBy: actor.id,
      updatedAt: new Date().toISOString(),
    })),
    content: vi.fn(async (x) => x),
    listContent: vi.fn(async () => []),
    listPublishedPrompts: vi.fn(async () => []),
  };
}
describe("admin model and commerce API", () => {
  it("runs the model setup chain without exposing credentials", async () => {
    const gateway = new MemoryModelGatewayRepository(),
      discovery = new ModelDiscoveryService(
        gateway,
        vi.fn(
          async () =>
            new Response(JSON.stringify({ data: [{ id: "model-a" }] }), {
              headers: { "content-type": "application/json" },
            }),
        ) as typeof fetch,
        async () => ["203.0.113.10"],
      ),
      audit = adminRepository(),
      service = new AdminService(
        audit,
        new SecretCipher(Buffer.alloc(32, 5).toString("base64")),
      ),
      app = mounted(
        createAdminApi(service, "maintenance", {
          modelGateway: gateway,
          modelDiscovery: discovery,
          commerce: new CommerceService(
            new MemoryCommerceRepository(),
            "c".repeat(32),
          ),
        }),
      ),
      channelId = crypto.randomUUID();
    expect(
      (
        await app.request("/admin/models/protocols/openai", {
          method: "PUT",
          headers: json,
          body: JSON.stringify({
            name: "OpenAI",
            adapter: "openai-compatible",
            enabled: true,
            config: {},
          }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/admin/models/channels/${channelId}`, {
          method: "PUT",
          headers: json,
          body: JSON.stringify({
            name: "Primary",
            protocolId: "openai",
            baseUrl: "https://models.example.test/v1",
            enabled: true,
            config: {},
            apiKey: "secret-value",
          }),
        })
      ).status,
    ).toBe(200);
    const discovered = await app.request(
      `/admin/models/channels/${channelId}/discover`,
      { method: "POST" },
    );
    expect(await discovered.json()).toMatchObject({
      data: { models: [{ id: "model-a" }] },
    });
    const catalog = JSON.stringify(
      await (await app.request("/admin/models/catalog")).json(),
    );
    expect(catalog).not.toContain("secret-value");
    expect(catalog).toContain('"credentialConfigured":true');
    expect(audit.recordAudit).toHaveBeenCalled();
  });

  it("creates a one-time CDK while keeping catalog responses plaintext-free", async () => {
    const commerce = new CommerceService(
        new MemoryCommerceRepository(),
        "d".repeat(32),
      ),
      gateway = new MemoryModelGatewayRepository(),
      app = mounted(
        createAdminApi(
          new AdminService(
            adminRepository(),
            new SecretCipher(Buffer.alloc(32, 6).toString("base64")),
          ),
          "maintenance",
          {
            modelGateway: gateway,
            modelDiscovery: new ModelDiscoveryService(gateway),
            commerce,
          },
        ),
      ),
      now = Date.now();
    const response = await app.request("/admin/commerce/codes", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        kind: "cdk",
        label: "launch",
        discountBps: 0,
        bonusUnits: 100,
        maxRedemptions: 1,
        perUserLimit: 1,
        startsAt: new Date(now - 1000).toISOString(),
        expiresAt: new Date(now + 60000).toISOString(),
        active: true,
      }),
    });
    const created = (await response.json()) as any;
    expect(created.data.code).toMatch(/^CDK_/);
    const catalog = JSON.stringify(
      await (await app.request("/admin/commerce")).json(),
    );
    expect(catalog).not.toContain(created.data.code);
    expect(catalog).not.toMatch(/[a-f0-9]{64}/);
  });

  it("retries a failed channel refund through an audited admin action", async () => {
    const audit = adminRepository();
    const refundId = crypto.randomUUID();
    const payments = {
      retryRefund: vi.fn(async () => ({
        refund: { id: refundId, status: "succeeded" },
        replayed: false,
      })),
    } as unknown as PaymentService;
    const modelGateway = new MemoryModelGatewayRepository();
    const app = mounted(
      createAdminApi(
        new AdminService(
          audit,
          new SecretCipher(Buffer.alloc(32, 7).toString("base64")),
        ),
        "maintenance",
        {
          payments,
          modelGateway,
          modelDiscovery: new ModelDiscoveryService(modelGateway),
        },
      ),
    );

    const response = await app.request(
      `/admin/commerce/refunds/${refundId}/retry`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { refund: { id: refundId, status: "succeeded" } },
    });
    expect(payments.retryRefund).toHaveBeenCalledWith(refundId);
    expect(audit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req-admin-test" }),
      "commerce.refund.retry",
      "billing_refund",
      refundId,
      undefined,
    );
  });
});
const json = { "content-type": "application/json" };
function mounted(api: Hono<any>) {
  const app = new Hono<any>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req-admin-test");
    await next();
  });
  app.route("/admin", api);
  return app;
}
