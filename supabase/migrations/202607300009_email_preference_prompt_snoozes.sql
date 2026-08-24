begin;

create table if not exists shorts_mvp.email_preference_prompt_snoozes (
  user_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
  snooze_step smallint not null default 0
    check (snooze_step between 0 and 30),
  completed_jobs_at_snooze integer not null default 0
    check (completed_jobs_at_snooze >= 0),
  next_prompt_completed_job_count integer not null
    check (next_prompt_completed_job_count >= completed_jobs_at_snooze),
  snoozed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

drop trigger if exists email_preference_prompt_snoozes_set_updated_at
  on shorts_mvp.email_preference_prompt_snoozes;
create trigger email_preference_prompt_snoozes_set_updated_at
before update on shorts_mvp.email_preference_prompt_snoozes
for each row execute function shorts_mvp.set_updated_at();

alter table shorts_mvp.email_preference_prompt_snoozes enable row level security;
revoke all on table shorts_mvp.email_preference_prompt_snoozes
  from anon, authenticated;
grant all on table shorts_mvp.email_preference_prompt_snoozes
  to service_role;

comment on table shorts_mvp.email_preference_prompt_snoozes is
  'Backoff state for users who choose Later on the email preference prompt. It is not consent or refusal.';
comment on column
  shorts_mvp.email_preference_prompt_snoozes.next_prompt_completed_job_count is
  'Prompt becomes eligible again after the user reaches this completed non-example job count.';

commit;
