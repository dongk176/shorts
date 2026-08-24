begin;

create table if not exists shorts_mvp.ai_comment_regeneration_requests (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  mvp_session_id uuid not null
    references shorts_mvp.mvp_sessions(id) on delete cascade,
  user_id uuid not null
    references shorts_mvp.app_users(id) on delete cascade,
  short_id uuid not null
    references shorts_mvp.generated_shorts(id) on delete cascade,
  comment_count integer not null check (comment_count between 1 and 20),
  usage_seconds integer not null default 60 check (usage_seconds = 60),
  status text not null default 'reserved'
    check (status in ('reserved','consumed','released')),
  generated_comments jsonb,
  failure_code text,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id,request_id),
  check (
    status <> 'consumed'
    or (
      jsonb_typeof(generated_comments)='array'
      and jsonb_array_length(generated_comments)=comment_count
    )
  )
);

create index if not exists ai_comment_regeneration_short_created_idx
  on shorts_mvp.ai_comment_regeneration_requests(short_id,created_at desc);

create table if not exists shorts_mvp.ai_comment_regeneration_allocations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null
    references shorts_mvp.ai_comment_regeneration_requests(id) on delete cascade,
  grant_id uuid not null
    references shorts_mvp.usage_grants(id) on delete restrict,
  allocated_seconds integer not null check (allocated_seconds > 0),
  status text not null default 'reserved'
    check (status in ('reserved','consumed','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id,grant_id)
);

create index if not exists ai_comment_regeneration_allocations_grant_idx
  on shorts_mvp.ai_comment_regeneration_allocations(grant_id,status);

create or replace function shorts_mvp.reserve_ai_comment_regeneration_usage(
  p_user_id uuid,
  p_session_id uuid,
  p_short_id uuid,
  p_request_id uuid,
  p_comment_count integer
)
returns uuid
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
declare
  existing_request shorts_mvp.ai_comment_regeneration_requests%rowtype;
  created_request_id uuid;
  grant_row record;
  remaining integer := 60;
  allocation integer;
  has_full_service_access boolean := false;
  complimentary_only boolean := false;
begin
  if p_comment_count < 1 or p_comment_count > 20 then
    raise exception '재생성할 댓글 개수가 올바르지 않습니다.';
  end if;

  update shorts_mvp.ai_comment_regeneration_requests
  set status='released',failure_code='stale_request'
  where user_id=p_user_id
    and status='reserved'
    and created_at<clock_timestamp()-interval '5 minutes';

  select *
  into existing_request
  from shorts_mvp.ai_comment_regeneration_requests request_row
  where request_row.user_id=p_user_id
    and request_row.request_id=p_request_id
  for update;

  if existing_request.id is not null then
    if existing_request.short_id<>p_short_id
      or existing_request.comment_count<>p_comment_count then
      raise exception '같은 요청 번호를 다른 댓글 재생성에 사용할 수 없습니다.';
    end if;
    if existing_request.status='consumed' then
      return existing_request.id;
    end if;
    if existing_request.status='reserved' then
      raise exception '댓글 재생성 요청이 이미 처리 중입니다.';
    end if;
    raise exception '실패한 댓글 재생성 요청입니다. 다시 시도해 주세요.';
  end if;

  if not exists (
    select 1
    from shorts_mvp.generated_shorts generated_short
    join shorts_mvp.video_jobs job on job.id=generated_short.job_id
    where generated_short.id=p_short_id
      and generated_short.user_id=p_user_id
      and not job.is_example
      and generated_short.deleted_at is null
      and generated_short.expires_at>clock_timestamp()
  ) then
    raise exception '댓글을 재생성할 쇼츠를 찾을 수 없습니다.';
  end if;

  insert into shorts_mvp.ai_comment_regeneration_requests (
    request_id,mvp_session_id,user_id,short_id,comment_count
  ) values (
    p_request_id,p_session_id,p_user_id,p_short_id,p_comment_count
  )
  returning id into created_request_id;

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
          'admin_manual_usage_v1'
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
          'admin_manual_usage_v1'
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
    insert into shorts_mvp.ai_comment_regeneration_allocations (
      request_id,grant_id,allocated_seconds
    ) values (
      created_request_id,grant_row.id,allocation
    );
    remaining := remaining-allocation;
  end loop;

  if remaining > 0 then
    raise exception '댓글 재생성에 사용할 수 있는 시간이 부족합니다.';
  end if;

  return created_request_id;
end;
$$;

create or replace function shorts_mvp.apply_ai_comment_regeneration_usage()
returns trigger
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
begin
  if old.status<>'reserved' or new.status not in ('consumed','released') then
    return new;
  end if;

  if new.status='consumed' then
    update shorts_mvp.usage_grants grant_item
    set reserved_seconds=grant_item.reserved_seconds-allocation.allocated_seconds,
      consumed_seconds=grant_item.consumed_seconds+allocation.allocated_seconds,
      updated_at=clock_timestamp()
    from shorts_mvp.ai_comment_regeneration_allocations allocation
    where allocation.request_id=new.id
      and allocation.grant_id=grant_item.id
      and allocation.status='reserved';
    update shorts_mvp.ai_comment_regeneration_allocations
    set status='consumed',updated_at=clock_timestamp()
    where request_id=new.id and status='reserved';
    new.consumed_at=clock_timestamp();
  else
    update shorts_mvp.usage_grants grant_item
    set reserved_seconds=grant_item.reserved_seconds-allocation.allocated_seconds,
      updated_at=clock_timestamp()
    from shorts_mvp.ai_comment_regeneration_allocations allocation
    where allocation.request_id=new.id
      and allocation.grant_id=grant_item.id
      and allocation.status='reserved';
    update shorts_mvp.ai_comment_regeneration_allocations
    set status='released',updated_at=clock_timestamp()
    where request_id=new.id and status='reserved';
    new.released_at=clock_timestamp();
  end if;
  new.updated_at=clock_timestamp();
  return new;
end;
$$;

drop trigger if exists ai_comment_regeneration_apply_usage
  on shorts_mvp.ai_comment_regeneration_requests;
create trigger ai_comment_regeneration_apply_usage
before update of status
on shorts_mvp.ai_comment_regeneration_requests
for each row execute function shorts_mvp.apply_ai_comment_regeneration_usage();

alter table shorts_mvp.ai_comment_regeneration_requests enable row level security;
alter table shorts_mvp.ai_comment_regeneration_allocations enable row level security;

revoke all on table shorts_mvp.ai_comment_regeneration_requests
  from public,anon,authenticated;
revoke all on table shorts_mvp.ai_comment_regeneration_allocations
  from public,anon,authenticated;
grant all on table shorts_mvp.ai_comment_regeneration_requests to service_role;
grant all on table shorts_mvp.ai_comment_regeneration_allocations to service_role;

revoke all on function shorts_mvp.reserve_ai_comment_regeneration_usage(
  uuid,uuid,uuid,uuid,integer
) from public,anon,authenticated;
grant execute on function shorts_mvp.reserve_ai_comment_regeneration_usage(
  uuid,uuid,uuid,uuid,integer
) to service_role;

commit;
