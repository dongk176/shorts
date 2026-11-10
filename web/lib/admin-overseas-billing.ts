import "server-only";
import { requireOverseasAdminUser } from "./admin-overseas-auth";
import { getDb } from "./db";
import { overseasScope } from "./admin-overseas";
import { billingRange, type BillingCalendarData } from "./admin-billing-calendar";
import type { OverseasRow } from "./admin-overseas-contract";

export type OverseasBillingCurrency = "USD" | "JPY" | "all";
export type OverseasBillingData = Omit<BillingCalendarData, "currency" | "days"> & { currency: OverseasBillingCurrency; days: Array<BillingCalendarData["days"][number] & { currency: "USD" | "JPY" }>; rows: OverseasRow[]; total: number; page: number; pages: number };
export async function loadOverseasBilling(filters: {
  month: string; currency: OverseasBillingCurrency; provider: "all" | "paddle" | "paypal"; query: string; day?: string; page: number;
}): Promise<OverseasBillingData> {
  await requireOverseasAdminUser();
  const db = getDb();
  const { start, end } = billingRange(filters.month);
  const pattern = `%${filters.query.replace(/[\\%_]/g, "\\$&")}%`;
  const [result] = await db`
    with ${overseasScope(db, {start,end})}, filtered as materialized (
      select p.*,coalesce(u.email,'탈퇴 회원') as email,u.display_name as name,
        to_char(p.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') as day
      from paid p left join shorts_mvp.app_users u on u.id=p.user_id
      where p.created_at>=${start}::timestamptz and p.created_at<${end}::timestamptz
        and (${filters.currency}='all' or p.currency=${filters.currency}) and (${filters.provider}='all' or p.provider=${filters.provider})
        and (${filters.query}='' or u.email ilike ${pattern} or u.display_name ilike ${pattern}
          or p.plan_code ilike ${pattern} or p.transaction_id ilike ${pattern})
    ), selected as (select * from filtered where (${!filters.day} or day=${filters.day ?? null})),
    paging as (select count(*)::integer as total,greatest(1,ceil(count(*)::numeric/30)::integer) as pages from selected)
    select total,pages,least(${filters.page},pages) as page,
      (select coalesce(jsonb_agg(d order by d.day,d.currency),'[]'::jsonb) from (
        select day,currency,sum(amount_minor) as gross,sum(refunded+chargeback) as refunded,count(*)::integer as count from filtered group by day,currency
      ) d) as days,
      (select coalesce(jsonb_agg(r order by r."createdAt" desc,r.id desc),'[]'::jsonb) from (
        select transaction_id as id,email,name,coalesce(plan_code,'unknown') as label,
          case when chargeback>0 then 'chargeback' when refunded>=amount_minor then 'refunded'
            when refunded>0 then 'partially_refunded' else 'completed' end as status,
          created_at as "createdAt",currency,provider,amount_minor as amount,refunded,chargeback,pending
        from selected order by created_at desc,transaction_id desc limit 30 offset ((least(${filters.page},pages)-1)*30)
      ) r) as rows from paging
  `;
  return { month:filters.month,currency:filters.currency,days:result.days,rows:result.rows,total:Number(result.total),page:Number(result.page),pages:Number(result.pages) };
}
