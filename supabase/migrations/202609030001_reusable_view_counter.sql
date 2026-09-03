begin;

set local lock_timeout = '3s';
set local statement_timeout = '30s';

with current_run as (
  select current_search.id,current_search.completed_at,
    (
      select max(previous_search.completed_at)
      from shorts_mvp.popular_search_runs previous_search
      where previous_search.status='ready'
        and previous_search.completed_at < current_search.completed_at
    ) as previous_completed_at
  from shorts_mvp.popular_search_runs current_search
  where current_search.status='ready'
  order by current_search.completed_at desc
  limit 1
),
reusable_candidates as (
  select item.video_id,item.view_count,item.collected_at,
    run.completed_at as last_seen_at,0 as source_priority
  from shorts_mvp.popular_search_items item
  join shorts_mvp.popular_search_runs run on run.id=item.run_id
  where run.status='ready'
    and run.completed_at <= (select completed_at from current_run)
    and item.license='creativeCommon'
  union all
  select item.video_id,item.view_count,item.collected_at,
    run.completed_at as last_seen_at,1 as source_priority
  from shorts_mvp.popular_video_items item
  join shorts_mvp.popular_video_runs run on run.id=item.run_id
  where run.status='ready'
    and run.completed_at <= (select completed_at from current_run)
    and item.license='creativeCommon'
),
ranked as (
  select view_count,
    min(last_seen_at) over (partition by video_id) as first_seen_at,
    row_number() over (
      partition by video_id
      order by last_seen_at desc,collected_at desc,view_count desc,source_priority asc
    ) as duplicate_rank
  from reusable_candidates
),
summary as (
  select current_run.completed_at,current_run.previous_completed_at,
    coalesce(sum(ranked.view_count) filter (
      where ranked.duplicate_rank=1
    ),0)::bigint as target_value,
    coalesce(sum(ranked.view_count) filter (
      where ranked.duplicate_rank=1
        and current_run.previous_completed_at is not null
        and ranked.first_seen_at > current_run.previous_completed_at
    ),0)::bigint as newly_discovered_views
  from current_run
  left join ranked on true
  group by current_run.completed_at,current_run.previous_completed_at
),
schedule as (
  select greatest(0,target_value-newly_discovered_views)::bigint as start_value,
    target_value,
    floor(extract(epoch from completed_at)*1000)::bigint as started_at_ms,
    floor(extract(epoch from (
      case
        when (
          date_trunc('day',completed_at at time zone 'UTC') + interval '8 hours'
        ) at time zone 'UTC' > completed_at + interval '3 seconds'
        then (
          date_trunc('day',completed_at at time zone 'UTC') + interval '8 hours'
        ) at time zone 'UTC'
        else (
          date_trunc('day',completed_at at time zone 'UTC') + interval '1 day 8 hours'
        ) at time zone 'UTC'
      end
    ))*1000)::bigint as ends_at_ms,
    completed_at
  from summary
),
metrics as (
  select metric.key,metric.value,schedule.completed_at
  from schedule
  cross join lateral (values
    ('reusable_views_start',schedule.start_value),
    ('reusable_views_target',schedule.target_value),
    ('reusable_views_started_at_ms',schedule.started_at_ms),
    ('reusable_views_ends_at_ms',schedule.ends_at_ms)
  ) metric(key,value)
)
insert into shorts_mvp.site_metrics (key,value,updated_at)
select key,value,completed_at
from metrics
on conflict (key) do nothing;

commit;
