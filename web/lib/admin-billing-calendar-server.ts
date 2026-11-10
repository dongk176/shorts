import "server-only";
import { getDb } from "./db";
import { oneTimeEnabled } from "./paypal/one-time-config";
import { billingRange, type BillingCalendarData, type BillingCurrency } from "./admin-billing-calendar";

export async function loadBillingCalendar(filters: {
  month: string; currency: BillingCurrency; provider: string; query: string;
}): Promise<BillingCalendarData> {
  const db = getDb();
  const { start, end } = billingRange(filters.month);
  const search = `%${filters.query.toLowerCase()}%`;
  const rows = await db`
    with payments as (
      select o.approved_at as occurred_at, 'KRW' as currency, o.provider, u.email,
        o.order_id, o.provider_transaction_id,
        o.amount_krw::bigint as gross, o.refunded_amount_krw::bigint as refunded
      from shorts_mvp.billing_orders o join shorts_mvp.app_users u on u.id=o.user_id
      where o.approved_at >= ${start}::timestamptz and o.approved_at < ${end}::timestamptz and o.amount_krw > 0
      union all
      select p.created_at, p.currency, 'paddle', u.email, p.transaction_id, p.transaction_id,
        p.amount_minor, least(p.amount_minor, coalesce(a.refunded,0))
          + least(greatest(0,p.amount_minor-coalesce(a.refunded,0)),coalesce(a.chargeback,0))
      from shorts_mvp.paddle_payments p
      join shorts_mvp.paddle_subscriptions ps on ps.paddle_id=p.paddle_subscription_id and ps.user_id=p.user_id
      join shorts_mvp.app_users u on u.id=p.user_id
      left join lateral (
        select sum(amount_minor) filter(where action='refund' and status='approved') as refunded,
          sum(amount_minor) filter(where action='chargeback' and status='approved') as chargeback
        from shorts_mvp.paddle_adjustments where transaction_id=p.transaction_id
      ) a on true
      where ps.environment='live' and p.created_at >= ${start}::timestamptz and p.created_at < ${end}::timestamptz
      ${oneTimeEnabled() ? db`union all
        select o.paid_at,o.currency,'paypal',u.email,o.capture_id,o.capture_id,o.amount_minor,
          o.refunded_minor + case when o.reversed then greatest(0,o.amount_minor-o.refunded_minor) else 0 end
        from shorts_mvp.paypal_one_time_orders o join shorts_mvp.app_users u on u.id=o.user_id
        where o.environment='live' and o.status='completed'
          and o.paid_at >= ${start}::timestamptz and o.paid_at < ${end}::timestamptz` : db``}
    )
    select to_char(occurred_at at time zone 'Asia/Seoul','YYYY-MM-DD') as day,
      sum(gross) as gross, sum(refunded) as refunded, count(*)::integer as count
    from payments
    where currency=${filters.currency} and (${filters.provider}='all' or provider=${filters.provider})
      and (${filters.query}='' or lower(coalesce(email,'')) like ${search}
        or lower(order_id) like ${search} or lower(coalesce(provider_transaction_id,'')) like ${search})
    group by day order by day
  `;
  return { month: filters.month, currency: filters.currency, days: rows.map(row => ({
    day: String(row.day), gross: Number(row.gross), refunded: Number(row.refunded || 0), count: Number(row.count),
  })) };
}
