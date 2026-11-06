begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
-- The target admission trigger independently verifies scope, expiry, quota and
-- the exact registered worker. Do not call its counting function a second time.
do $$ declare body text; anchor text:=E'begin\n'; begin
  body:=pg_get_functiondef('shorts_mvp.enforce_language_request_binding()'::regprocedure);
  if position('LANGUAGE_RELEASE_REQUIRED' in body)=0
    or position('silence_test_release_id' in body)>0
    or position(anchor in body)=0
    or not exists(select 1 from pg_trigger where tgrelid='shorts_mvp.video_jobs'::regclass
      and tgfoid='shorts_mvp.enforce_project_target_successor_admission()'::regprocedure
      and not tgisinternal and tgenabled='O')
    or position('assert_silence_test_job' in pg_get_functiondef('shorts_mvp.enforce_project_target_successor_admission()'::regprocedure))=0
  then raise exception 'SILENCE_LANGUAGE_GUARD_BASELINE_CHANGED'; end if;
  body:=overlay(body placing E'begin\n  if new.silence_test_release_id is not null\n    and new.source_type=\'youtube\'\n    and new.initial_editor_release_id=new.silence_test_release_id\n    and exists(select 1 from shorts_mvp.silence_test_releases r\n      join shorts_mvp.app_users u on u.id=r.administrator_id\n      where r.id=new.silence_test_release_id and u.id=new.user_id\n        and u.is_admin and r.verified_at is not null) then\n    return new;\n  end if;\n' from position(anchor in body) for length(anchor));
  execute body;
end $$;
commit;
