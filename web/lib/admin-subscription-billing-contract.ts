export type SubscriptionBillingRow = { date: string; productCode: string; productName: string; months: number; amount: number; count: number };
export type SubscriptionBillingData = { today: string; rows: SubscriptionBillingRow[] };
const productNames: Record<string, string> = { easycut_pro: "이지컷 프로", starter: "스타터", expert: "전문가" };
export function subscriptionProduct(row: SubscriptionBillingRow) {
  const code = row.productCode.replace(/^toss_/, "");
  const family = code === "easycut_pro_v2" ? "easycut_pro" : code.replace(/_\d+m$/, "");
  return { code: family, name: productNames[family] ?? row.productName };
}
export function summarizeSubscriptionBilling(rows: SubscriptionBillingRow[], product: string, from: string, to: string, months = "all") {
  return rows.filter(row => (product === "all" || subscriptionProduct(row).code === product)
    && (months === "all" || row.months === Number(months))
    && (!from || row.date >= from) && (!to || row.date <= to))
    .reduce((sum, row) => ({ amount: sum.amount + row.amount, count: sum.count + row.count }), { amount: 0, count: 0 });
}
