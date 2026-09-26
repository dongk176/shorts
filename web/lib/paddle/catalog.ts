export const paddlePlans = [
  {
    code: "paddle_lite",
    name: "Lite",
    billingMonths: 1,
    minutes: 60,
    jobs: 1,
    usd: 399,
    jpy: 590,
  },
  {
    code: "paddle_creator",
    name: "Creator",
    billingMonths: 1,
    minutes: 200,
    jobs: 2,
    usd: 1199,
    jpy: 1790,
  },
  {
    code: "paddle_pro",
    name: "Pro",
    billingMonths: 1,
    minutes: 600,
    jobs: 3,
    usd: 3499,
    jpy: 4990,
  },
  { code: "paddle_creator_3m", name: "Starter", billingMonths: 3, minutes: 200, jobs: 2, usd: 4497, jpy: 6570 },
  { code: "paddle_creator_6m", name: "Starter", billingMonths: 6, minutes: 200, jobs: 2, usd: 7194, jpy: 10740 },
  { code: "paddle_creator_12m", name: "Starter", billingMonths: 12, minutes: 200, jobs: 2, usd: 11988, jpy: 17880 },
  { code: "paddle_pro_3m", name: "Expert", billingMonths: 3, minutes: 600, jobs: 3, usd: 10797, jpy: 15270 },
  { code: "paddle_pro_6m", name: "Expert", billingMonths: 6, minutes: 600, jobs: 3, usd: 20994, jpy: 29940 },
  { code: "paddle_pro_12m", name: "Expert", billingMonths: 12, minutes: 600, jobs: 3, usd: 31188, jpy: 45480 },
] as const;
export type PaddlePlanCode = (typeof paddlePlans)[number]["code"];
export type PaddleCurrency = "USD" | "JPY";
export function paddlePlan(code: string) {
  const plan = paddlePlans.find((p) => p.code === code);
  if (!plan) throw new Error("Unknown Paddle plan");
  return plan;
}
export function paddleAmount(code: string, currency: PaddleCurrency) {
  const plan = paddlePlan(code);
  return currency === "JPY" ? plan.jpy : plan.usd;
}
export function formatPaddlePrice(code: string, currency: PaddleCurrency, monthly = false) {
  return new Intl.NumberFormat(currency === "JPY" ? "ja-JP" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(paddleAmount(code, currency) / (monthly ? paddlePlan(code).billingMonths : 1) / (currency === "JPY" ? 1 : 100));
}

export const paddlePackageTerms = [3, 6, 12] as const;
export function paddleDisplayPlans(months: (typeof paddlePackageTerms)[number]) {
  return [paddlePlan("paddle_lite"), paddlePlan(`paddle_creator_${months}m`), paddlePlan(`paddle_pro_${months}m`)];
}

export function paddleInitialTerm(code?: string) {
 const months=paddlePlans.find(p=>p.code===code)?.billingMonths;
 return months===3 || months===12 ? months : 6;
}
export function paddleDiscount(code:string,currency:PaddleCurrency) {
 const plan=paddlePlan(code);
 if(plan.billingMonths<=3) return null;
 const baseline=paddlePlan(code.replace(/_(6|12)m$/, '_3m'));
 const savings=1-paddleAmount(code,currency)*baseline.billingMonths/(paddleAmount(baseline.code,currency)*plan.billingMonths);
 return {percent:Math.floor(savings*1000)/10,baseline:baseline.code};
}
