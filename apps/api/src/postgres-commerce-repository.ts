import pg, { type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.js";
import type {
  BillingProduct,
  BillingPromotion,
  CommerceRepository,
  RedemptionCodeInput,
} from "./commerce-repository.js";
export class PostgresCommerceRepository implements CommerceRepository {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }
  async listCodes() {
    const r = await this.pool.query(
      "SELECT id,kind,label,discount_bps,bonus_units,max_redemptions,redeemed_count,per_user_limit,starts_at,expires_at,active,created_at FROM billing_redemption_codes ORDER BY created_at DESC",
    );
    return r.rows.map((x) => ({
      id: x.id,
      kind: x.kind,
      label: x.label,
      discountBps: Number(x.discount_bps),
      bonusUnits: Number(x.bonus_units),
      maxRedemptions: Number(x.max_redemptions),
      redeemedCount: Number(x.redeemed_count),
      perUserLimit: Number(x.per_user_limit),
      startsAt: iso(x.starts_at),
      expiresAt: iso(x.expires_at),
      active: x.active,
      createdAt: iso(x.created_at),
    }));
  }
  async listReferrals(limit: number) {
    const r = await this.pool.query(
      "SELECT id,inviter_id,invitee_id,inviter_reward_units,invitee_reward_units,created_at FROM billing_referrals ORDER BY created_at DESC,id DESC LIMIT $1",
      [limit],
    );
    return r.rows.map((x) => ({
      id: x.id,
      inviterId: x.inviter_id,
      inviteeId: x.invitee_id,
      inviterRewardUnits: Number(x.inviter_reward_units),
      inviteeRewardUnits: Number(x.invitee_reward_units),
      createdAt: iso(x.created_at),
    }));
  }
  async products(active: boolean) {
    const r = await this.pool.query(
      "SELECT * FROM billing_products WHERE NOT $1 OR active ORDER BY price_minor,code",
      [active],
    );
    return r.rows.map(product);
  }
  async saveProduct(x: BillingProduct) {
    const r = await this.pool.query(
      "INSERT INTO billing_products(id,code,name,description,units,price_minor,currency,active,metadata,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,units=EXCLUDED.units,price_minor=EXCLUDED.price_minor,currency=EXCLUDED.currency,active=EXCLUDED.active,metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at RETURNING *",
      [
        x.id,
        x.code,
        x.name,
        x.description,
        x.units,
        x.priceMinor,
        x.currency,
        x.active,
        JSON.stringify(x.metadata),
        x.createdAt,
      ],
    );
    return product(r.rows[0]);
  }
  async promotions(active: boolean, now: string) {
    const r = await this.pool.query(
      "SELECT * FROM billing_promotions WHERE NOT $1 OR (active AND starts_at<=$2 AND ends_at>$2) ORDER BY discount_bps DESC,bonus_units DESC",
      [active, now],
    );
    return r.rows.map(promotion);
  }
  async savePromotion(x: BillingPromotion) {
    const r = await this.pool.query(
      "INSERT INTO billing_promotions(id,name,discount_bps,bonus_units,starts_at,ends_at,active,product_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,discount_bps=EXCLUDED.discount_bps,bonus_units=EXCLUDED.bonus_units,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,active=EXCLUDED.active,product_id=EXCLUDED.product_id RETURNING *",
      [
        x.id,
        x.name,
        x.discountBps,
        x.bonusUnits,
        x.startsAt,
        x.endsAt,
        x.active,
        x.productId,
      ],
    );
    return promotion(r.rows[0]);
  }
  async claimFreeProduct(u: string, id: string, now: string) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const old = await c.query(
        "SELECT g.units,COALESCE(w.balance_units,0) balance_units FROM billing_free_grants g LEFT JOIN billing_wallets w ON w.user_id=g.user_id WHERE g.product_id=$1 AND g.user_id=$2",
        [id, u],
      );
      if (old.rows[0]) {
        await c.query("COMMIT");
        return {
          units: Number(old.rows[0].units),
          balanceUnits: Number(old.rows[0].balance_units),
          replayed: true,
        };
      }
      const p = await c.query(
        "SELECT * FROM billing_products WHERE id=$1 AND active AND price_minor=0 FOR UPDATE",
        [id],
      );
      if (!p.rows[0])
        throw new DomainError(
          "BILLING_FREE_PRODUCT_INVALID",
          422,
          "免费额度商品无效",
        );
      const promo = await c.query(
          "SELECT COALESCE(MAX(bonus_units),0) bonus FROM billing_promotions WHERE active AND starts_at<=$2 AND ends_at>$2 AND (product_id IS NULL OR product_id=$1)",
          [id, now],
        ),
        units = Number(p.rows[0].units) + Number(promo.rows[0].bonus),
        grant = randomUUID();
      await c.query(
        "INSERT INTO billing_free_grants(id,product_id,user_id,units,created_at) VALUES($1,$2,$3,$4,$5)",
        [grant, id, u, units, now],
      );
      const balance = await credit(
        c,
        u,
        units,
        "redemption",
        `free-product:${id}:${u}`,
        { productId: id, grantId: grant },
        now,
      );
      await c.query("COMMIT");
      return { units, balanceUnits: balance, replayed: false };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async saveCode(x: RedemptionCodeInput) {
    await this.pool.query(
      "INSERT INTO billing_redemption_codes(id,kind,code_hash,label,discount_bps,bonus_units,max_redemptions,per_user_limit,starts_at,expires_at,active,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        x.id,
        x.kind,
        x.codeHash,
        x.label,
        x.discountBps,
        x.bonusUnits,
        x.maxRedemptions,
        x.perUserLimit,
        x.startsAt,
        x.expiresAt,
        x.active,
        x.createdAt,
      ],
    );
    const { codeHash, ...safe } = x;
    return safe;
  }
  async redeemCode(userId: string, hash: string, key: string, now: string) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const old = await c.query(
        "SELECT r.*,COALESCE(w.balance_units,0) balance_units FROM billing_code_redemptions r LEFT JOIN billing_wallets w ON w.user_id=r.user_id WHERE r.idempotency_key=$1 AND r.user_id=$2",
        [key, userId],
      );
      if (old.rows[0]) {
        await c.query("COMMIT");
        return redemption(old.rows[0], true);
      }
      const q = await c.query(
          "SELECT * FROM billing_redemption_codes WHERE code_hash=$1 FOR UPDATE",
          [hash],
        ),
        x = q.rows[0];
      if (
        !x ||
        !x.active ||
        Date.parse(x.starts_at) > Date.parse(now) ||
        Date.parse(x.expires_at) <= Date.parse(now)
      )
        throw new DomainError(
          "BILLING_CODE_INVALID",
          422,
          "兑换码无效或已过期",
        );
      if (x.redeemed_count >= x.max_redemptions)
        throw new DomainError("BILLING_CODE_EXHAUSTED", 409, "兑换码已领完");
      const used = await c.query(
        "SELECT count(*)::int n FROM billing_code_redemptions WHERE code_id=$1 AND user_id=$2",
        [x.id, userId],
      );
      if (used.rows[0].n >= x.per_user_limit)
        throw new DomainError(
          "BILLING_CODE_USER_LIMIT",
          409,
          "已达到个人领取上限",
        );
      const id = randomUUID();
      await c.query(
        "INSERT INTO billing_code_redemptions(id,code_id,user_id,idempotency_key,discount_bps,bonus_units,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, x.id, userId, key, x.discount_bps, x.bonus_units, now],
      );
      await c.query(
        "UPDATE billing_redemption_codes SET redeemed_count=redeemed_count+1 WHERE id=$1",
        [x.id],
      );
      const balance = await credit(
        c,
        userId,
        Number(x.bonus_units),
        "redemption",
        `redemption:${id}`,
        { codeId: x.id },
        now,
      );
      await c.query("COMMIT");
      return {
        redemptionId: id,
        discountBps: Number(x.discount_bps),
        bonusUnits: Number(x.bonus_units),
        balanceUnits: balance,
        replayed: false,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async inviteCode(userId: string, id: string, hash: string, now: string) {
    const r = await this.pool.query(
      "INSERT INTO billing_invite_codes(id,owner_id,code_hash,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id) DO NOTHING RETURNING id",
      [id, userId, hash, now],
    );
    const row =
      r.rows[0] ||
      (
        await this.pool.query(
          "SELECT id FROM billing_invite_codes WHERE owner_id=$1",
          [userId],
        )
      ).rows[0];
    return { id: row.id, codeCreated: !!r.rows[0] };
  }
  async redeemInvite(
    userId: string,
    hash: string,
    key: string,
    rewards: { inviter: number; invitee: number },
    now: string,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const old = await c.query(
        "SELECT r.*,COALESCE(w.balance_units,0) balance_units FROM billing_referrals r LEFT JOIN billing_wallets w ON w.user_id=r.invitee_id WHERE r.idempotency_key=$1 AND r.invitee_id=$2",
        [key, userId],
      );
      if (old.rows[0]) {
        await c.query("COMMIT");
        return {
          inviterId: old.rows[0].inviter_id,
          inviteeBalance: Number(old.rows[0].balance_units),
          replayed: true,
        };
      }
      const q = await c.query(
          "SELECT * FROM billing_invite_codes WHERE code_hash=$1 AND active FOR UPDATE",
          [hash],
        ),
        x = q.rows[0];
      if (!x || x.used_count >= x.max_uses)
        throw new DomainError("BILLING_INVITE_INVALID", 422, "邀请码无效");
      if (x.owner_id === userId)
        throw new DomainError(
          "BILLING_SELF_INVITE",
          422,
          "不能使用自己的邀请码",
        );
      if (
        (
          await c.query("SELECT 1 FROM billing_referrals WHERE invitee_id=$1", [
            userId,
          ])
        ).rows[0]
      )
        throw new DomainError(
          "BILLING_ALREADY_REFERRED",
          409,
          "已绑定邀请关系",
        );
      const id = randomUUID();
      await c.query(
        "INSERT INTO billing_referrals(id,invite_code_id,inviter_id,invitee_id,idempotency_key,inviter_reward_units,invitee_reward_units,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          x.id,
          x.owner_id,
          userId,
          key,
          rewards.inviter,
          rewards.invitee,
          now,
        ],
      );
      await c.query(
        "UPDATE billing_invite_codes SET used_count=used_count+1 WHERE id=$1",
        [x.id],
      );
      await credit(
        c,
        x.owner_id,
        rewards.inviter,
        "referral",
        `referral:${id}:inviter`,
        { inviteeId: userId },
        now,
      );
      const balance = await credit(
        c,
        userId,
        rewards.invitee,
        "referral",
        `referral:${id}:invitee`,
        { inviterId: x.owner_id },
        now,
      );
      await c.query("COMMIT");
      return {
        inviterId: x.owner_id,
        inviteeBalance: balance,
        replayed: false,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
async function credit(
  c: PoolClient,
  userId: string,
  amount: number,
  type: "redemption" | "referral",
  key: string,
  meta: Record<string, unknown>,
  now: string,
) {
  await c.query(
    "INSERT INTO billing_wallets(user_id,balance_units,created_at,updated_at) VALUES($1,0,$2,$2) ON CONFLICT DO NOTHING",
    [userId, now],
  );
  const w = await c.query(
      "SELECT balance_units FROM billing_wallets WHERE user_id=$1 FOR UPDATE",
      [userId],
    ),
    balance = Number(w.rows[0].balance_units) + amount;
  if (amount) {
    await c.query(
      "UPDATE billing_wallets SET balance_units=$2,updated_at=$3 WHERE user_id=$1",
      [userId, balance, now],
    );
    await c.query(
      "INSERT INTO billing_ledger_entries(id,user_id,entry_type,amount_units,balance_after_units,idempotency_key,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
      [
        randomUUID(),
        userId,
        type,
        amount,
        balance,
        key,
        JSON.stringify(meta),
        now,
      ],
    );
  }
  return balance;
}
const redemption = (x: any, replayed: boolean) => ({
  redemptionId: x.id,
  discountBps: Number(x.discount_bps),
  bonusUnits: Number(x.bonus_units),
  balanceUnits: Number(x.balance_units),
  replayed,
});
const iso = (x: any) => new Date(x).toISOString();
const product = (x: any): BillingProduct => ({
  id: x.id,
  code: x.code,
  name: x.name,
  description: x.description,
  units: Number(x.units),
  priceMinor: Number(x.price_minor),
  currency: x.currency,
  active: x.active,
  metadata: x.metadata,
  createdAt: iso(x.created_at),
  updatedAt: iso(x.updated_at),
});
const promotion = (x: any): BillingPromotion => ({
  id: x.id,
  name: x.name,
  discountBps: Number(x.discount_bps),
  bonusUnits: Number(x.bonus_units),
  startsAt: iso(x.starts_at),
  endsAt: iso(x.ends_at),
  active: x.active,
  productId: x.product_id,
});
