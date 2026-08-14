begin;

-- Advertising consent is kept separate from the account address used for
-- transactional project-completion notices.
alter table shorts_mvp.user_email_notification_preferences
  add column if not exists marketing_email text,
  add column if not exists marketing_decision_version text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='user_email_notification_preferences_marketing_email_check'
      and conrelid='shorts_mvp.user_email_notification_preferences'::regclass
  ) then
    alter table shorts_mvp.user_email_notification_preferences
      add constraint user_email_notification_preferences_marketing_email_check
      check (
        marketing_email is null
        or (
          length(marketing_email) between 3 and 320
          and marketing_email=btrim(marketing_email)
        )
      );
  end if;
end;
$$;

update shorts_mvp.user_email_notification_preferences
set marketing_email=notification_email
where marketing_email_status='enabled'
  and marketing_email is null
  and notification_email is not null;

update shorts_mvp.user_email_notification_preferences
set marketing_decision_version='2026-07-30-v1'
where marketing_email_status is not null
  and marketing_decision_version is null;

-- Every non-example, user-owned project gets a transactional completion notice.
create or replace function shorts_mvp.queue_all_job_completion_email()
returns trigger
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
begin
  if new.user_id is null or new.is_example then
    return new;
  end if;

  insert into shorts_mvp.job_completion_email_notifications (
    job_id,user_id,status,available_at
  ) values (
    new.id,new.user_id,
    case when new.status='completed' then 'pending' else 'waiting' end,
    clock_timestamp()
  )
  on conflict (job_id) do nothing;

  return new;
end;
$$;

drop trigger if exists video_jobs_queue_opted_in_completion_email
  on shorts_mvp.video_jobs;
drop trigger if exists video_jobs_queue_all_completion_email
  on shorts_mvp.video_jobs;
create trigger video_jobs_queue_all_completion_email
after insert on shorts_mvp.video_jobs
for each row execute function shorts_mvp.queue_all_job_completion_email();

drop function if exists shorts_mvp.queue_opted_in_job_completion_email();

-- Cover projects already in progress when this migration is applied. Historical
-- completed projects are intentionally excluded so the release cannot send a
-- burst of old notifications.
insert into shorts_mvp.job_completion_email_notifications (
  job_id,user_id,status,available_at
)
select job.id,job.user_id,'waiting',clock_timestamp()
from shorts_mvp.video_jobs job
where job.user_id is not null
  and not job.is_example
  and job.status in (
    'validating','queued','retry_waiting','starting','downloading',
    'transcribing','selecting','extracting','rendering','uploading'
  )
on conflict (job_id) do nothing;

-- Completion mail is a service notice and always uses the active account email.
-- The return shape is retained for rolling-deploy compatibility; display_name
-- and video_title are no longer rendered by the application.
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
    join shorts_mvp.app_users account on account.id=n.user_id
    join shorts_mvp.video_jobs job on job.id=n.job_id
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
      and account.email is not null
      and btrim(account.email) <> ''
      and account.withdrawn_at is null
      and job.status='completed'
      and not job.is_example
    order by n.available_at,n.requested_at
    for update of n skip locked
    limit greatest(1,least(p_limit,25))
  ), claimed as (
    update shorts_mvp.job_completion_email_notifications notification
    set status='processing',claimed_at=clock_timestamp(),
        attempt_count=least(notification.attempt_count+1,5),last_error=null
    from candidates candidate
    where notification.job_id=candidate.job_id
    returning notification.job_id,notification.user_id,
              notification.attempt_count
  )
  select claimed.job_id,claimed.user_id,btrim(account.email),
         account.display_name,job.project_number,job.video_title,
         claimed.attempt_count
  from claimed
  join shorts_mvp.app_users account on account.id=claimed.user_id
  join shorts_mvp.video_jobs job on job.id=claimed.job_id
  order by job.project_number;
$$;

revoke all on function
  shorts_mvp.claim_job_completion_email_notifications(integer)
  from public, anon, authenticated;
grant execute on function
  shorts_mvp.claim_job_completion_email_notifications(integer)
  to service_role;

comment on table shorts_mvp.job_completion_email_notifications is
  'Transactional completion notices for every non-example user project. Recipients are resolved from the active account email when sending.';
comment on column
  shorts_mvp.user_email_notification_preferences.completion_email_status is
  'Legacy preference retained for compatibility; it no longer controls transactional project-completion notices.';
comment on column
  shorts_mvp.user_email_notification_preferences.notification_email is
  'Legacy shared email override retained for compatibility; completion notices use the account email.';
comment on column
  shorts_mvp.user_email_notification_preferences.marketing_email is
  'Optional delivery address used only for explicitly consented advertising email.';
comment on column
  shorts_mvp.user_email_notification_preferences.marketing_decision_version is
  'Copy/version identifier associated with the latest advertising email consent decision.';

commit;
