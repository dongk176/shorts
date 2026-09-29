begin;
set local lock_timeout='3s';

-- The SNS experiment owns its immutable release and never repoints the public gate.
create or replace function shorts_mvp.assert_sns_template_job(p_job shorts_mvp.video_jobs)
returns void language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare r record; t jsonb;
begin
  if p_job.template_snapshot->>'snsTemplateVersion' is distinct from '1'
    or p_job.template_id is distinct from 'white-yellow'
    or p_job.subtitle_template_id is not null then
    raise exception 'SNS_TEMPLATE_CONTEXT_MISMATCH';
  end if;
  perform id from shorts_mvp.app_users where id=p_job.user_id and is_admin for share;
  if not found then raise exception 'SNS_TEMPLATE_ADMIN_ONLY'; end if;
  select l.*,e.git_sha,e.worker_image_digest,e.font_manifest_sha256,e.status,e.staging_verified_at
    into r from shorts_mvp.language_test_releases l
    join shorts_mvp.editor_releases e on e.id=l.id
    where l.id=p_job.language_test_release_id and l.verified_at is not null
      and l.verification->>'kind'='sns_admin_generation_only'
      and e.ui_version=3 and e.document_version=3
      and e.render_spec_version=4 and e.caption_render_spec_version=4 for share of l,e;
  if not found or r.status not in ('canary_ready','canary_active','approved') or r.staging_verified_at is null then
    raise exception 'SNS_TEMPLATE_UNAVAILABLE';
  end if;
  t:=r.registry->'lanes'->p_job.batch_target_key->'current';
  if t is null or p_job.initial_editor_release_id is distinct from r.id
    or p_job.batch_target_release_id is distinct from t->>'releaseId'
    or p_job.batch_job_definition is distinct from t->>'jobDefinitionArn'
    or p_job.batch_job_queue is distinct from t->>'jobQueueArn'
    or r.git_sha is distinct from t->>'workerSourceGitSha'
    or r.worker_image_digest is distinct from split_part(t->>'imageUri','@',2)
    or r.font_manifest_sha256 is distinct from t->>'fontManifestSha256'
    or coalesce(t->>'releaseId','') !~ '^sns-template-'
    or coalesce(t->>'jobDefinitionArn','') !~ '^arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-language-test-sns-'
    or coalesce(t->>'jobQueueArn','') !~ '^arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-language-test-'
  then raise exception 'SNS_TEMPLATE_TARGET_MISMATCH'; end if;
end; $$;
revoke all on function shorts_mvp.assert_sns_template_job(shorts_mvp.video_jobs) from public,anon,authenticated;
grant execute on function shorts_mvp.assert_sns_template_job(shorts_mvp.video_jobs) to service_role;

commit;
