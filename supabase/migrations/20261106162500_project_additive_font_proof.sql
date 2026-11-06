begin;

-- A larger manifest is compatible only when the finalized, versioned probe
-- artifacts prove that every existing face and layout metric is unchanged.
create table shorts_mvp.project_font_successor_proofs (
  previous_release_id uuid not null references shorts_mvp.editor_releases(id),
  successor_release_id uuid not null references shorts_mvp.editor_releases(id),
  previous_font_sha256 text not null,
  successor_font_sha256 text not null,
  previous_probe_id uuid not null references shorts_mvp.editor_release_probe_runs(id),
  successor_probe_id uuid not null references shorts_mvp.editor_release_probe_runs(id),
  previous_manifest_sha256 text not null,
  successor_manifest_sha256 text not null,
  retained_font_count integer not null check(retained_font_count>0),
  added_font_count integer not null check(added_font_count>0),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(previous_release_id,successor_release_id)
);
alter table shorts_mvp.project_font_successor_proofs enable row level security;
revoke all on shorts_mvp.project_font_successor_proofs from public,anon,authenticated,service_role;

create function shorts_mvp.record_project_font_successor_proof(
  p_previous_release_id uuid,p_successor_release_id uuid,
  p_previous_manifest text,p_successor_manifest text,p_admin_user_id uuid
) returns void language plpgsql security definer
set search_path=shorts_mvp,pg_temp as $$
declare
  old_probe shorts_mvp.editor_release_probe_runs%rowtype;
  new_probe shorts_mvp.editor_release_probe_runs%rowtype;
  old_doc jsonb; new_doc jsonb; old_fonts jsonb; new_fonts jsonb;
  old_count integer; new_count integer;
begin
  if not exists(select 1 from shorts_mvp.app_users where id=p_admin_user_id and is_admin) then
    raise exception 'administrator required' using errcode='42501';
  end if;
  if p_previous_release_id=p_successor_release_id
    or octet_length(p_previous_manifest)>8388608 or octet_length(p_successor_manifest)>8388608
    or p_previous_manifest is null or p_successor_manifest is null then
    raise exception 'invalid font proof input' using errcode='23514';
  end if;
  select * into strict old_probe from shorts_mvp.editor_release_probe_runs
    where finalized_release_id=p_previous_release_id and state='finalized' for share;
  select * into strict new_probe from shorts_mvp.editor_release_probe_runs
    where finalized_release_id=p_successor_release_id and state='finalized' for share;
  if encode(sha256(convert_to(p_previous_manifest,'UTF8')),'hex') is distinct from old_probe.manifest_sha256
    or encode(sha256(convert_to(p_successor_manifest,'UTF8')),'hex') is distinct from new_probe.manifest_sha256
    or coalesce(length(old_probe.manifest_s3_version_id),0)=0
    or coalesce(length(new_probe.manifest_s3_version_id),0)=0 then
    raise exception 'font proof does not match finalized artifacts' using errcode='23514';
  end if;
  old_doc:=p_previous_manifest::jsonb; new_doc:=p_successor_manifest::jsonb;
  if old_doc->>'gitSha' is distinct from old_probe.git_sha
    or new_doc->>'gitSha' is distinct from new_probe.git_sha
    or old_doc->>'workerImageDigest' is distinct from old_probe.worker_image_digest
    or new_doc->>'workerImageDigest' is distinct from new_probe.worker_image_digest
    or old_doc->>'fontManifestSha256' is distinct from old_probe.font_manifest_sha256
    or new_doc->>'fontManifestSha256' is distinct from new_probe.font_manifest_sha256
    or old_doc#>>'{fontManifest,sha256}' is distinct from old_probe.font_manifest_sha256
    or new_doc#>>'{fontManifest,sha256}' is distinct from new_probe.font_manifest_sha256
    or old_doc#>'{fontManifest,fallbackDetected}' is distinct from 'false'::jsonb
    or new_doc#>'{fontManifest,fallbackDetected}' is distinct from 'false'::jsonb then
    raise exception 'font proof identity mismatch' using errcode='23514';
  end if;
  old_fonts:=old_doc#>'{fontManifest,entries}'; new_fonts:=new_doc#>'{fontManifest,entries}';
  if jsonb_typeof(old_fonts) is distinct from 'array' or jsonb_typeof(new_fonts) is distinct from 'array' then
    raise exception 'font entries missing' using errcode='23514';
  end if;
  old_count:=jsonb_array_length(old_fonts);new_count:=jsonb_array_length(new_fonts);
  if old_count=0 or new_count<=old_count
    or (select count(distinct e->>'fontId') from jsonb_array_elements(old_fonts) e)<>old_count
    or (select count(distinct e->>'fontId') from jsonb_array_elements(new_fonts) e)<>new_count
    or exists(select 1 from jsonb_array_elements(old_fonts) old_face
      where not exists(select 1 from jsonb_array_elements(new_fonts) new_face where new_face=old_face)) then
    raise exception 'existing font bytes or metrics changed' using errcode='23514';
  end if;
  perform 1 from shorts_mvp.editor_release_state state
    join shorts_mvp.editor_releases old_release on old_release.id=state.stable_release_id
    where state.singleton and state.stable_release_id=p_previous_release_id
      and state.candidate_release_id=p_successor_release_id
      and old_release.status='stable' and old_release.font_manifest_sha256=old_probe.font_manifest_sha256
    for share of state,old_release;
  if not found then raise exception 'previous project identity changed' using errcode='23514'; end if;
  insert into shorts_mvp.project_font_successor_proofs values(
    p_previous_release_id,p_successor_release_id,old_probe.font_manifest_sha256,new_probe.font_manifest_sha256,
    old_probe.id,new_probe.id,old_probe.manifest_sha256,new_probe.manifest_sha256,
    old_count,new_count-old_count,clock_timestamp());
