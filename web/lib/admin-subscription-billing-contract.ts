export type SubscriptionBillingRow = { date: string; productCode: string; productName: string; gross: number; refunded: number; count: number };
export type SubscriptionBillingData = { today: string; rows: SubscriptionBillingRow[] };
export function summarizeSubscriptionBilling(rows: SubscriptionBillingRow[], product: string, from: string, to: string) {
  return rows.filter(row => (product === "all" || row.productCode === product) && (!from || row.date >= from) && (!to || row.date <= to))
    .reduce((sum, row) => ({ gross: sum.gross + row.gross, refunded: sum.refunded + row.refunded, count: sum.count + row.count }), { gross: 0, refunded: 0, count: 0 });
}
