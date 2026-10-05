import "server-only";
import { ensureAdminDbReady, getDb } from "@/lib/db";
import { pushConfigured } from "@/lib/admin-mobile-contract";

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null;
const n = (value: unknown) => Number(value || 0);
export { loadMobileRoutes } from "@/lib/admin-ip-routes";
import { loadMobileRoutes } from "@/lib/admin-ip-routes";

export async function loadAdminMobileOverview(adminId: string) {
  const db = getDb();
  await ensureAdminDbReady();
  const checkedAt = new Date().toISOString();
  const settled = await Promise.allSettled([
    db`with payments as (
        select to_char(approved_at at time zone 'Asia/Seoul','YYYY-MM-DD') as day,'KRW' as currency,
          amount_krw::bigint as amount,refunded_amount_krw::bigint as refunded,
          case when kind='subscription_initial' then 'new' when kind in ('subscription_renewal','annual_renewal') then 'renewal' else 'other' end as kind
        from shorts_mvp.billing_orders where approved_at>=(date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')-interval '29 days'
          and amount_krw>0
        union all
        select to_char(p.created_at at time zone 'Asia/Seoul','YYYY-MM-DD'),p.currency,p.amount_minor,
          coalesce((select sum(a.amount_minor) from shorts_mvp.paddle_adjustments a
            where a.transaction_id=p.transaction_id and a.status='approved' and a.action='refund'),0),
          case when exists(select 1 from shorts_mvp.paddle_payments earlier where earlier.paddle_subscription_id=p.paddle_subscription_id and earlier.created_at<p.created_at) then 'renewal' else 'new' end
        from shorts_mvp.paddle_payments p join shorts_mvp.paddle_subscriptions ps on ps.paddle_id=p.paddle_subscription_id and ps.environment='live' where p.created_at>=(date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')-interval '29 days'
      ) select day,currency,sum(amount)::bigint as gross,sum(refunded)::bigint as refunds,count(*)::integer as count,
        count(*) filter(where kind='new')::integer as new_count,count(*) filter(where kind='renewal')::integer as renewal_count
      from payments group by day,currency order by day`,
    db`select * from (
        select order_id as id,
          case when kind='subscription_initial' then 'new' when kind in ('subscription_renewal','annual_renewal') then 'renewal' else 'other' end as kind,
          amount_krw::bigint as amount_minor,'KRW' as currency,approved_at as occurred_at,
          case when exists(select 1 from shorts_mvp.usage_grants g where g.billing_order_id=o.id) then true else null end as entitlement,
          refunded_amount_krw::bigint as refunded_minor
        from shorts_mvp.billing_orders o where approved_at>=now()-interval '30 days' and amount_krw>0
        union all
        select transaction_id,
          case when exists(select 1 from shorts_mvp.paddle_payments earlier where earlier.paddle_subscription_id=p.paddle_subscription_id and earlier.created_at<p.created_at) then 'renewal' else 'new' end,
          amount_minor,currency,p.created_at,grant_id is not null,
          coalesce((select sum(a.amount_minor) from shorts_mvp.paddle_adjustments a
            where a.transaction_id=p.transaction_id and a.status='approved' and a.action='refund'),0)
        from shorts_mvp.paddle_payments p join shorts_mvp.paddle_subscriptions ps on ps.paddle_id=p.paddle_subscription_id and ps.environment='live' where p.created_at>=now()-interval '30 days'
      ) as recent order by occurred_at desc limit 100`,
    db`select
        count(*) filter(where created_at>=now()-interval '24 hours' and status='completed')::integer as succeeded,
        count(*) filter(where created_at>=now()-interval '24 hours' and status in ('completed','failed'))::integer as attempted,
        count(*) filter(where status in ('queued','retry_waiting'))::integer as waiting,
        count(*) filter(where status in ('validating','starting','downloading','transcribing','selecting','extracting','rendering','uploading'))::integer as running,
        coalesce(extract(epoch from now()-min(created_at) filter(where status in ('queued','retry_waiting')))/60,0)::integer as oldest_wait
      from shorts_mvp.video_jobs where created_at>=now()-interval '24 hours'
        or status in ('queued','retry_waiting','validating','starting','downloading','transcribing','selecting','extracting','rendering','uploading')`,
    db`select
        (select count(distinct user_id)::integer from shorts_mvp.user_subscriptions where status='active') as active_subscriptions,
        (select count(*)::integer from shorts_mvp.app_users where created_at >= date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as new_members,
        (select count(*)::integer from shorts_mvp.customer_inquiries where status='new') as unanswered_inquiries`,
  ]);
  const rows = (index: number) => settled[index].status === "fulfilled" ? settled[index].value : null;
  const sales = rows(0), payments = rows(1), jobs = rows(2)?.[0], stats = rows(3)?.[0];
  const extra = await Promise.allSettled([
    loadMobileRoutes(),
    db`select e.*,r.read_at,r.acknowledged_at from shorts_mvp.admin_mobile_events e
      left join shorts_mvp.admin_mobile_receipts r on r.event_id=e.id and r.admin_id=${adminId}
      where e.occurred_at>=now()-interval '30 days' order by e.occurred_at desc limit 100`,
    db`select last_success_at from shorts_mvp.admin_mobile_monitor_state where singleton`,
  ]);
  const routes = extra[0].status === "fulfilled" ? extra[0].value : [];
  const events = extra[1].status === "fulfilled" ? extra[1].value : [];
  const monitor = extra[2].status === "fulfilled" ? extra[2].value[0] : null;
  return {
    version: 1, mode: "live", actor: adminId, checkedAt,
    dailySales: sales?.map(row => ({ day: row.day, currency: row.currency, gross: n(row.gross), refunds: n(row.refunds),
      count: n(row.count), newCount: n(row.newCount), renewalCount: n(row.renewalCount) })) || [],
    payments: payments?.map(row => ({ id: row.id, kind: row.kind, amountMinor: n(row.amountMinor),
      currency: row.currency, occurredAt: iso(row.occurredAt), entitlement: row.entitlement, refundedMinor: n(row.refundedMinor) })) || [],
    jobs: jobs ? { sample: [n(jobs.succeeded),n(jobs.attempted)], window: "24h 접수 · 처리 종료", waiting: n(jobs.waiting),
      running: n(jobs.running), oldestWaitMinutes: Math.max(0,n(jobs.oldestWait)) } : null,
    stages: [],
    routes,
    stats: { activeSubscriptions: stats ? n(stats.activeSubscriptions) : null, newMembers: stats ? n(stats.newMembers) : null,
      unansweredInquiries: stats ? n(stats.unansweredInquiries) : null },
    events: events.map(row => ({ id: row.id, kind: row.kind, title: row.title, subtitle: row.subtitle,
      occurredAt: iso(row.occurredAt), impact: row.impact, detail: row.detail, nextStep: row.nextStep,
      paymentId: row.payload?.paymentId || null, routeId: row.payload?.routeId || null, timeline: [],
      read: !!row.readAt, acknowledged: !!row.acknowledgedAt, resolved: !!row.resolvedAt })),
    availability: { billing: sales !== null && payments !== null, jobs: !!jobs, routes: extra[0].status === "fulfilled",
      alerts: extra[1].status === "fulfilled" && !!monitor?.lastSuccessAt
        && Date.now()-new Date(monitor.lastSuccessAt).getTime()<180_000 },
    monitor: { lastTickAt: iso(monitor?.lastSuccessAt), pushReady: pushConfigured() },
  };
}
