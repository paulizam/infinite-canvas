import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { MemoryPlatformRepository } from "./memory-repository.js";
import { MemoryCommerceRepository } from "./memory-commerce-repository.js";
import { CommerceService } from "./commerce-service.js";
import {
  IdentityService,
  ProjectService,
  WorkspaceService,
} from "./services.js";
import { AssetService } from "./asset-service.js";
import { MemoryAssetBlobStore } from "./blob-store.js";
import { GenerationJobService } from "./generation-job-service.js";
import { MemoryGenerationJobRepository } from "./generation-job-repository.js";
import { MemoryModelGatewayRepository } from "./model-gateway-repository.js";
const maintenance = "maintenance-token-at-least-32-chars";
let app: ReturnType<typeof createApp>, commerceRepo: MemoryCommerceRepository;
beforeEach(() => {
  const p = new MemoryPlatformRepository(),
    jobs = new MemoryGenerationJobRepository();
  commerceRepo = new MemoryCommerceRepository(
    async (u, amount, key, note, now) =>
      (
        await jobs.adjustWallet({
          userId: u,
          amountUnits: amount,
          idempotencyKey: key,
          note,
          now,
        })
      ).balanceUnits,
  );
  app = createApp({
    identity: new IdentityService(p, 60_000),
    workspaces: new WorkspaceService(p),
    projects: new ProjectService(p),
    assets: new AssetService(p, new MemoryAssetBlobStore(), 1024),
    jobs: new GenerationJobService(p, jobs),
    jobRepository: jobs,
    workerToken: "worker-token-at-least-32-characters",
    workerStaleMs: 1000,
    modelGateway: new MemoryModelGatewayRepository(),
    maintenanceToken: maintenance,
    secureCookies: false,
    commerce: new CommerceService(
      commerceRepo,
      "billing-code-secret-at-least-32-bytes",
      { inviter: 100, invitee: 100 },
    ),
  });
});
async function register(email: string) {
  const r = await app.request("/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "test-password", name: email }),
  });
  const b = (await r.json()) as any;
  return {
    userId: b.data.user.id,
    cookie: r.headers.get("set-cookie")!.split(";")[0]!,
  };
}
const json = (cookie: string) => ({
  cookie,
  "content-type": "application/json",
});
const adminHeaders = {
  authorization: `Bearer ${maintenance}`,
  "content-type": "application/json",
};
describe("Commerce API", () => {
  it("credits CDK and referral rewards exactly once without storing plaintext codes", async () => {
    const alice = await register("alice@example.com"),
      bob = await register("bob@example.com");
    let r = await app.request("/internal/v1/maintenance/billing/products", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        code: "starter",
        name: "Starter",
        units: 1000,
        priceMinor: 999,
        currency: "cny",
        active: true,
      }),
    });
    expect(r.status).toBe(200);
    expect(
      (
        (await (
          await app.request("/api/public/v1/billing/products")
        ).json()) as any
      ).data[0],
    ).toMatchObject({ code: "starter", currency: "CNY" });
    r = await app.request("/internal/v1/maintenance/billing/products", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        code: "free",
        name: "Free quota",
        units: 50,
        priceMinor: 0,
        currency: "cny",
        active: true,
      }),
    });
    const free = ((await r.json()) as any).data;
    const promoNow = Date.now();
    await app.request("/internal/v1/maintenance/billing/promotions", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "Launch bonus",
        discountBps: 0,
        bonusUnits: 25,
        startsAt: new Date(promoNow - 1000).toISOString(),
        endsAt: new Date(promoNow + 86400000).toISOString(),
        active: true,
        productId: free.id,
      }),
    });
    const catalog = (
      (await (
        await app.request("/api/public/v1/billing/products")
      ).json()) as any
    ).data;
    expect(catalog.find((x: any) => x.id === free.id)).toMatchObject({
      effectivePriceMinor: 0,
      effectiveUnits: 75,
    });
    r = await app.request(`/api/v1/billing/products/${free.id}/claim-free`, {
      method: "POST",
      headers: { cookie: bob.cookie },
    });
    expect(((await r.json()) as any).data).toMatchObject({
      units: 75,
      balanceUnits: 75,
      replayed: false,
    });
    r = await app.request(`/api/v1/billing/products/${free.id}/claim-free`, {
      method: "POST",
      headers: { cookie: bob.cookie },
    });
    expect(((await r.json()) as any).data.replayed).toBe(true);
    const now = Date.now();
    r = await app.request("/internal/v1/maintenance/billing/codes", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        kind: "cdk",
        label: "Launch",
        discountBps: 0,
        bonusUnits: 500,
        maxRedemptions: 10,
        perUserLimit: 1,
        startsAt: new Date(now - 1000).toISOString(),
        expiresAt: new Date(now + 86400000).toISOString(),
        active: true,
      }),
    });
    expect(r.status).toBe(201);
    const code = ((await r.json()) as any).data.code;
    expect([...commerceRepo.codes.keys()]).not.toContain(code);
    const redeem = { code, idempotencyKey: "redeem-cdk-bob-001" };
    r = await app.request("/api/v1/billing/codes/redeem", {
      method: "POST",
      headers: json(bob.cookie),
      body: JSON.stringify(redeem),
    });
    expect(((await r.json()) as any).data).toMatchObject({
      bonusUnits: 500,
      balanceUnits: 575,
      replayed: false,
    });
    r = await app.request("/api/v1/billing/codes/redeem", {
      method: "POST",
      headers: json(bob.cookie),
      body: JSON.stringify(redeem),
    });
    expect(((await r.json()) as any).data.replayed).toBe(true);
    expect(
      (
        (await (
          await app.request("/api/v1/billing/ledger", {
            headers: { cookie: bob.cookie },
          })
        ).json()) as any
      ).data,
    ).toHaveLength(2);
    r = await app.request("/api/v1/billing/invites", {
      method: "POST",
      headers: { cookie: alice.cookie },
    });
    const invite = ((await r.json()) as any).data.code;
    expect(invite).toMatch(/^INV_/);
    r = await app.request("/api/v1/billing/invites/redeem", {
      method: "POST",
      headers: json(alice.cookie),
      body: JSON.stringify({
        code: invite,
        idempotencyKey: "self-invite-attempt",
      }),
    });
    expect(r.status).toBe(422);
    const bind = { code: invite, idempotencyKey: "invite-bind-bob-001" };
    r = await app.request("/api/v1/billing/invites/redeem", {
      method: "POST",
      headers: json(bob.cookie),
      body: JSON.stringify(bind),
    });
    expect(((await r.json()) as any).data).toMatchObject({
      inviteeBalance: 675,
      replayed: false,
    });
    r = await app.request("/api/v1/billing/invites/redeem", {
      method: "POST",
      headers: json(bob.cookie),
      body: JSON.stringify(bind),
    });
    expect(((await r.json()) as any).data.replayed).toBe(true);
    expect(
      (
        (await (
          await app.request("/api/v1/billing/wallet", {
            headers: { cookie: alice.cookie },
          })
        ).json()) as any
      ).data.balanceUnits,
    ).toBe(100);
    expect(
      (
        (await (
          await app.request("/api/v1/billing/wallet", {
            headers: { cookie: bob.cookie },
          })
        ).json()) as any
      ).data.balanceUnits,
    ).toBe(675);
  });
});
