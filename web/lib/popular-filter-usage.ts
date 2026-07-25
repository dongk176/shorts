import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type {
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
  if (!source?.subscriptionId || !source?.billingOrderId) {
    throw new Error("POPULAR_FILTER_ENTITLEMENT_SOURCE_MISSING");
  }

  const interactionId = input.interactionId || randomUUID();
  const inserted = await db`
    insert into shorts_mvp.popular_filter_usage_events (
      interaction_id,user_id,subscription_id,billing_order_id,
      filter_type,category,reusable_only,long_form_only,korean_only,result_count
    ) values (
      ${interactionId},${input.userId},${source.subscriptionId},${source.billingOrderId},
      ${input.type},${input.category},${input.reusableOnly},${input.longFormOnly},
      ${input.koreanOnly},${input.resultCount}
    )
    on conflict (user_id,interaction_id) do nothing
    returning id,occurred_at
  `;
  return inserted[0] || null;
}
