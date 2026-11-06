begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
create or replace function shorts_mvp.enforce_silence_test_editor_binding() returns trigger
language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
declare pinned uuid; upload_job shorts_mvp.video_jobs%rowtype; proof jsonb;
begin
  select j.silence_test_release_id into pinned from shorts_mvp.generated_shorts s
    join shorts_mvp.video_jobs j on j.id=s.job_id where s.id=new.short_id;
  -- A registered release can serve both isolated link and upload tests.
  -- Upload ownership and immutable admission proof are verified separately.
  if pinned is null then
    select j.* into upload_job from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=new.short_id and s.user_id=new.user_id and j.user_id=new.user_id
        and j.source_type='upload' and j.template_snapshot->'uploadLanguage' is not null
        and j.initial_editor_release_id=new.release_id;
    if found and new.release_channel='canary' then
      proof:=shorts_mvp.upload_language_project_release(upload_job);
      if proof->>'releaseId'=new.release_id::text then return new; end if;
    end if;
  end if;
  if pinned is null and not exists(select 1 from shorts_mvp.silence_test_releases where id=new.release_id) then
    return new;
  end if;
  if new.release_id is distinct from pinned or new.release_channel is distinct from 'canary'
    or not exists(select 1 from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      join shorts_mvp.app_users u on u.id=j.user_id
      join shorts_mvp.silence_test_releases r on r.id=j.silence_test_release_id
      where s.id=new.short_id and s.user_id=new.user_id and j.user_id=new.user_id
        and u.is_admin and r.administrator_id=u.id and r.verified_at is not null)
  then raise exception 'SILENCE_TEST_EDITOR_BINDING_INVALID'; end if;
  return new;
end; $$;
commit;
