begin;

-- Public beta keeps owner, plan, source/image/font and immutable release checks.
create or replace function shorts_mvp.assert_sns_template_job(p_job shorts_mvp.video_jobs)
returns void language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare r record; t jsonb;
begin
  if p_job.template_snapshot->>'snsTemplateVersion' is distinct from '1'
    or p_job.template_id is distinct from 'white-yellow'
    or p_job.subtitle_template_id is not null then
    raise exception 'SNS_TEMPLATE_CONTEXT_MISMATCH';
  end if;
  perform id from shorts_mvp.app_users where id=p_job.user_id
    and (is_admin or p_job.language_test_release_id='8dc98fc0-a5bb-411f-9cc6-0e8dc28648ca'::uuid) for share;
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

create or replace function shorts_mvp.assert_sns_editor_request(p_request shorts_mvp.editor_render_requests)
returns void language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
begin
  if (p_request.release_id is null or p_request.release_id not in ('406dadcf-f290-4eb8-b82e-a6e8c6b40105'::uuid,'77d3b2de-12a4-4b7d-a134-87170b1d3ecf'::uuid))
    or p_request.release_channel is distinct from 'canary'
    or not exists (
      select 1 from shorts_mvp.generated_shorts s
      join shorts_mvp.video_jobs j on j.id=s.job_id
      join shorts_mvp.app_users u on u.id=j.user_id and (u.is_admin or p_request.release_id='77d3b2de-12a4-4b7d-a134-87170b1d3ecf'::uuid)
      join shorts_mvp.language_test_releases generation on generation.id=j.language_test_release_id
        and generation.verified_at is not null
      join shorts_mvp.editor_releases e on e.id=p_request.release_id
      join shorts_mvp.editor_release_checks c on c.release_id=e.id
        and c.environment='isolated' and c.check_name='sns_editor_compatibility'
        and c.status='passed' and c.completed_at is not null
      where s.id=p_request.short_id and s.user_id=p_request.user_id and j.user_id=p_request.user_id
        and s.deleted_at is null and j.user_deleted_at is null and s.expires_at>clock_timestamp()
        and s.render_version=p_request.base_render_version
        and s.template_snapshot->>'snsTemplateVersion'='1'
        and j.template_snapshot->>'snsTemplateVersion'='1'
        and j.initial_editor_release_id=j.language_test_release_id
        and j.language_test_release_id in (
          '8dc98fc0-a5bb-411f-9cc6-0e8dc28648ca'::uuid,
          '8af2c7e6-5421-4e93-9671-b0e8bb41de8a'::uuid)
        and e.staging_verified_at is not null and e.status in ('canary_ready','canary_active','approved')
        and e.ui_version=3 and e.document_version=3
        and e.render_spec_version=4 and e.caption_render_spec_version=4
        and c.details->>'sourceGitSha'=e.git_sha
        and c.details->>'imageDigest'=e.worker_image_digest
        and c.details->>'fontManifestSha256'=e.font_manifest_sha256
        and c.details->'generationReleaseIds' ? j.language_test_release_id::text
    ) then raise exception 'SNS_EDITOR_BINDING_MISMATCH';
  end if;
end; $$;
revoke all on function shorts_mvp.assert_sns_editor_request(shorts_mvp.editor_render_requests)
  from public,anon,authenticated;
grant execute on function shorts_mvp.assert_sns_editor_request(shorts_mvp.editor_render_requests) to service_role;

do $$ declare body text; old_guard text := 'if new.release_id=''406dadcf-f290-4eb8-b82e-a6e8c6b40105''::uuid then'; begin
  body := pg_get_functiondef('shorts_mvp.enforce_language_test_editor_binding()'::regprocedure);
  if position(old_guard in body)=0 then raise exception 'SNS_PUBLIC_EDITOR_GUARD_BASELINE_CHANGED'; end if;
  body := replace(body,old_guard,'if new.release_id in (''406dadcf-f290-4eb8-b82e-a6e8c6b40105''::uuid,''77d3b2de-12a4-4b7d-a134-87170b1d3ecf''::uuid) then');
  execute body;
end $$;

commit;
