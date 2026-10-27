-- Additive server-only beta scheduler. Existing ECS/admin scheduler remains unchanged.
set local lock_timeout='3s';
set local statement_timeout='10s';
create function shorts_ranking_runtime.claim_route_beta(p_operation uuid,p_task text,p_allowed text[],p_excluded text[])
returns text language plpgsql security invoker set search_path=pg_catalog as $$
declare selected text; live_count integer;
begin
  -- Same admission lock as the old ranking worker; serialize allocation, never downloads.
  if not pg_try_advisory_xact_lock(19760824,2401) then return null; end if;
  if not exists (
    select 1 from shorts_mvp.ranking_operations o
    join shorts_mvp.ranking_projects p on p.id=o.project_id
    join shorts_mvp.app_users u on u.id=p.user_id
    where o.id=p_operation and o.status='running' and o.task_id=p_task and o.executor='vercel'
      and p.deleted_at is null and p.expires_at>clock_timestamp()
  ) then return null; end if;
  if coalesce(cardinality(p_allowed),0) not between 1 and 32 or cardinality(p_excluded)>32 then return null; end if;
  select route_id into selected from shorts_mvp.ingestion_route_slots
    where ranking_operation_id=p_operation and ranking_lease_expires_at>clock_timestamp();
  if selected is not null then return selected; end if;
  select count(*) into live_count from shorts_mvp.ingestion_route_slots
    where ranking_lease_expires_at>clock_timestamp();
  if live_count>=3 then return null; end if;
  -- Leave capacity for the existing longform pipeline even with three ranking users.
  if (select count(*) from shorts_mvp.ingestion_route_slots where enabled and egress_class='webshare_isp'
      and leased_job_id is null and coalesce(ranking_lease_expires_at,'-infinity'::timestamptz)<=clock_timestamp()
      and coalesce(cooldown_until,'-infinity'::timestamptz)<=clock_timestamp())<=2 then return null; end if;
  select s.route_id into selected from shorts_mvp.ingestion_route_slots s
    cross join lateral shorts_mvp.ingestion_route_quality(s.route_id) q
    left join lateral (
      select max(created_at) filter(where result='success') as succeeded,
        max(created_at) filter(where result='bot_check') as blocked,
        max(created_at) filter(where result='network_error') as network_failed,
        count(*) filter(where result='bot_check') as blocks
      from shorts_mvp.ranking_route_attempts a where a.route_id=s.route_id
        and a.created_at>greatest(clock_timestamp()-interval '1 hour',coalesce(s.quality_reset_at,'-infinity'::timestamptz))
    ) recent on true
    where s.enabled and s.egress_class='webshare_isp' and s.leased_job_id is null
      and coalesce(s.ranking_lease_expires_at,'-infinity'::timestamptz)<=clock_timestamp()
      and coalesce(s.cooldown_until,'-infinity'::timestamptz)<=clock_timestamp()
      and s.route_id=any(p_allowed) and not(s.route_id=any(coalesce(p_excluded,array[]::text[])))
      and coalesce(recent.blocked,'-infinity'::timestamptz)<clock_timestamp()-case when recent.blocks>=2 then interval '15 minutes' else interval '5 minutes' end
      and coalesce(recent.network_failed,'-infinity'::timestamptz)<clock_timestamp()-interval '1 minute'
    order by q.quality_tier,recent.succeeded desc nulls last,q.success_rate desc,s.last_leased_at nulls first,s.route_id
    for update of s skip locked limit 1;
  if selected is null then return null; end if;
  update shorts_mvp.ingestion_route_slots set ranking_operation_id=p_operation,
    ranking_lease_expires_at=clock_timestamp()+interval '10 minutes' where route_id=selected;
  return selected;
end;
$$;
revoke all on function shorts_ranking_runtime.claim_route_beta(uuid,text,text[],text[]) from public,anon,authenticated;
