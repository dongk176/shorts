-- Additive rollout: old web builds remain administrator-only while this flag is off.
insert into shorts_mvp.runtime_feature_flags(flag_key,enabled,description)
values ('public_shorts_silence',false,'회원용 쇼츠 무음 구간 삭제') on conflict (flag_key) do nothing;

-- Keep the existing private table, privileges and RLS. Admission is checked by
-- the server; queued opt-in tasks can finish even after public admission stops.
create or replace function shorts_mvp.guard_admin_short_silence_task() returns trigger
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
      and s.user_id=u.id and not j.is_example
      and j.midform_request is null
      and j.template_snapshot->'shortsSilenceRemoval'='{"version":1,"preset":"aggressive"}'::jsonb
  ) then raise exception 'SILENCE_OWNERSHIP_REQUIRED'; end if;
  return new;
end; $$;
revoke all on function shorts_mvp.guard_admin_short_silence_task() from public,anon,authenticated;
