-- A render reserves five minutes; only a successful result consumes it.
-- Keep the operation UUID as an audit reference after 30-day media retention.
-- Deliberately no cascading FK: deleting media must not erase usage history.
alter table shorts_mvp.usage_reservations
  add column ranking_operation_id uuid unique,
  alter column job_id drop not null,
  alter column mvp_session_id drop not null;
alter table shorts_mvp.usage_reservations add constraint usage_reservation_source check (
  (ranking_operation_id is null and job_id is not null and mvp_session_id is not null)
  or (ranking_operation_id is not null and job_id is null and mvp_session_id is null
      and source_duration_seconds=300)
);

create function shorts_mvp.reserve_ranking_render_usage(p_operation_id uuid,p_user_id uuid,p_enterprise boolean default false)
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
    values(p_user_id,p_operation_id,300,'reserved') returning id into reservation_id;
  if p_enterprise then
    perform shorts_mvp.reserve_enterprise_usage_grants(p_user_id,reservation_id,300);
  else
    perform shorts_mvp.reserve_usage_grants(p_user_id,reservation_id,300);
  end if;
end;
$$;
revoke all on function shorts_mvp.reserve_ranking_render_usage(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function shorts_mvp.reserve_ranking_render_usage(uuid,uuid,boolean) to service_role;

create function shorts_mvp.settle_ranking_render_usage()
returns trigger language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
begin
  if tg_op='DELETE' then
    update shorts_mvp.usage_reservations set status='released',released_at=clock_timestamp()
      where ranking_operation_id=old.id and status='reserved';
    return old;
  end if;
  if new.action='render' and new.status in ('succeeded','failed') then
    update shorts_mvp.usage_reservations
      set status=case when new.status='succeeded' then 'consumed' else 'released' end,
          consumed_at=case when new.status='succeeded' then clock_timestamp() else null end,
          released_at=case when new.status='failed' then clock_timestamp() else null end
      where ranking_operation_id=new.id and status='reserved';
  end if;
  return new;
end;
$$;
revoke all on function shorts_mvp.settle_ranking_render_usage() from public,anon,authenticated;
create trigger ranking_render_usage_settle after update of status on shorts_mvp.ranking_operations
  for each row execute function shorts_mvp.settle_ranking_render_usage();
create trigger ranking_render_usage_cleanup before delete on shorts_mvp.ranking_operations
  for each row execute function shorts_mvp.settle_ranking_render_usage();
