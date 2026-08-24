set lock_timeout = '3s';

create table if not exists shorts_mvp.editor_render_outbox (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique
    references shorts_mvp.editor_render_requests(id) on delete cascade,
  short_id uuid not null references shorts_mvp.generated_shorts(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','dispatching','dispatched','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  dispatched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists editor_render_outbox_pending_idx
  on shorts_mvp.editor_render_outbox(available_at,created_at)
  where status in ('pending','dispatching');

create or replace function shorts_mvp.claim_editor_render_outbox(
  p_limit integer default 25
)
returns table(outbox_id uuid,request_id uuid,short_id uuid,attempt_count integer)
language plpgsql
security definer
set search_path = shorts_mvp,pg_temp
as $$
begin
  return query
  with candidates as (
    select o.id
    from shorts_mvp.editor_render_outbox o
    where (
      (o.status='pending' and o.available_at<=clock_timestamp())
      or (
        o.status='dispatching'
        and o.claimed_at<clock_timestamp()-interval '5 minutes'
      )
    )
    order by o.available_at,o.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,25),100))
  ), claimed as (
    update shorts_mvp.editor_render_outbox o
    set status='dispatching',
        attempt_count=o.attempt_count+1,
        claimed_at=clock_timestamp(),
        updated_at=clock_timestamp(),
        last_error=null
    from candidates c
    where o.id=c.id
    returning o.id,o.request_id,o.short_id,o.attempt_count
  )
  select c.id,c.request_id,c.short_id,c.attempt_count from claimed c;
end;
$$;

alter table shorts_mvp.editor_render_outbox enable row level security;
revoke all on table shorts_mvp.editor_render_outbox from anon,authenticated;
grant all on table shorts_mvp.editor_render_outbox to service_role;
revoke all on function shorts_mvp.claim_editor_render_outbox(integer)
  from public,anon,authenticated;
grant execute on function shorts_mvp.claim_editor_render_outbox(integer)
  to service_role;

comment on table shorts_mvp.editor_render_outbox is
  '신규 편집기 렌더만 격리 카나리 제출기로 전달하는 전용 outbox';
