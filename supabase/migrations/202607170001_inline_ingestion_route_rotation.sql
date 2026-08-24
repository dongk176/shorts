begin;

create or replace function shorts_mvp.rotate_ingestion_route(
  p_job_id uuid,
  p_current_route_id text,
  p_result text,
  p_cooldown_seconds integer default 0,
  p_excluded_route_ids text[] default array[]::text[]
)
returns table (route_id text)
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  current_job shorts_mvp.video_jobs%rowtype;
  next_route_id text;
begin
  select * into current_job
  from shorts_mvp.video_jobs
  where id=p_job_id
  for update;

  if not found
    or current_job.status in ('completed','failed','expired','deleted')
    or current_job.deadline_at <= clock_timestamp() + interval '5 minutes' then
    return;
  end if;

  if p_current_route_id is not null then
    if current_job.ingestion_route_id is distinct from p_current_route_id then
      return;
    end if;
    perform shorts_mvp.release_ingestion_route(
      p_job_id,
      p_current_route_id,
      p_result,
      p_cooldown_seconds
    );
  elsif current_job.ingestion_route_id is not null then
    return;
  end if;

  select s.route_id into next_route_id
  from shorts_mvp.ingestion_route_slots s
  where s.enabled
    and s.leased_job_id is null
    and coalesce(s.cooldown_until,'-infinity'::timestamptz) <= clock_timestamp()
    and not (s.route_id = any(coalesce(p_excluded_route_ids,array[]::text[])))
  order by s.last_leased_at nulls first,s.route_id
  for update of s skip locked
  limit 1;

  if next_route_id is null then
    return;
  end if;

  update shorts_mvp.ingestion_route_slots s
  set leased_job_id=p_job_id,
      lease_expires_at=clock_timestamp() + interval '20 minutes',
      cooldown_until=null,
      last_leased_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where s.route_id=next_route_id
    and s.leased_job_id is null;

  if not found then
    return;
  end if;

  update shorts_mvp.video_jobs j
  set ingestion_route_id=next_route_id,
      ingestion_route_leased_at=clock_timestamp(),
      heartbeat_at=clock_timestamp()
  where j.id=p_job_id;

  return query select next_route_id;
end;
$$;

revoke all on function shorts_mvp.rotate_ingestion_route(uuid,text,text,integer,text[])
  from public, anon, authenticated;
grant execute on function shorts_mvp.rotate_ingestion_route(uuid,text,text,integer,text[])
  to service_role;

commit;
