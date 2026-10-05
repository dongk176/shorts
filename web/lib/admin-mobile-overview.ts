import "server-only";
import { z } from "zod";
import { ensureAdminDbReady, getDb } from "@/lib/db";
import { pushConfigured } from "@/lib/admin-mobile-contract";

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null;
const n = (value: unknown) => Number(value || 0);
const assignmentSchema = z.array(z.object({
  routeId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
  identity: z.string().regex(/^[a-zA-Z0-9_-]{4,64}$/),
  assignedAt: z.iso.datetime(),
  evidence: z.string().min(1).max(160),
}));
export function routeAssignments() {
  try { return assignmentSchema.parse(JSON.parse(process.env.ADMIN_ROUTE_ASSIGNMENTS_JSON || "[]")); }
  catch { return []; }
}
export async function loadMobileRoutes() {
  const db = getDb(), now = new Date();
  const slots = await db`select route_id,enabled,cooldown_until from shorts_mvp.ingestion_route_slots order by route_id`;
  const assignments = routeAssignments();
  const routes = [];
  for (const slot of slots) {
    const assignment = assignments.find(item => item.routeId === slot.routeId);
    const samples: Record<string, [number, number] | null> = { 1: null, 6: null, 24: null, 72: null };
    let lastSuccess: string | null = null;
    let consecutiveFailures: number | null = null;
    let failures: Array<{name: string; count: number}> = [];
    if (assignment && Date.parse(assignment.assignedAt) <= now.getTime()) {
      const rows = await db`select h.hours,
        count(a.id) filter(where a.result='success')::integer as succeeded,
        count(a.id) filter(where a.result in ('success','bot_check'))::integer as attempted,
        count(a.id) filter(where a.result='bot_check')::integer as bot_checks,
        count(a.id) filter(where a.result='other_error')::integer as unclassified,
        max(a.created_at) filter(where a.result='success') as last_success
        from (values(1),(6),(24),(72)) as h(hours)
        left join shorts_mvp.ingestion_attempts a on a.route_id=${slot.routeId}
          and a.created_at>=greatest(${assignment.assignedAt}::timestamptz,now()-make_interval(hours=>h.hours))
        group by h.hours order by h.hours`;
      // Legacy 'other_error' mixes access restrictions with network errors.
      // Do not score an IP until the denominator can be classified reliably.
      for (const row of rows) samples[String(row.hours)] = n(row.unclassified) === 0 ? [n(row.succeeded), n(row.attempted)] : null;
      lastSuccess = iso(rows.at(-1)?.lastSuccess);
      failures = [{ name: "봇 확인 · 최근 1시간", count: n(rows[0]?.botChecks) },
        { name: "유형 미분류 · 최근 1시간", count: n(rows[0]?.unclassified) }].filter(item => item.count > 0);
      const recent = await db`select result from shorts_mvp.ingestion_attempts where route_id=${slot.routeId}
        and created_at>=${assignment.assignedAt}::timestamptz order by created_at desc,id desc limit 20`;
      const index = recent.findIndex(row => row.result === "success");
      consecutiveFailures = index === -1 ? recent.length : index;
    }
    const sample = samples["1"];
    const watch = sample && sample[1] >= 20 && sample[0] / sample[1] < .8;
    routes.push({
      id: String(slot.routeId), identity: assignment?.identity || null, assignedAt: assignment?.assignedAt || null,
      samples, lastSuccess, consecutiveFailures, failures,
      coolingDown: slot.cooldownUntil ? new Date(slot.cooldownUntil) > now : false,
      recommendation: !slot.enabled ? "일시 제외" : !sample ? "미확인" : watch ? "관찰" : sample[1] < 5 ? "표본 부족" : "유지",
      reason: !assignment ? "현재 IP의 할당 이력이 연결되면 교체 이후 성공률을 표시해요."
        : !sample ? "일부 실패의 유형을 구분할 수 없어 성공률을 확정하지 않았어요."
        : watch ? "최근 수집 성공률이 낮아졌어요. 긴 구간의 추세도 함께 확인해주세요."
        : "교체 이후 기록을 기준으로 집계했어요.",
    });
  }
  return routes;
}

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
