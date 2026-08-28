import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { DomainError } from "./domain.js";
import type {
  PaymentRepository,
  ReconciliationLine,
} from "./payment-repository.js";

export interface PaymentAdapter {
  readonly provider: string;
  createCheckout(order: {
    id: string;
    amountMinor: number;
    currency: string;
    expiresAt: string;
  }): Promise<{
    providerOrderId: string;
    checkoutUrl: string;
    qrCode: string;
  }>;
  refund(input: {
    refundId: string;
    providerTransactionId: string;
    amountMinor: number;
  }): Promise<{ providerRefundId: string }>;
}
export class HostedPaymentAdapter implements PaymentAdapter {
  readonly provider: string;
  private base: URL;
  constructor(provider: string, checkoutBaseUrl: string) {
    this.provider = provider;
    this.base = new URL(checkoutBaseUrl);
    if (this.base.protocol !== "https:" && this.base.hostname !== "localhost")
      throw new Error("PAYMENT_CHECKOUT_BASE_URL must use HTTPS");
  }
  async createCheckout(order: { id: string }) {
    const url = new URL(`orders/${order.id}`, this.base).toString();
    return { providerOrderId: order.id, checkoutUrl: url, qrCode: url };
  }
  async refund(input: { refundId: string }) {
    return { providerRefundId: `${this.provider}:${input.refundId}` };
  }
}
export class HttpPaymentAdapter implements PaymentAdapter {
  readonly provider: string;
  private base: URL;
  constructor(
    provider: string,
    baseUrl: string,
    private token: string,
    private timeoutMs = 10000,
  ) {
    this.provider = provider;
    this.base = new URL(baseUrl);
    if (this.base.protocol !== "https:" && this.base.hostname !== "localhost")
      throw new Error("PAYMENT_API_BASE_URL must use HTTPS");
    if (
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash
    )
      throw new Error(
        "PAYMENT_API_BASE_URL must not contain credentials/query/fragment",
      );
    if (token.length < 32)
      throw new Error("PAYMENT_API_TOKEN must contain at least 32 characters");
  }
  async createCheckout(order: {
    id: string;
    amountMinor: number;
    currency: string;
    expiresAt: string;
  }) {
    const x = await this.post("v1/orders", order);
    return {
      providerOrderId: requiredString(x.providerOrderId),
      checkoutUrl: safeHttpsUrl(x.checkoutUrl),
      qrCode: requiredString(x.qrCode),
    };
  }
  async refund(input: {
    refundId: string;
    providerTransactionId: string;
    amountMinor: number;
  }) {
    const x = await this.post("v1/refunds", input);
    return { providerRefundId: requiredString(x.providerRefundId) };
  }
  private async post(path: string, body: unknown) {
    const response = await fetch(new URL(path, this.base), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        "idempotency-key":
          (body as { id?: string; refundId?: string }).id ||
          (body as { refundId?: string }).refundId ||
          "",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new DomainError("PAYMENT_PROVIDER_FAILED", 502, "支付渠道调用失败");
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 64 * 1024)
      throw new DomainError(
        "PAYMENT_PROVIDER_RESPONSE_INVALID",
        502,
        "支付渠道响应无效",
      );
    const text = await response.text();
    if (Buffer.byteLength(text) > 64 * 1024)
      throw new DomainError(
        "PAYMENT_PROVIDER_RESPONSE_INVALID",
        502,
        "支付渠道响应无效",
      );
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new DomainError(
        "PAYMENT_PROVIDER_RESPONSE_INVALID",
        502,
        "支付渠道响应无效",
      );
    }
  }
}
export class PaymentService {
  constructor(
    private repository: PaymentRepository,
    private adapter: PaymentAdapter,
    private webhookSecret: string,
    private toleranceSeconds = 300,
  ) {
    if (Buffer.byteLength(webhookSecret) < 32)
      throw new Error("PAYMENT_WEBHOOK_SECRET must contain at least 32 bytes");
  }
  orders(
    status?: import("./payment-repository.js").BillingOrderStatus,
    limit = 100,
  ) {
    return this.repository.orders(status, Math.min(Math.max(limit, 1), 1000));
  }
  refunds(
    status?: import("./payment-repository.js").BillingRefund["status"],
    limit = 100,
  ) {
    return this.repository.refunds(status, Math.min(Math.max(limit, 1), 1000));
  }
  async createOrder(
    userId: string,
    input: { productId: string; idempotencyKey: string },
  ) {
    const now = new Date(),
      requestHash = hashJson(input),
      result = await this.repository.createOrder({
        id: randomUUID(),
        userId,
        productId: input.productId,
        provider: this.adapter.provider,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        now: now.toISOString(),
        expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      });
    if (result.order.checkoutUrl) return result;
    const checkout = await this.adapter.createCheckout(result.order);
    return {
      order: await this.repository.attachCheckout(
        result.order.id,
        checkout.providerOrderId,
        checkout.checkoutUrl,
        checkout.qrCode,
        new Date().toISOString(),
      ),
      replayed: result.replayed,
    };
  }
  getOrder(userId: string, orderId: string) {
    return this.repository.getOrder(userId, orderId, new Date().toISOString());
  }
  expire(limit = 100) {
    return this.repository.expire(new Date().toISOString(), limit);
  }
  async webhook(rawBody: string, timestamp: string, signature: string) {
    const seconds = Number(timestamp);
    if (!Number.isSafeInteger(seconds)) throw signatureError();
    if (Math.abs(Date.now() / 1000 - seconds) > this.toleranceSeconds)
      throw signatureError();
    const expected = createHmac("sha256", this.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signature, "hex");
    } catch {
      throw signatureError();
    }
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw signatureError();
    let x: Record<string, unknown>;
    try {
      x = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new DomainError("PAYMENT_EVENT_INVALID", 422, "支付事件无效");
    }
    if (
      typeof x.eventId !== "string" ||
      typeof x.orderId !== "string" ||
      typeof x.providerTransactionId !== "string" ||
      typeof x.amountMinor !== "number" ||
      !Number.isSafeInteger(x.amountMinor) ||
      x.amountMinor <= 0 ||
      x.type !== "payment.succeeded"
    )
      throw new DomainError("PAYMENT_EVENT_INVALID", 422, "支付事件无效");
    return this.repository.fulfill({
      provider: this.adapter.provider,
      eventId: x.eventId,
      payloadHash: createHash("sha256").update(rawBody).digest("hex"),
      orderId: x.orderId,
      amountMinor: x.amountMinor,
      providerTransactionId: x.providerTransactionId,
      now: new Date().toISOString(),
    });
  }
  async refund(
    userId: string,
    input: { orderId: string; idempotencyKey: string; reason: string },
  ) {
    const created = await this.repository.createRefund({
      id: randomUUID(),
      userId,
      orderId: input.orderId,
      idempotencyKey: input.idempotencyKey,
      requestHash: hashJson(input),
      reason: input.reason,
      now: new Date().toISOString(),
    });
    if (created.replayed || created.refund.status !== "pending") return created;
    const order = await this.repository.getOrder(
      userId,
      input.orderId,
      new Date().toISOString(),
    );
    if (!order?.providerTransactionId)
      throw new DomainError("ORDER_NOT_REFUNDABLE", 409, "订单不可退款");
    try {
      const channel = await this.adapter.refund({
        refundId: created.refund.id,
        providerTransactionId: order.providerTransactionId,
        amountMinor: created.refund.amountMinor,
      });
      return {
        refund: await this.repository.completeRefund({
          refundId: created.refund.id,
          succeeded: true,
          providerRefundId: channel.providerRefundId,
          errorCode: null,
          now: new Date().toISOString(),
        }),
        replayed: false,
      };
    } catch {
      return {
        refund: await this.repository.completeRefund({
          refundId: created.refund.id,
          succeeded: false,
          providerRefundId: null,
          errorCode: "PROVIDER_REFUND_FAILED",
          now: new Date().toISOString(),
        }),
        replayed: false,
      };
    }
  }
  reconcile(date: string, lines: ReconciliationLine[]) {
    return this.repository.reconcile(
      this.adapter.provider,
      date,
      lines,
      new Date().toISOString(),
    );
  }
  report(from: string, to: string) {
    return this.repository.report(from, to);
  }
}
const hashJson = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const signatureError = () =>
  new DomainError("PAYMENT_SIGNATURE_INVALID", 401, "支付签名无效");
const requiredString = (x: unknown) => {
  if (typeof x !== "string" || !x.trim())
    throw new DomainError(
      "PAYMENT_PROVIDER_RESPONSE_INVALID",
      502,
      "支付渠道响应无效",
    );
  return x;
};
const safeHttpsUrl = (x: unknown) => {
  const value = requiredString(x),
    url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new DomainError(
      "PAYMENT_PROVIDER_RESPONSE_INVALID",
      502,
      "支付渠道响应无效",
    );
  return url.toString();
};
