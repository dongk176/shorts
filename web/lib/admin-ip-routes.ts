import "server-only";
import { getDb } from "@/lib/db";
import { loadRouteAssignments } from "@/lib/admin-ip-inventory";

type Sample = [number, number] | null;
export function ipRecommendation(enabled: boolean, samples: Record<string,Sample>, streak: number | null, peers: number | null) {
  if (!enabled) return { recommendation:"일시 제외", reason:"현재 수집에 사용하지 않는 경로예요." };
  const short = samples["1"], medium = samples["6"], long = samples["24"];
  if (!short) return { recommendation:"미확인", reason:"현재 IP 이력 또는 실패 유형을 확인하지 못했어요." };
  const shortBad = short[1] >= 20 && short[0]/short[1] < .8;
  const longBad = long && long[1] >= 30 && long[0]/long[1] < .6;
  const individuallyBad = longBad && peers !== null && peers-long[0]/long[1] >= .2;
  const mediumBad = medium && medium[1]>=10 && medium[0]/medium[1]<.6;
  const shortRecovered = short[1]>=5 && short[0]/short[1]>=.8 && streak===0;
  if (individuallyBad && !shortRecovered && (shortBad || mediumBad || (streak ?? 0) >= 5)) return {
    recommendation:"교체 검토", reason:"하루 성공률이 60% 미만이고 다른 경로보다 20%p 이상 낮아요. 최근 구간에서도 실패가 이어지고 있어요." };
  if (shortBad || (streak ?? 0) >= 5) return {
    recommendation:"관찰", reason:(streak ?? 0) >= 5 ? "봇 확인 실패가 5회 이상 이어졌어요. 긴 구간 추세도 확인해주세요." : "최근 1시간 성공률이 80% 미만이에요. 다른 경로의 상태도 함께 확인해주세요." };
  if (long && long[1]>=30 && long[0]/long[1]<.8) return {
    recommendation:"관찰", reason:shortRecovered ? "최근 시도는 나아졌지만 하루 성공률은 80% 미만이에요. 회복 추세를 확인해주세요." : "하루 30회 이상 시도에서 성공률이 80% 미만이에요. 최근 시도가 적어도 긴 구간의 실패는 확인이 필요해요." };
  if (short[1] < 5 && (!long || long[1]<30)) return { recommendation:"표본 부족", reason:"현재 IP의 시도 기록이 적어요. 더 쌓인 뒤 추세를 확인해주세요." };
  if (short[1] < 5) return { recommendation:"유지", reason:"최근 1시간 시도가 적어 하루 추세를 함께 확인했어요. 하루 성공률은 80% 이상이에요." };
  return { recommendation:"유지", reason:"현재 IP의 확인된 이력 이후 기록이에요. 최근 경고 기준에 해당하지 않아요." };
}

export async function loadMobileRoutes() {
  const db = getDb(), now = new Date();
  const assignments = await loadRouteAssignments();
  const verified = JSON.stringify(assignments.map(r=>({route_id:r.routeId,assigned_at:r.assignedAt})));
  // One bounded aggregate request for all routes/windows. Jobs created before
  // assignment are excluded: an in-flight task can retain its previous IP.
  const rows = await db`with inventory as (
      select * from jsonb_to_recordset(${verified}::text::jsonb) as i(route_id text,assigned_at timestamptz)
    ), attempts as materialized (
      select a.* from shorts_mvp.ingestion_attempts a join inventory i on i.route_id=a.route_id
      join shorts_mvp.video_jobs j on j.id=a.job_id and j.created_at>=i.assigned_at
      where a.created_at>=greatest(i.assigned_at,now()-interval '72 hours') and a.created_at<=now()
    ), recent as (
      select route_id,result,row_number() over(partition by route_id order by created_at desc,id desc) as pos from attempts
    ), streaks as (
      select route_id,coalesce(min(pos) filter(where result<>'bot_check'),count(*)+1)-1 as streak,
        bool_or(pos=1 and result='other_error') as unknown_latest from recent where pos<=20 group by route_id
    ) select s.route_id,s.enabled,s.cooldown_until,h.hours,
      count(a.id) filter(where a.result='success')::integer as succeeded,
      count(a.id) filter(where a.result in ('success','bot_check'))::integer as attempted,
      count(a.id) filter(where a.result='bot_check')::integer as bot_checks,
      count(a.id) filter(where a.result='other_error')::integer as unclassified,
      max(a.created_at) filter(where a.result='success') as last_success,max(a.created_at) as last_attempt,
      coalesce(t.streak,0)::integer as streak,coalesce(t.unknown_latest,false) as unknown_latest
    from shorts_mvp.ingestion_route_slots s cross join (values(1),(6),(24),(72)) as h(hours)
    left join attempts a on a.route_id=s.route_id and a.created_at>=now()-make_interval(hours=>h.hours)
    left join streaks t on t.route_id=s.route_id
    group by s.route_id,s.enabled,s.cooldown_until,h.hours,t.streak,t.unknown_latest order by s.route_id,h.hours`;
  const iso = (v: unknown) => v ? new Date(String(v)).toISOString() : null;
  const routes = [...new Set(rows.map(row=>String(row.routeId)))].map(id=>{
    const group = rows.filter(row=>row.routeId===id), slot=group[0];
    const assignment = assignments.find(r=>r.routeId===id);
    const samples:Record<string,Sample> = {}, excluded:Record<string,number> = {};
    for (const row of group) {
      samples[String(row.hours)] = assignment && !Number(row.unclassified) ? [Number(row.succeeded),Number(row.attempted)] : null;
      excluded[String(row.hours)] = Number(row.unclassified);
    }
    const last = group.at(-1)!;
    return {
      id, enabled:Boolean(slot.enabled), identity:assignment?.identity ?? null, assignedAt:assignment?.assignedAt ?? null,
      assignmentExact:assignment?.assignmentExact ?? false, samples, excluded,
      lastSuccess:assignment?iso(last.lastSuccess):null, lastAttempt:assignment?iso(last.lastAttempt):null,
      consecutiveFailures:!assignment||last.unknownLatest?null:Number(last.streak),
      coolingDown:slot.cooldownUntil ? new Date(slot.cooldownUntil)>now : false,
      cooldownUntil:iso(slot.cooldownUntil),
      failures:[{name:"봇 확인 · 최근 1시간",count:Number(group[0].botChecks)},
        {name:"유형 미분류 · 최근 1시간",count:Number(group[0].unclassified)}].filter(f=>f.count>0),
    };
  });
  return routes.map(route=>{
    const peers = routes.filter(r=>r.id!==route.id && r.enabled).map(r=>r.samples["24"]).filter((s):s is [number,number]=>!!s&&s[1]>0);
    const total=peers.reduce((a,s)=>[a[0]+s[0],a[1]+s[1]],[0,0]);
    return {...route,...ipRecommendation(route.enabled,route.samples,route.consecutiveFailures,total[1]>=30?total[0]/total[1]:null)};
  });
}
