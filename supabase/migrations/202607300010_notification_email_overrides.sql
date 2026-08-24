begin;

alter table shorts_mvp.user_email_notification_preferences
  add column if not exists notification_email text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='user_email_notification_preferences_email_length_check'
      and conrelid='shorts_mvp.user_email_notification_preferences'::regclass
  ) then
    alter table shorts_mvp.user_email_notification_preferences
      add constraint user_email_notification_preferences_email_length_check
      check (
        notification_email is null
        or (
          length(notification_email) between 3 and 320
          and notification_email=btrim(notification_email)
        )
      );
  end if;
end;
$$;

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
    left join shorts_mvp.user_email_notification_preferences preference
      on preference.user_id=n.user_id
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
      and preference.completion_email_status='enabled'
      and coalesce(
        nullif(btrim(preference.notification_email),''),
        nullif(btrim(u.email),'')
      ) is not null
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
  select c.job_id,c.user_id,
         coalesce(
           nullif(btrim(preference.notification_email),''),
           btrim(u.email)
         ),
         u.display_name,j.project_number,j.video_title,c.attempt_count
  from claimed c
  join shorts_mvp.app_users u on u.id=c.user_id
  left join shorts_mvp.user_email_notification_preferences preference
    on preference.user_id=c.user_id
  join shorts_mvp.video_jobs j on j.id=c.job_id
  order by j.project_number;
$$;

revoke all on function
  shorts_mvp.claim_job_completion_email_notifications(integer)
  from public, anon, authenticated;
grant execute on function
  shorts_mvp.claim_job_completion_email_notifications(integer)
  to service_role;

comment on column
  shorts_mvp.user_email_notification_preferences.notification_email is
  'Optional delivery address for completion and marketing emails; falls back to the account email.';
comment on table shorts_mvp.job_completion_email_notifications is
  'User-requested transactional completion emails. Recipient addresses are resolved from the notification preference when sending.';

commit;
