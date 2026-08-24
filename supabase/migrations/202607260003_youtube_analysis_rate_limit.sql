begin;

create table if not exists shorts_mvp.youtube_analysis_rate_limits (
  user_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
  burst_window_started_at timestamptz not null default clock_timestamp(),
  burst_count smallint not null default 0 check (burst_count between 0 and 5),
  sustained_window_started_at timestamptz not null default clock_timestamp(),
  sustained_count smallint not null default 0 check (sustained_count between 0 and 30),
  blocked_until timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

alter table shorts_mvp.youtube_analysis_rate_limits enable row level security;
revoke all on table shorts_mvp.youtube_analysis_rate_limits from anon, authenticated;
grant all on table shorts_mvp.youtube_analysis_rate_limits to service_role;

create or replace function shorts_mvp.consume_youtube_analysis_request(
  p_user_id uuid
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = pg_catalog, shorts_mvp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state shorts_mvp.youtube_analysis_rate_limits%rowtype;
  v_burst_started_at timestamptz;
  v_burst_count integer;
  v_sustained_started_at timestamptz;
  v_sustained_count integer;
  v_blocked_until timestamptz;
begin
  if p_user_id is null then
    raise exception 'youtube analysis rate limit requires a user';
  end if;

  insert into shorts_mvp.youtube_analysis_rate_limits (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into v_state
  from shorts_mvp.youtube_analysis_rate_limits
  where user_id = p_user_id
  for update;

  if v_state.blocked_until is not null and v_state.blocked_until > v_now then
    return query
    select false, greatest(
      1,
      ceil(extract(epoch from (v_state.blocked_until - v_now)))::integer
    );
    return;
  end if;

  if v_state.burst_window_started_at <= v_now - interval '1 minute' then
    v_burst_started_at := v_now;
    v_burst_count := 0;
  else
    v_burst_started_at := v_state.burst_window_started_at;
    v_burst_count := v_state.burst_count;
  end if;

  if v_state.sustained_window_started_at <= v_now - interval '1 hour' then
    v_sustained_started_at := v_now;
    v_sustained_count := 0;
  else
    v_sustained_started_at := v_state.sustained_window_started_at;
    v_sustained_count := v_state.sustained_count;
  end if;

  if v_burst_count >= 5 or v_sustained_count >= 30 then
    v_blocked_until := v_now + interval '10 minutes';
    update shorts_mvp.youtube_analysis_rate_limits
    set burst_window_started_at = v_burst_started_at,
        burst_count = v_burst_count,
        sustained_window_started_at = v_sustained_started_at,
        sustained_count = v_sustained_count,
        blocked_until = v_blocked_until,
        updated_at = v_now
    where user_id = p_user_id;

    return query
    select false, ceil(extract(epoch from (v_blocked_until - v_now)))::integer;
    return;
  end if;

  update shorts_mvp.youtube_analysis_rate_limits
  set burst_window_started_at = v_burst_started_at,
      burst_count = v_burst_count + 1,
      sustained_window_started_at = v_sustained_started_at,
      sustained_count = v_sustained_count + 1,
      blocked_until = null,
      updated_at = v_now
  where user_id = p_user_id;

  return query select true, 0;
end;
$$;

revoke all on function shorts_mvp.consume_youtube_analysis_request(uuid)
  from public, anon, authenticated;
grant execute on function shorts_mvp.consume_youtube_analysis_request(uuid)
  to service_role;

comment on table shorts_mvp.youtube_analysis_rate_limits is
  'Per-account burst and sustained limits for YouTube URL analysis requests.';
comment on function shorts_mvp.consume_youtube_analysis_request(uuid) is
  'Allows 5 requests per minute and 30 per hour; excess requests lock analysis for 10 minutes.';

commit;
