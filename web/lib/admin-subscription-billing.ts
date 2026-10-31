import "server-only";
import { getDb } from "@/lib/db";
import { kstDate } from "@/lib/admin-trends";
import type { SubscriptionBillingData } from "./admin-subscription-billing-contract";

export async function loadAdminSubscriptionBilling(): Promise<SubscriptionBillingData> {
  const rows = await getDb()`
    select to_char(o.approved_at at time zone 'Asia/Seoul','YYYY-MM-DD') as date,
      o.product_code, coalesce(p.display_name,o.product_code) as product_name,
      sum(o.amount_krw)::bigint as gross, sum(coalesce(o.refunded_amount_krw,0))::bigint as refunded,
      count(*)::integer as count
    from shorts_mvp.billing_orders o
    join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
    left join shorts_mvp.plans p on p.code=o.product_code
    where s.status='active' and s.current_period_start<=now() and s.current_period_end>now()
      and o.approved_at is not null and o.approved_at<=now() and o.amount_krw>0
      and o.kind in ('subscription_initial','subscription_renewal','annual_renewal','subscription_change')
    group by 1,2,3 order by 1 desc,2
  `;
  return { today: kstDate(), rows: rows.map(row => ({ date: String(row.date), productCode: String(row.productCode), productName: String(row.productName), gross: Number(row.gross), refunded: Number(row.refunded), count: Number(row.count) })) };
}
