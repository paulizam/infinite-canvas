import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { CommerceRepository } from "./commerce-repository.js";
export class CommerceService {
  constructor(
    private repository: CommerceRepository,
    private secret: string,
    private rewards = { inviter: 100, invitee: 100 },
  ) {
    if (Buffer.byteLength(secret) < 32)
      throw new Error("BILLING_CODE_SECRET must contain at least 32 bytes");
  }
  async products(activeOnly = true) {
    const now = new Date().toISOString(),
      [products, promotions] = await Promise.all([
        this.repository.products(activeOnly),
        this.repository.promotions(activeOnly, now),
      ]);
    return products.map((product) => {
      const applicable = promotions.filter(
          (x) => !x.productId || x.productId === product.id,
        ),
        discountBps = Math.max(0, ...applicable.map((x) => x.discountBps)),
        bonusUnits = Math.max(0, ...applicable.map((x) => x.bonusUnits));
      return {
        ...product,
        discountBps,
        bonusUnits,
        effectivePriceMinor: Math.floor(
          (product.priceMinor * (10000 - discountBps)) / 10000,
        ),
        effectiveUnits: product.units + bonusUnits,
      };
    });
  }
  saveProduct(i: {
    code: string;
    name: string;
    description?: string;
    units: number;
    priceMinor: number;
    currency: string;
    active: boolean;
    metadata?: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    return this.repository.saveProduct({
      id: randomUUID(),
      code: i.code.trim().toLowerCase(),
      name: i.name.trim(),
      description: i.description?.trim() || "",
      units: i.units,
      priceMinor: i.priceMinor,
      currency: i.currency.toUpperCase(),
      active: i.active,
      metadata: i.metadata || {},
      createdAt: now,
      updatedAt: now,
    });
  }
  savePromotion(i: {
    id?: string;
    name: string;
    discountBps: number;
    bonusUnits: number;
    startsAt: string;
    endsAt: string;
    active: boolean;
    productId?: string | null;
  }) {
    return this.repository.savePromotion({
      id: i.id || randomUUID(),
      name: i.name.trim(),
      discountBps: i.discountBps,
      bonusUnits: i.bonusUnits,
      startsAt: i.startsAt,
      endsAt: i.endsAt,
      active: i.active,
      productId: i.productId || null,
    });
  }
  claimFreeProduct(u: string, id: string) {
    return this.repository.claimFreeProduct(u, id, new Date().toISOString());
  }
  async createCode(i: {
    kind: "coupon" | "cdk";
    label: string;
    discountBps: number;
    bonusUnits: number;
    maxRedemptions: number;
    perUserLimit: number;
    startsAt: string;
    expiresAt: string;
    active: boolean;
  }) {
    const code = `${i.kind.toUpperCase()}_${randomBytes(18).toString("base64url")}`,
      now = new Date().toISOString();
    const record = await this.repository.saveCode({
      id: randomUUID(),
      ...i,
      label: i.label.trim(),
      codeHash: this.hash(code),
      createdAt: now,
    });
    return { ...record, code };
  }
  redeemCode(u: string, code: string, key: string) {
    return this.repository.redeemCode(
      u,
      this.hash(code),
      key,
      new Date().toISOString(),
    );
  }
  async createInvite(u: string) {
    const code = `INV_${randomBytes(15).toString("base64url")}`,
      result = await this.repository.inviteCode(
        u,
        randomUUID(),
        this.hash(code),
        new Date().toISOString(),
      );
    return { ...result, code: result.codeCreated ? code : null };
  }
  redeemInvite(u: string, code: string, key: string) {
    return this.repository.redeemInvite(
      u,
      this.hash(code),
      key,
      this.rewards,
      new Date().toISOString(),
    );
  }
  private hash(code: string) {
    return createHmac("sha256", this.secret)
      .update(code.trim().toUpperCase())
      .digest("hex");
  }
}
