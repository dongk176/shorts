export type AdminOrder = {
  id: string;
  orderId: string;
  kind: string;
  productCode: string;
  billingCycle: string | null;
  prepaidMonths: number;
  refundPolicyVersion: number;
  amountKrw: number;
  refundedAmountKrw: number;
  reservedRefundKrw: number;
  refundStatus: string;
  status: string;
  provider: string;
  providerTransactionId: string | null;
  providerStatus: string | null;
  providerTerminalId: string | null;
  hasPaymentMethod: boolean;
  credentialScope: string | null;
  installmentMonths: number;
  cardIssuerName: string | null;
  installmentBenefitType: string | null;
  declaredCardKind: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  approvedAt: string | null;
  createdAt: string;
  email: string;
  subscriptionStatus: string | null;
  contractPeriodStart: string | null;
  contractPeriodEnd: string | null;
  currentPackageMonthUsed: boolean;
  firstCompletedJobAt: string | null;
  popularFilterUsageCount: number;
  popularFilterLastUsedAt: string | null;
};

export type AdminRefund = {
  id: string;
  billingOrderId: string;
  orderId: string;
  email: string;
  adminEmail: string;
  amountKrw: number;
  reason: string;
  status: string;
  entitlementActionStatus: string;
  providerRefundTransactionId: string | null;
  failureMessage: string | null;
  requestedAt: string;
  processedAt: string | null;
};

export type RemediationMetrics = {
  total: number;
  required: number;
  registering: number;
  awaitingProvider: number;
  completed: number;
  expired: number;
  manualReview: number;
  staleRegistering: number;
  snapshotChanged: number;
  duplicateActiveSchedules: number;
  claimsEnabled: boolean;
  reconciliationEnabled: boolean;
};

export type AdminBillingOrderPage = {
  orders: AdminOrder[];
  hasMore: boolean;
  nextCursor: string | null;
  nextOffset: number;
};

export type AdminBillingSupportingData = {
  refunds: AdminRefund[];
  remediationMetrics: RemediationMetrics | null;
};
