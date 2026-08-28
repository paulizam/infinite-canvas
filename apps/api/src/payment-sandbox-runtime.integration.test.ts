import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HttpPaymentAdapter, PaymentService } from "./payment-service.js";
import { PostgresPaymentRepository } from "./postgres-payment-repository.js";

const databaseUrl = process.env.PAYMENT_SANDBOX_TEST_DATABASE_URL?.trim();
const token = "sandbox-api-token-0123456789abcdef";
const webhookSecret = "sandbox-webhook-secret-0123456789abcdef";

describe.runIf(Boolean(databaseUrl))("payment provider HTTP sandbox [BIL-005][BIL-006][BIL-007]", () => {
  const userId = randomUUID();
  const productId = randomUUID();
  const setup = new pg.Pool({ connectionString: databaseUrl });
  const repository = new PostgresPaymentRepository(databaseUrl!);
  let server: Server;
  let origin: string;
  let orderCalls = 0;
  let refundCalls = 0;
  let failNextRefund = false;

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      if (request.method !== "POST" || request.headers.authorization !== `Bearer ${token}`) return response.writeHead(401).end();
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/orders") {
        orderCalls++;
        expect(request.headers["idempotency-key"]).toBe(body.id);
        return response.end(JSON.stringify({ providerOrderId: `sandbox-order-${body.id}`, checkoutUrl: `${origin}/checkout/${body.id}`, qrCode: `sandbox-qr:${body.id}` }));
      }
      if (request.url === "/v1/refunds") {
        refundCalls++;
        expect(request.headers["idempotency-key"]).toBe(body.refundId);
        if (failNextRefund) {
          failNextRefund = false;
          return response.writeHead(503).end(JSON.stringify({ error: "sandbox transient failure" }));
        }
        return response.end(JSON.stringify({ providerRefundId: `sandbox-refund-${body.refundId}` }));
      }
      response.writeHead(404).end();
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "localhost", () => {
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("sandbox did not expose a port"));
        resolve(address.port);
      });
    });
    origin = `http://localhost:${port}`;
    const now = new Date().toISOString();
    await setup.query("INSERT INTO users(id,email,name,password_hash,created_at,updated_at) VALUES($1,$2,'Runtime','runtime-only',$3,$3)", [userId, `${userId}@runtime.invalid`, now]);
    await setup.query("INSERT INTO billing_products(id,code,name,units,price_minor,currency,created_at,updated_at) VALUES($1,$2,'Sandbox credits',500,990,'CNY',$3,$3)", [productId, `sandbox-${productId}`, now]);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await setup.end();
    await (repository as unknown as { pool: { end(): Promise<void> } }).pool.end();
  });

  it("exercises checkout, signed idempotent webhook, expiration, refund and failed-refund retry", async () => {
    const adapter = new HttpPaymentAdapter("runtime-sandbox", `${origin}/`, token);
    const service = new PaymentService(repository, adapter, webhookSecret);

    const firstKey = `order-${randomUUID()}`;
    const first = await service.createOrder(userId, { productId, idempotencyKey: firstKey });
    expect(first.order).toMatchObject({ status: "pending", amountMinor: 990, checkoutUrl: `${origin}/checkout/${first.order.id}` });
    const replayedOrder = await service.createOrder(userId, { productId, idempotencyKey: firstKey });
    expect(replayedOrder).toMatchObject({ replayed: true, order: { id: first.order.id } });
    expect(orderCalls).toBe(1);

    const paidFirst = await fulfill(service, first.order.id, first.order.amountMinor);
    expect(paidFirst.order.status).toBe("fulfilled");
    const replayedEvent = await service.webhook(paidFirst.body, paidFirst.timestamp, paidFirst.signature);
    expect(replayedEvent.replayed).toBe(true);
    await expect(service.webhook(paidFirst.body, paidFirst.timestamp, "00".repeat(32))).rejects.toMatchObject({ code: "PAYMENT_SIGNATURE_INVALID" });

    const expired = await service.createOrder(userId, { productId, idempotencyKey: `expire-${randomUUID()}` });
    await setup.query("UPDATE billing_orders SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.order.id]);
    expect(await service.expire()).toBeGreaterThanOrEqual(1);
    await expect(service.getOrder(userId, expired.order.id)).resolves.toMatchObject({ status: "expired" });

    const refund = await service.refund(userId, { orderId: first.order.id, idempotencyKey: `refund-${randomUUID()}`, reason: "runtime verification" });
    expect(refund.refund).toMatchObject({ status: "succeeded", providerRefundId: `sandbox-refund-${refund.refund.id}` });

    const second = await service.createOrder(userId, { productId, idempotencyKey: `order-${randomUUID()}` });
    await fulfill(service, second.order.id, second.order.amountMinor);
    failNextRefund = true;
    const failed = await service.refund(userId, { orderId: second.order.id, idempotencyKey: `refund-${randomUUID()}`, reason: "transient sandbox failure" });
    expect(failed.refund).toMatchObject({ status: "failed", errorCode: "PROVIDER_REFUND_FAILED" });
    const retried = await service.retryRefund(failed.refund.id);
    expect(retried.refund).toMatchObject({ status: "succeeded", providerRefundId: `sandbox-refund-${failed.refund.id}` });
    expect(refundCalls).toBe(3);

    const state = await setup.query("SELECT (SELECT balance_units FROM billing_wallets WHERE user_id=$1) balance,(SELECT count(*) FROM billing_payment_events WHERE order_id IN ($2,$3)) events,(SELECT count(*) FROM billing_ledger_entries WHERE user_id=$1 AND entry_type='refund') refunds", [userId, first.order.id, second.order.id]);
    expect(state.rows[0]).toMatchObject({ balance: "0", events: "2", refunds: "2" });
  });
});

async function fulfill(service: PaymentService, orderId: string, amountMinor: number) {
  const body = JSON.stringify({ eventId: `event-${randomUUID()}`, orderId, providerTransactionId: `transaction-${randomUUID()}`, amountMinor, type: "payment.succeeded" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex");
  const result = await service.webhook(body, timestamp, signature);
  return { ...result, body, timestamp, signature };
}
