import "server-only";

import type { Sql, TransactionSql } from "postgres";
import { catalogReadsEnabled, japaneseDiscoveryEnabled } from "@/lib/youtube-quota";
import { nextReusableDiscoveryAt } from "@/lib/youtube-discovery-time";
import {
  nextDailyReusableCollectionAt,
  projectReusableViewCounter,
  type ReusableViewCounterSchedule,
} from "@/lib/reusable-view-counter";

const counterMetricKeys = {
  startValue: "reusable_views_start",
  targetValue: "reusable_views_target",
  startedAtMs: "reusable_views_started_at_ms",
  endsAtMs: "reusable_views_ends_at_ms",
} as const;
const generatedShortsMetricKey = "generated_shorts";
type CounterSql = Sql | TransactionSql;

function safeMetricNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseStoredSchedule(rows: Array<Record<string, unknown>>) {
  const metrics = new Map(rows.map((row) => [String(row.key), row.value]));
  const startValue = safeMetricNumber(metrics.get(counterMetricKeys.startValue));
  const targetValue = safeMetricNumber(metrics.get(counterMetricKeys.targetValue));
  const startedAtMs = safeMetricNumber(metrics.get(counterMetricKeys.startedAtMs));
  const endsAtMs = safeMetricNumber(metrics.get(counterMetricKeys.endsAtMs));
  if (
    startValue === null
    || targetValue === null
    || startedAtMs === null
    || endsAtMs === null
    || targetValue < startValue
    || endsAtMs <= startedAtMs
  ) return null;
  return {
    startValue,
    targetValue,
    startedAt: new Date(startedAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
  } satisfies ReusableViewCounterSchedule;
}

export async function getReusableViewCounterSchedule(db: CounterSql) {
  const rows = await db`
    select key,value
    from shorts_mvp.site_metrics
    where key in ${db(Object.values(counterMetricKeys))}
  `;
  return parseStoredSchedule(rows as Array<Record<string, unknown>>);
}

export async function getPublicSiteMetrics(db: CounterSql) {
  const rows = await db`
    select key,value
    from shorts_mvp.site_metrics
    where key in ${db([
      generatedShortsMetricKey,
      ...Object.values(counterMetricKeys),
    ])}
  `;
  const records = rows as Array<Record<string, unknown>>;
  const metrics = new Map(records.map((row) => [String(row.key), row.value]));
  return {
    generatedShortCount:
      safeMetricNumber(metrics.get(generatedShortsMetricKey)) ?? 4_321,
    reusableViewCounter: parseStoredSchedule(records),
  };
}

export async function refreshReusableViewCounterSchedule(
  db: CounterSql,
  input: { runId: string; updatedAt: Date },
) {
  const storedSchedule = await getReusableViewCounterSchedule(db);
  const rows = await db`
    with run_window as (
      select current_run.completed_at as current_completed_at,
        (
          select max(previous_run.completed_at)
          from shorts_mvp.popular_search_runs previous_run
          where previous_run.status='ready'
            and previous_run.completed_at < current_run.completed_at
        ) as previous_completed_at
      from shorts_mvp.popular_search_runs current_run
      where current_run.id=${input.runId} and current_run.status='ready'
    ),
    reusable_candidates as (
      select i.video_id,i.view_count,i.collected_at,
        r.completed_at as last_seen_at,0 as source_priority
      from shorts_mvp.popular_search_items i
      join shorts_mvp.popular_search_runs r on r.id=i.run_id
      where r.status='ready'
        and r.completed_at <= (select current_completed_at from run_window)
        and i.license='creativeCommon'
      union all
      select i.video_id,i.view_count,i.collected_at,
        r.completed_at as last_seen_at,1 as source_priority
      from shorts_mvp.popular_video_items i
      join shorts_mvp.popular_video_runs r on r.id=i.run_id
      where r.status='ready'
        and r.completed_at <= (select current_completed_at from run_window)
        and i.license='creativeCommon'
    ),
    ranked as (
      select view_count,
        min(last_seen_at) over (partition by video_id) as first_seen_at,
        row_number() over (
          partition by video_id
          order by last_seen_at desc,collected_at desc,view_count desc,source_priority asc
        ) as duplicate_rank
      from reusable_candidates
    )
    select run_window.current_completed_at,run_window.previous_completed_at,
      coalesce(sum(ranked.view_count) filter (
        where ranked.duplicate_rank=1
      ),0)::bigint as target_value,
      coalesce(sum(ranked.view_count) filter (
        where ranked.duplicate_rank=1
          and run_window.previous_completed_at is not null
          and ranked.first_seen_at > run_window.previous_completed_at
      ),0)::bigint as newly_discovered_views
    from run_window
    left join ranked on true
    group by run_window.current_completed_at,run_window.previous_completed_at
  `;
  if (!rows[0]) throw new Error("REUSABLE_VIEW_COUNTER_RUN_NOT_READY");

  const targetValue = safeMetricNumber(rows[0].targetValue);
  const newlyDiscoveredViews = safeMetricNumber(rows[0].newlyDiscoveredViews);
  if (targetValue === null || newlyDiscoveredViews === null) {
    throw new Error("REUSABLE_VIEW_COUNTER_VALUE_OUT_OF_RANGE");
  }

  const startedAt = new Date(input.updatedAt);
  if (!Number.isFinite(startedAt.getTime())) {
    throw new Error("REUSABLE_VIEW_COUNTER_TIME_INVALID");
  }
  const endsAt = nextDailyReusableCollectionAt(startedAt);
  const projectedPreviousValue = storedSchedule
    ? projectReusableViewCounter(storedSchedule, startedAt.getTime()).value
    : Math.max(0, targetValue - newlyDiscoveredViews);
  const startValue = Math.min(targetValue, projectedPreviousValue);
  const startedAtMs = startedAt.getTime();
  const endsAtMs = endsAt.getTime();

  await db`
    insert into shorts_mvp.site_metrics (key,value,updated_at)
    values
      (${counterMetricKeys.startValue},${startValue},${input.updatedAt}),
      (${counterMetricKeys.targetValue},${targetValue},${input.updatedAt}),
      (${counterMetricKeys.startedAtMs},${startedAtMs},${input.updatedAt}),
      (${counterMetricKeys.endsAtMs},${endsAtMs},${input.updatedAt})
    on conflict (key) do update set
      value=excluded.value,updated_at=excluded.updated_at
  `;

  return {
    startValue,
    targetValue,
    startedAt: startedAt.toISOString(),
    endsAt: endsAt.toISOString(),
  } satisfies ReusableViewCounterSchedule;
}

/** Canonical current CC metadata includes every discovery source, including free. */
export async function refreshCatalogViewCounter(db: CounterSql, now: Date) {
  // During backfill the catalog is intentionally incomplete. Keep the live
  // legacy counter until the validated catalog actually serves the UI.
  if (!catalogReadsEnabled()) return;
  if (!Number.isFinite(now.getTime())) {
    throw new Error("REUSABLE_VIEW_COUNTER_TIME_INVALID");
  }
  // Collection callers already hold a transaction. Serialize only counter
  // refreshes so overlapping collectors continue the latest saved animation.
  await db`select pg_advisory_xact_lock(hashtext('shorts_mvp.reusable_views_counter'))`;
  const storedSchedule = await getReusableViewCounterSchedule(db);
  const [row] = await db`select coalesce(sum((metadata->>'viewCount')::bigint),0)::bigint as total
    from shorts_mvp.youtube_catalog c where (exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id and (r.region_code='KR' or (${japaneseDiscoveryEnabled()} and exists(select 1 from shorts_mvp.youtube_quota_verifications q where q.project_id=${process.env.YOUTUBE_QUOTA_PROJECT_ID || ""} and q.japan_discovery_enabled)))) or not exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id)) and availability='public' and metadata->>'license'='creativeCommon'
      and verified_at>clock_timestamp()-interval '30 days'`;
  const total=Number(row.total);
  if (!Number.isSafeInteger(total) || total<0) throw new Error("REUSABLE_VIEW_COUNTER_VALUE_OUT_OF_RANGE");
  const startedAtMs = Math.max(now.getTime(), storedSchedule ? Date.parse(storedSchedule.startedAt) : 0);
  const endsAtMs = nextReusableDiscoveryAt(new Date(startedAtMs)).getTime();
  // Keep repeated updates in the same collection interval stable. This also
  // repairs schedules saved with the old arbitrary twelve-hour deadline.
  if (storedSchedule?.targetValue === total && Date.parse(storedSchedule.endsAt) === endsAtMs) return storedSchedule;
  const displayedValue = storedSchedule
    ? projectReusableViewCounter(storedSchedule, startedAtMs).value
    : total;
  // Never animate invented views or retain views removed by a license change.
  const startValue = Math.min(total, displayedValue);
  await db`insert into shorts_mvp.site_metrics(key,value,updated_at) values
    ('reusable_views_start',${startValue},${now}),('reusable_views_target',${total},${now}),
    ('reusable_views_started_at_ms',${startedAtMs},${now}),
    ('reusable_views_ends_at_ms',${endsAtMs},${now})
    on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at`;
  return {
    startValue,
    targetValue: total,
    startedAt: new Date(startedAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
  } satisfies ReusableViewCounterSchedule;
}
