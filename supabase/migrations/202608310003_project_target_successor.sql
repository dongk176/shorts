begin;

set local lock_timeout = '3s';
set local statement_timeout = '2min';

-- One durable admission pin, not another feature flag or expiring lease.
-- A completed handoff keeps its active pin so an old web cannot submit an old
-- target after the two-hour infrastructure lease expires.
alter table shorts_mvp.editor_release_state
  add column if not exists render_v4_target_successor jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint
    where conrelid='shorts_mvp.editor_release_state'::regclass
      and conname='editor_release_state_target_successor_check') then
    alter table shorts_mvp.editor_release_state
      add constraint editor_release_state_target_successor_check check (
        render_v4_target_successor is null or (
          jsonb_typeof(render_v4_target_successor)='object'
          and render_v4_target_successor->'version' is not distinct from '1'::jsonb
          and coalesce(render_v4_target_successor->>'phase','') in ('fenced','admin_ready','active')
        )
      );
  end if;
end;
$$;

create or replace function shorts_mvp._project_target_successor_contract(
  p_previous uuid,p_successor uuid,p_allow_promoted boolean default false
)
returns jsonb
language plpgsql security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_state shorts_mvp.editor_release_state%rowtype;
  v_old shorts_mvp.editor_releases%rowtype;
  v_new shorts_mvp.editor_releases%rowtype;
  v_proof jsonb;
  v_names text[];
  v_targets jsonb;
  v_key text;
  v_record jsonb;
  v_expected constant text[] := array[
    'browser-parity-worker-matrix','browser-worker-visual-parity',
    'caption-render-spec-v4','captured-timeline','editor-v2','ffprobe',
    'font-fallback','font-manifest','frame-parity','legacy-no-timeline',
    'render-spec-v4','runtime-identity','worker-caption-noop-parity',
    'worker-image','worker-title-compositor-parity'
  ];
