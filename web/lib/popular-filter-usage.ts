import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type {
  PopularDiscoveryPeriod,
  PopularVideoCategory,
  PopularVideoType,
} from "@/lib/youtube-popular";

type PopularFilterUsageDb = Sql | TransactionSql;

export type PopularFilterUsageInput = {
  interactionId?: string;
  userId: string;
  type: PopularVideoType;
  category: PopularVideoCategory;
  reusableOnly: boolean;
  longFormOnly: boolean;
  koreanOnly: boolean;
  discoveryPeriod: PopularDiscoveryPeriod;
  resultCount: number;
};

export async function recordPopularFilterUsage(
  db: PopularFilterUsageDb,
  input: PopularFilterUsageInput,
) {
  const sources = await db`
    select s.id as subscription_id,source_order.id as billing_order_id
    from shorts_mvp.user_subscriptions s
    left join lateral (
      select o.id
      from shorts_mvp.billing_orders o
      where o.subscription_id=s.id
        and o.status='succeeded'
        and o.amount_krw>o.refunded_amount_krw
        and o.approved_at<=clock_timestamp()
      order by
        case
          when o.renewal_period_start is not null
            and o.renewal_period_start<=clock_timestamp()
          then 0
          else 1
        end,
        coalesce(o.renewal_period_start,o.approved_at) desc,
        o.created_at desc
      limit 1
    ) source_order on true
    where s.user_id=${input.userId}
      and s.status in ('active','trialing')
      and s.current_period_start<=clock_timestamp()
      and s.current_period_end>clock_timestamp()
    order by s.current_period_end,s.created_at,s.id
    limit 1
  `;
  const source = sources[0];
  if (!source) {
    const directAccess = await db`
      select 1
      from shorts_mvp.app_users account
      where account.id=${input.userId}
        and (
          (
            account.manual_service_access_until > clock_timestamp()
            and not exists (
              select 1
              from shorts_mvp.managed_login_accounts managed
              where managed.app_user_id=account.id
            )
          )
          or exists (
            select 1
            from shorts_mvp.managed_login_accounts managed
            where managed.app_user_id=account.id
              and managed.is_active=true
              and account.manual_service_access_until>clock_timestamp()
          )
        )
      limit 1
    `;
    if (!directAccess[0]) {
      throw new Error("POPULAR_FILTER_ENTITLEMENT_SOURCE_MISSING");
    }
  }

  const interactionId = input.interactionId || randomUUID();
  const inserted = await db`
    insert into shorts_mvp.popular_filter_usage_events (
      interaction_id,user_id,subscription_id,billing_order_id,
      filter_type,category,reusable_only,long_form_only,korean_only,
      discovery_period,result_count
    ) values (
      ${interactionId},${input.userId},${source?.subscriptionId || null},
      ${source?.billingOrderId || null},
      ${input.type},${input.category},${input.reusableOnly},${input.longFormOnly},
      ${input.koreanOnly},${input.discoveryPeriod},${input.resultCount}
    )
    on conflict (user_id,interaction_id) do nothing
    returning id,occurred_at
  `;
  return inserted[0] || null;
}
