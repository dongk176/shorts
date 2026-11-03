import "server-only";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import { defaultMobilePreferences, shouldNotify } from "@/lib/admin-mobile-contract";
import { loadMobileRoutes } from "@/lib/admin-mobile-overview";
import { sendMobilePush } from "@/lib/admin-mobile-push";
import { oneTimeEnabled } from "@/lib/paypal/one-time-config";

type Incident = { key: string; active: boolean | null; title: string; detail: string; nextStep: string; impact: string; urgent?: boolean; payload?: {routeId:string; identity:string; summary:string} };

export function operationalIncidents(row: Record<string, unknown>): Incident[] {
  const waiting = Number(row.waiting), oldest = Number(row.oldestWait), running = Number(row.running);
  const failures = Number(row.failures), customers = Number(row.failedCustomers);
  return [
    { key: "queue-stalled", active: waiting >= 3 && oldest >= 10 && running === 0,
      title: "제작 대기가 길어지고 있어요", detail: "대기 3건 이상 · 최장 대기 10분 이상 · 실행 중인 작업 없음",
      nextStep: "관리자 페이지에서 대기열과 작업 시작 상태를 확인해주세요.", impact: waiting + "건 대기", urgent: true },
    { key: "multiple-job-failures", active: failures >= 3 && customers >= 2,
      title: "여러 고객의 제작이 실패했어요", detail: "최근 30분 접수 작업 중 " + failures + "건이 실패로 종료됐어요.",
      nextStep: "실패 원인과 수집 경로를 확인해주세요.", impact: customers + "명 영향", urgent: true },
    { key: "billing-review", active: Number(row.billingReview) > 0,
      title: "확인이 필요한 결제가 있어요", detail: "최근 24시간 결제 중 수동 확인 상태의 내역이 있어요.",
      nextStep: "기존 관리자 페이지에서 결제 상태와 이용권 반영을 확인해주세요.", impact: Number(row.billingReview) + "건 확인", urgent: true },
    { key: "ingestion-paused", active: Boolean(row.circuitBlocked) && waiting>0 && oldest>=5 && !row.recentIngestionSuccess,
      title: "영상 수집 대기가 길어지고 있어요", detail: "수집 제한 중 5분 이상 기다린 제작이 있고, 최근 5분간 수집 성공이 없어요.",
      nextStep: "대기 작업과 수집 경로 상태를 확인해주세요.", impact: "새 제작 지연", urgent: true },
  ];
}

async function syncIncident(tx: TransactionSql, incident: Incident) {
  if (incident.active === null) {
    await tx`update shorts_mvp.admin_mobile_events set healthy_since=null
      where incident_key=${incident.key} and resolved_at is null`;
    return;
  }
  if (incident.active) {
    await tx`insert into shorts_mvp.admin_mobile_events
      (event_key,incident_key,kind,title,subtitle,detail,next_step,impact,payload)
      values(${"incident:" + randomUUID()},${incident.key},${incident.urgent ? "urgent" : "attention"},
        ${incident.title},${incident.impact},${incident.detail},${incident.nextStep},${incident.impact},${JSON.stringify(incident.payload || {})}::text::jsonb)
      on conflict do nothing`;
    await tx`update shorts_mvp.admin_mobile_events set healthy_since=null
      where incident_key=${incident.key} and resolved_at is null`;
  } else {
    // Require repeated healthy observations before announcing recovery.
    await tx`update shorts_mvp.admin_mobile_events set healthy_since=coalesce(healthy_since,now())
      where incident_key=${incident.key} and resolved_at is null`;
    const recovered = await tx`update shorts_mvp.admin_mobile_events set resolved_at=now()
      where incident_key=${incident.key} and resolved_at is null and healthy_since<=now()-interval '2 minutes'
      returning id,title`;
    for (const event of recovered) await tx`insert into shorts_mvp.admin_mobile_events
      (event_key,kind,title,subtitle,detail,next_step,impact)
      values(${"recovery:" + event.id},'recovery','운영 상태가 회복됐어요',${event.title},
        '현재 확인에서 해당 알림의 발생 조건이 해소됐어요.','잠시 추이를 지켜봐주세요.','발생 조건 해소')
      on conflict(event_key) do nothing`;
  }
}

