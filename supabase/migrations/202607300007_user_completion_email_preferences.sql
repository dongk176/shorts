begin;

create table if not exists shorts_mvp.user_email_notification_preferences (
  user_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
  completion_email_status text not null
    check (completion_email_status in ('enabled','declined')),
  decided_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

drop trigger if exists user_email_notification_preferences_set_updated_at
  on shorts_mvp.user_email_notification_preferences;
create trigger user_email_notification_preferences_set_updated_at
before update on shorts_mvp.user_email_notification_preferences
for each row execute function shorts_mvp.set_updated_at();

alter table shorts_mvp.user_email_notification_preferences enable row level security;
revoke all on table shorts_mvp.user_email_notification_preferences
  from anon, authenticated;
grant all on table shorts_mvp.user_email_notification_preferences
  to service_role;

insert into shorts_mvp.user_email_notification_preferences (
  user_id,completion_email_status,decided_at
)
select notification.user_id,'enabled',min(notification.requested_at)
from shorts_mvp.job_completion_email_notifications notification
group by notification.user_id
on conflict (user_id) do nothing;

create or replace function shorts_mvp.queue_opted_in_job_completion_email()
returns trigger
language plpgsql
security definer
set search_path = shorts_mvp, pg_temp
as $$
begin
  if new.user_id is null or new.is_example then
    return new;
  end if;

  if exists (
    select 1
    from shorts_mvp.user_email_notification_preferences preference
    where preference.user_id=new.user_id
      and preference.completion_email_status='enabled'
  ) then
    insert into shorts_mvp.job_completion_email_notifications (
      job_id,user_id,status,available_at
    ) values (
      new.id,new.user_id,
      case when new.status='completed' then 'pending' else 'waiting' end,
      clock_timestamp()
    )
    on conflict (job_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists video_jobs_queue_opted_in_completion_email
  on shorts_mvp.video_jobs;
create trigger video_jobs_queue_opted_in_completion_email
after insert on shorts_mvp.video_jobs
for each row execute function shorts_mvp.queue_opted_in_job_completion_email();

comment on table shorts_mvp.user_email_notification_preferences is
  'Per-user transactional email preferences. Absence means not asked; this table is not marketing consent.';
comment on column
  shorts_mvp.user_email_notification_preferences.completion_email_status is
  'enabled queues future job-completion emails; declined suppresses the home prompt.';

commit;
