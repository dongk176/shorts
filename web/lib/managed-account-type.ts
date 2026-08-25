export const MANAGED_ACCOUNT_TYPES = ["personal", "enterprise"] as const;

export type ManagedAccountType = (typeof MANAGED_ACCOUNT_TYPES)[number];

export const MANAGED_ACCOUNT_TYPE_LABELS: Record<ManagedAccountType, string> = {
  personal: "개인",
  enterprise: "기업",
};