export async function scanMobileEvents() {
  const db = getDb();
  // An unavailable IP observation must never close an existing incident.
  const routes = await loadMobileRoutes().catch(() => []);
  return db.begin(async tx => {
    const [lock] = await tx`select pg_try_advisory_xact_lock(hashtext('admin-mobile-scan')) as acquired`;
    if (!lock.acquired) return { skipped: true };
    await tx`insert into shorts_mvp.admin_mobile_events
      (event_key,kind,title,subtitle,detail,next_step,impact,payload,occurred_at)
      select 'payment:domestic:'||o.id,'payment',
        case when o.kind in ('subscription_renewal','annual_renewal') then '구독이 갱신됐어요' when o.kind='subscription_initial' then '새로운 구독이 시작됐어요' else '결제가 완료됐어요' end,
        '결제 승인 완료','결제사의 승인이 확인된 결제입니다.','매출에서 결제 내역을 확인할 수 있어요.','결제 1건',
        jsonb_build_object('paymentId',o.order_id,'amountMinor',o.amount_krw,'currency','KRW'),o.approved_at
      from shorts_mvp.billing_orders o,shorts_mvp.admin_mobile_monitor_state m
      where m.singleton and o.approved_at>=m.started_at and o.approved_at>=now()-interval '7 days' and o.amount_krw>0
        and not exists(select 1 from shorts_mvp.admin_mobile_events e where e.event_key='payment:domestic:'||o.id)
      order by o.approved_at limit 500 on conflict(event_key) do nothing`;
    await tx`insert into shorts_mvp.admin_mobile_events
      (event_key,kind,title,subtitle,detail,next_step,impact,payload,occurred_at)
      select 'payment:paddle:'||p.transaction_id,'payment','해외 결제가 완료됐어요',
        '결제 승인 완료','해외 결제사의 승인이 확인된 결제입니다.','매출에서 통화별 결제를 확인할 수 있어요.','결제 1건',
        jsonb_build_object('paymentId',p.transaction_id,'amountMinor',p.amount_minor,'currency',p.currency),p.created_at
      from shorts_mvp.paddle_payments p join shorts_mvp.paddle_subscriptions ps on ps.paddle_id=p.paddle_subscription_id and ps.environment='live',shorts_mvp.admin_mobile_monitor_state m
      where m.singleton and p.created_at>=m.started_at and p.created_at>=now()-interval '7 days'
        and not exists(select 1 from shorts_mvp.admin_mobile_events e where e.event_key='payment:paddle:'||p.transaction_id)
      order by p.created_at limit 500 on conflict(event_key) do nothing`;
    if(oneTimeEnabled())await tx`insert into shorts_mvp.admin_mobile_events
      (event_key,kind,title,subtitle,detail,next_step,impact,payload,occurred_at)
      select 'payment:paypal:'||o.capture_id,'payment','해외 이용권이 판매됐어요','PayPal 일회성 결제',
        '결제 완료와 이용권 지급이 확인됐어요. 자동 갱신은 없어요.','매출에서 달러 결제 내역을 확인해주세요.','결제 1건',
        jsonb_build_object('paymentId',o.capture_id,'amountMinor',o.amount_minor,'currency','USD'),o.paid_at
      from shorts_mvp.paypal_one_time_orders o,shorts_mvp.admin_mobile_monitor_state m
      where m.singleton and o.environment='live' and o.status='completed' and o.paid_at>=m.started_at and o.paid_at>=now()-interval '7 days'
        and not exists(select 1 from shorts_mvp.admin_mobile_events e where e.event_key='payment:paypal:'||o.capture_id)
      order by o.paid_at limit 500 on conflict(event_key) do nothing`;
    const [health] = await tx`select
      count(*) filter(where status in ('queued','retry_waiting'))::integer as waiting,
      coalesce(extract(epoch from now()-min(created_at) filter(where status in ('queued','retry_waiting')))/60,0)::integer as oldest_wait,
      count(*) filter(where status in ('validating','starting','downloading','transcribing','selecting','extracting','rendering','uploading'))::integer as running,
      count(*) filter(where status='failed' and created_at>=now()-interval '30 minutes')::integer as failures,
      count(distinct user_id) filter(where status='failed' and created_at>=now()-interval '30 minutes')::integer as failed_customers,
      (select count(*)::integer from shorts_mvp.billing_orders where status='manual_review' and created_at>=now()-interval '24 hours') as billing_review,
      coalesce((select blocked_until>now() from shorts_mvp.ingestion_circuit where singleton),false) as circuit_blocked,
      exists(select 1 from shorts_mvp.ingestion_attempts where result='success' and created_at>=now()-interval '5 minutes') as recent_ingestion_success
      from shorts_mvp.video_jobs where created_at>=now()-interval '30 minutes'
        or status in ('queued','retry_waiting','validating','starting','downloading','transcribing','selecting','extracting','rendering','uploading')`;
    for (const incident of operationalIncidents(health)) await syncIncident(tx, incident);
    for (const route of routes) {
      if (!route.identity || !route.assignedAt) continue;
      const key = "route:"+route.id+":"+route.identity;
      // A replacement retires the old IP's incident without claiming recovery.
      await tx`update shorts_mvp.admin_mobile_events set resolved_at=now()
        where resolved_at is null and incident_key like ${"route:"+route.id+":%"} and incident_key<>${key}`;
      if (!route.enabled) {
        await tx`update shorts_mvp.admin_mobile_events set resolved_at=now() where incident_key=${key} and resolved_at is null`;
        continue;
      }
      const sample = route.samples["1"], long=route.samples["24"], streak=route.consecutiveFailures;
      const fresh = !!route.lastAttempt && Date.now()-Date.parse(route.lastAttempt)<15*60_000;
      const longBad = !!long && long[1]>=30 && long[0]/long[1]<.6;
      const healthy = sample && sample[1]>=5 && sample[0]/sample[1]>=.8 && streak===0;
      const bad = sample && ((sample[1]>=20 && sample[0]/sample[1]<.8) || (fresh && (streak??0)>=5) || (fresh && longBad && !healthy));
      const shown = longBad && (!sample || sample[1]<20) ? long : sample;
      const period = shown===long ? "24시간" : "1시간";
      const summary = route.id+" · "+period+" "+(shown?.[1] ? Math.round(shown[0]/shown[1]*100)+"% ("+shown[0]+"/"+shown[1]+")" : "표본 확인 중")+" · 연속 실패 "+(streak??"미확인")+"회";
      await syncIncident(tx, { key, active:bad?true:healthy?false:null,
        title: route.recommendation==="교체 검토" ? "교체를 검토할 IP가 있어요" : "IP 수집 성공률을 확인해주세요",
        detail:summary+" · 현재 IP 기록", nextStep:route.reason,
        impact:route.id, urgent:false, payload:{routeId:route.id,identity:route.identity,summary} });
    }
    await tx`insert into shorts_mvp.admin_mobile_deliveries(event_id,subscription_id)
      select e.id,s.id from shorts_mvp.admin_mobile_events e
      join shorts_mvp.admin_mobile_subscriptions s on s.active and e.occurred_at>=s.active_from
      join shorts_mvp.app_users u on u.id=s.admin_id and u.is_admin
      where e.occurred_at>=now()-interval '1 hour' and e.resolved_at is null
      on conflict(event_id,subscription_id) do nothing`;
    await tx`update shorts_mvp.admin_mobile_monitor_state set last_success_at=now() where singleton`;
    return { skipped: false, ipRoutes: routes.length, ipVerified: routes.filter(route=>route.identity).length };
  });
}

