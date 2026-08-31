begin;

set local lock_timeout = '3s';
set local statement_timeout = '2min';

-- Keep the nine currently published checks intact during a receiver handoff.
-- A separate nullable column is intentional: the existing check-recording RPC
-- replaces details, but must never accidentally remove the admission fence.
alter table shorts_mvp.file_upload_release_checks
  add column if not exists successor jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='shorts_mvp.file_upload_release_checks'::regclass
      and conname='file_upload_release_checks_successor_check'
  ) then
    alter table shorts_mvp.file_upload_release_checks
      add constraint file_upload_release_checks_successor_check check (
        successor is null
        or (check_key='runtime_identity' and jsonb_typeof(successor)='object')
      );
  end if;
end;
$$;

create or replace function shorts_mvp._lock_file_upload_successor_control(
  p_admin_user_id uuid,
  p_expected_release_id uuid,
  p_expected_source_git_sha text,
  p_expected_worker_image_digest text,
  p_require_open boolean default true
)
returns shorts_mvp.file_upload_release_checks
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_runtime shorts_mvp.file_upload_release_checks%rowtype;
begin
  perform 1 from shorts_mvp.app_users
  where id=p_admin_user_id and is_admin and withdrawn_at is null
  for share;
  if not found then
    raise exception 'administrator required' using errcode='42501';
  end if;
  -- Same order as mode changes and session admission. Never modify the flags.
  perform 1 from shorts_mvp.runtime_feature_flags
  where flag_key in ('file_upload','file_upload_public','file_upload_emergency_stop')
  order by flag_key for update;
  if (select count(*) from shorts_mvp.runtime_feature_flags
      where flag_key in ('file_upload','file_upload_public','file_upload_emergency_stop'))<>3
  then
    raise exception 'file upload release flags are incomplete' using errcode='23514';
  end if;
  perform 1 from shorts_mvp.file_upload_release_checks
  order by check_key for update;
  select * into strict v_runtime from shorts_mvp.file_upload_release_checks
  where check_key='runtime_identity';
  if p_expected_release_id is null
    or coalesce(p_expected_source_git_sha,'') !~ '^[0-9a-f]{40}$'
    or coalesce(p_expected_worker_image_digest,'') !~ '^sha256:[0-9a-f]{64}$'
    or v_runtime.details->>'releaseId' is distinct from p_expected_release_id::text
    or v_runtime.details->>'sourceGitSha' is distinct from p_expected_source_git_sha
    or v_runtime.details->>'workerImageDigest' is distinct from p_expected_worker_image_digest
  then
    raise exception 'file upload successor compare-and-swap failed' using errcode='40001';
  end if;
  if p_require_open and (
    not coalesce((select enabled from shorts_mvp.runtime_feature_flags
      where flag_key='file_upload'),false)
    or coalesce((select enabled from shorts_mvp.runtime_feature_flags
      where flag_key='file_upload_emergency_stop'),true)
    or (select count(*) from shorts_mvp.file_upload_release_checks)<>9
    or exists (select 1 from shorts_mvp.file_upload_release_checks
      where not passed or details->>'sourceGitSha' is distinct from p_expected_source_git_sha)
  ) then
    raise exception 'file upload existing release is not available' using errcode='23514';
  end if;
  return v_runtime;
end;
$$;

