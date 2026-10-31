import "server-only";
import { getDb } from "@/lib/db";
import { kstDate } from "@/lib/admin-trends";
import { TOSS_PLAN_CATALOG } from "@/lib/toss-subscription";
import type { SubscriptionBillingData } from "./admin-subscription-billing-contract";

export async function loadAdminSubscriptionBilling(): Promise<SubscriptionBillingData> {
  // Use the same retained catalog as Toss renewals, including retired contracts.
  const catalog = TOSS_PLAN_CATALOG.map(plan => ({ code: plan.code, amount: plan.priceKrw, months: plan.contractMonths }));
  const rows = await getDb()`
    with catalog as (
      select * from jsonb_to_recordset(${JSON.stringify(catalog)}::jsonb)
        as c(code text,amount integer,months integer)
    ), scheduled as (
      select s.next_charge_at,
        coalesce(s.scheduled_plan_code,s.plan_code) as product_code,
        p.display_name as product_name,
        coalesce(c.months,p.prepaid_months,case when s.billing_cycle='yearly' then 12 else 1 end) as months,
        case when s.payment_provider='toss' then c.amount
          when s.billing_cycle='yearly' then p.yearly_price_krw
          else p.monthly_price_krw end as amount
      from shorts_mvp.user_subscriptions s
      join shorts_mvp.plans p on p.code=coalesce(s.scheduled_plan_code,s.plan_code)
      left join catalog c on c.code=p.code
      where s.status='active' and not s.cancel_at_period_end
        and s.next_charge_at is not null
        and s.next_charge_at >= date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
        and s.payment_provider in ('toss','thepayone')
        and s.provider_schedule_status='active' and s.billing_review_status='clear'
        and s.payment_method_id is not null
        and (s.payment_provider='toss' or (s.billing_cycle='monthly' and s.scheduled_plan_code is null))
    )
    select to_char(next_charge_at at time zone 'Asia/Seoul','YYYY-MM-DD') as date,
      product_code,product_name,months,sum(amount)::bigint as amount,count(*)::integer as count
    from scheduled where amount>0
    group by 1,2,3,4 order by 1,2
  `;
  return { today: kstDate(), rows: rows.map(row => ({ date: String(row.date), productCode: String(row.productCode), productName: String(row.productName), months: Number(row.months), amount: Number(row.amount), count: Number(row.count) })) };
}
