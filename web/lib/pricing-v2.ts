export const pricingV2PackageMonths = [3, 6, 12] as const;

export type PricingV2PackageMonths = (typeof pricingV2PackageMonths)[number];
export type PricingV2PackageTier = "starter" | "expert";

export const pricingV2PlanCodes = [
  "easycut_pro_v2",
  "starter_3m",
  "starter_6m",
  "starter_12m",
  "expert_3m",
  "expert_6m",
  "expert_12m",
] as const;

export type PricingV2PlanCode = (typeof pricingV2PlanCodes)[number];

export type PricingV2PlanProduct = {
  code: PricingV2PlanCode;
  kind: "subscription" | "package";
  tier: "easycut" | PricingV2PackageTier;
  displayName: string;
  billingCycle: "monthly" | "yearly";
  durationMonths: number;
  monthlyMinutes: number;
  monthlyPriceKrw: number;
  totalPriceKrw: number;
  discountPercent: number;
};

export const pricingV2Plans: readonly PricingV2PlanProduct[] = [
  {
    code: "easycut_pro_v2",
    kind: "subscription",
    tier: "easycut",
    displayName: "이지컷 프로",
    billingCycle: "monthly",
    durationMonths: 1,
    monthlyMinutes: 60,
    monthlyPriceKrw: 9_900,
    totalPriceKrw: 9_900,
    discountPercent: 0,
  },
  {
    code: "starter_3m",
    kind: "package",
    tier: "starter",
    displayName: "스타터 패키지 3개월",
    billingCycle: "yearly",
    durationMonths: 3,
    monthlyMinutes: 200,
    monthlyPriceKrw: 23_655,
    totalPriceKrw: 70_965,
    discountPercent: 5,
  },
  {
    code: "starter_6m",
    kind: "package",
    tier: "starter",
    displayName: "스타터 패키지 6개월",
    billingCycle: "yearly",
    durationMonths: 6,
    monthlyMinutes: 200,
    monthlyPriceKrw: 19_900,
    totalPriceKrw: 119_400,
    discountPercent: 20,
  },
  {
    code: "starter_12m",
    kind: "package",
    tier: "starter",
    displayName: "스타터 패키지 12개월",
    billingCycle: "yearly",
    durationMonths: 12,
    monthlyMinutes: 200,
    monthlyPriceKrw: 16_500,
    totalPriceKrw: 198_000,
    discountPercent: 34,
  },
  {
    code: "expert_3m",
    kind: "package",
    tier: "expert",
    displayName: "전문가 패키지 3개월",
    billingCycle: "yearly",
    durationMonths: 3,
    monthlyMinutes: 600,
    monthlyPriceKrw: 49_000,
    totalPriceKrw: 147_000,
    discountPercent: 39,
  },
  {
    code: "expert_6m",
    kind: "package",
    tier: "expert",
    displayName: "전문가 패키지 6개월",
    billingCycle: "yearly",
    durationMonths: 6,
    monthlyMinutes: 600,
    monthlyPriceKrw: 48_000,
    totalPriceKrw: 288_000,
    discountPercent: 40,
  },
  {
    code: "expert_12m",
    kind: "package",
    tier: "expert",
    displayName: "전문가 패키지 12개월",
    billingCycle: "yearly",
    durationMonths: 12,
    monthlyMinutes: 600,
    monthlyPriceKrw: 36_000,
    totalPriceKrw: 432_000,
    discountPercent: 55,
  },
] as const;

export const pricingV2EarlyBirdCodes = [
  "earlybird_300",
  "earlybird_600",
  "earlybird_1000",
] as const;

export type PricingV2EarlyBirdCode = (typeof pricingV2EarlyBirdCodes)[number];

export const pricingV2EarlyBirdProducts = [
  {
    code: "earlybird_300",
    minutes: 300,
    discountPercent: 20,
    originalPriceKrw: 60_000,
    priceKrw: 48_000,
  },
  {
    code: "earlybird_600",
    minutes: 600,
    discountPercent: 30,
    originalPriceKrw: 120_000,
    priceKrw: 84_000,
  },
  {
    code: "earlybird_1000",
    minutes: 1_000,
    discountPercent: 40,
    originalPriceKrw: 200_000,
    priceKrw: 120_000,
  },
] as const;

export function isPricingV2PlanCode(value: string | null | undefined): value is PricingV2PlanCode {
  return pricingV2PlanCodes.some((code) => code === value);
}

export function isPricingV2PackageCode(value: string | null | undefined) {
  return pricingV2Plans.some((plan) => plan.code === value && plan.kind === "package");
}

export function canStackPricingV2Package(
  currentPlanCode: string | null | undefined,
  targetPlanCode: string | null | undefined,
) {
  return isPricingV2PackageCode(currentPlanCode)
    && isPricingV2PackageCode(targetPlanCode)
    && currentPlanCode !== targetPlanCode;
}

export function getPricingV2Plan(value: string | null | undefined) {
  return pricingV2Plans.find((plan) => plan.code === value) || null;
}

export function getPricingV2Package(tier: PricingV2PackageTier, months: PricingV2PackageMonths) {
  return pricingV2Plans.find(
    (plan) => plan.kind === "package" && plan.tier === tier && plan.durationMonths === months,
  ) || null;
}

export function isPricingV2EarlyBirdCode(
  value: string | null | undefined,
): value is PricingV2EarlyBirdCode {
  return pricingV2EarlyBirdCodes.some((code) => code === value);
}
