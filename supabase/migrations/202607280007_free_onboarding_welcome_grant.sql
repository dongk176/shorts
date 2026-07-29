begin;

-- Free login welcome trial:
--   * issued by the application after an authenticated login;
--   * no successful paid order, current paid/trial entitlement, or manual access;
--   * one immutable 20-minute grant per account, valid for 30 days;
--   * no real-time-popular-filter entitlement.
create unique index if not exists usage_grants_one_onboarding_welcome_per_user_idx
  on shorts_mvp.usage_grants (user_id,product_code)
  where product_code='onboarding_welcome_20min_v1';

-- A welcome account may reserve only its welcome grant. It never receives the
-- broader direct-service entitlement used by operator-issued complimentary
-- access, so paid add-ons and campaign grants cannot be unlocked accidentally.
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
  has_full_service_access boolean := false;
  welcome_only boolean := false;
begin
  if p_seconds <= 0 then
    raise exception '사용량 예약 시간이 올바르지 않습니다.';
  end if;

  if not exists (
    select 1
    from shorts_mvp.usage_reservations reservation
    where reservation.id=p_reservation_id
      and reservation.user_id=p_user_id
      and reservation.status='reserved'
      and reservation.source_duration_seconds=p_seconds
  ) then
    raise exception '사용량 예약 정보를 확인할 수 없습니다.';
  end if;

  select (
    exists (
      select 1
      from shorts_mvp.user_subscriptions subscription
      where subscription.user_id=p_user_id
        and subscription.status='active'
        and subscription.current_period_start<=clock_timestamp()
        and subscription.current_period_end>clock_timestamp()
    )
    or exists (
      select 1
      from shorts_mvp.app_users account
      where account.id=p_user_id
        and account.manual_service_access_until>clock_timestamp()
    )
  ) into has_full_service_access;

  if not has_full_service_access then
    if not exists (
      select 1
      from shorts_mvp.usage_grants welcome_grant
      where welcome_grant.user_id=p_user_id
        and welcome_grant.product_code='onboarding_welcome_20min_v1'
        and welcome_grant.status='active'
        and welcome_grant.valid_from<=clock_timestamp()
        and welcome_grant.expires_at>clock_timestamp()
        and welcome_grant.total_seconds
          > welcome_grant.reserved_seconds+welcome_grant.consumed_seconds
    ) then
      raise exception '활성 구독 또는 사용 가능한 체험시간이 필요합니다.';
    end if;
    welcome_only := true;
  end if;

  for grant_row in
    select
      grant_item.id,
      grant_item.total_seconds
        - grant_item.reserved_seconds
        - grant_item.consumed_seconds as available_seconds
    from shorts_mvp.usage_grants grant_item
    where grant_item.user_id=p_user_id
      and grant_item.status='active'
      and grant_item.valid_from<=clock_timestamp()
      and grant_item.expires_at>clock_timestamp()
      and grant_item.total_seconds
        > grant_item.reserved_seconds+grant_item.consumed_seconds
      and (
        not welcome_only
        or grant_item.product_code='onboarding_welcome_20min_v1'
      )
    order by
      case when grant_item.kind='addon' then 0 else 1 end,
      case when grant_item.kind='addon' then grant_item.expires_at end,
      case when grant_item.kind='base' then grant_item.valid_from end desc,
      grant_item.created_at
    for update
  loop
    exit when remaining=0;
    allocation := least(remaining,grant_row.available_seconds);
    update shorts_mvp.usage_grants
    set reserved_seconds=reserved_seconds+allocation,
      updated_at=clock_timestamp()
    where id=grant_row.id;
    insert into shorts_mvp.usage_grant_allocations (
      reservation_id,grant_id,allocated_seconds
    ) values (
      p_reservation_id,grant_row.id,allocation
    );
    remaining := remaining-allocation;
  end loop;

  if remaining > 0 then
    raise exception '사용 가능한 원본 영상 처리 시간이 부족합니다.';
  end if;
end;
$$;

revoke all on function shorts_mvp.reserve_usage_grants(uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function shorts_mvp.reserve_usage_grants(uuid,uuid,integer)
  to service_role;

comment on index shorts_mvp.usage_grants_one_onboarding_welcome_per_user_idx is
  'Database-level one-account-one-grant guard for the free login welcome trial.';

commit;
