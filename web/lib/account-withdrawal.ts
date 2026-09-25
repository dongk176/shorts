export type WithdrawalSubscription = {
  status: string;
  paymentProvider?: string | null;
  billingCycle: string | null;
  paymentMethodId: string | null;
  cancelAtPeriodEnd: boolean;
  providerScheduleStatus: string | null;
};

export const accountWithdrawalConfirmationWords = [
  "회원탈퇴",
  "DELETE ACCOUNT",
  "アカウント削除",
] as const;

export function isAccountWithdrawalConfirmation(value: unknown) {
  if (typeof value !== "string") return false;
  return accountWithdrawalConfirmationWords.some((word) => word === value.trim());
}

export function blocksAccountWithdrawal(subscription: WithdrawalSubscription) {
  if (subscription.status === "pending") return true;
  if (!["trialing", "active", "past_due"].includes(subscription.status)) return false;
  // Paddle does not use a local saved-card row. Wait for its actual cancellation
  // webhook so an account cannot disappear while remote billing remains active.
  if (subscription.paymentProvider === "paddle") return true;
  if (subscription.billingCycle !== "monthly" || !subscription.paymentMethodId) return false;
  return !(
    subscription.cancelAtPeriodEnd
    && ["none", "paused", "disposed"].includes(subscription.providerScheduleStatus || "none")
  );
}
