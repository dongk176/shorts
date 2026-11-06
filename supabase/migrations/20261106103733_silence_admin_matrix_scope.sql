-- Administrator-only bounded QA; public admission and runtime targets remain unchanged.
set local lock_timeout='2s';
set local statement_timeout='30s';
create or replace function shorts_mvp.assert_silence_test_job(p_job shorts_mvp.video_jobs)
returns void language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
declare r record; t record; v_state shorts_mvp.editor_release_state%rowtype;
begin
  -- Locks only the private QA row; ordinary submissions do not acquire it.
  select q.*,e.status,e.git_sha,e.worker_image_digest,e.staging_verified_at,
    e.render_spec_version,e.caption_render_spec_version into r
    from shorts_mvp.silence_test_releases q join shorts_mvp.editor_releases e on e.id=q.id
    where q.id=p_job.silence_test_release_id for update of q;
  if not found or not r.enabled or r.verified_at is null or r.expires_at<=clock_timestamp()
    or r.admitted_jobs>=r.max_jobs or r.administrator_id is distinct from p_job.user_id
    or r.status not in ('canary_ready','canary_active','approved')
    or r.staging_verified_at is null or r.render_spec_version<>4 or r.caption_render_spec_version<>4
    or not exists(select 1 from shorts_mvp.app_users where id=p_job.user_id and is_admin)
  then raise exception 'SILENCE_TEST_UNAVAILABLE'; end if;
  select * into v_state from shorts_mvp.editor_release_state where singleton for share;
  if not found or v_state.render_v4_kill_switch
    or (v_state.render_v4_infra_lease_id is not null
      and v_state.render_v4_infra_lease_expires_at>clock_timestamp())
    or not exists(select 1 from shorts_mvp.runtime_feature_flags
      where flag_key='editor_rendering_v2' and enabled)
    or not exists(select 1 from shorts_mvp.runtime_feature_flags
      where flag_key='admin_shorts_silence' and enabled)
  then raise exception 'SILENCE_TEST_STOPPED'; end if;
  -- Upload is deliberately excluded until its isolated receiver is verified.
  if p_job.source_type is distinct from 'youtube' or p_job.pipeline_version is distinct from 2
    or p_job.is_example is distinct from false or p_job.output_language not in ('ko','en','ja')
    or p_job.output_language is null or p_job.midform_request is not null
    or p_job.language_test_release_id is not null
    or coalesce(p_job.source_language_hint,'auto') not in ('auto','ko','en','ja')
    or coalesce(p_job.template_snapshot->>'snsTemplateVersion','') not in ('','1')
    or coalesce(p_job.template_snapshot->>'communityTemplateVersion','') not in ('','1')
    or p_job.template_snapshot->'shortsSilenceRemoval' is distinct from '{"version":1,"preset":"aggressive"}'::jsonb
    or p_job.initial_editor_release_id is distinct from r.id
    or p_job.initial_render_spec_version is distinct from 4
    or p_job.initial_caption_render_spec_version is distinct from 4
  then raise exception 'SILENCE_TEST_BINDING_INVALID'; end if;
  -- Extended QA combinations require an explicit source/image-bound scope.
  -- This is permission to test, not evidence that the combination has passed.
  if p_job.output_language<>'ko' or p_job.custom_template_id is not null
    or p_job.source_language_hint is not null
    or p_job.template_snapshot->>'snsTemplateVersion'='1'
    or p_job.template_snapshot->>'communityTemplateVersion'='1'
  then
    if r.verification#>>'{authorizedTestScope,version}' is distinct from '1'
      or r.verification#>>'{authorizedTestScope,sourceGitSha}' is distinct from r.git_sha
      or r.verification#>>'{authorizedTestScope,workerImageDigest}' is distinct from r.worker_image_digest
      or not coalesce((r.verification#>'{authorizedTestScope,outputLanguages}') ? p_job.output_language,false)
      or not coalesce((r.verification#>'{authorizedTestScope,templateKinds}') ? (
        case when p_job.template_snapshot->>'communityTemplateVersion'='1' then 'community'
          when p_job.template_snapshot->>'snsTemplateVersion'='1' then 'sns'
          when p_job.custom_template_id is not null then 'custom' else 'standard' end),false)
      or (p_job.template_snapshot->>'communityTemplateVersion'='1'
        and p_job.template_snapshot->>'snsTemplateVersion' is distinct from '1')
    then raise exception 'SILENCE_TEST_SCOPE_INVALID'; end if;
  end if;
  select * into t from shorts_mvp.editor_release_project_targets
    where release_id=r.id and target_key=p_job.batch_target_key;
  if not found or p_job.batch_target_release_id is distinct from t.batch_target_release_id
    or p_job.batch_job_definition is distinct from t.job_definition_arn
    or p_job.batch_job_queue is distinct from r.job_queue_arn
    or t.worker_source_git_sha is distinct from r.git_sha
    or t.worker_image_digest is distinct from r.worker_image_digest
  then raise exception 'SILENCE_TEST_TARGET_INVALID'; end if;
  update shorts_mvp.silence_test_releases set admitted_jobs=admitted_jobs+1 where id=r.id;
end; $$;

create or replace function shorts_mvp.enforce_silence_test_identity() returns trigger
language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
begin
  if new.silence_test_release_id is distinct from old.silence_test_release_id
    or (old.silence_test_release_id is not null and (
      row(new.user_id,new.source_type,new.pipeline_version,new.is_example,new.output_language,
        new.source_language_hint,new.custom_template_id,new.template_snapshot,new.language_test_release_id,new.midform_request,
        new.initial_editor_release_id,new.initial_render_spec_version,new.initial_caption_render_spec_version,
        new.batch_target_key,new.batch_target_release_id,new.batch_job_definition,new.batch_job_queue)
      is distinct from
      row(old.user_id,old.source_type,old.pipeline_version,old.is_example,old.output_language,
        old.source_language_hint,old.custom_template_id,old.template_snapshot,old.language_test_release_id,old.midform_request,
        old.initial_editor_release_id,old.initial_render_spec_version,old.initial_caption_render_spec_version,
        old.batch_target_key,old.batch_target_release_id,old.batch_job_definition,old.batch_job_queue)))
  then raise exception 'SILENCE_TEST_IDENTITY_IMMUTABLE'; end if;
  return new;
end; $$;
