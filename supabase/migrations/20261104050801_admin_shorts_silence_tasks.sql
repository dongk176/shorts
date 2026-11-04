-- Private, additive state for administrator-only post-generation processing.
-- No existing job, editor, upload, billing, or release-control guard is changed.
insert into shorts_mvp.runtime_feature_flags(flag_key,enabled,description)
values ('admin_shorts_silence',false,'관리자 전용 쇼츠 무음 정리 테스트') on conflict (flag_key) do nothing;

create table shorts_mvp.admin_short_silence_tasks (
  short_id uuid primary key references shorts_mvp.generated_shorts(id),
  job_id uuid not null references shorts_mvp.video_jobs(id),
  user_id uuid not null references shorts_mvp.app_users(id),
  request_id uuid not null unique,
  lease_id uuid not null,
  lease_until timestamptz not null,
  state text not null check (state in ('processing','rendering','completed','failed')),
  attempts smallint not null default 1 check (attempts between 1 and 2),
  cut_count integer not null default 0 check (cut_count between 0 and 119),
  removed_seconds numeric not null default 0 check (removed_seconds between 0 and 180),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table shorts_mvp.admin_short_silence_tasks enable row level security;
revoke all on shorts_mvp.admin_short_silence_tasks from public,anon,authenticated;
grant select,insert,update on shorts_mvp.admin_short_silence_tasks to service_role;

create function shorts_mvp.guard_admin_short_silence_task() returns trigger
language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
begin
  if tg_op='UPDATE' and (new.short_id is distinct from old.short_id
    or new.job_id is distinct from old.job_id or new.user_id is distinct from old.user_id
    or new.request_id is distinct from old.request_id) then
    raise exception 'SILENCE_TASK_IDENTITY_IMMUTABLE';
  end if;
  if not exists (
    select 1 from shorts_mvp.generated_shorts s
    join shorts_mvp.video_jobs j on j.id=s.job_id
    join shorts_mvp.app_users u on u.id=j.user_id
    where s.id=new.short_id and j.id=new.job_id and u.id=new.user_id
      and s.user_id=u.id and u.is_admin and not j.is_example
      and j.midform_request is null
      and j.template_snapshot->'shortsSilenceRemoval'='{"version":1,"preset":"aggressive"}'::jsonb
  ) then raise exception 'SILENCE_ADMIN_OWNERSHIP_REQUIRED'; end if;
  return new;
end; $$;
revoke all on function shorts_mvp.guard_admin_short_silence_task() from public,anon,authenticated;
create trigger guard_admin_short_silence_task before insert or update on shorts_mvp.admin_short_silence_tasks
for each row execute function shorts_mvp.guard_admin_short_silence_task();
