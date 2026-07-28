begin;

-- Complimentary service access is checked by the application before job
-- creation. Keep the final, transactional usage reservation check aligned so
-- direct-access accounts can spend only the active grants issued to them.
create or replace function shorts_mvp.reserve_usage_grants(
  p_user_id uuid,
  p_reservation_id uuid,
  p_seconds integer
)
returns void
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  grant_row record;
  remaining integer := p_seconds;
  allocation integer;
begin
  if p_seconds <= 0 then
    raise exception '사용량 예약 시간이 올바르지 않습니다.';
  end if;

  if not exists (
    select 1
    from shorts_mvp.usage_reservations r
    where r.id=p_reservation_id and r.user_id=p_user_id
      and r.status='reserved' and r.source_duration_seconds=p_seconds
  ) then
    raise exception '사용량 예약 정보를 확인할 수 없습니다.';
  end if;

  if not exists (
    select 1 from shorts_mvp.user_subscriptions s
    where s.user_id=p_user_id and s.status='active'
      and s.current_period_start <= clock_timestamp()
      and s.current_period_end > clock_timestamp()
  ) and not exists (
    select 1 from shorts_mvp.app_users u
    where u.id=p_user_id
      and u.manual_service_access_until > clock_timestamp()
  ) then
    raise exception '활성 구독이 필요합니다.';
  end if;

  for grant_row in
    select g.id, g.total_seconds-g.reserved_seconds-g.consumed_seconds as available_seconds
    from shorts_mvp.usage_grants g
    where g.user_id=p_user_id and g.status='active'
      and g.valid_from <= clock_timestamp() and g.expires_at > clock_timestamp()
      and g.total_seconds > g.reserved_seconds+g.consumed_seconds
    order by case when g.kind='addon' then 0 else 1 end,
      case when g.kind='addon' then g.expires_at end,
      case when g.kind='base' then g.valid_from end desc,
      g.created_at
    for update
  loop
    exit when remaining=0;
    allocation := least(remaining,grant_row.available_seconds);
    update shorts_mvp.usage_grants
    set reserved_seconds=reserved_seconds+allocation,updated_at=clock_timestamp()
    where id=grant_row.id;
    insert into shorts_mvp.usage_grant_allocations
      (reservation_id,grant_id,allocated_seconds)
    values (p_reservation_id,grant_row.id,allocation);
    remaining := remaining-allocation;
  end loop;

  if remaining > 0 then
    raise exception '사용 가능한 원본 영상 처리 시간이 부족합니다.';
  end if;
end;
$$;

revoke all on function shorts_mvp.reserve_usage_grants(uuid,uuid,integer) from public;
grant execute on function shorts_mvp.reserve_usage_grants(uuid,uuid,integer) to service_role;

commit;
