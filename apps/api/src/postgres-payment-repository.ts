import pg, { type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.js";
import type {
  BillingOrder,
  BillingRefund,
  PaymentRepository,
  ReconciliationLine,
} from "./payment-repository.js";

export class PostgresPaymentRepository implements PaymentRepository {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url });
  }
  async createOrder(i: Parameters<PaymentRepository["createOrder"]>[0]) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const old = await c.query(
        "SELECT * FROM billing_orders WHERE user_id=$1 AND idempotency_key=$2 FOR UPDATE",
        [i.userId, i.idempotencyKey],
      );
      if (old.rows[0]) {
        if (old.rows[0].request_hash !== i.requestHash)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "幂等键载荷不一致",
          );
        await c.query("COMMIT");
        return { order: mapOrder(old.rows[0]), replayed: true };
      }
      const p = await c.query(
        "SELECT * FROM billing_products WHERE id=$1 AND active AND price_minor>0 FOR SHARE",
        [i.productId],
      );
      if (!p.rows[0])
        throw new DomainError("PRODUCT_NOT_ORDERABLE", 422, "商品不可下单");
      const promo = await c.query(
        "SELECT COALESCE(MAX(discount_bps),0) discount,COALESCE(MAX(bonus_units),0) bonus FROM billing_promotions WHERE active AND starts_at<=$2 AND ends_at>$2 AND (product_id IS NULL OR product_id=$1)",
        [i.productId, i.now],
      );
      const amount = Math.floor(
          (Number(p.rows[0].price_minor) *
            (10000 - Number(promo.rows[0].discount))) /
            10000,
        ),
        units = Number(p.rows[0].units) + Number(promo.rows[0].bonus);
      if (amount <= 0 || units <= 0)
        throw new DomainError("PRODUCT_NOT_ORDERABLE", 422, "商品不可下单");
      const r = await c.query(
        "INSERT INTO billing_orders(id,user_id,product_id,idempotency_key,request_hash,status,units,amount_minor,currency,provider,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$11) RETURNING *",
        [
          i.id,
          i.userId,
          i.productId,
          i.idempotencyKey,
          i.requestHash,
          units,
          amount,
          p.rows[0].currency,
          i.provider,
          i.expiresAt,
          i.now,
        ],
      );
      await c.query("COMMIT");
      return { order: mapOrder(r.rows[0]), replayed: false };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async attachCheckout(
    id: string,
    providerId: string,
    url: string,
    qr: string,
    now: string,
  ) {
    const r = await this.pool.query(
      "UPDATE billing_orders SET provider_order_id=COALESCE(provider_order_id,$2),checkout_url=COALESCE(checkout_url,$3),qr_code=COALESCE(qr_code,$4),updated_at=$5 WHERE id=$1 RETURNING *",
      [id, providerId, url, qr, now],
    );
    if (!r.rows[0]) throw new DomainError("ORDER_NOT_FOUND", 404, "订单不存在");
    return mapOrder(r.rows[0]);
  }
  async getOrder(userId: string, id: string, now: string) {
    await this.pool.query(
      "UPDATE billing_orders SET status='expired',updated_at=$3 WHERE id=$1 AND user_id=$2 AND status='pending' AND expires_at<=$3",
      [id, userId, now],
    );
    const r = await this.pool.query(
      "SELECT * FROM billing_orders WHERE id=$1 AND user_id=$2",
      [id, userId],
    );
    return r.rows[0] ? mapOrder(r.rows[0]) : null;
  }
  async expire(now: string, limit: number) {
    const r = await this.pool.query(
      "WITH due AS (SELECT id FROM billing_orders WHERE status='pending' AND expires_at<=$1 ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE billing_orders o SET status='expired',updated_at=$1 FROM due WHERE o.id=due.id RETURNING o.id",
      [now, limit],
    );
    return r.rowCount || 0;
  }
  async fulfill(i: Parameters<PaymentRepository["fulfill"]>[0]) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const prior = await c.query(
        "SELECT e.payload_hash,o.* FROM billing_payment_events e JOIN billing_orders o ON o.id=e.order_id WHERE e.provider=$1 AND e.provider_event_id=$2",
        [i.provider, i.eventId],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].payload_hash !== i.payloadHash)
          throw new DomainError(
            "PAYMENT_EVENT_CONFLICT",
            409,
            "支付事件载荷冲突",
          );
        await c.query("COMMIT");
        return { order: mapOrder(prior.rows[0]), replayed: true };
      }
      const q = await c.query(
          "SELECT * FROM billing_orders WHERE id=$1 FOR UPDATE",
          [i.orderId],
        ),
        o = q.rows[0];
      if (
        !o ||
        o.provider !== i.provider ||
        Number(o.amount_minor) !== i.amountMinor
      )
        throw new DomainError(
          "PAYMENT_AMOUNT_MISMATCH",
          422,
          "支付订单或金额不匹配",
        );
      if (o.status !== "pending")
        throw new DomainError("ORDER_STATE_INVALID", 409, "订单状态不接受支付");
      await c.query(
        "INSERT INTO billing_payment_events(id,provider,provider_event_id,order_id,event_type,payload_hash,received_at) VALUES($1,$2,$3,$4,'payment.succeeded',$5,$6)",
        [randomUUID(), i.provider, i.eventId, i.orderId, i.payloadHash, i.now],
      );
      await credit(
        c,
        o.user_id,
        Number(o.units),
        `order:${o.id}:purchase`,
        { orderId: o.id },
        i.now,
      );
      const updated = await c.query(
        "UPDATE billing_orders SET status='fulfilled',provider_transaction_id=$2,paid_at=$3,fulfilled_at=$3,updated_at=$3 WHERE id=$1 RETURNING *",
        [o.id, i.providerTransactionId, i.now],
      );
      await c.query("COMMIT");
      return { order: mapOrder(updated.rows[0]), replayed: false };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async createRefund(i: Parameters<PaymentRepository["createRefund"]>[0]) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const old = await c.query(
        "SELECT * FROM billing_refunds WHERE user_id=$1 AND idempotency_key=$2 FOR UPDATE",
        [i.userId, i.idempotencyKey],
      );
      if (old.rows[0]) {
        if (old.rows[0].request_hash !== i.requestHash)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "幂等键载荷不一致",
          );
        await c.query("COMMIT");
        return { refund: mapRefund(old.rows[0]), replayed: true };
      }
      const q = await c.query(
        "SELECT * FROM billing_orders WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [i.orderId, i.userId],
      );
      const o = q.rows[0];
      if (!o || o.status !== "fulfilled")
        throw new DomainError("ORDER_NOT_REFUNDABLE", 409, "订单不可退款");
      const r = await c.query(
        "INSERT INTO billing_refunds(id,order_id,user_id,idempotency_key,request_hash,status,amount_minor,units,reason,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$9) RETURNING *",
        [
          i.id,
          i.orderId,
          i.userId,
          i.idempotencyKey,
          i.requestHash,
          o.amount_minor,
          o.units,
          i.reason,
          i.now,
        ],
      );
      await c.query(
        "UPDATE billing_orders SET status='refund_pending',updated_at=$2 WHERE id=$1",
        [i.orderId, i.now],
      );
      await c.query("COMMIT");
      return { refund: mapRefund(r.rows[0]), replayed: false };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async completeRefund(i: Parameters<PaymentRepository["completeRefund"]>[0]) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(
          "SELECT * FROM billing_refunds WHERE id=$1 FOR UPDATE",
          [i.refundId],
        ),
        r = q.rows[0];
      if (!r) throw new DomainError("REFUND_NOT_FOUND", 404, "退款不存在");
      if (r.status !== "pending") {
        await c.query("COMMIT");
        return mapRefund(r);
      }
      let status = i.succeeded ? "succeeded" : "failed";
      if (i.succeeded) {
        const wallet = await c.query(
          "SELECT balance_units FROM billing_wallets WHERE user_id=$1 FOR UPDATE",
          [r.user_id],
        );
        if (
          !wallet.rows[0] ||
          Number(wallet.rows[0].balance_units) < Number(r.units)
        )
          status = "needs_review";
        else
          await credit(
            c,
            r.user_id,
            -Number(r.units),
            `refund:${r.id}`,
            { orderId: r.order_id },
            i.now,
          );
      }
      const orderStatus =
        status === "succeeded"
          ? "refunded"
          : status === "failed"
            ? "refund_failed"
            : "needs_review";
      const out = await c.query(
        "UPDATE billing_refunds SET status=$2,provider_refund_id=$3,error_code=$4,updated_at=$5 WHERE id=$1 RETURNING *",
        [
          r.id,
          status,
          i.providerRefundId,
          status === "needs_review"
            ? "INSUFFICIENT_POINTS_COMPENSATION"
            : i.errorCode,
          i.now,
        ],
      );
      await c.query(
        "UPDATE billing_orders SET status=$2,updated_at=$3 WHERE id=$1",
        [r.order_id, orderStatus, i.now],
      );
      await c.query("COMMIT");
      return mapRefund(out.rows[0]);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async reconcile(
    provider: string,
    date: string,
    lines: ReconciliationLine[],
    now: string,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const prior = await c.query(
        "SELECT * FROM billing_reconciliation_runs WHERE provider=$1 AND statement_date=$2",
        [provider, date],
      );
      if (prior.rows[0]) {
        await c.query("COMMIT");
        return {
          id: prior.rows[0].id,
          matchedCount: prior.rows[0].matched_count,
          mismatchCount: prior.rows[0].mismatch_count,
          replayed: true,
        };
      }
      const id = randomUUID();
      let matched = 0;
      const items = [];
      for (const line of lines) {
        const q = await c.query(
          "SELECT id,amount_minor FROM billing_orders WHERE provider=$1 AND provider_transaction_id=$2",
          [provider, line.providerTransactionId],
        );
        const o = q.rows[0],
          status = !o
            ? "missing_local"
            : Number(o.amount_minor) === line.amountMinor
              ? "matched"
              : "amount_mismatch";
        if (status === "matched") matched++;
        items.push({
          ...line,
          orderId: o?.id || null,
          localAmountMinor: o ? Number(o.amount_minor) : null,
          status,
        });
      }
      await c.query(
        "INSERT INTO billing_reconciliation_runs(id,provider,statement_date,status,matched_count,mismatch_count,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider,statement_date) DO NOTHING",
        [
          id,
          provider,
          date,
          matched === lines.length ? "completed" : "mismatch",
          matched,
          lines.length - matched,
          now,
        ],
      );
      for (const x of items)
        await c.query(
          "INSERT INTO billing_reconciliation_items(id,run_id,provider_transaction_id,order_id,statement_amount_minor,local_amount_minor,status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
          [
            randomUUID(),
            id,
            x.providerTransactionId,
            x.orderId,
            x.amountMinor,
            x.localAmountMinor,
            x.status,
          ],
        );
      await c.query("COMMIT");
      return {
        id,
        matchedCount: matched,
        mismatchCount: lines.length - matched,
        items,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async report(from: string, to: string) {
    const r = await this.pool.query(
      "SELECT COALESCE(SUM(amount_minor) FILTER (WHERE status IN ('fulfilled','refund_pending','refunded','refund_failed','needs_review')),0) revenue,COALESCE(SUM(amount_minor) FILTER (WHERE status='refunded'),0) refunds,COALESCE(SUM(units) FILTER (WHERE status IN ('fulfilled','refund_pending','refunded','refund_failed','needs_review')),0) units FROM billing_orders WHERE created_at>=$1 AND created_at<$2",
      [from, to],
    );
    const cost = await this.pool.query(
      "SELECT COALESCE(SUM(actual_units),0) cost FROM generation_jobs WHERE phase='succeeded' AND updated_at>=$1 AND updated_at<$2",
      [from, to],
    );
    return {
      revenueMinor: Number(r.rows[0].revenue),
      refundMinor: Number(r.rows[0].refunds),
      purchasedUnits: Number(r.rows[0].units),
      modelCostUnits: Number(cost.rows[0].cost),
    };
  }
}
async function credit(
  c: PoolClient,
  user: string,
  amount: number,
  key: string,
  meta: unknown,
  now: string,
) {
  await c.query(
    "INSERT INTO billing_wallets(user_id,balance_units,created_at,updated_at) VALUES($1,0,$2,$2) ON CONFLICT DO NOTHING",
    [user, now],
  );
  const q = await c.query(
      "SELECT balance_units FROM billing_wallets WHERE user_id=$1 FOR UPDATE",
      [user],
    ),
    balance = Number(q.rows[0].balance_units) + amount;
  if (balance < 0)
    throw new DomainError("INSUFFICIENT_POINTS", 409, "积分余额不足");
  await c.query(
    "UPDATE billing_wallets SET balance_units=$2,updated_at=$3 WHERE user_id=$1",
    [user, balance, now],
  );
  await c.query(
    "INSERT INTO billing_ledger_entries(id,user_id,entry_type,amount_units,balance_after_units,idempotency_key,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
    [
      randomUUID(),
      user,
      amount > 0 ? "purchase" : "refund",
      amount,
      balance,
      key,
      JSON.stringify(meta),
      now,
    ],
  );
}
const iso = (x: unknown) => (x ? new Date(x as string).toISOString() : null);
const mapOrder = (x: any): BillingOrder => ({
  id: x.id,
  userId: x.user_id,
  productId: x.product_id,
  status: x.status,
  units: Number(x.units),
  amountMinor: Number(x.amount_minor),
  currency: x.currency,
  provider: x.provider,
  providerOrderId: x.provider_order_id,
  providerTransactionId: x.provider_transaction_id,
  checkoutUrl: x.checkout_url,
  qrCode: x.qr_code,
  expiresAt: iso(x.expires_at)!,
  paidAt: iso(x.paid_at),
  fulfilledAt: iso(x.fulfilled_at),
  createdAt: iso(x.created_at)!,
  updatedAt: iso(x.updated_at)!,
});
const mapRefund = (x: any): BillingRefund => ({
  id: x.id,
  orderId: x.order_id,
  userId: x.user_id,
  status: x.status,
  amountMinor: Number(x.amount_minor),
  units: Number(x.units),
  reason: x.reason,
  providerRefundId: x.provider_refund_id,
  errorCode: x.error_code,
  createdAt: iso(x.created_at)!,
  updatedAt: iso(x.updated_at)!,
});
