begin;

-- Free onboarding trial:
--   * authenticated account with a completed onboarding profile;
--   * no successful paid order, current paid/trial entitlement, or manual access;
--   * one immutable 20-minute grant per account, valid for 30 days;
--   * no real-time-popular-filter entitlement.
create unique index if not exists usage_grants_one_onboarding_welcome_per_user_idx
  on shorts_mvp.usage_grants (user_id,product_code)
  where product_code='onboarding_welcome_20min_v1';

with eligible_accounts as (
  select profile.user_id
  from shorts_mvp.user_onboarding_profiles profile
  join shorts_mvp.app_users account on account.id=profile.user_id
  where account.withdrawn_at is null
    and not (
      account.manual_service_access_until is not null
      and account.manual_service_access_until>clock_timestamp()
    )
    and not exists (
      select 1
      from shorts_mvp.billing_orders paid_order
      where paid_order.user_id=account.id
        and paid_order.status='succeeded'
        and paid_order.amount_krw>0
    )
    and not exists (
      select 1
      from shorts_mvp.user_subscriptions subscription
      where subscription.user_id=account.id
        and subscription.status in ('pending','trialing','active','past_due')
    )
)
insert into shorts_mvp.usage_grants (
  user_id,subscription_id,billing_order_id,kind,product_code,
  total_seconds,credited_seconds,carried_seconds,
  reserved_seconds,consumed_seconds,valid_from,expires_at,status
)
select
  eligible.user_id,null,null,'addon','onboarding_welcome_20min_v1',
  1200,1200,0,0,0,statement_timestamp(),
  statement_timestamp()+interval '30 days','active'
from eligible_accounts eligible
on conflict do nothing;

insert into shorts_mvp.member_campaign_announcements (
  user_id,campaign_code,granted_seconds,valid_until
)
select
  grant_row.user_id,'onboarding_welcome_v1',
  grant_row.total_seconds,grant_row.expires_at
from shorts_mvp.usage_grants grant_row
where grant_row.product_code='onboarding_welcome_20min_v1'
  and grant_row.status='active'
  and grant_row.expires_at>clock_timestamp()
on conflict (user_id,campaign_code) do nothing;

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
  'Database-level one-account-one-grant guard for the free onboarding trial.';

commit;
