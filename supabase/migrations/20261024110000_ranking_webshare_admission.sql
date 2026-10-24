-- Shared Webshare admission: existing workers retain their exact scheduling logic.
-- A bounded ranking lease excludes only its occupied IP; no existing job is changed.
set local lock_timeout='3s';
set local statement_timeout='10s';
alter table shorts_mvp.ingestion_route_slots
  add column ranking_operation_id uuid references shorts_mvp.ranking_operations(id),
  add column ranking_lease_expires_at timestamptz;
create table shorts_mvp.ranking_route_attempts (
  id bigint generated always as identity primary key,
  operation_id uuid not null references shorts_mvp.ranking_operations(id),
  route_id text not null,
  result text not null check(result in ('success','bot_check','network_error','terminal')),
  created_at timestamptz not null default now()
);
alter table shorts_mvp.ranking_route_attempts enable row level security;
revoke all on shorts_mvp.ranking_route_attempts from public,anon,authenticated;

-- Refuse to overwrite a concurrently changed production scheduler.
do $guard$
declare definition text;
begin
  select pg_get_functiondef('shorts_mvp.claim_job_outbox(integer)'::regprocedure) into definition;
  if md5(definition)<>'cf494ca026e6fe86675f5b5d082d38e9' then
    raise exception 'Production function changed: claim_job_outbox';
  end if;
  execute replace(definition, 's.leased_job_id is null', 's.leased_job_id is null and coalesce(s.ranking_lease_expires_at,''-infinity''::timestamptz)<=clock_timestamp()');
end;
$guard$;

-- Refuse to overwrite a concurrently changed production scheduler.
do $guard$
declare definition text;
begin
  select pg_get_functiondef('shorts_mvp.claim_project_job_outbox_without_ingestion_circuit(integer)'::regprocedure) into definition;
  if md5(definition)<>'d3eb31c76056f76bb19da6783b43f529' then
    raise exception 'Production function changed: claim_project_job_outbox_without_ingestion_circuit';
  end if;
  execute replace(definition, 'route.leased_job_id is null', 'route.leased_job_id is null and coalesce(route.ranking_lease_expires_at,''-infinity''::timestamptz)<=clock_timestamp()');
end;
$guard$;

-- Refuse to overwrite a concurrently changed production scheduler.
do $guard$
declare definition text;
begin
  select pg_get_functiondef('shorts_mvp.rotate_ingestion_route(uuid,text,text,integer,text[])'::regprocedure) into definition;
  if md5(definition)<>'929ecb7232f60c4c23c60ac14057cce5' then
    raise exception 'Production function changed: rotate_ingestion_route';
  end if;
  execute replace(definition, 's.leased_job_id is null', 's.leased_job_id is null and coalesce(s.ranking_lease_expires_at,''-infinity''::timestamptz)<=clock_timestamp()');
end;
$guard$;


create function shorts_ranking_runtime.claim_route(p_operation uuid,p_task text,p_allowed text[],p_excluded text[])
returns text language plpgsql security definer set search_path=pg_catalog as $$
declare selected text;
begin
  -- One ranking acquisition globally, even during service replacement.
  if not pg_try_advisory_xact_lock(19760824,2401) then return null; end if;
  if not exists (
    select 1 from shorts_mvp.ranking_operations o
    join shorts_mvp.ranking_projects p on p.id=o.project_id
    join shorts_mvp.app_users u on u.id=p.user_id
    where o.id=p_operation and o.status='running' and o.task_id=p_task
      and u.is_admin=true and p.deleted_at is null and p.expires_at>clock_timestamp()
  ) then return null; end if;
  if cardinality(p_allowed)>32 or cardinality(p_excluded)>32 then return null; end if;
  if exists(select 1 from shorts_mvp.ingestion_route_slots
    where ranking_lease_expires_at>clock_timestamp()) then return null; end if;
  select s.route_id into selected from shorts_mvp.ingestion_route_slots s
    cross join lateral shorts_mvp.ingestion_route_quality(s.route_id) q
    where s.enabled and s.egress_class='webshare_isp' and s.leased_job_id is null
      and coalesce(s.ranking_lease_expires_at,'-infinity'::timestamptz)<=clock_timestamp()
      and coalesce(s.cooldown_until,'-infinity'::timestamptz)<=clock_timestamp()
      and s.route_id=any(p_allowed)
      and not(s.route_id=any(coalesce(p_excluded,array[]::text[])))
    order by q.quality_tier,s.last_leased_at nulls first,s.route_id
    for update of s skip locked limit 1;
  if selected is null then return null; end if;
  update shorts_mvp.ingestion_route_slots set ranking_operation_id=p_operation,
    ranking_lease_expires_at=clock_timestamp()+interval '10 minutes'
    where route_id=selected;
  return selected;
end;
$$;
create function shorts_ranking_runtime.release_route(p_operation uuid,p_task text,p_route text,p_result text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare released integer;
begin
  if p_result not in ('success','bot_check','network_error','terminal') then
    raise exception 'Invalid ranking route result';
  end if;
  if not exists(select 1 from shorts_mvp.ranking_operations
    where id=p_operation and task_id=p_task) then return false; end if;
  update shorts_mvp.ingestion_route_slots set ranking_operation_id=null,
    ranking_lease_expires_at=null,
    cooldown_until=case when p_result='bot_check'
      then greatest(coalesce(cooldown_until,'-infinity'::timestamptz),clock_timestamp()+interval '15 seconds')
      else cooldown_until end
    where route_id=p_route and ranking_operation_id=p_operation;
  get diagnostics released=row_count;
  if released=1 then
    insert into shorts_mvp.ranking_route_attempts(operation_id,route_id,result)
    values(p_operation,p_route,p_result);
  end if;
  return released=1;
end;
$$;
revoke all on function shorts_ranking_runtime.claim_route(uuid,text,text[],text[]) from public,anon,authenticated;
revoke all on function shorts_ranking_runtime.release_route(uuid,text,text,text) from public,anon,authenticated;
grant execute on function shorts_ranking_runtime.claim_route(uuid,text,text[],text[]) to shorts_ranking_runtime;
grant execute on function shorts_ranking_runtime.release_route(uuid,text,text,text) to shorts_ranking_runtime;
