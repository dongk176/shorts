export const paypalPlans = [
  { code: "pro_1m", baseCode: "easycut_pro_v2", name: "EasyCut Pro", months: 1, minutes: 60, jobs: 1, amount: 1200 },
  { code: "starter_3m", baseCode: "starter_3m", name: "Starter", months: 3, minutes: 200, jobs: 2, amount: 8700 },
  { code: "starter_6m", baseCode: "starter_6m", name: "Starter", months: 6, minutes: 200, jobs: 2, amount: 14400 },
  { code: "starter_12m", baseCode: "starter_12m", name: "Starter", months: 12, minutes: 200, jobs: 2, amount: 22800 },
  { code: "expert_3m", baseCode: "expert_3m", name: "Expert", months: 3, minutes: 600, jobs: 3, amount: 20700 },
  { code: "expert_6m", baseCode: "expert_6m", name: "Expert", months: 6, minutes: 600, jobs: 3, amount: 35400 },
  { code: "expert_12m", baseCode: "expert_12m", name: "Expert", months: 12, minutes: 600, jobs: 3, amount: 58800 },
] as const;
export type PayPalPlan = typeof paypalPlans[number];
export function paypalPlan(code: string): PayPalPlan {
  const plan = paypalPlans.find(p => p.code === code);
  if (!plan) throw Error("Unknown PayPal plan");
  return plan;
}
export function usdMinor(value: string) {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) throw Error("Invalid USD amount");
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw Error("Invalid USD amount");
  return minor;
}
export function addPayPalMonths(start: Date, months: number) {
  const d = new Date(start); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()+months);
  d.setUTCDate(Math.min(start.getUTCDate(), new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));
  return d;
}