begin
  select * into strict v_state from shorts_mvp.editor_release_state
    where singleton for share;
  select * into strict v_old from shorts_mvp.editor_releases
    where id=p_previous for share;
  select * into strict v_new from shorts_mvp.editor_releases
    where id=p_successor for share;
  if p_previous=p_successor or p_previous is null or p_successor is null
    or not (v_state.stable_release_id=p_previous
      or (p_allow_promoted and v_state.stable_release_id=p_successor))
    or (v_state.stable_release_id=p_previous
      and v_state.candidate_release_id is distinct from p_successor)
    or v_old.status<>'stable' or v_old.promoted_at is null
    or v_new.status not in ('canary_ready','canary_active','approved','stable')
    or v_new.staging_verified_at is null
    or (v_new.status='stable' and v_new.promoted_at is null)
    or v_old.render_spec_version is distinct from 4
    or v_old.caption_render_spec_version is distinct from 4
    or v_new.render_spec_version is distinct from 4
    or v_new.caption_render_spec_version is distinct from 4
    or v_old.font_manifest_sha256 is distinct from v_new.font_manifest_sha256
    or coalesce(v_new.font_manifest_sha256,'') !~ '^[0-9a-f]{64}$'
  then
    raise exception 'project successor release baseline differs' using errcode='40001';
  end if;
  perform 1 from shorts_mvp.editor_release_checks
    where release_id=p_successor and environment='isolated'
    order by check_name for share;
  select array_agg(check_name order by check_name) into v_names
    from shorts_mvp.editor_release_checks
    where release_id=p_successor and environment='isolated' and status='passed';
  if v_names is distinct from v_expected
    or (select count(*) from shorts_mvp.editor_release_checks
      where release_id=p_successor and environment='isolated')<>15 then
    raise exception 'project successor requires exactly fifteen passed checks' using errcode='23514';
  end if;
  select jsonb_build_object(
    'probeRunId',probe.id,'artifactUri',probe.artifact_uri,
    'manifestSha256',probe.manifest_sha256,'manifestS3VersionId',probe.manifest_s3_version_id,
    'matrixSha256',probe.matrix_sha256,'matrixS3VersionId',probe.matrix_s3_version_id,
    'compatibleSuccessor',checked.details->'compatibleSuccessor',
    'sourceGitSha',v_new.git_sha,'workerImageDigest',v_new.worker_image_digest,
    'fontManifestSha256',v_new.font_manifest_sha256,
    'editorJobDefinitionArn',v_new.production_job_definition_arn
  ) into v_proof
  from shorts_mvp.editor_release_probe_runs probe
  join shorts_mvp.editor_release_checks checked
    on checked.release_id=p_successor and checked.environment='isolated'
    and checked.check_name='render-spec-v4' and checked.status='passed'
  where probe.finalized_release_id=p_successor and probe.state='finalized'
    and probe.git_sha=v_new.git_sha and probe.worker_image_digest=v_new.worker_image_digest
    and probe.font_manifest_sha256=v_new.font_manifest_sha256
    and checked.details->>'probeRunId'=probe.id::text
    and checked.artifact_uri=probe.artifact_uri and probe.artifact_uri ~ '^s3://'
    and probe.manifest_sha256 ~ '^[0-9a-f]{64}$'
    and probe.matrix_sha256 ~ '^[0-9a-f]{64}$'
    and coalesce(probe.manifest_s3_version_id,'') not in ('','null')
    and coalesce(probe.matrix_s3_version_id,'') not in ('','null')
    and checked.details->'customTemplateDesign'->'version'='1'::jsonb
    and checked.details->'customTemplateDesign'->'passed'='true'::jsonb
    and checked.details->'customTemplateDesign'->>'wrapRevision'='editor-text-v1'
    and checked.details->'customTemplateDesign'->'renderSpecVersion'='4'::jsonb
    and checked.details->'customTemplateDesign'->'captionRenderSpecVersion'='4'::jsonb
    and checked.details->'customTemplateDesign'->>'sourceGitSha'=v_new.git_sha
    and checked.details->'customTemplateDesign'->>'workerImageDigest'=v_new.worker_image_digest
    and checked.details->'customTemplateDesign'->>'fontManifestSha256'=v_new.font_manifest_sha256
  for share of probe,checked;
  if v_proof is null or (select count(*) from shorts_mvp.editor_release_probe_runs
    where finalized_release_id=p_successor and state='finalized')<>1 then
    raise exception 'project successor finalized design evidence is incomplete' using errcode='23514';
  end if;
  v_record:=v_proof->'compatibleSuccessor';
  if v_record->'version' is distinct from '1'::jsonb
    or v_record->>'predecessorReleaseId' is distinct from p_previous::text
    or v_record->>'sourceGitSha' is distinct from v_old.git_sha
    or v_record->>'workerImageDigest' is distinct from v_old.worker_image_digest
    or v_record->>'fontManifestSha256' is distinct from v_old.font_manifest_sha256
    or v_record->'editor'->>'jobDefinitionArn' is distinct from v_old.production_job_definition_arn
    or coalesce(v_record->'editor'->>'contractSha256','') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(v_record->'projectTargets') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(v_record->'projectTargets'))<>5 then
    raise exception 'project successor recorded predecessor differs' using errcode='23514';
  end if;
  perform 1 from shorts_mvp.editor_release_project_targets
    where release_id in (p_previous,p_successor) order by release_id,target_key for share;
  for v_key,v_targets in select release_id::text,jsonb_object_agg(target_key,jsonb_build_object(
    'batchTargetReleaseId',batch_target_release_id,'workerSourceGitSha',worker_source_git_sha,
    'workerImageDigest',worker_image_digest,'jobDefinitionArn',job_definition_arn,
    'jobQueueArn',job_queue_arn))
    from shorts_mvp.editor_release_project_targets
    where release_id in (p_previous,p_successor) group by release_id
  loop
    if (select array_agg(key order by key) from jsonb_object_keys(v_targets) as keys(key))
      is distinct from array['elevenlabs_transcription','legacy_project','source_range',
        'subtitle_templates','unified_template_subtitles'] then
      raise exception 'project successor five targets are incomplete' using errcode='23514';
    end if;
    v_proof:=v_proof||jsonb_build_object(
      case when v_key=p_previous::text then 'oldTargets' else 'newTargets' end,v_targets);
  end loop;
  if v_proof->'oldTargets' is null or v_proof->'newTargets' is null then
    raise exception 'project successor five targets are missing' using errcode='23514';
  end if;
  for v_key,v_targets in select * from jsonb_each(v_proof->'oldTargets') loop
    if (v_record->'projectTargets'->v_key)-'contractSha256' is distinct from v_targets
      or coalesce(v_record->'projectTargets'->v_key->>'contractSha256','') !~ '^[0-9a-f]{64}$'
      or v_targets->>'workerSourceGitSha' is distinct from v_old.git_sha
      or v_targets->>'workerImageDigest' is distinct from v_old.worker_image_digest
      or v_proof->'newTargets'->v_key->>'workerSourceGitSha' is distinct from v_new.git_sha
      or v_proof->'newTargets'->v_key->>'workerImageDigest' is distinct from v_new.worker_image_digest
      or v_proof->'newTargets'->v_key->>'jobQueueArn' is distinct from v_targets->>'jobQueueArn'
    then
      raise exception 'project successor exact target identity differs' using errcode='23514';
    end if;
  end loop;
  return v_proof;
