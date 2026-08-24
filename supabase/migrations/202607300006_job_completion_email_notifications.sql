begin;

create table if not exists shorts_mvp.job_completion_email_notifications (
  job_id uuid primary key references shorts_mvp.video_jobs(id) on delete cascade,
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  status text not null default 'waiting'
    check (status in ('waiting','pending','processing','sent','failed')),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 5),
  available_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  requested_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists job_completion_email_notifications_pending_idx
  on shorts_mvp.job_completion_email_notifications (available_at,requested_at)
  where status='pending';

create index if not exists job_completion_email_notifications_user_idx
  on shorts_mvp.job_completion_email_notifications (user_id,requested_at desc);

drop trigger if exists job_completion_email_notifications_set_updated_at
  on shorts_mvp.job_completion_email_notifications;
create trigger job_completion_email_notifications_set_updated_at
before update on shorts_mvp.job_completion_email_notifications
for each row execute function shorts_mvp.set_updated_at();

alter table shorts_mvp.job_completion_email_notifications enable row level security;
revoke all on table shorts_mvp.job_completion_email_notifications
  from anon, authenticated;
grant all on table shorts_mvp.job_completion_email_notifications
  to service_role;

create or replace function shorts_mvp.queue_requested_job_completion_email()
returns trigger
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
begin
  if new.status='completed' and old.status is distinct from new.status then
    update shorts_mvp.job_completion_email_notifications
    set status='pending',available_at=clock_timestamp(),claimed_at=null,
        last_error=null
    where job_id=new.id and status='waiting';
  end if;
  return new;
end;
$$;

drop trigger if exists video_jobs_queue_completion_email
  on shorts_mvp.video_jobs;
create trigger video_jobs_queue_completion_email
after update of status on shorts_mvp.video_jobs
for each row execute function shorts_mvp.queue_requested_job_completion_email();

create or replace function shorts_mvp.claim_job_completion_email_notifications(
  p_limit integer default 10
)
returns table (
  job_id uuid,
  user_id uuid,
  recipient_email text,
  display_name text,
  project_number bigint,
  video_title text,
  attempt_count integer
)
language sql
security definer
set search_path = shorts_mvp, pg_temp
as $$
  with candidates as (
    select n.job_id
    from shorts_mvp.job_completion_email_notifications n
    join shorts_mvp.app_users u on u.id=n.user_id
    join shorts_mvp.video_jobs j on j.id=n.job_id
    where (
        (
          n.status='pending'
          and n.available_at <= clock_timestamp()
          and n.attempt_count < 5
        )
        or (
          n.status='processing'
          and n.claimed_at < clock_timestamp() - interval '10 minutes'
        )
      )
      and u.email is not null
      and btrim(u.email) <> ''
      and u.withdrawn_at is null
      and j.status='completed'
    order by n.available_at,n.requested_at
    for update of n skip locked
    limit greatest(1,least(p_limit,25))
  ), claimed as (
    update shorts_mvp.job_completion_email_notifications n
    set status='processing',claimed_at=clock_timestamp(),
        attempt_count=least(n.attempt_count+1,5),last_error=null
    from candidates c
    where n.job_id=c.job_id
    returning n.job_id,n.user_id,n.attempt_count
  )
  select c.job_id,c.user_id,btrim(u.email),u.display_name,
         j.project_number,j.video_title,c.attempt_count
  from claimed c
  join shorts_mvp.app_users u on u.id=c.user_id
  join shorts_mvp.video_jobs j on j.id=c.job_id
  order by j.project_number;
$$;

revoke all on function
  shorts_mvp.claim_job_completion_email_notifications(integer)
  from public, anon, authenticated;
grant execute on function
  shorts_mvp.claim_job_completion_email_notifications(integer)
  to service_role;

comment on table shorts_mvp.job_completion_email_notifications is
  'User-requested transactional completion emails. Recipient addresses are read from app_users only when sending.';
comment on column shorts_mvp.job_completion_email_notifications.status is
  'waiting until the job completes, then pending/processing/sent with bounded retries.';

commit;
