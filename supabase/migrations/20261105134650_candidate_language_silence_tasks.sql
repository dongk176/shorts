-- Preserve ordinary opt-in and ownership checks. Candidate-only language jobs
-- require the verified private release owner; this does not enable inline admission.
set local lock_timeout='2s';
set local statement_timeout='30s';
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
      and (j.template_snapshot->'shortsSilenceRemoval'='{"version":1,"preset":"aggressive"}'::jsonb
        or (u.is_admin and j.language_test_release_id is not null
          and j.template_snapshot->'shortsSilenceRemovalCandidate'='{"version":1,"preset":"aggressive"}'::jsonb
          and exists (select 1 from shorts_mvp.silence_test_releases q
            where q.id::text=j.template_snapshot->>'shortsSilenceCandidateId'
              and q.administrator_id=u.id and q.verified_at is not null
              and j.created_at>=q.verified_at and j.created_at<q.expires_at)))
  ) then raise exception 'SILENCE_OWNERSHIP_REQUIRED'; end if;
  return new;
end; $$;
revoke all on function shorts_mvp.guard_admin_short_silence_task() from public,anon,authenticated;