export function notificationContent(event: { id: string; kind: string; title: string; payload: Record<string, unknown> }, showAmount: boolean) {
  const amount = Number(event.payload?.amountMinor), currency = String(event.payload?.currency);
  let body = event.kind === "payment" ? "새로운 결제 승인이 확인됐어요." : "앱에서 현재 상태를 확인해주세요.";
  if (event.kind !== "payment" && typeof event.payload?.summary === "string") body = event.payload.summary.slice(0,160);
  if (event.kind === "payment" && showAmount && Number.isFinite(amount) && ["KRW","USD","JPY"].includes(currency)) {
    body = new Intl.NumberFormat("ko-KR", { style: "currency", currency, maximumFractionDigits: currency === "USD" ? 2 : 0 })
      .format(currency === "USD" ? amount / 100 : amount) + " 결제 승인";
  }
  return { eventId: event.id, title: "EasyCut · " + event.title.slice(0,65), body };
}

export async function dispatchMobilePushes() {
  const db = getDb(), token = randomUUID();
  // A lease makes overlapping cron invocations safe and recovers interrupted deliveries.
  const claimed = await db`with candidates as (
    select d.event_id,d.subscription_id from shorts_mvp.admin_mobile_deliveries d
    where (d.status='pending' and d.available_at<=now()) or (d.status='sending' and d.lease_until<now())
    order by d.available_at for update skip locked limit 12
  ) update shorts_mvp.admin_mobile_deliveries d set status='sending',attempts=d.attempts+1,
      lease_until=now()+interval '2 minutes',lease_token=${token}
    from candidates c where d.event_id=c.event_id and d.subscription_id=c.subscription_id
    returning d.event_id,d.subscription_id,d.attempts`;
  const counts = { sent: 0, skipped: 0, failed: 0 };
  // At most three provider requests concurrently; bounded to four groups.
  for (let offset = 0; offset < claimed.length; offset += 3) {
    await Promise.all(claimed.slice(offset,offset+3).map(async delivery => {
      const [row] = await db`select e.id,e.kind,e.title,e.payload,e.occurred_at,e.resolved_at,
        s.endpoint,s.p256dh,s.auth,s.transport,s.apns_token,s.apns_environment,s.active,u.is_admin,
        p.payments,p.operations,p.quiet_night,p.show_amount
        from shorts_mvp.admin_mobile_events e
        join shorts_mvp.admin_mobile_subscriptions s on s.id=${delivery.subscriptionId}
        join shorts_mvp.app_users u on u.id=s.admin_id
        left join shorts_mvp.admin_mobile_preferences p on p.admin_id=s.admin_id
        where e.id=${delivery.eventId}`;
      const preferences = row ? { payments: row.payments ?? true, operations: row.operations ?? true,
        quietNight: row.quietNight ?? true, showAmount: row.showAmount ?? true } : defaultMobilePreferences;
      let status = "sent", code: number | null = null;
      const expired = !row || Date.now()-new Date(row.occurredAt).getTime()>3_600_000 || Number(delivery.attempts)>3;
      if (expired) status = "expired";
      else if (!row.active || !row.isAdmin || row.resolvedAt || !shouldNotify(row.kind,preferences,new Date())) status = "skipped";
      else {
        try {
          await sendMobilePush({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth,
            transport: row.transport, apnsToken: row.apnsToken, apnsEnvironment: row.apnsEnvironment },
            notificationContent({ id: row.id, kind: row.kind, title: row.title, payload: row.payload },preferences.showAmount));
        } catch (error) {
          code = Number((error as { statusCode?: number }).statusCode || 0);
          if (code === 404 || code === 410) {
            status = "expired";
            await db`update shorts_mvp.admin_mobile_subscriptions set active=false,updated_at=now() where id=${delivery.subscriptionId}
              and (transport<>'apns' or apns_token=${row.apnsToken ?? null})`;
          } else status = Number(delivery.attempts) >= 3 ? "failed" : "pending";
        }
      }
      await db`update shorts_mvp.admin_mobile_deliveries set status=${status},
        sent_at=case when ${status}='sent' then now() else sent_at end,
        available_at=now()+make_interval(mins=>${Number(delivery.attempts)*2}),
        lease_until=null,lease_token=null,last_status_code=${code}
        where event_id=${delivery.eventId} and subscription_id=${delivery.subscriptionId} and lease_token=${token}`;
      if (status === "sent") counts.sent++;
      else if (status === "skipped" || status === "expired") counts.skipped++;
      else counts.failed++;
    }));
  }
  if (counts.sent) await db`update shorts_mvp.admin_mobile_monitor_state set last_delivery_at=now() where singleton`;
  return counts;
}
