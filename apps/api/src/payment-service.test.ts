import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HostedPaymentAdapter, PaymentService } from "./payment-service.js";
import type {
  BillingOrder,
  BillingRefund,
  PaymentRepository,
} from "./payment-repository.js";

const now = new Date().toISOString();
const order: BillingOrder = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  productId: "33333333-3333-4333-8333-333333333333",
  status: "pending",
  units: 500,
  amountMinor: 990,
  currency: "CNY",
  provider: "test",
  providerOrderId: null,
  providerTransactionId: null,
  checkoutUrl: null,
  qrCode: null,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  paidAt: null,
  fulfilledAt: null,
  createdAt: now,
  updatedAt: now,
};
const refund: BillingRefund = {
  id: "44444444-4444-4444-8444-444444444444",
  orderId: order.id,
  userId: order.userId,
  status: "pending",
  amountMinor: order.amountMinor,
  units: order.units,
  reason: "duplicate",
  providerRefundId: null,
  errorCode: null,
  createdAt: now,
  updatedAt: now,
};
function repository(): PaymentRepository {
  return {
    orders: vi.fn(async () => []),
    refunds: vi.fn(async () => []),
    createOrder: vi.fn(async () => ({ order, replayed: false })),
    attachCheckout: vi.fn(
      async (_id, providerOrderId, checkoutUrl, qrCode) => ({
        ...order,
        providerOrderId,
        checkoutUrl,
        qrCode,
      }),
    ),
    getOrder: vi.fn(
      async () =>
        ({
          ...order,
          status: "refund_pending",
          providerTransactionId: "txn-1",
        }) satisfies BillingOrder,
    ),
    expire: vi.fn(async () => 0),
    fulfill: vi.fn(async () => ({
      order: { ...order, status: "fulfilled" } satisfies BillingOrder,
      replayed: false,
    })),
    createRefund: vi.fn(async () => ({ refund, replayed: false })),
    completeRefund: vi.fn(
      async (x) =>
        ({
          ...refund,
          status: x.succeeded ? "succeeded" : "failed",
          providerRefundId: x.providerRefundId,
          errorCode: x.errorCode,
        }) satisfies BillingRefund,
    ),
    retryRefund: vi.fn(async () => ({
      refund: { ...refund, status: "pending" } satisfies BillingRefund,
      order: {
        ...order,
        status: "refund_pending",
        providerTransactionId: "txn-1",
      } satisfies BillingOrder,
    })),
    reconcile: vi.fn(async () => ({})),
    report: vi.fn(async () => ({
      revenueMinor: 0,
      refundMinor: 0,
      purchasedUnits: 0,
      modelCostUnits: 0,
    })),
  };
}

describe("PaymentService", () => {
  it("creates an idempotent hosted checkout without open redirects [BIL-005]", async () => {
    const repo = repository(),
      adapter = new HostedPaymentAdapter("test", "https://pay.example.test/"),
      service = new PaymentService(repo, adapter, "w".repeat(32));
    const result = await service.createOrder(order.userId, {
      productId: order.productId,
      idempotencyKey: "order-key-001",
    });
    expect(result.order.checkoutUrl).toBe(
      `https://pay.example.test/orders/${order.id}`,
    );
    expect(repo.attachCheckout).toHaveBeenCalledOnce();
    expect(() => new HostedPaymentAdapter("bad", "http://evil.test/")).toThrow(
      /HTTPS/,
    );
  });

  it("verifies raw webhook signatures and rejects replay-window drift [BIL-006]", async () => {
    const repo = repository(),
      adapter = new HostedPaymentAdapter("test", "https://pay.example.test/"),
      secret = "s".repeat(32),
      service = new PaymentService(repo, adapter, secret),
      body = JSON.stringify({
        eventId: "evt-1",
        orderId: order.id,
        providerTransactionId: "txn-1",
        amountMinor: 990,
        type: "payment.succeeded",
      }),
      timestamp = String(Math.floor(Date.now() / 1000)),
      signature = createHmac("sha256", secret)
        .update(`${timestamp}.${body}`)
        .digest("hex");
    await expect(
      service.webhook(body, timestamp, signature),
    ).resolves.toMatchObject({
      order: { status: "fulfilled" },
    });
    expect(repo.fulfill).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt-1", amountMinor: 990 }),
    );
    await expect(service.webhook(body, "1", signature)).rejects.toMatchObject({
      code: "PAYMENT_SIGNATURE_INVALID",
    });
  });

  it("uses the durable refund id as provider idempotency key [BIL-007]", async () => {
    const repo = repository(),
      adapter = new HostedPaymentAdapter("test", "https://pay.example.test/"),
      service = new PaymentService(repo, adapter, "r".repeat(32));
    const result = await service.refund(order.userId, {
      orderId: order.id,
      idempotencyKey: "refund-key-001",
      reason: "duplicate",
    });
    expect(result.refund).toMatchObject({
      status: "succeeded",
      providerRefundId: `test:${refund.id}`,
    });
    expect(repo.completeRefund).toHaveBeenCalledOnce();
  });

  it("resumes a pending durable refund after a crash before the provider call", async () => {
    const repo = repository();
    vi.mocked(repo.createRefund).mockResolvedValue({ refund, replayed: true });
    const adapter = new HostedPaymentAdapter(
      "test",
      "https://pay.example.test/",
    );
    const refundSpy = vi.spyOn(adapter, "refund");
    const service = new PaymentService(repo, adapter, "r".repeat(32));

    const result = await service.refund(order.userId, {
      orderId: order.id,
      idempotencyKey: "refund-key-after-crash",
      reason: "duplicate",
    });

    expect(refundSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        refundId: refund.id,
        providerTransactionId: "txn-1",
      }),
    );
    expect(result).toMatchObject({
      refund: { status: "succeeded" },
      replayed: false,
    });
  });

  it("retries a provider-failed refund with the same durable refund id", async () => {
    const repo = repository();
    const adapter = new HostedPaymentAdapter(
      "test",
      "https://pay.example.test/",
    );
    const refundSpy = vi.spyOn(adapter, "refund");
    const service = new PaymentService(repo, adapter, "r".repeat(32));

    await expect(service.retryRefund(refund.id)).resolves.toMatchObject({
      refund: { status: "succeeded" },
    });
    expect(repo.retryRefund).toHaveBeenCalledWith(
      refund.id,
      expect.any(String),
    );
    expect(refundSpy).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: refund.id }),
    );
  });
});
