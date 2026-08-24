begin;

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'shorts_10k_thank_you_event',
  true,
  '쇼츠 1만 개 감사 이벤트: 계정당 안내 1회 및 첫 쇼츠 생성 시 50분 1회 지급'
)
on conflict (flag_key) do nothing;

create table if not exists shorts_mvp.member_campaign_presentations (
  user_id uuid not null
    references shorts_mvp.app_users(id) on delete cascade,
  campaign_code text not null
    check (char_length(campaign_code) between 2 and 100),
  presented_at timestamptz not null default now(),
  primary key (user_id,campaign_code)
);

alter table shorts_mvp.member_campaign_presentations enable row level security;
revoke all on shorts_mvp.member_campaign_presentations from anon, authenticated;
grant all on shorts_mvp.member_campaign_presentations to service_role;

create unique index if not exists
  usage_grants_one_shorts_10k_thank_you_per_user_idx
  on shorts_mvp.usage_grants (user_id,product_code)
  where product_code='shorts_10k_thank_you_50min_v1';

-- Keep the transactional reservation guard aligned with application access:
-- paid and operator access may spend every active grant, while free accounts
-- may spend only their onboarding/event complimentary grants.
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
  complimentary_only boolean := false;
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
      from shorts_mvp.usage_grants complimentary_grant
      where complimentary_grant.user_id=p_user_id
        and complimentary_grant.product_code in (
          'onboarding_welcome_20min_v1',
          'shorts_10k_thank_you_50min_v1'
        )
        and complimentary_grant.status='active'
        and complimentary_grant.valid_from<=clock_timestamp()
        and complimentary_grant.expires_at>clock_timestamp()
        and complimentary_grant.total_seconds
          > complimentary_grant.reserved_seconds
            + complimentary_grant.consumed_seconds
    ) then
      raise exception '활성 구독 또는 사용 가능한 체험시간이 필요합니다.';
    end if;
    complimentary_only := true;
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
        not complimentary_only
        or grant_item.product_code in (
          'onboarding_welcome_20min_v1',
          'shorts_10k_thank_you_50min_v1'
        )
      )
    order by
      case when grant_item.funding_source='paid' then 0 else 1 end,
      case
        when grant_item.funding_source='paid'
          and grant_item.kind='addon' then 0
        when grant_item.funding_source='paid'
          and grant_item.kind='base' then 1
        else 2
      end,
      case
        when grant_item.funding_source='paid'
          and grant_item.kind='addon'
        then grant_item.expires_at
      end,
      case
        when grant_item.funding_source='paid'
          and grant_item.kind='base'
        then grant_item.valid_from
      end desc,
      case
        when grant_item.funding_source='complimentary'
        then grant_item.expires_at
      end,
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

comment on table shorts_mvp.member_campaign_presentations is
  'Account-wide one-time presentation audit for campaigns without a pre-issued grant.';
comment on index
  shorts_mvp.usage_grants_one_shorts_10k_thank_you_per_user_idx is
  'Database-level one-account-one-grant guard for the shorts 10k thank-you event.';

commit;