end;
$$;

create or replace function shorts_mvp._project_target_successor_flags()
returns jsonb language sql security definer
set search_path=shorts_mvp,pg_temp
as $$
  select jsonb_build_object('publicEnabled',state.public_enabled,
    'internalEnabled',state.render_v4_internal_enabled,'rolloutPercent',state.render_v4_rollout_percent,
    'killSwitch',state.render_v4_kill_switch,'runtimeEnabled',runtime.enabled)
  from shorts_mvp.editor_release_state state
  join shorts_mvp.runtime_feature_flags runtime on runtime.flag_key='editor_rendering_v2'
  where state.singleton;
$$;

create or replace function shorts_mvp._assert_project_successor_registry(
  p_registry jsonb,p_targets jsonb,p_font text
)
returns void language plpgsql security definer
set search_path=shorts_mvp,pg_temp
as $$
declare v_key text; v_row jsonb; v_actual jsonb;
begin
  if p_registry->'version' is distinct from '1'::jsonb
    or p_registry->>'environment' is distinct from 'production'
    or jsonb_typeof(p_registry->'lanes') is distinct from 'object'
    or (select array_agg(key order by key) from jsonb_object_keys(p_registry->'lanes') as keys(key))
      is distinct from (select array_agg(key order by key) from jsonb_object_keys(p_targets) as keys(key))
  then raise exception 'project successor registry contract differs' using errcode='23514'; end if;
  for v_key,v_row in select * from jsonb_each(p_targets) loop
    v_actual:=p_registry->'lanes'->v_key->'current';
    if v_actual->>'releaseId' is distinct from v_row->>'batchTargetReleaseId'
      or v_actual->>'workerSourceGitSha' is distinct from v_row->>'workerSourceGitSha'
      or v_actual->>'jobDefinitionArn' is distinct from v_row->>'jobDefinitionArn'
      or v_actual->>'jobQueueArn' is distinct from v_row->>'jobQueueArn'
      or split_part(v_actual->>'imageUri','@',2) is distinct from v_row->>'workerImageDigest'
      or v_actual->'renderSpecVersion' is distinct from '4'::jsonb
      or v_actual->'captionRenderSpecVersion' is distinct from '4'::jsonb
      or v_actual->>'fontManifestSha256' is distinct from p_font
    then raise exception 'project successor registry target differs' using errcode='23514'; end if;
  end loop;
end;
$$;

create or replace function shorts_mvp.project_target_successor_drain()
returns jsonb language sql security definer
set search_path=shorts_mvp,pg_temp
as $$
  with operation as (
    select render_v4_target_successor as value from shorts_mvp.editor_release_state where singleton
  ), active_jobs as (
    select job.* from shorts_mvp.video_jobs job
    where job.pipeline_version=2 and job.source_type is distinct from 'upload'
      and job.status not in ('completed','failed','expired','deleted')
  ) select jsonb_build_object(
    'unsubmittedJobs',(select count(*) from active_jobs where nullif(aws_batch_job_id,'') is null),
    'pendingOutbox',(select count(*) from shorts_mvp.project_job_outbox outbox
      join active_jobs job on job.id=outbox.job_id where outbox.status='pending'),
    'unsubmittedClaims',(select count(*) from shorts_mvp.batch_submission_claims claim
      where claim.submission_key like 'project:%' and (
        nullif(claim.aws_batch_job_id,'') is null
        or exists(select 1 from active_jobs job
          where claim.submission_key='project:'||job.id::text||case
            when job.project_resume_count=1 then ':resume:1' else ':0' end
            and claim.aws_batch_job_id is distinct from job.aws_batch_job_id))),
    'olderGenerationJobs',(select count(*) from active_jobs job,operation
      where not exists (select 1 from jsonb_each(operation.value->'oldRegistry'->'lanes') lane
        where job.batch_job_definition=lane.value->'current'->>'jobDefinitionArn'
          and job.batch_job_queue=lane.value->'current'->>'jobQueueArn'
          and (job.batch_target_key is null or (job.batch_target_key=lane.key
            and job.batch_target_release_id=lane.value->'current'->>'releaseId'))))
  );
