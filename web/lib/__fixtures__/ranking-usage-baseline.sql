CREATE OR REPLACE FUNCTION shorts_mvp.apply_usage_reservation_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'shorts_mvp', 'pg_temp'
AS $function$
begin
  if old.status <> 'reserved' or new.status not in ('consumed','released') then
    return new;
  end if;

  if new.status='consumed' then
    update shorts_mvp.usage_grants g
    set reserved_seconds=g.reserved_seconds-a.allocated_seconds,
        consumed_seconds=g.consumed_seconds+a.allocated_seconds,
        updated_at=clock_timestamp()
    from shorts_mvp.usage_grant_allocations a
    where a.reservation_id=new.id and a.grant_id=g.id and a.status='reserved';
    update shorts_mvp.usage_grant_allocations
    set status='consumed',updated_at=clock_timestamp()
    where reservation_id=new.id and status='reserved';
  else
    update shorts_mvp.usage_grants g
    set reserved_seconds=g.reserved_seconds-a.allocated_seconds,
        updated_at=clock_timestamp()
    from shorts_mvp.usage_grant_allocations a
    where a.reservation_id=new.id and a.grant_id=g.id and a.status='reserved';
    update shorts_mvp.usage_grant_allocations
    set status='released',updated_at=clock_timestamp()
    where reservation_id=new.id and status='reserved';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION shorts_mvp.reserve_enterprise_usage_grants(p_user_id uuid, p_reservation_id uuid, p_seconds integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'shorts_mvp', 'pg_temp'
AS $function$
declare
  grant_row record;
  remaining integer := p_seconds;
  allocation integer;
begin
  if p_seconds<=0 then raise exception '사용량 예약 시간이 올바르지 않습니다.'; end if;
  if not exists (
    select 1 from shorts_mvp.usage_reservations reservation
    where reservation.id=p_reservation_id and reservation.user_id=p_user_id
      and reservation.status='reserved'
      and reservation.source_duration_seconds=p_seconds
  ) then raise exception '사용량 예약 정보를 확인할 수 없습니다.'; end if;
  if not exists (
    select 1 from shorts_mvp.enterprise_service_entitlements entitlement
    where entitlement.app_user_id=p_user_id
      and entitlement.starts_at<=clock_timestamp()
      and entitlement.ends_at>clock_timestamp()
  ) then raise exception '현재 이용 가능한 기업 서비스 기간이 아닙니다.'; end if;

  for grant_row in
    select usage_grant.id,
      usage_grant.total_seconds-usage_grant.reserved_seconds-
        usage_grant.consumed_seconds as available_seconds
    from shorts_mvp.enterprise_service_entitlements entitlement
    join shorts_mvp.usage_grants usage_grant on usage_grant.id=entitlement.usage_grant_id
    where entitlement.app_user_id=p_user_id
      and entitlement.starts_at<=clock_timestamp() and entitlement.ends_at>clock_timestamp()
      and usage_grant.status='active' and usage_grant.valid_from<=clock_timestamp()
      and usage_grant.expires_at>clock_timestamp()
      and usage_grant.total_seconds>usage_grant.reserved_seconds+usage_grant.consumed_seconds
    order by usage_grant.expires_at,usage_grant.created_at
    for update of usage_grant
  loop
    exit when remaining=0;
    allocation := least(remaining,grant_row.available_seconds);
    update shorts_mvp.usage_grants
    set reserved_seconds=reserved_seconds+allocation,updated_at=clock_timestamp()
    where id=grant_row.id;
    insert into shorts_mvp.usage_grant_allocations (
      reservation_id,grant_id,allocated_seconds
    ) values (p_reservation_id,grant_row.id,allocation);
    remaining := remaining-allocation;
  end loop;
  if remaining>0 then raise exception '사용 가능한 원본 영상 처리 시간이 부족합니다.'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION shorts_mvp.reserve_usage_grants(p_user_id uuid, p_reservation_id uuid, p_seconds integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'shorts_mvp', 'pg_temp'
AS $function$
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
          'shorts_10k_thank_you_50min_v1',
          'admin_manual_usage_v1',
          'creator_support_30min_v1', 'creator_support_100min_v2'
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
          'shorts_10k_thank_you_50min_v1',
          'admin_manual_usage_v1',
          'creator_support_30min_v1', 'creator_support_100min_v2'
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
$function$;

