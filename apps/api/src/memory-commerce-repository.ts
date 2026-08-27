import { DomainError } from "./domain.js";
import type {
  BillingProduct,
  CommerceRepository,
  RedemptionCodeInput,
  BillingPromotion,
} from "./commerce-repository.js";
export class MemoryCommerceRepository implements CommerceRepository {
  constructor(
    private credit?: (
      userId: string,
      amount: number,
      key: string,
      note: string,
      now: string,
    ) => Promise<number>,
  ) {}
  productsMap = new Map<string, BillingProduct>();
  codes = new Map<string, RedemptionCodeInput & { count: number }>();
  uses = new Map<
    string,
    { id: string; userId: string; discount: number; bonus: number }
  >();
  invites = new Map<string, { id: string; owner: string; count: number }>();
  referrals = new Map<string, { inviter: string; invitee: string }>();
  balances = new Map<string, number>();
  promotionMap = new Map<string, BillingPromotion>();
  private grants = new Set<string>();
  async products(a: boolean) {
    return [...this.productsMap.values()].filter((x) => !a || x.active);
  }
  async saveProduct(x: BillingProduct) {
    this.productsMap.set(x.code, x);
    return x;
  }
  async promotions(active: boolean, now: string) {
    return [...this.promotionMap.values()].filter(
      (x) => !active || (x.active && x.startsAt <= now && x.endsAt > now),
    );
  }
  async savePromotion(x: BillingPromotion) {
    this.promotionMap.set(x.id, x);
    return x;
  }
  async claimFreeProduct(u: string, id: string, now: string) {
    const p = [...this.productsMap.values()].find((x) => x.id === id);
    if (!p || !p.active || p.priceMinor !== 0)
      throw new DomainError(
        "BILLING_FREE_PRODUCT_INVALID",
        422,
        "免费额度商品无效",
      );
    const key = `${u}:${id}`;
    if (this.grants.has(key))
      return {
        units: p.units,
        balanceUnits: this.balances.get(u) || 0,
        replayed: true,
      };
    const promos = await this.promotions(true, now),
      bonus = Math.max(
        0,
        ...promos
          .filter((x) => !x.productId || x.productId === id)
          .map((x) => x.bonusUnits),
      ),
      units = p.units + bonus,
      balance = this.credit
        ? await this.credit(
            u,
            units,
            `free-product:${id}:${u}`,
            "free product grant",
            now,
          )
        : (this.balances.get(u) || 0) + units;
    this.grants.add(key);
    this.balances.set(u, balance);
    return { units, balanceUnits: balance, replayed: false };
  }
  async saveCode(x: RedemptionCodeInput) {
    this.codes.set(x.codeHash, { ...x, count: 0 });
    const { codeHash, ...safe } = x;
    return safe;
  }
  async redeemCode(u: string, h: string, k: string, now: string) {
    const old = this.uses.get(k);
    if (old) {
      if (old.userId !== u) throw invalid();
      return {
        redemptionId: old.id,
        discountBps: old.discount,
        bonusUnits: old.bonus,
        balanceUnits: this.balances.get(u) || 0,
        replayed: true,
      };
    }
    const x = this.codes.get(h);
    if (!x || !x.active || x.startsAt > now || x.expiresAt <= now)
      throw invalid();
    if (x.count >= x.maxRedemptions)
      throw new DomainError("BILLING_CODE_EXHAUSTED", 409, "兑换码已领完");
    if (
      [...this.uses.values()].filter(
        (y) => y.userId === u && y.id.startsWith(`${x.id}:`),
      ).length >= x.perUserLimit
    )
      throw new DomainError(
        "BILLING_CODE_USER_LIMIT",
        409,
        "已达到个人领取上限",
      );
    const id = `${x.id}:${x.count + 1}`;
    const balance = this.credit
      ? await this.credit(
          u,
          x.bonusUnits,
          `redemption:${id}`,
          "code redemption",
          now,
        )
      : (this.balances.get(u) || 0) + x.bonusUnits;
    x.count++;
    this.uses.set(k, {
      id,
      userId: u,
      discount: x.discountBps,
      bonus: x.bonusUnits,
    });
    this.balances.set(u, balance);
    return {
      redemptionId: id,
      discountBps: x.discountBps,
      bonusUnits: x.bonusUnits,
      balanceUnits: balance,
      replayed: false,
    };
  }
  async inviteCode(u: string, id: string, h: string) {
    const old = [...this.invites.values()].find((x) => x.owner === u);
    if (old) return { id: old.id, codeCreated: false };
    this.invites.set(h, { id, owner: u, count: 0 });
    return { id, codeCreated: true };
  }
  async redeemInvite(
    u: string,
    h: string,
    k: string,
    r: { inviter: number; invitee: number },
    now: string,
  ) {
    const old = this.referrals.get(k);
    if (old)
      return {
        inviterId: old.inviter,
        inviteeBalance: this.balances.get(u) || 0,
        replayed: true,
      };
    const x = this.invites.get(h);
    if (!x || x.count >= 100)
      throw new DomainError("BILLING_INVITE_INVALID", 422, "邀请码无效");
    if (x.owner === u)
      throw new DomainError("BILLING_SELF_INVITE", 422, "不能使用自己的邀请码");
    if ([...this.referrals.values()].some((y) => y.invitee === u))
      throw new DomainError("BILLING_ALREADY_REFERRED", 409, "已绑定邀请关系");
    x.count++;
    this.referrals.set(k, { inviter: x.owner, invitee: u });
    const inviterBalance = this.credit
      ? await this.credit(
          x.owner,
          r.inviter,
          `referral:${k}:inviter`,
          "referral reward",
          now,
        )
      : (this.balances.get(x.owner) || 0) + r.inviter;
    this.balances.set(x.owner, inviterBalance);
    const balance = this.credit
      ? await this.credit(
          u,
          r.invitee,
          `referral:${k}:invitee`,
          "referral reward",
          now,
        )
      : (this.balances.get(u) || 0) + r.invitee;
    this.balances.set(u, balance);
    return { inviterId: x.owner, inviteeBalance: balance, replayed: false };
  }
}
const invalid = () =>
  new DomainError("BILLING_CODE_INVALID", 422, "兑换码无效或已过期");
