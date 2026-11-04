set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- New ranking renders reserve 3 minutes. Existing 5-minute reservations retain
-- their recorded allocations and settle/release through the unchanged trigger.
alter table shorts_mvp.usage_reservations drop constraint usage_reservation_source;
alter table shorts_mvp.usage_reservations add constraint usage_reservation_source check (
  (ranking_operation_id is null and job_id is not null and mvp_session_id is not null)
  or (ranking_operation_id is not null and job_id is null and mvp_session_id is null
      and source_duration_seconds in (180,300))
);

create or replace function shorts_mvp.reserve_ranking_render_usage(p_operation_id uuid,p_user_id uuid,p_enterprise boolean default false)
returns void language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare reservation_id uuid;
begin
  perform o.id from shorts_mvp.ranking_operations o
    join shorts_mvp.ranking_projects p on p.id=o.project_id
    where o.id=p_operation_id and p.user_id=p_user_id and o.action='render'
      and o.status in ('queued','running') and p.deleted_at is null and p.expires_at>now()
    for update of o;
  if not found then raise exception 'Invalid ranking render reservation'; end if;
  if exists(select 1 from shorts_mvp.usage_reservations where ranking_operation_id=p_operation_id) then return; end if;
  insert into shorts_mvp.usage_reservations(user_id,ranking_operation_id,source_duration_seconds,status)
    values(p_user_id,p_operation_id,180,'reserved') returning id into reservation_id;
  if p_enterprise then
    perform shorts_mvp.reserve_enterprise_usage_grants(p_user_id,reservation_id,180);
  else
    perform shorts_mvp.reserve_usage_grants(p_user_id,reservation_id,180);
  end if;
end;
$$;
revoke all on function shorts_mvp.reserve_ranking_render_usage(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function shorts_mvp.reserve_ranking_render_usage(uuid,uuid,boolean) to service_role;

