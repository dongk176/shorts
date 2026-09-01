begin;

-- Keep the promoted stable project path available while an administrator
-- verifies a successor registry.  The predecessor web still submits the old
-- exact targets; only an administrator admitted by the successor proof may
-- submit the new targets during admin_ready.
create or replace function shorts_mvp.enforce_project_target_successor_admission()
returns trigger language plpgsql security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_state shorts_mvp.editor_release_state%rowtype;
  v_operation jsonb; v_registry jsonb; v_target jsonb; v_admin_release uuid;
  v_expected_release uuid; v_runtime_enabled boolean; v_rollout_bucket smallint;
begin
  if new.source_type='upload' or new.pipeline_version<>2 then return new; end if;
  select * into v_state from shorts_mvp.editor_release_state where singleton for share;
  v_operation:=v_state.render_v4_target_successor;
  if v_operation is null then return new; end if;
  if v_operation->'version' is distinct from '1'::jsonb then
    raise exception 'INITIAL_RENDER_RELEASE_HANDOFF' using errcode='P0001';
  end if;

  if v_operation->>'phase'='admin_ready' then
    v_admin_release:=shorts_mvp.editor_target_successor_admin_release(new.user_id);
    if v_admin_release is not null then
      v_registry:=v_operation->'newRegistry';
      v_expected_release:=v_admin_release;
      if new.initial_editor_release_id is distinct from v_admin_release
        or new.initial_render_spec_version is distinct from 4
        or new.initial_caption_render_spec_version is distinct from 4 then
        raise exception 'INITIAL_RENDER_RELEASE_HANDOFF' using errcode='P0001';
      end if;
    else
      v_registry:=v_operation->'oldRegistry';
      v_expected_release:=(v_operation->>'predecessorReleaseId')::uuid;
    end if;
  elsif v_operation->>'phase'='active' then
    v_registry:=v_operation->'activeRegistry';
    v_expected_release:=(v_operation->>'activeReleaseId')::uuid;
  else
    raise exception 'INITIAL_RENDER_RELEASE_HANDOFF' using errcode='P0001';
  end if;

  v_target:=v_registry->'lanes'->new.batch_target_key->'current';
  if v_target is null
    or new.batch_target_release_id is distinct from v_target->>'releaseId'
    or new.batch_job_definition is distinct from v_target->>'jobDefinitionArn'
    or new.batch_job_queue is distinct from v_target->>'jobQueueArn'
    or (new.initial_editor_release_id is not null
      and new.initial_editor_release_id is distinct from v_expected_release)
  then raise exception 'INITIAL_RENDER_RELEASE_HANDOFF' using errcode='P0001'; end if;

  -- Preserve the existing stable rollout contract for ordinary users during
  -- admin_ready as well as after activation.  Users outside the public v4
  -- rollout may still use the deliberate legacy/null binding, but a selected
  -- user must carry the exact stable/active v4 release.
  if v_operation->>'phase'='active'
    or (v_operation->>'phase'='admin_ready' and v_admin_release is null) then
    select enabled into v_runtime_enabled from shorts_mvp.runtime_feature_flags
      where flag_key='editor_rendering_v2' for share;
    v_rollout_bucket:=(('x'||substr(md5(new.user_id::text||':editor-render-v4'),1,8))
      ::bit(32)::bigint%100)::smallint;
    if coalesce(v_runtime_enabled,false) and not v_state.render_v4_kill_switch
      and v_state.public_enabled and v_state.render_v4_rollout_percent>v_rollout_bucket
      and (v_state.stable_release_id is distinct from v_expected_release
        or new.initial_editor_release_id is distinct from v_expected_release
        or new.initial_render_spec_version is distinct from 4
        or new.initial_caption_render_spec_version is distinct from 4
        or (v_state.render_v4_infra_lease_id is not null
          and v_state.render_v4_infra_lease_expires_at>clock_timestamp())) then
      raise exception 'INITIAL_RENDER_RELEASE_HANDOFF' using errcode='P0001';
    end if;
  end if;
  return new;