end;
$$;

create function shorts_mvp._project_successor_fonts_compatible(p_previous uuid,p_successor uuid)
returns boolean language sql stable security definer set search_path=shorts_mvp,pg_temp as $$
 select exists(select 1 from shorts_mvp.editor_releases old_release
   join shorts_mvp.editor_releases new_release on new_release.id=p_successor
   where old_release.id=p_previous and (
     old_release.font_manifest_sha256=new_release.font_manifest_sha256
     or exists(select 1 from shorts_mvp.project_font_successor_proofs proof
       join shorts_mvp.editor_release_probe_runs old_probe on old_probe.id=proof.previous_probe_id
       join shorts_mvp.editor_release_probe_runs new_probe on new_probe.id=proof.successor_probe_id
       where proof.previous_release_id=p_previous and proof.successor_release_id=p_successor
         and proof.previous_font_sha256=old_release.font_manifest_sha256
         and proof.successor_font_sha256=new_release.font_manifest_sha256
         and old_probe.state='finalized' and new_probe.state='finalized'
         and old_probe.finalized_release_id=p_previous and new_probe.finalized_release_id=p_successor
         and old_probe.manifest_sha256=proof.previous_manifest_sha256
         and new_probe.manifest_sha256=proof.successor_manifest_sha256
         and old_probe.font_manifest_sha256=proof.previous_font_sha256
         and new_probe.font_manifest_sha256=proof.successor_font_sha256
         and coalesce(length(old_probe.manifest_s3_version_id),0)>0
         and coalesce(length(new_probe.manifest_s3_version_id),0)>0
     )))
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
    or not shorts_mvp._project_successor_fonts_compatible(p_previous,p_successor)
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
revoke all on function shorts_mvp.record_project_font_successor_proof(uuid,uuid,text,text,uuid)
  from public,anon,authenticated;
grant execute on function shorts_mvp.record_project_font_successor_proof(uuid,uuid,text,text,uuid) to service_role;
revoke all on function shorts_mvp._project_successor_fonts_compatible(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function shorts_mvp._project_target_successor_contract(uuid,uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function shorts_mvp._project_target_successor_contract(uuid,uuid,boolean) to service_role;
commit;
