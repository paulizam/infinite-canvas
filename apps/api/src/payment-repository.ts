export type BillingOrderStatus =
  | "pending"
  | "paid"
  | "fulfilled"
  | "expired"
  | "cancelled"
  | "refund_pending"
  | "refunded"
  | "refund_failed"
  | "needs_review";
export type BillingOrder = {
  id: string;
  userId: string;
  productId: string;
  status: BillingOrderStatus;
  units: number;
  amountMinor: number;
  currency: string;
  provider: string;
  providerOrderId: string | null;
  providerTransactionId: string | null;
  checkoutUrl: string | null;
  qrCode: string | null;
  expiresAt: string;
  paidAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type BillingRefund = {
  id: string;
  orderId: string;
  userId: string;
  status: "pending" | "succeeded" | "failed" | "needs_review";
  amountMinor: number;
  units: number;
  reason: string;
  providerRefundId: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ReconciliationLine = {
  providerTransactionId: string;
  amountMinor: number;
};
export interface PaymentRepository {
  createOrder(input: {
    id: string;
    userId: string;
    productId: string;
    provider: string;
    idempotencyKey: string;
    requestHash: string;
    now: string;
    expiresAt: string;
  }): Promise<{ order: BillingOrder; replayed: boolean }>;
  attachCheckout(
    orderId: string,
    providerOrderId: string,
    checkoutUrl: string,
    qrCode: string,
    now: string,
  ): Promise<BillingOrder>;
  getOrder(
    userId: string,
    orderId: string,
    now: string,
  ): Promise<BillingOrder | null>;
  expire(now: string, limit: number): Promise<number>;
  fulfill(input: {
    provider: string;
    eventId: string;
    payloadHash: string;
    orderId: string;
    amountMinor: number;
    providerTransactionId: string;
    now: string;
  }): Promise<{ order: BillingOrder; replayed: boolean }>;
  createRefund(input: {
    id: string;
    userId: string;
    orderId: string;
    idempotencyKey: string;
    requestHash: string;
    reason: string;
    now: string;
  }): Promise<{ refund: BillingRefund; replayed: boolean }>;
  completeRefund(input: {
    refundId: string;
    succeeded: boolean;
    providerRefundId: string | null;
    errorCode: string | null;
    now: string;
  }): Promise<BillingRefund>;
  reconcile(
    provider: string,
    date: string,
    lines: ReconciliationLine[],
    now: string,
  ): Promise<unknown>;
  report(
    from: string,
    to: string,
  ): Promise<{
    revenueMinor: number;
    refundMinor: number;
    purchasedUnits: number;
    modelCostUnits: number;
  }>;
}
