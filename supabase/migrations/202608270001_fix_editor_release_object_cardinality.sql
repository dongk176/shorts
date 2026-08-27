-- Replace only the release finalizer. PostgreSQL exposes jsonb_object_keys
-- but has no built-in jsonb_object_length function.

create or replace function shorts_mvp.finalize_editor_render_v4_release(
  p_probe_id uuid,
  p_nonce text,
  p_production_job_definition_arn text,
  p_project_targets jsonb,
  p_release_checks jsonb,
  p_browser_parity_report_sha256 text,
  p_workflow_run_url text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_probe shorts_mvp.editor_release_probe_runs%rowtype;
  v_state shorts_mvp.editor_release_state%rowtype;
  v_release shorts_mvp.editor_releases%rowtype;
  v_target record;
  v_check record;
  v_check_names text[];
  v_expected_check_names constant text[] := array[
    'browser-parity-worker-matrix',
    'browser-worker-visual-parity',
    'caption-render-spec-v4',
    'captured-timeline',
    'editor-v2',
    'ffprobe',
    'font-fallback',
    'font-manifest',
    'frame-parity',
    'legacy-no-timeline',
    'render-spec-v4',
    'runtime-identity',
    'worker-caption-noop-parity',
    'worker-image',
    'worker-title-compositor-parity'
  ];
begin
  select * into strict v_probe
  from shorts_mvp.editor_release_probe_runs
  where id=p_probe_id and nonce=p_nonce
  for update;
  if v_probe.state='finalized' then
    return jsonb_build_object(
      'releaseId',v_probe.finalized_release_id,
      'status','canary_ready',
      'idempotent',true
    );
  end if;
  if v_probe.state<>'evidence_verified' or v_probe.expires_at<=clock_timestamp() then
    raise exception 'editor release probe is not ready to finalize';
  end if;
  if jsonb_typeof(p_project_targets)<>'object'
    or (
      case when jsonb_typeof(p_project_targets)='object'
        then (select count(*) from jsonb_object_keys(p_project_targets))
        else 0
      end
    )<>5
    or jsonb_typeof(p_release_checks)<>'array'
    or jsonb_array_length(p_release_checks)<>15
    or p_browser_parity_report_sha256 !~ '^[0-9a-f]{64}$'
    or p_production_job_definition_arn
      !~ ('^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/'
        || 'shorts-mvp-editor-release-' || left(v_probe.git_sha,12)
        || '-4vcpu:[1-9][0-9]*$')
    or p_workflow_run_url<>(
      'https://github.com/' || v_probe.github_repository || '/actions/runs/'
      || v_probe.github_workflow_run_id || '/attempts/'
      || v_probe.github_workflow_run_attempt
    )
  then
    raise exception 'editor release finalization payload is incomplete';
  end if;
  select array_agg(value->>'checkName' order by value->>'checkName')
  into v_check_names
  from jsonb_array_elements(p_release_checks);
  if v_check_names is distinct from v_expected_check_names
    or exists (
      select 1 from jsonb_array_elements(p_release_checks) check_value
      where jsonb_typeof(check_value)<>'object'
        or (
          case when jsonb_typeof(check_value)='object'
            then (select count(*) from jsonb_object_keys(check_value))
            else 0
          end
        )<>3
        or not check_value ?& array['checkName','artifactUri','details']
        or jsonb_typeof(check_value->'details')<>'object'
        or (
          check_value->>'checkName'='browser-worker-visual-parity'
          and check_value->>'artifactUri'<>v_probe.matrix_uri
        )
        or (
          check_value->>'checkName'<>'browser-worker-visual-parity'
          and check_value->>'artifactUri'<>v_probe.artifact_uri
        )
    )
  then
    raise exception 'editor release checks are not the exact verified set';
  end if;

  select * into strict v_state
  from shorts_mvp.editor_release_state
  where singleton
  for update;
  if v_state.candidate_release_id is distinct from v_probe.expected_candidate_release_id
    or v_state.release_registration_revision<>v_probe.expected_state_revision
    or v_state.canary_enabled
  then
    raise exception 'editor release state changed after probe reservation';
  end if;

  select * into v_release
  from shorts_mvp.editor_releases
  where git_sha=v_probe.git_sha
    and worker_image_digest=v_probe.worker_image_digest
  for update;
  if found then
    raise exception 'editor release identity already exists outside this probe';
  else
    insert into shorts_mvp.editor_releases (
      git_sha,ui_version,document_version,worker_image_digest,
      production_job_definition_arn,subtitle_editing_capable,
      render_spec_version,caption_render_spec_version,font_manifest_sha256,
      status,staging_verified_at
    ) values (
      v_probe.git_sha,4,3,v_probe.worker_image_digest,
      p_production_job_definition_arn,true,4,4,v_probe.font_manifest_sha256,
      'canary_ready',clock_timestamp()
    ) returning * into v_release;
  end if;

  for v_target in select key,value from jsonb_each(p_project_targets)
  loop
    if v_target.key not in (
      'legacy_project','source_range','elevenlabs_transcription',
      'subtitle_templates','unified_template_subtitles'
    ) or jsonb_typeof(v_target.value)<>'object'
      or (
        case when jsonb_typeof(v_target.value)='object'
          then (select count(*) from jsonb_object_keys(v_target.value))
          else 0
        end
      )<>6
      or not v_target.value ?& array[
        'batchTargetReleaseId','workerSourceGitSha','workerImageDigest',
        'jobDefinitionArn','jobQueueArn','renderSpecVersion'
      ]
      or v_target.value->>'workerSourceGitSha'<>v_probe.git_sha
      or v_target.value->>'workerImageDigest'<>v_probe.worker_image_digest
      or v_target.value->>'renderSpecVersion'<>'4'
      or v_target.value->>'batchTargetReleaseId'
        !~ '^[a-z0-9][a-z0-9._-]{2,127}$'
      or v_target.value->>'jobDefinitionArn'
        !~ ('^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/'
          || 'shorts-mvp-editor-v4-'
          || replace(v_target.key,'_','-') || '-'
          || left(v_probe.git_sha,12) || ':[1-9][0-9]*$')
      or v_target.value->>'jobQueueArn'
        !~ '^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-queue/[A-Za-z0-9_-]+$'
    then
      raise exception 'invalid editor release project target %',v_target.key;
    end if;
    insert into shorts_mvp.editor_release_project_targets (
      release_id,target_key,batch_target_release_id,worker_source_git_sha,
      worker_image_digest,job_definition_arn,job_queue_arn
    ) values (
      v_release.id,v_target.key,v_target.value->>'batchTargetReleaseId',
      v_target.value->>'workerSourceGitSha',
      v_target.value->>'workerImageDigest',
      v_target.value->>'jobDefinitionArn',v_target.value->>'jobQueueArn'
    ) on conflict (release_id,target_key) do nothing;
  end loop;
  if (
    select count(*) from shorts_mvp.editor_release_project_targets
    where release_id=v_release.id
  )<>5 then
    raise exception 'editor release project targets are incomplete';
  end if;
  if exists (
    select 1
    from shorts_mvp.editor_release_project_targets target
    join jsonb_each(p_project_targets) supplied on supplied.key=target.target_key
    where target.release_id=v_release.id
      and (
        target.batch_target_release_id<>supplied.value->>'batchTargetReleaseId'
        or target.worker_source_git_sha<>supplied.value->>'workerSourceGitSha'
        or target.worker_image_digest<>supplied.value->>'workerImageDigest'
        or target.job_definition_arn<>supplied.value->>'jobDefinitionArn'
        or target.job_queue_arn<>supplied.value->>'jobQueueArn'
      )
  ) then
    raise exception 'stored editor release project target identity differs';
  end if;

  for v_check in select value from jsonb_array_elements(p_release_checks)
  loop
    insert into shorts_mvp.editor_release_checks (
      release_id,environment,check_name,status,details,artifact_uri,
      started_at,completed_at
    ) values (
      v_release.id,'isolated',v_check.value->>'checkName','passed',
      coalesce(v_check.value->'details','{}'::jsonb)
        || jsonb_build_object(
          'workflowRunUrl',p_workflow_run_url,
          'probeRunId',v_probe.id,
          'browserParityReportSha256',p_browser_parity_report_sha256
        ),
      v_check.value->>'artifactUri',clock_timestamp(),clock_timestamp()
    ) on conflict (release_id,environment,check_name) do nothing;
  end loop;
  if (
    select array_agg(check_name order by check_name)
    from shorts_mvp.editor_release_checks
    where release_id=v_release.id and environment='isolated' and status='passed'
  ) is distinct from v_expected_check_names then
    raise exception 'stored editor release checks are incomplete';
  end if;

  update shorts_mvp.editor_release_state
  set candidate_release_id=v_release.id,canary_enabled=false,
    release_registration_revision=release_registration_revision+1
  where singleton
    and candidate_release_id is not distinct from v_probe.expected_candidate_release_id
    and release_registration_revision=v_probe.expected_state_revision;
  if not found then
    raise exception 'editor release state compare-and-swap failed';
  end if;

  update shorts_mvp.editor_release_probe_runs
  set state='finalized',finalized_release_id=v_release.id,
    finalized_at=clock_timestamp()
  where id=v_probe.id and nonce=v_probe.nonce and state='evidence_verified';
  if not found then
    raise exception 'editor release probe finalization compare-and-swap failed';
  end if;
  return jsonb_build_object(
    'releaseId',v_release.id,'status','canary_ready','idempotent',false
  );
end;
$$;

