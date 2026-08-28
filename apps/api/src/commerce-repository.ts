export type BillingProduct = {
  id: string;
  code: string;
  name: string;
  description: string;
  units: number;
  priceMinor: number;
  currency: string;
  active: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type RedemptionCodeInput = {
  id: string;
  kind: "coupon" | "cdk";
  codeHash: string;
  label: string;
  discountBps: number;
  bonusUnits: number;
  maxRedemptions: number;
  perUserLimit: number;
  startsAt: string;
  expiresAt: string;
  active: boolean;
  createdAt: string;
};
export type BillingPromotion = {
  id: string;
  name: string;
  discountBps: number;
  bonusUnits: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  productId: string | null;
};
export interface CommerceRepository {
  listCodes(): Promise<
    Array<Omit<RedemptionCodeInput, "codeHash"> & { redeemedCount: number }>
  >;
  listReferrals(limit: number): Promise<unknown[]>;
  products(activeOnly: boolean): Promise<BillingProduct[]>;
  saveProduct(x: BillingProduct): Promise<BillingProduct>;
  promotions(activeOnly: boolean, now: string): Promise<BillingPromotion[]>;
  savePromotion(x: BillingPromotion): Promise<BillingPromotion>;
  claimFreeProduct(
    userId: string,
    productId: string,
    now: string,
  ): Promise<{ units: number; balanceUnits: number; replayed: boolean }>;
  saveCode(
    x: RedemptionCodeInput,
  ): Promise<Omit<RedemptionCodeInput, "codeHash">>;
  redeemCode(
    userId: string,
    codeHash: string,
    key: string,
    now: string,
  ): Promise<{
    redemptionId: string;
    discountBps: number;
    bonusUnits: number;
    balanceUnits: number;
    replayed: boolean;
  }>;
  inviteCode(
    userId: string,
    id: string,
    codeHash: string,
    now: string,
  ): Promise<{ id: string; codeCreated: boolean }>;
  redeemInvite(
    userId: string,
    codeHash: string,
    key: string,
    rewards: { inviter: number; invitee: number },
    now: string,
  ): Promise<{ inviterId: string; inviteeBalance: number; replayed: boolean }>;
}