-- This is an attested capability check, not a mutable passed=true JSON gate.
-- Keep the original fifteen isolated checks and bind the new evidence to the
-- finalized probe's exact source, digest, font and versioned artifacts.
create or replace function shorts_mvp._verified_file_upload_successor_identity(
  p_release_id uuid,
  p_font_manifest_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_identity jsonb;
  v_names text[];
  v_expected_names constant text[] := array[
    'browser-parity-worker-matrix','browser-worker-visual-parity',
    'caption-render-spec-v4','captured-timeline','editor-v2','ffprobe',
    'font-fallback','font-manifest','frame-parity','legacy-no-timeline',
    'render-spec-v4','runtime-identity','worker-caption-noop-parity',
    'worker-image','worker-title-compositor-parity'
  ];
begin
  select jsonb_build_object(
    'releaseId',release.id,'sourceGitSha',release.git_sha,
    'workerImageDigest',release.worker_image_digest,
    'fontManifestSha256',release.font_manifest_sha256,
    'renderSpecVersion',4,'captionRenderSpecVersion',4,
    'probeRunId',probe.id,'artifactUri',probe.artifact_uri,
    'manifestSha256',probe.manifest_sha256,
    'manifestS3VersionId',probe.manifest_s3_version_id,
    'matrixSha256',probe.matrix_sha256,
    'matrixS3VersionId',probe.matrix_s3_version_id
  ) into v_identity
  from shorts_mvp.editor_release_state state
  join shorts_mvp.runtime_feature_flags runtime on runtime.flag_key='editor_rendering_v2'
  join shorts_mvp.editor_releases release on release.id=p_release_id
  join shorts_mvp.editor_release_probe_runs probe
    on probe.finalized_release_id=release.id and probe.state='finalized'
  join shorts_mvp.editor_release_checks checked
    on checked.release_id=release.id and checked.environment='isolated'
    and checked.check_name='render-spec-v4' and checked.status='passed'
  where state.singleton and runtime.enabled and not state.render_v4_kill_switch
    and not (state.render_v4_infra_lease_id is not null
      and state.render_v4_infra_lease_expires_at>clock_timestamp())
    and release.status in ('staging_verified','canary_ready','canary_active','approved','stable')
    and release.staging_verified_at is not null
    and (release.status<>'stable' or release.promoted_at is not null)
    and release.render_spec_version=4 and release.caption_render_spec_version=4
    and release.font_manifest_sha256=p_font_manifest_sha256
    and release.git_sha=probe.git_sha
    and release.worker_image_digest=probe.worker_image_digest
    and release.font_manifest_sha256=probe.font_manifest_sha256
    and checked.details->>'probeRunId'=probe.id::text
    and checked.artifact_uri=probe.artifact_uri
    and probe.artifact_uri ~ '^s3://'
    and probe.manifest_sha256 ~ '^[0-9a-f]{64}$'
    and probe.matrix_sha256 ~ '^[0-9a-f]{64}$'
    and length(probe.manifest_s3_version_id)>0
    and length(probe.matrix_s3_version_id)>0
    and (select count(*) from shorts_mvp.editor_release_probe_runs candidate_probe
      where candidate_probe.finalized_release_id=release.id and candidate_probe.state='finalized')=1
    and checked.details->'customTemplateDesign'->'version'='1'::jsonb
    and checked.details->'customTemplateDesign'->'passed'='true'::jsonb
    and checked.details->'customTemplateDesign'->>'wrapRevision'='editor-text-v1'
    and checked.details->'customTemplateDesign'->'renderSpecVersion'='4'::jsonb
    and checked.details->'customTemplateDesign'->'captionRenderSpecVersion'='4'::jsonb
    and checked.details->'customTemplateDesign'->>'sourceGitSha'=release.git_sha
    and checked.details->'customTemplateDesign'->>'workerImageDigest'=release.worker_image_digest
    and checked.details->'customTemplateDesign'->>'fontManifestSha256'=release.font_manifest_sha256
  for share of state,runtime,release,probe,checked;
  if v_identity is null then
    raise exception 'file upload successor has no attested design capability' using errcode='23514';
  end if;
  perform 1 from shorts_mvp.editor_release_checks
  where release_id=p_release_id and environment='isolated'
  order by check_name for share;
  select array_agg(check_name order by check_name) into v_names
  from shorts_mvp.editor_release_checks
  where release_id=p_release_id and environment='isolated' and status='passed';
  if v_names is distinct from v_expected_names
    or (select count(*) from shorts_mvp.editor_release_checks
      where release_id=p_release_id and environment='isolated')<>15
  then
    raise exception 'file upload successor isolated checks are incomplete' using errcode='23514';
  end if;
  perform 1 from shorts_mvp.editor_release_project_targets
  where release_id=p_release_id order by target_key for share;
  if (select count(*) from shorts_mvp.editor_release_project_targets
      where release_id=p_release_id
        and target_key in ('legacy_project','source_range','elevenlabs_transcription',
          'subtitle_templates','unified_template_subtitles')
        and worker_source_git_sha=v_identity->>'sourceGitSha'
        and worker_image_digest=v_identity->>'workerImageDigest')<>5
  then
    raise exception 'file upload successor targets are incomplete' using errcode='23514';
  end if;
  return v_identity;
end;
$$;

create or replace function shorts_mvp._assert_file_upload_receiver_ready(
  p_evidence jsonb,
  p_identity jsonb
)
returns void
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_observed_at timestamptz;
  v_key text;
begin
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object'
    or octet_length(p_evidence::text)>16384
  then
    raise exception 'file upload receiver readiness evidence is incomplete' using errcode='23514';
  end if;
  foreach v_key in array array['releaseId','sourceGitSha','workerImageDigest',
    'fontManifestSha256','renderSpecVersion','captionRenderSpecVersion']
  loop
    if p_evidence->v_key is distinct from p_identity->v_key then
      raise exception 'file upload receiver readiness identity does not match' using errcode='23514';
    end if;
  end loop;
  begin
    v_observed_at := (p_evidence->>'observedAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'file upload receiver observation time is invalid' using errcode='23514';
  end;
  if v_observed_at is null or not isfinite(v_observed_at)
    or v_observed_at<clock_timestamp()-interval '5 minutes'
    or v_observed_at>clock_timestamp()
    or coalesce(char_length(p_evidence->>'evidenceId'),0) not between 1 and 200
    or coalesce(p_evidence->>'inventorySha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_evidence->>'readyReceiverCount','') !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_evidence->'readyReceiverCount') is distinct from 'number'
    or p_evidence->'allReadyImagesMatch' is distinct from 'true'::jsonb
  then
    raise exception 'file upload receiver readiness evidence is stale or incomplete' using errcode='23514';
  end if;
  foreach v_key in array array['oldTaskCount','oldTargetCount','protectedTaskCount',
    'capacityWaitingCount','capacityGrantedCount','capacityClaimedCount']
  loop
    if p_evidence->v_key is distinct from '0'::jsonb then
      raise exception 'file upload receiver or capacity has not drained' using errcode='23514';
    end if;
  end loop;
  -- SQL independently checks all old/new upload work; AWS evidence additionally
  -- covers leases, protected tasks and old/draining ALB targets outside SQL.
  if exists (select 1 from shorts_mvp.video_jobs
      where source_type='upload' and status not in ('completed','failed','expired','deleted'))
    or exists (select 1 from shorts_mvp.upload_sessions
      where status='claimed' or (status='awaiting_upload' and expires_at>clock_timestamp()))
    or exists (
      select 1 from shorts_mvp.file_upload_capacity_requests capacity
      left join shorts_mvp.upload_sessions upload on upload.id=capacity.id
      where (capacity.status='waiting' and capacity.queue_expires_at>clock_timestamp())
        or (capacity.status='granted' and capacity.upload_expires_at>clock_timestamp()
          and (upload.id is null or upload.status in ('awaiting_upload','claimed')))
    )
  then
    raise exception 'file upload sessions or jobs have not drained' using errcode='23514';
  end if;
end;
$$;

create or replace function shorts_mvp.begin_file_upload_successor(
  p_expected_release_id uuid,
  p_expected_source_git_sha text,
  p_expected_worker_image_digest text,
  p_successor_release_id uuid,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_runtime shorts_mvp.file_upload_release_checks%rowtype;
  v_identity jsonb;
  v_successor jsonb;
begin
  v_runtime := shorts_mvp._lock_file_upload_successor_control(
    p_admin_user_id,p_expected_release_id,p_expected_source_git_sha,p_expected_worker_image_digest
  );
  if v_runtime.successor is not null then
    raise exception 'a file upload successor is already in progress' using errcode='23514';
  end if;
  if p_successor_release_id is null or p_successor_release_id=p_expected_release_id
    or v_runtime.details->'renderSpecVersion' is distinct from '4'::jsonb
    or v_runtime.details->'captionRenderSpecVersion' is distinct from '4'::jsonb
  then
    raise exception 'file upload successor must preserve the existing v4 contract' using errcode='23514';
  end if;
  v_identity := shorts_mvp._verified_file_upload_successor_identity(
    p_successor_release_id,v_runtime.details->>'fontManifestSha256'
  );
  if v_identity->>'workerImageDigest'=p_expected_worker_image_digest then
    raise exception 'file upload successor must use a new immutable image' using errcode='23514';
  end if;
  v_successor := jsonb_build_object(
    'version',1,'id',gen_random_uuid(),'phase','draining',
    'previousReleaseId',p_expected_release_id,
    'previousSourceGitSha',p_expected_source_git_sha,
    'previousWorkerImageDigest',p_expected_worker_image_digest,
    'identity',v_identity,'startedAt',clock_timestamp(),'startedBy',p_admin_user_id
  );
  update shorts_mvp.file_upload_release_checks set successor=v_successor
  where check_key='runtime_identity';
  insert into shorts_mvp.admin_audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
  values(p_admin_user_id,'file_upload.successor_started','file_upload_release',
    v_successor->>'id',v_successor);
  return v_successor;
end;
$$;

create or replace function shorts_mvp.ready_file_upload_successor(
  p_successor_id uuid,
  p_expected_release_id uuid,
  p_expected_source_git_sha text,
  p_expected_worker_image_digest text,
  p_receiver_evidence jsonb,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_runtime shorts_mvp.file_upload_release_checks%rowtype;
  v_successor jsonb;
  v_identity jsonb;
begin
  v_runtime := shorts_mvp._lock_file_upload_successor_control(
    p_admin_user_id,p_expected_release_id,p_expected_source_git_sha,p_expected_worker_image_digest
  );
  v_successor := v_runtime.successor;
  if p_successor_id is null or v_successor->>'id' is distinct from p_successor_id::text
    or coalesce(v_successor->>'phase','') not in ('draining','admin_test')
  then
    raise exception 'file upload successor state changed' using errcode='40001';
  end if;
  v_identity := shorts_mvp._verified_file_upload_successor_identity(
    (v_successor->'identity'->>'releaseId')::uuid,v_runtime.details->>'fontManifestSha256'
  );
  if v_identity is distinct from v_successor->'identity' then
    raise exception 'file upload successor attestation changed' using errcode='40001';
  end if;
  perform shorts_mvp._assert_file_upload_receiver_ready(p_receiver_evidence,v_identity);
  v_successor := v_successor || jsonb_build_object(
    'phase','admin_test','receiverEvidence',p_receiver_evidence,
    'readyAt',clock_timestamp(),'expiresAt',clock_timestamp()+interval '24 hours'
  );
  update shorts_mvp.file_upload_release_checks set successor=v_successor
  where check_key='runtime_identity';
  insert into shorts_mvp.admin_audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
  values(p_admin_user_id,'file_upload.successor_ready','file_upload_release',
    p_successor_id::text,v_successor);
  return v_successor;
end;
$$;

create or replace function shorts_mvp.promote_file_upload_successor(
  p_successor_id uuid,
  p_expected_release_id uuid,
  p_expected_source_git_sha text,
  p_expected_worker_image_digest text,
  p_checks jsonb,
  p_receiver_evidence jsonb,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_runtime shorts_mvp.file_upload_release_checks%rowtype;
  v_successor jsonb;
  v_identity jsonb;
  v_check record;
  v_details jsonb;
  v_key text;
  v_observed_at timestamptz;
  v_names text[];
  v_expected_names constant text[] := array[
    'admin_end_to_end','no_proxy_environment','no_stuck_sessions','render_parity',
    'runtime_identity','source_cleanup','upload_1gb','upload_5gb','usage_integrity'
  ];
begin
  v_runtime := shorts_mvp._lock_file_upload_successor_control(
    p_admin_user_id,p_expected_release_id,p_expected_source_git_sha,p_expected_worker_image_digest
  );
  v_successor := v_runtime.successor;
  if p_successor_id is null or v_successor->>'id' is distinct from p_successor_id::text
    or v_successor->>'phase' is distinct from 'admin_test'
    or coalesce((v_successor->>'expiresAt')::timestamptz, '-infinity')<=clock_timestamp()
  then
    raise exception 'file upload successor is not ready to promote' using errcode='23514';
  end if;
  v_identity := shorts_mvp._verified_file_upload_successor_identity(
    (v_successor->'identity'->>'releaseId')::uuid,v_runtime.details->>'fontManifestSha256'
  );
  if v_identity is distinct from v_successor->'identity' then
    raise exception 'file upload successor attestation changed' using errcode='40001';
  end if;
  perform shorts_mvp._assert_file_upload_receiver_ready(p_receiver_evidence,v_identity);
  if p_checks is null or jsonb_typeof(p_checks)<>'object'
    or octet_length(p_checks::text)>147456
  then
    raise exception 'file upload successor checks are incomplete' using errcode='23514';
  end if;
  select array_agg(key order by key) into v_names from jsonb_object_keys(p_checks) key;
  if v_names is distinct from v_expected_names then
    raise exception 'file upload successor needs the exact nine checks' using errcode='23514';
  end if;
  for v_check in select key,value from jsonb_each(p_checks) order by key
  loop
    v_details := v_check.value->'details';
    if v_check.value->'passed' is distinct from 'true'::jsonb
      or v_details is null or jsonb_typeof(v_details)<>'object'
      or coalesce(char_length(v_details->>'evidenceId'),0) not between 1 and 200
      or octet_length(v_details::text)>16384
    then
      raise exception 'file upload successor check did not pass' using errcode='23514';
    end if;
    foreach v_key in array array['releaseId','sourceGitSha','workerImageDigest',
      'fontManifestSha256','renderSpecVersion','captionRenderSpecVersion']
    loop
      if v_details->v_key is distinct from v_identity->v_key then
        raise exception 'file upload successor check identities do not match' using errcode='23514';
      end if;
    end loop;
    begin
      v_observed_at := (v_details->>'observedAt')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'file upload successor check time is invalid' using errcode='23514';
    end;
    if v_observed_at is null or not isfinite(v_observed_at)
      or v_observed_at<clock_timestamp()-interval '24 hours'
      or v_observed_at>clock_timestamp()
    then
      raise exception 'file upload successor check is not fresh' using errcode='23514';
    end if;
    -- Preserve the actual observation timestamp; copying evidence is not a new
    -- successful test. No upload job/session or public flag is rewritten.
    update shorts_mvp.file_upload_release_checks
    set passed=true,details=v_details,verified_at=v_observed_at,
      verified_by_user_id=p_admin_user_id,updated_at=clock_timestamp(),successor=null
    where check_key=v_check.key;
  end loop;
  insert into shorts_mvp.admin_audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
  values(p_admin_user_id,'file_upload.successor_promoted','file_upload_release',
    p_successor_id::text,jsonb_build_object('previousReleaseId',p_expected_release_id,
      'identity',v_identity,'checks',p_checks,'receiverEvidence',p_receiver_evidence));
  return v_identity;
end;
$$;

create or replace function shorts_mvp.cancel_file_upload_successor(
  p_successor_id uuid,
  p_expected_release_id uuid,
  p_expected_source_git_sha text,
  p_expected_worker_image_digest text,
  p_restored_receiver_evidence jsonb,
  p_admin_user_id uuid
)
returns void
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_runtime shorts_mvp.file_upload_release_checks%rowtype;
begin
  v_runtime := shorts_mvp._lock_file_upload_successor_control(
    p_admin_user_id,p_expected_release_id,p_expected_source_git_sha,p_expected_worker_image_digest,false
  );
  if p_successor_id is null
    or v_runtime.successor->>'id' is distinct from p_successor_id::text
  then
    raise exception 'file upload successor state changed' using errcode='40001';
  end if;
  -- Never time out back to the old image automatically. Even cancellation
  -- requires no live sessions and observed restoration of the pinned receiver.
  perform shorts_mvp._assert_file_upload_receiver_ready(p_restored_receiver_evidence,v_runtime.details);
  update shorts_mvp.file_upload_release_checks set successor=null
  where check_key='runtime_identity';
  insert into shorts_mvp.admin_audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
  values(p_admin_user_id,'file_upload.successor_cancelled','file_upload_release',
    p_successor_id::text,jsonb_build_object('previousReleaseId',p_expected_release_id,
      'receiverEvidence',p_restored_receiver_evidence));
end;
$$;

-- Old candidate web URLs do not know about the handoff. Fence their new upload
-- inserts too, while leaving existing sessions, queue progress and jobs alone.
create or replace function shorts_mvp.guard_file_upload_successor_admission()
returns trigger
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_successor jsonb;
begin
  if new.source_type<>'upload' then return new; end if;
  perform 1 from shorts_mvp.runtime_feature_flags
  where flag_key in ('file_upload','file_upload_public','file_upload_emergency_stop')
  order by flag_key for share;
  select successor into v_successor from shorts_mvp.file_upload_release_checks
  where check_key='runtime_identity' for share;
  if v_successor is null then return new; end if;
  if v_successor->'version'='1'::jsonb and v_successor->>'phase'='admin_test'
    and (v_successor->>'expiresAt')::timestamptz>clock_timestamp()
    and new.initial_editor_release_id::text=v_successor->'identity'->>'releaseId'
    and new.initial_render_spec_version=4 and new.initial_caption_render_spec_version=4
    and exists(select 1 from shorts_mvp.app_users
      where id=new.user_id and is_admin and withdrawn_at is null)
    and exists(select 1 from shorts_mvp.runtime_feature_flags
      where flag_key='file_upload' and enabled)
    and exists(select 1 from shorts_mvp.runtime_feature_flags
      where flag_key='file_upload_emergency_stop' and not enabled)
  then
    if shorts_mvp._verified_file_upload_successor_identity(
      new.initial_editor_release_id,v_successor->'identity'->>'fontManifestSha256'
    ) is distinct from v_successor->'identity' then
      raise exception 'file upload successor attestation changed' using errcode='40001';
    end if;
    return new;
  end if;
  raise exception 'file upload receiver is transitioning; retry without usage reservation'
    using errcode='55000';
end;
$$;

drop trigger if exists video_jobs_guard_file_upload_successor on shorts_mvp.video_jobs;
create trigger video_jobs_guard_file_upload_successor
before insert on shorts_mvp.video_jobs
for each row execute function shorts_mvp.guard_file_upload_successor_admission();

revoke all on function shorts_mvp._lock_file_upload_successor_control(uuid,uuid,text,text,boolean)
  from public,anon,authenticated,service_role;
revoke all on function shorts_mvp._verified_file_upload_successor_identity(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function shorts_mvp._assert_file_upload_receiver_ready(jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function shorts_mvp.guard_file_upload_successor_admission()
  from public,anon,authenticated,service_role;
revoke all on function shorts_mvp.begin_file_upload_successor(uuid,text,text,uuid,uuid)
  from public,anon,authenticated;
revoke all on function shorts_mvp.ready_file_upload_successor(uuid,uuid,text,text,jsonb,uuid)
  from public,anon,authenticated;
revoke all on function shorts_mvp.promote_file_upload_successor(uuid,uuid,text,text,jsonb,jsonb,uuid)
  from public,anon,authenticated;
revoke all on function shorts_mvp.cancel_file_upload_successor(uuid,uuid,text,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function shorts_mvp.begin_file_upload_successor(uuid,text,text,uuid,uuid)
  to service_role;
grant execute on function shorts_mvp.ready_file_upload_successor(uuid,uuid,text,text,jsonb,uuid)
  to service_role;
grant execute on function shorts_mvp.promote_file_upload_successor(uuid,uuid,text,text,jsonb,jsonb,uuid)
  to service_role;
grant execute on function shorts_mvp.cancel_file_upload_successor(uuid,uuid,text,text,jsonb,uuid)
  to service_role;

comment on column shorts_mvp.file_upload_release_checks.successor is
  'Explicit drain/admin-test fence for an attested receiver successor. Existing published checks and flags remain unchanged until atomic promotion; expiry never removes the fence.';

commit;
