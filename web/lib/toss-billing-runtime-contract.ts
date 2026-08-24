export const TOSS_RUNTIME_ASSIGNMENTS_FLAG = "toss_billing_new_assignments";
export const TOSS_RUNTIME_CHARGES_FLAG = "toss_billing_charges";
export const TOSS_RUNTIME_RENEWALS_FLAG = "toss_billing_renewals";
export const TOSS_RUNTIME_HANA_CARD_FLAG = "toss_billing_hana_card";

export const TOSS_RUNTIME_FLAGS = [
  TOSS_RUNTIME_ASSIGNMENTS_FLAG,
  TOSS_RUNTIME_CHARGES_FLAG,
  TOSS_RUNTIME_RENEWALS_FLAG,
  TOSS_RUNTIME_HANA_CARD_FLAG,
] as const;

export type TossRuntimeFlag = typeof TOSS_RUNTIME_FLAGS[number];

export type TossBillingRuntimeState = {
  stored: {
    assignments: boolean;
    charges: boolean;
    renewals: boolean;
    hanaCard: boolean;
  };
  environment: {
    assignments: boolean;
    charges: boolean;
    renewals: boolean;
    hanaCard: boolean;
  };
  effective: {
    assignments: boolean;
    charges: boolean;
    renewals: boolean;
    hanaCard: boolean;
  };
};