$$;

create or replace function shorts_mvp.begin_project_target_successor(
  p_previous uuid,p_successor uuid,p_binding jsonb,p_admin uuid
)
returns jsonb language plpgsql security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_state shorts_mvp.editor_release_state%rowtype;
  v_proof jsonb; v_flags jsonb; v_operation jsonb; v_key text; v_lane jsonb;
begin
  perform 1 from shorts_mvp.app_users where id=p_admin and is_admin and withdrawn_at is null for share;
  if not found then raise exception 'administrator required' using errcode='42501'; end if;
  select * into strict v_state from shorts_mvp.editor_release_state where singleton for update;
  v_proof:=shorts_mvp._project_target_successor_contract(p_previous,p_successor);
  perform 1 from shorts_mvp.runtime_feature_flags where flag_key='editor_rendering_v2' for share;
  v_flags:=shorts_mvp._project_target_successor_flags();
  if v_flags->'publicEnabled' is distinct from 'true'::jsonb
    or v_flags->'runtimeEnabled' is distinct from 'true'::jsonb
    or v_flags->'killSwitch' is distinct from 'false'::jsonb
    or coalesce((v_flags->>'rolloutPercent')::integer,0)<=0
    or jsonb_typeof(p_binding) is distinct from 'object'
    or coalesce(p_binding->>'head','') !~ '^[0-9a-f]{40}$'
    or coalesce(p_binding->>'base','') !~ '^[0-9a-f]{40}$'
    or coalesce(p_binding->>'oldRegistrySha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_binding->>'newRegistrySha256','') !~ '^[0-9a-f]{64}$'
  then raise exception 'project successor binding or public state differs' using errcode='23514'; end if;
  perform shorts_mvp._assert_project_successor_registry(
    p_binding->'oldRegistry',v_proof->'oldTargets',v_proof->>'fontManifestSha256');
  perform shorts_mvp._assert_project_successor_registry(
    p_binding->'newRegistry',v_proof->'newTargets',v_proof->>'fontManifestSha256');
  for v_key,v_lane in select * from jsonb_each(p_binding->'oldRegistry'->'lanes') loop
    if (p_binding->'newRegistry'->'lanes'->v_key->'previous')-'submitAsReleaseId'
        is distinct from v_lane->'current'
      or coalesce(p_binding->'newRegistry'->'lanes'->v_key->'previous'->>'submitAsReleaseId',
        v_lane->'current'->>'releaseId') is distinct from v_lane->'current'->>'releaseId'
      or p_binding->'newRegistry'->'lanes'->v_key->'schedulingMode'
        is distinct from v_lane->'schedulingMode'
      or split_part(p_binding->'newRegistry'->'lanes'->v_key->'current'->>'imageUri','@',1)
        is distinct from split_part(v_lane->'current'->>'imageUri','@',1)
    then raise exception 'project successor must preserve the exact previous target' using errcode='23514'; end if;
  end loop;
  foreach v_key in array array['editorTemplateSha256','computeTemplateSha256',
    'registrarCodeSha256','submitterCodeSha256','inventorySha256'] loop
    if coalesce(p_binding->'oldRuntime'->>v_key,'') !~ '^[0-9a-f]{64}$' then
      raise exception 'project successor predecessor runtime observation is missing' using errcode='23514';
    end if;
  end loop;
  v_operation:=v_state.render_v4_target_successor;
  if v_operation is not null and v_operation->>'phase'<>'active' then
    if v_operation->>'predecessorReleaseId'=p_previous::text
      and v_operation->>'successorReleaseId'=p_successor::text
      and v_operation->>'head'=p_binding->>'head'
      and v_operation->'oldRegistry'=p_binding->'oldRegistry'
      and v_operation->'newRegistry'=p_binding->'newRegistry'
      and v_operation->'flags'=v_flags and v_operation->'proof'=v_proof
    then return v_operation; end if;
    raise exception 'another durable project successor fence is active' using errcode='40001';
  end if;
  if v_operation is not null and (v_operation->>'activeReleaseId'<>p_previous::text
    or v_operation->'activeRegistry' is distinct from p_binding->'oldRegistry') then
    raise exception 'project successor active pin differs' using errcode='40001';
  end if;
  if v_state.render_v4_infra_lease_id is not null
    and v_state.render_v4_infra_lease_expires_at>clock_timestamp() then
    raise exception 'infrastructure lease is active' using errcode='40001';
  end if;
  v_operation:=jsonb_build_object('version',1,'id',gen_random_uuid(),'phase','fenced',
    'predecessorReleaseId',p_previous,'successorReleaseId',p_successor,
    'base',p_binding->'base','head',p_binding->'head',
    'oldRegistry',p_binding->'oldRegistry','newRegistry',p_binding->'newRegistry',
    'oldRegistrySha256',p_binding->'oldRegistrySha256',
    'newRegistrySha256',p_binding->'newRegistrySha256',
    'oldRuntime',p_binding->'oldRuntime',
    'flags',v_flags,'proof',v_proof,'begunAt',clock_timestamp(),'begunBy',p_admin);
  update shorts_mvp.editor_release_state set render_v4_target_successor=v_operation where singleton;
  insert into shorts_mvp.admin_audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(p_admin,'editor_release.project_successor_fenced','editor_release',p_successor::text,v_operation);
  return v_operation;
end;
$$;

create or replace function shorts_mvp.transition_project_target_successor(
  p_operation uuid,p_action text,p_runtime jsonb,p_admin uuid
)
returns jsonb language plpgsql security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_state shorts_mvp.editor_release_state%rowtype;
  v_operation jsonb; v_proof jsonb; v_registry jsonb; v_release uuid;
  v_observed timestamptz; v_key text;
begin
  perform 1 from shorts_mvp.app_users where id=p_admin and is_admin and withdrawn_at is null for share;
  if not found then raise exception 'administrator required' using errcode='42501'; end if;
  select * into strict v_state from shorts_mvp.editor_release_state where singleton for update;
  v_operation:=v_state.render_v4_target_successor;
  if v_operation->>'id' is distinct from p_operation::text
    or v_operation->>'phase' not in ('fenced','admin_ready')
    or coalesce(p_action,'') not in ('ready','complete','cancel','fence') then
    raise exception 'project successor transition compare-and-swap failed' using errcode='40001';
  end if;
  -- Closing admission is always safe, including after an emergency stop.
  -- Reopening still requires fresh actual runtime evidence below.
  if p_action='fence' then
    v_operation:=v_operation||jsonb_build_object('phase','fenced');
    update shorts_mvp.editor_release_state set render_v4_target_successor=v_operation where singleton;
    insert into shorts_mvp.admin_audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
      values(p_admin,'editor_release.project_successor_refenced','editor_release',
        v_operation->>'successorReleaseId',jsonb_build_object('operationId',p_operation));
    return v_operation;
  end if;
  if v_state.render_v4_infra_lease_id is not null
    and v_state.render_v4_infra_lease_expires_at>clock_timestamp() then
    raise exception 'infrastructure lease is active' using errcode='40001';
  end if;
  v_proof:=shorts_mvp._project_target_successor_contract(
    (v_operation->>'predecessorReleaseId')::uuid,(v_operation->>'successorReleaseId')::uuid,true);
  perform 1 from shorts_mvp.runtime_feature_flags where flag_key='editor_rendering_v2' for share;
  if v_proof is distinct from v_operation->'proof'
    or shorts_mvp._project_target_successor_flags() is distinct from v_operation->'flags' then
    raise exception 'project successor proof or public flags changed' using errcode='40001';
  end if;
  if exists(select 1 from jsonb_each(shorts_mvp.project_target_successor_drain()) item
    where item.value<>'0'::jsonb) then
    raise exception 'project successor submissions have not drained' using errcode='23514';
  end if;
  v_registry:=v_operation->(case when p_action='cancel' then 'oldRegistry' else 'newRegistry' end);
  v_release:=(v_operation->>(case when p_action='cancel'
    then 'predecessorReleaseId' else 'successorReleaseId' end))::uuid;
  begin v_observed:=(p_runtime->>'observedAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then v_observed:=null; end;
  if v_observed is null or not isfinite(v_observed)
    or v_observed<clock_timestamp()-interval '5 minutes' or v_observed>clock_timestamp()
    or p_runtime->>'registrySha256' is distinct from v_operation->>(case when p_action='cancel'
      then 'oldRegistrySha256' else 'newRegistrySha256' end)
    or p_runtime->'allTargetsMatch' is distinct from 'true'::jsonb then
    raise exception 'project successor live runtime observation is stale or incomplete' using errcode='23514';
  end if;
  foreach v_key in array array['editorTemplateSha256','computeTemplateSha256',
    'registrarCodeSha256','submitterCodeSha256','inventorySha256'] loop
    if coalesce(p_runtime->>v_key,'') !~ '^[0-9a-f]{64}$' then
      raise exception 'project successor live runtime hash is incomplete' using errcode='23514';
    end if;
    if p_action='cancel' and v_key<>'inventorySha256'
      and p_runtime->v_key is distinct from v_operation->'oldRuntime'->v_key then
      raise exception 'project successor predecessor runtime is not restored' using errcode='23514';
    end if;
  end loop;
  if p_action='ready' then
    if v_state.stable_release_id::text<>v_operation->>'predecessorReleaseId'
      or v_state.candidate_release_id is distinct from v_release then
      raise exception 'project successor candidate changed' using errcode='40001';
    end if;
    v_operation:=v_operation||jsonb_build_object('phase','admin_ready','runtime',p_runtime);
  else
    if v_state.stable_release_id is distinct from v_release then
      raise exception 'project successor stable promotion or restoration is not complete' using errcode='40001';
    end if;
    if p_action='complete' and v_operation->>'phase'<>'admin_ready' then
      raise exception 'project successor administrator verification has not started' using errcode='23514';
    end if;
    if p_action='cancel' and exists(select 1 from shorts_mvp.video_jobs
      where source_type is distinct from 'upload'
        and initial_editor_release_id=(v_operation->>'successorReleaseId')::uuid
        and status not in ('completed','failed','expired','deleted')) then
      raise exception 'project successor candidate jobs must finish before restoration' using errcode='23514';
    end if;
    if p_action='cancel' and p_runtime->'candidateActiveJobs' is distinct from '0'::jsonb then
      raise exception 'project successor AWS candidate jobs have not drained' using errcode='23514';
    end if;
    v_operation:=v_operation||jsonb_build_object('phase','active','activeRegistry',v_registry,
      'activeReleaseId',v_release,'runtime',p_runtime,'completedAt',clock_timestamp(),
      'outcome',p_action);
  end if;
  update shorts_mvp.editor_release_state set render_v4_target_successor=v_operation where singleton;
  insert into shorts_mvp.admin_audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(p_admin,'editor_release.project_successor_'||p_action,'editor_release',v_release::text,p_runtime);
  return v_operation;
end;
$$;

-- Shared by the initial-render resolver and the existing editor resolver.
-- Neither a tester row nor a caller-supplied administrator boolean is enough.
create or replace function shorts_mvp.editor_target_successor_admin_release(p_user_id uuid)
returns uuid language plpgsql security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_state shorts_mvp.editor_release_state%rowtype;
  v_operation jsonb; v_proof jsonb;
begin
  select * into v_state from shorts_mvp.editor_release_state where singleton for share;
  v_operation:=v_state.render_v4_target_successor;
  if v_operation->'version' is distinct from '1'::jsonb
    or v_operation->>'phase' is distinct from 'admin_ready'
    or not v_state.canary_enabled or v_state.render_v4_kill_switch
    or v_state.stable_release_id::text is distinct from v_operation->>'predecessorReleaseId'
    or v_state.candidate_release_id::text is distinct from v_operation->>'successorReleaseId'
    or (v_state.render_v4_infra_lease_id is not null
      and v_state.render_v4_infra_lease_expires_at>clock_timestamp())
    or v_operation->'runtime'->>'registrySha256' is distinct from v_operation->>'newRegistrySha256'
    or v_operation->'runtime'->'allTargetsMatch' is distinct from 'true'::jsonb
  then return null; end if;
  perform 1 from shorts_mvp.app_users
    where id=p_user_id and is_admin and withdrawn_at is null for share;
  if not found then return null; end if;
  perform 1 from shorts_mvp.runtime_feature_flags
    where flag_key='editor_rendering_v2' and enabled for share;
  if not found or shorts_mvp._project_target_successor_flags()
    is distinct from v_operation->'flags' then return null; end if;
  begin
    v_proof:=shorts_mvp._project_target_successor_contract(
      (v_operation->>'predecessorReleaseId')::uuid,(v_operation->>'successorReleaseId')::uuid);
  exception when check_violation or serialization_failure or no_data_found then return null;
  end;
  if v_proof is distinct from v_operation->'proof' then return null; end if;
  return (v_operation->>'successorReleaseId')::uuid;
end;
$$;

create or replace function shorts_mvp.enforce_project_target_successor_admission()
returns trigger language plpgsql security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_state shorts_mvp.editor_release_state%rowtype;
  v_operation jsonb; v_registry jsonb; v_target jsonb; v_admin_release uuid;
  v_runtime_enabled boolean; v_rollout_bucket smallint;
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
    if v_admin_release is null or new.initial_editor_release_id is distinct from v_admin_release
      or new.initial_render_spec_version is distinct from 4
      or new.initial_caption_render_spec_version is distinct from 4 then
      raise exception 'INITIAL_RENDER_RELEASE_HANDOFF' using errcode='P0001';
    end if;
    v_registry:=v_operation->'newRegistry';
  elsif v_operation->>'phase'='active' then
    v_registry:=v_operation->'activeRegistry';
  else
    raise exception 'INITIAL_RENDER_RELEASE_HANDOFF' using errcode='P0001';
  end if;
  v_target:=v_registry->'lanes'->new.batch_target_key->'current';
  if v_target is null
    or new.batch_target_release_id is distinct from v_target->>'releaseId'
    or new.batch_job_definition is distinct from v_target->>'jobDefinitionArn'
    or new.batch_job_queue is distinct from v_target->>'jobQueueArn'
    or (new.initial_editor_release_id is not null and new.initial_editor_release_id::text
      is distinct from case when v_operation->>'phase'='active'
        then v_operation->>'activeReleaseId' else v_operation->>'successorReleaseId' end)
  then raise exception 'INITIAL_RENDER_RELEASE_HANDOFF' using errcode='P0001'; end if;
  -- An old/misconfigured web can skip the resolver entirely. When the DB's
  -- existing public rollout requires v4, a matching target alone must not
  -- admit a legacy/null render binding. Intentional kill/runtime/public OFF
  -- and users outside the rollout bucket retain their existing legacy path.
  if v_operation->>'phase'='active' then
    select enabled into v_runtime_enabled from shorts_mvp.runtime_feature_flags
      where flag_key='editor_rendering_v2' for share;
    v_rollout_bucket:=(('x'||substr(md5(new.user_id::text||':editor-render-v4'),1,8))
      ::bit(32)::bigint%100)::smallint;
    if coalesce(v_runtime_enabled,false) and not v_state.render_v4_kill_switch
      and v_state.public_enabled and v_state.render_v4_rollout_percent>v_rollout_bucket
      and (v_state.stable_release_id::text is distinct from v_operation->>'activeReleaseId'
        or new.initial_editor_release_id::text is distinct from v_operation->>'activeReleaseId'
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

drop trigger if exists video_jobs_project_target_successor_admission on shorts_mvp.video_jobs;
create trigger video_jobs_project_target_successor_admission
before insert on shorts_mvp.video_jobs for each row
execute function shorts_mvp.enforce_project_target_successor_admission();

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
      if v_admin_release is null then return; end if;
      return query select release.id,'canary'::text,release.render_spec_version,
        release.caption_render_spec_version,release.font_manifest_sha256,
        release.worker_image_digest,release.production_job_definition_arn
      from shorts_mvp.editor_releases release
      join shorts_mvp.editor_release_project_targets target on target.release_id=release.id
      where release.id=v_admin_release and target.target_key=p_batch_target_key
        and target.batch_target_release_id=p_batch_target_release_id
        and target.job_definition_arn=p_job_definition_arn and target.job_queue_arn=p_job_queue_arn
        and target.worker_image_digest=p_worker_image_digest
        and target.worker_source_git_sha=p_worker_source_git_sha;
      return;
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
  -- Linearize a successful v4 admission with emergency stop, runtime stop,
  -- and infrastructure lease acquisition. These shared row locks live until
  -- the caller's job-creation transaction commits. The web calls this resolver
  -- immediately before INSERT so emergency stop is delayed only by the final
  -- atomic job/reservation writes, not by earlier validation work.
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

  if not found then
    return;
  end if;

  return query
  with release_state as (
    select state.*,
      (
        ('x' || substr(md5(p_user_id::text || ':editor-render-v4'),1,8))
          ::bit(32)::bigint % 100
      )::smallint as rollout_bucket
    from shorts_mvp.editor_release_state state
    where state.singleton
      and not state.render_v4_kill_switch
      and not (
        state.render_v4_infra_lease_id is not null
        and state.render_v4_infra_lease_expires_at > clock_timestamp()
      )
  ), eligible as (
    select
      candidate.id as release_id,
      'canary'::text as release_channel,
      candidate.render_spec_version,
      candidate.caption_render_spec_version,
      candidate.font_manifest_sha256,
      candidate.worker_image_digest as release_worker_image_digest,
      candidate.production_job_definition_arn
        as editor_production_job_definition_arn,
      0 as priority
    from release_state state
    join shorts_mvp.editor_release_testers tester
      on tester.user_id=p_user_id and tester.enabled
    join shorts_mvp.editor_releases candidate
      on candidate.id=state.candidate_release_id
    join shorts_mvp.editor_release_project_targets project_target
      on project_target.release_id=candidate.id
      and project_target.target_key=p_batch_target_key
      and project_target.batch_target_release_id=p_batch_target_release_id
      and project_target.job_definition_arn=p_job_definition_arn
      and project_target.job_queue_arn=p_job_queue_arn
      and project_target.worker_image_digest=p_worker_image_digest
      and project_target.worker_source_git_sha=p_worker_source_git_sha
    where state.canary_enabled
      and state.render_v4_internal_enabled
      and candidate.render_spec_version=4
      and candidate.caption_render_spec_version=4
      and candidate.font_manifest_sha256 is not null
      and candidate.status in ('canary_ready','canary_active','approved')
      and candidate.staging_verified_at is not null
      and candidate.worker_image_digest=project_target.worker_image_digest
      and candidate.git_sha=project_target.worker_source_git_sha

    union all

    select
      stable.id as release_id,
      'stable'::text as release_channel,
      stable.render_spec_version,
      stable.caption_render_spec_version,
      stable.font_manifest_sha256,
      stable.worker_image_digest as release_worker_image_digest,
      stable.production_job_definition_arn
        as editor_production_job_definition_arn,
      1 as priority
    from release_state state
    join shorts_mvp.editor_releases stable
      on stable.id=state.stable_release_id
    join shorts_mvp.editor_release_project_targets project_target
      on project_target.release_id=stable.id
      and project_target.target_key=p_batch_target_key
      and project_target.batch_target_release_id=p_batch_target_release_id
      and project_target.job_definition_arn=p_job_definition_arn
      and project_target.job_queue_arn=p_job_queue_arn
      and project_target.worker_image_digest=p_worker_image_digest
      and project_target.worker_source_git_sha=p_worker_source_git_sha
    where state.public_enabled
      and state.render_v4_rollout_percent > state.rollout_bucket
      and stable.status='stable'
      and stable.promoted_at is not null
      and stable.render_spec_version=4
      and stable.caption_render_spec_version=4
      and stable.font_manifest_sha256 is not null
      and stable.worker_image_digest=project_target.worker_image_digest
      and stable.git_sha=project_target.worker_source_git_sha
  )
  select
    eligible.release_id,
    eligible.release_channel,
    eligible.render_spec_version,
    eligible.caption_render_spec_version,
    eligible.font_manifest_sha256,
    eligible.release_worker_image_digest,
    eligible.editor_production_job_definition_arn
  from eligible
  order by eligible.priority
  limit 1;
end;
$$;

-- Read-only contract/identity helpers expose no user data or secrets.
revoke all on function shorts_mvp._project_target_successor_contract(uuid,uuid,boolean),
  shorts_mvp._project_target_successor_flags(),
  shorts_mvp._assert_project_successor_registry(jsonb,jsonb,text),
  shorts_mvp.project_target_successor_drain(),
  shorts_mvp.begin_project_target_successor(uuid,uuid,jsonb,uuid),
  shorts_mvp.transition_project_target_successor(uuid,text,jsonb,uuid),
  shorts_mvp.editor_target_successor_admin_release(uuid),
  shorts_mvp.enforce_project_target_successor_admission()
  from public,anon,authenticated,service_role;
grant execute on function shorts_mvp._project_target_successor_contract(uuid,uuid,boolean),
  shorts_mvp._project_target_successor_flags(),
  shorts_mvp.project_target_successor_drain(),
  shorts_mvp.begin_project_target_successor(uuid,uuid,jsonb,uuid),
  shorts_mvp.transition_project_target_successor(uuid,text,jsonb,uuid),
  shorts_mvp.editor_target_successor_admin_release(uuid)
  to service_role;
revoke all on function shorts_mvp.resolve_initial_render_v4_release(uuid,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function shorts_mvp.resolve_initial_render_v4_release(uuid,text,text,text,text,text,text)
  to service_role;

comment on column shorts_mvp.editor_release_state.render_v4_target_successor is
  'Durable fenced/admin_ready/active target pin. No lease expiry, legacy lease, flag toggle, or failed deploy clears this value.';

commit;
