export const TOSS_CONTRACT_MONTHS = [1, 3, 6, 12] as const;
export type TossContractMonths = (typeof TOSS_CONTRACT_MONTHS)[number];
export type TossPlanTier = "easycut_pro" | "starter" | "expert";

export type TossPlanCode =
  | "toss_easycut_pro_1m"
  | "toss_easycut_pro_6m"
  | "toss_easycut_pro_12m"
  | "toss_starter_1m"
  | "toss_starter_3m"
  | "toss_starter_6m"
  | "toss_starter_12m"
  | "toss_expert_1m"
  | "toss_expert_3m"
  | "toss_expert_6m"
  | "toss_expert_12m";

export type TossCatalogPlan = {
  code: TossPlanCode;
  tier: TossPlanTier;
  displayName: string;
  contractMonths: TossContractMonths;
  monthlyQuotaSeconds: number;
  maxActiveJobs: number;
  priceKrw: number;
  monthlyEquivalentKrw: number;
  discountPercent: number;
  guidebookIncluded: boolean;
};

/**
 * Complete server catalog. Retired plans remain here so existing contracts can
 * be read and renewed at their original amount. New checkout and change
 * requests must validate against TOSS_SALE_PLAN_CATALOG.
 */
export const TOSS_PLAN_CATALOG: readonly TossCatalogPlan[] = [
  { code: "toss_easycut_pro_1m", tier: "easycut_pro", displayName: "이지컷 프로", contractMonths: 1, monthlyQuotaSeconds: 3_600, maxActiveJobs: 1, priceKrw: 9_900, monthlyEquivalentKrw: 9_900, discountPercent: 0, guidebookIncluded: false },
  { code: "toss_easycut_pro_6m", tier: "easycut_pro", displayName: "이지컷 프로", contractMonths: 6, monthlyQuotaSeconds: 3_600, maxActiveJobs: 1, priceKrw: 53_400, monthlyEquivalentKrw: 8_900, discountPercent: 10, guidebookIncluded: false },
  { code: "toss_easycut_pro_12m", tier: "easycut_pro", displayName: "이지컷 프로", contractMonths: 12, monthlyQuotaSeconds: 3_600, maxActiveJobs: 1, priceKrw: 82_800, monthlyEquivalentKrw: 6_900, discountPercent: 30, guidebookIncluded: false },
  { code: "toss_starter_1m", tier: "starter", displayName: "스타터 패키지", contractMonths: 1, monthlyQuotaSeconds: 12_000, maxActiveJobs: 2, priceKrw: 24_900, monthlyEquivalentKrw: 24_900, discountPercent: 0, guidebookIncluded: true },
  { code: "toss_starter_3m", tier: "starter", displayName: "스타터 패키지", contractMonths: 3, monthlyQuotaSeconds: 12_000, maxActiveJobs: 2, priceKrw: 70_965, monthlyEquivalentKrw: 23_655, discountPercent: 5, guidebookIncluded: true },
  { code: "toss_starter_6m", tier: "starter", displayName: "스타터 패키지", contractMonths: 6, monthlyQuotaSeconds: 12_000, maxActiveJobs: 2, priceKrw: 119_400, monthlyEquivalentKrw: 19_900, discountPercent: 20, guidebookIncluded: true },
  { code: "toss_starter_12m", tier: "starter", displayName: "스타터 패키지", contractMonths: 12, monthlyQuotaSeconds: 12_000, maxActiveJobs: 2, priceKrw: 198_000, monthlyEquivalentKrw: 16_500, discountPercent: 34, guidebookIncluded: true },
  { code: "toss_expert_1m", tier: "expert", displayName: "전문가 패키지", contractMonths: 1, monthlyQuotaSeconds: 36_000, maxActiveJobs: 3, priceKrw: 59_000, monthlyEquivalentKrw: 59_000, discountPercent: 0, guidebookIncluded: true },
  { code: "toss_expert_3m", tier: "expert", displayName: "전문가 패키지", contractMonths: 3, monthlyQuotaSeconds: 36_000, maxActiveJobs: 3, priceKrw: 147_000, monthlyEquivalentKrw: 49_000, discountPercent: 39, guidebookIncluded: true },
  { code: "toss_expert_6m", tier: "expert", displayName: "전문가 패키지", contractMonths: 6, monthlyQuotaSeconds: 36_000, maxActiveJobs: 3, priceKrw: 288_000, monthlyEquivalentKrw: 48_000, discountPercent: 40, guidebookIncluded: true },
  { code: "toss_expert_12m", tier: "expert", displayName: "전문가 패키지", contractMonths: 12, monthlyQuotaSeconds: 36_000, maxActiveJobs: 3, priceKrw: 432_000, monthlyEquivalentKrw: 36_000, discountPercent: 55, guidebookIncluded: true },
] as const;

export const TOSS_SALE_PLAN_CATALOG = TOSS_PLAN_CATALOG.filter((plan) => (
  plan.code === "toss_easycut_pro_1m"
  || ((plan.tier === "starter" || plan.tier === "expert")
    && (plan.contractMonths === 3 || plan.contractMonths === 6 || plan.contractMonths === 12))
));

const CATALOG_BY_CODE = new Map(TOSS_PLAN_CATALOG.map((plan) => [plan.code, plan]));
const SALE_CODES = new Set(TOSS_SALE_PLAN_CATALOG.map((plan) => plan.code));

export function isTossPlanCode(value: string): value is TossPlanCode {
  return CATALOG_BY_CODE.has(value as TossPlanCode);
}
export function isTossSalePlanCode(value: string): value is TossPlanCode {
  return SALE_CODES.has(value as TossPlanCode);
}
export function tossPlan(code: TossPlanCode) {
  const plan = CATALOG_BY_CODE.get(code);
  if (!plan) throw new Error("지원하지 않는 토스 요금제입니다.");
  return plan;
}

export type TossSubscriptionChangeAction = "unchanged" | "immediate" | "scheduled";

export function classifyTossSubscriptionChange(input: {
  currentPlanCode: TossPlanCode;
  targetPlanCode: TossPlanCode;
}): TossSubscriptionChangeAction {
  if (input.currentPlanCode === input.targetPlanCode) return "unchanged";
  return tossPlan(input.targetPlanCode).priceKrw > tossPlan(input.currentPlanCode).priceKrw
    ? "immediate"
    : "scheduled";
}

function boundedRatio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, numerator / denominator));
}

export function quoteImmediateTossChange(input: {
  currentPlanCode: TossPlanCode;
  targetPlanCode: TossPlanCode;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  now?: Date;
}) {
  const action = classifyTossSubscriptionChange(input);
  if (action !== "immediate") {
    return { action, unusedCreditKrw: 0, chargeAmountKrw: 0 } as const;
  }
  const now = input.now ?? new Date();
  const current = tossPlan(input.currentPlanCode);
  const target = tossPlan(input.targetPlanCode);
  const periodMs = input.currentPeriodEnd.getTime() - input.currentPeriodStart.getTime();
  const remainingMs = input.currentPeriodEnd.getTime() - now.getTime();
  const unusedCreditKrw = Math.max(
    0,
    Math.min(current.priceKrw, Math.round(current.priceKrw * boundedRatio(remainingMs, periodMs))),
  );
  return {
    action,
    unusedCreditKrw,
    chargeAmountKrw: Math.max(0, target.priceKrw - unusedCreditKrw),
  } as const;
}
