import { expectedShortCount } from "./contracts";

export const YEARLY_DISCOUNT_RATE = 0.2;

const SHORT_ESTIMATE_SOURCE_MINUTES = 10;
const SHORTS_PER_ESTIMATE_SOURCE = expectedShortCount(SHORT_ESTIMATE_SOURCE_MINUTES * 60);

export const pricingPlanCodes = ["plus", "standard", "pro"] as const;

export type PricingPlanCode = (typeof pricingPlanCodes)[number];

export type PricingPlan = {
  code: PricingPlanCode;
  name: string;
  monthly: number;
  minutes: number;
  badge?: string;
  popular?: boolean;
  features: string[];
};

export const pricingPlans: PricingPlan[] = [
  {
    code: "plus",
    name: "PLUS",
    monthly: 9_900,
    minutes: 100,
    features: [
      "동시 작업 1개 · 프로젝트 7일 보관",
      "기본 · 커스텀 템플릿 사용",
    ],
  },
  {
    code: "standard",
    name: "STANDARD",
    monthly: 19_900,
    minutes: 200,
    badge: "가장 인기 있는 플랜",
    popular: true,
    features: [
      "동시 작업 2개 · 프로젝트 15일 보관",
      "기본 · 커스텀 템플릿 사용",
    ],
  },
  {
    code: "pro",
    name: "PRO",
    monthly: 49_900,
    minutes: 600,
    badge: "전문가를 위한 플랜",
    features: [
      "동시 작업 3개 · 프로젝트 30일 보관",
      "기본 · 커스텀 템플릿 사용",
    ],
  },
];

export const usageAddOns = [
  { code: "minutes_50", minutes: 50, price: 5_900 },
  { code: "minutes_100", minutes: 100, price: 9_900, badge: "가장 많이 선택" },
  { code: "minutes_300", minutes: 300, price: 24_900, badge: "분당 최저가" },
];

export function discountedMonthlyPrice(monthly: number) {
  return monthly * (1 - YEARLY_DISCOUNT_RATE);
}

export function yearlyCharge(monthly: number) {
  return discountedMonthlyPrice(monthly) * 12;
}

export function estimatedMonthlyShortCount(sourceMinutes: number) {
  return Math.round((sourceMinutes / SHORT_ESTIMATE_SOURCE_MINUTES) * SHORTS_PER_ESTIMATE_SOURCE);
}

export function isPricingPlanCode(value: string | undefined): value is PricingPlanCode {
  return pricingPlanCodes.some((code) => code === value);
}
