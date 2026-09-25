export const paddlePlans = [
  {
    code: "paddle_lite",
    name: "Lite",
    minutes: 60,
    jobs: 1,
    usd: 990,
    jpy: 1480,
  },
  {
    code: "paddle_creator",
    name: "Creator",
    minutes: 200,
    jobs: 2,
    usd: 1990,
    jpy: 2980,
  },
  {
    code: "paddle_pro",
    name: "Pro",
    minutes: 600,
    jobs: 3,
    usd: 4990,
    jpy: 7480,
  },
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
export function formatPaddlePrice(code: string, currency: PaddleCurrency) {
  return new Intl.NumberFormat(currency === "JPY" ? "ja-JP" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(paddleAmount(code, currency) / (currency === "JPY" ? 1 : 100));
}