end;
$$;

create or replace function shorts_mvp.resolve_initial_render_v4_release(
  p_user_id uuid,
  p_batch_target_key text,
  p_batch_target_release_id text,
  p_job_definition_arn text,
  p_job_queue_arn text,
  p_worker_image_digest text,
  p_worker_source_git_sha text
)
returns table (
  release_id uuid,
  release_channel text,
  render_spec_version smallint,
  caption_render_spec_version smallint,
  font_manifest_sha256 text,
  release_worker_image_digest text,
  editor_production_job_definition_arn text
)
language plpgsql
volatile
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_state shorts_mvp.editor_release_state%rowtype;
  v_operation jsonb;
  v_target jsonb;
  v_admin_release uuid;
begin
  select * into v_state from shorts_mvp.editor_release_state where singleton for share;
  v_operation:=v_state.render_v4_target_successor;
  if v_operation is not null then
    if v_operation->'version' is distinct from '1'::jsonb then return; end if;
    if v_operation->>'phase'='admin_ready' then
      v_admin_release:=shorts_mvp.editor_target_successor_admin_release(p_user_id);
      if v_admin_release is not null then
        return query select release.id,'canary'::text,release.render_spec_version,
          release.caption_render_spec_version,release.font_manifest_sha256,
          release.worker_image_digest,release.production_job_definition_arn
        from shorts_mvp.editor_releases release
        join shorts_mvp.editor_release_project_targets target on target.release_id=release.id
        where release.id=v_admin_release and target.target_key=p_batch_target_key
          and target.batch_target_release_id=p_batch_target_release_id
          and target.job_definition_arn=p_job_definition_arn
          and target.job_queue_arn=p_job_queue_arn
          and target.worker_image_digest=p_worker_image_digest
          and target.worker_source_git_sha=p_worker_source_git_sha;
        return;
      end if;
      v_target:=v_operation->'oldRegistry'->'lanes'->p_batch_target_key->'current';
      if v_target is null or v_target->>'releaseId' is distinct from p_batch_target_release_id
        or v_target->>'jobDefinitionArn' is distinct from p_job_definition_arn
        or v_target->>'jobQueueArn' is distinct from p_job_queue_arn
        or v_target->>'workerSourceGitSha' is distinct from p_worker_source_git_sha
        or split_part(v_target->>'imageUri','@',2) is distinct from p_worker_image_digest
      then return; end if;
      -- Continue through the normal stable rollout resolver below.  This keeps
      -- the pre-existing percentage/kill/runtime behavior intact.
    elsif v_operation->>'phase'='active' then
      v_target:=v_operation->'activeRegistry'->'lanes'->p_batch_target_key->'current';
      if v_target is null or v_target->>'releaseId' is distinct from p_batch_target_release_id
        or v_target->>'jobDefinitionArn' is distinct from p_job_definition_arn
        or v_target->>'jobQueueArn' is distinct from p_job_queue_arn
        or v_target->>'workerSourceGitSha' is distinct from p_worker_source_git_sha
        or split_part(v_target->>'imageUri','@',2) is distinct from p_worker_image_digest
      then return; end if;
    else return;
    end if;
  end if;

  perform 1
  from shorts_mvp.editor_release_state state
  join shorts_mvp.runtime_feature_flags runtime
    on runtime.flag_key='editor_rendering_v2'
  where state.singleton
    and runtime.enabled
    and not state.render_v4_kill_switch
    and not (
      state.render_v4_infra_lease_id is not null
      and state.render_v4_infra_lease_expires_at > clock_timestamp()
    )
  for share of state,runtime;

  if not found then return; end if;

  return query
  with release_state as (
    select state.*,
      ((('x'||substr(md5(p_user_id::text||':editor-render-v4'),1,8))
        ::bit(32)::bigint%100))::smallint as rollout_bucket
    from shorts_mvp.editor_release_state state
    where state.singleton
      and not state.render_v4_kill_switch
      and not (state.render_v4_infra_lease_id is not null
        and state.render_v4_infra_lease_expires_at>clock_timestamp())
  ), eligible as (
    select candidate.id as release_id,'canary'::text as release_channel,
      candidate.render_spec_version,candidate.caption_render_spec_version,
      candidate.font_manifest_sha256,
      candidate.worker_image_digest as release_worker_image_digest,
      candidate.production_job_definition_arn as editor_production_job_definition_arn,
      0 as priority
    from release_state state
    join shorts_mvp.editor_release_testers tester
      on tester.user_id=p_user_id and tester.enabled
    join shorts_mvp.editor_releases candidate on candidate.id=state.candidate_release_id
    join shorts_mvp.editor_release_project_targets project_target
      on project_target.release_id=candidate.id
      and project_target.target_key=p_batch_target_key
      and project_target.batch_target_release_id=p_batch_target_release_id
      and project_target.job_definition_arn=p_job_definition_arn
      and project_target.job_queue_arn=p_job_queue_arn
      and project_target.worker_image_digest=p_worker_image_digest
      and project_target.worker_source_git_sha=p_worker_source_git_sha
    where state.canary_enabled and state.render_v4_internal_enabled
      and candidate.render_spec_version=4 and candidate.caption_render_spec_version=4
      and candidate.font_manifest_sha256 is not null
      and candidate.status in ('canary_ready','canary_active','approved')
      and candidate.staging_verified_at is not null
      and candidate.worker_image_digest=project_target.worker_image_digest
      and candidate.git_sha=project_target.worker_source_git_sha

    union all

    select stable.id as release_id,'stable'::text as release_channel,
      stable.render_spec_version,stable.caption_render_spec_version,
      stable.font_manifest_sha256,
      stable.worker_image_digest as release_worker_image_digest,
      stable.production_job_definition_arn as editor_production_job_definition_arn,
      1 as priority
    from release_state state
    join shorts_mvp.editor_releases stable on stable.id=state.stable_release_id
    join shorts_mvp.editor_release_project_targets project_target
      on project_target.release_id=stable.id
      and project_target.target_key=p_batch_target_key
      and project_target.batch_target_release_id=p_batch_target_release_id
      and project_target.job_definition_arn=p_job_definition_arn
      and project_target.job_queue_arn=p_job_queue_arn
      and project_target.worker_image_digest=p_worker_image_digest
      and project_target.worker_source_git_sha=p_worker_source_git_sha
    where state.public_enabled
      and state.render_v4_rollout_percent>state.rollout_bucket
      and stable.status='stable' and stable.promoted_at is not null
      and stable.render_spec_version=4 and stable.caption_render_spec_version=4
      and stable.font_manifest_sha256 is not null
      and stable.worker_image_digest=project_target.worker_image_digest
      and stable.git_sha=project_target.worker_source_git_sha
  )
  select eligible.release_id,eligible.release_channel,
    eligible.render_spec_version,eligible.caption_render_spec_version,
    eligible.font_manifest_sha256,eligible.release_worker_image_digest,
    eligible.editor_production_job_definition_arn
  from eligible order by eligible.priority limit 1;
end;
$$;

revoke all on function shorts_mvp.enforce_project_target_successor_admission()
  from public,anon,authenticated,service_role;
revoke all on function shorts_mvp.resolve_initial_render_v4_release(uuid,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function shorts_mvp.resolve_initial_render_v4_release(uuid,text,text,text,text,text,text)
  to service_role;

comment on function shorts_mvp.resolve_initial_render_v4_release(uuid,text,text,text,text,text,text) is
  'Pins administrators to the exact successor target during admin_ready while ordinary users remain on the exact predecessor stable target.';

commit;
