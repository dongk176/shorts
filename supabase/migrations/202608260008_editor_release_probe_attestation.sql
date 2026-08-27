begin;

set local lock_timeout = '3s';
set local statement_timeout = '10min';

-- Release registration is a compare-and-swap operation.  Any administrator
-- or automation that changes a release pointer advances this revision so a
-- probe that was verified against an older state can never overwrite it.
alter table shorts_mvp.editor_release_state
  add column if not exists release_registration_revision bigint not null default 0;

create or replace function shorts_mvp.advance_editor_release_state_revision()
returns trigger
language plpgsql
set search_path=shorts_mvp,pg_temp
as $$
begin
  if new.stable_release_id is distinct from old.stable_release_id
    or new.previous_stable_release_id is distinct from old.previous_stable_release_id
    or new.candidate_release_id is distinct from old.candidate_release_id
    or new.public_enabled is distinct from old.public_enabled
    or new.canary_enabled is distinct from old.canary_enabled
  then
    if new.release_registration_revision = old.release_registration_revision then
      new.release_registration_revision := old.release_registration_revision + 1;
    elsif new.release_registration_revision <> old.release_registration_revision + 1 then
      raise exception 'editor release state revision must advance exactly once';
    end if;
  elsif new.release_registration_revision is distinct from old.release_registration_revision then
    raise exception 'editor release state revision cannot change without a pointer transition';
  end if;
  return new;
end;
$$;

drop trigger if exists editor_release_state_advance_registration_revision
  on shorts_mvp.editor_release_state;
create trigger editor_release_state_advance_registration_revision
before update on shorts_mvp.editor_release_state
for each row execute function shorts_mvp.advance_editor_release_state_revision();

create table if not exists shorts_mvp.editor_release_probe_runs (
  id uuid primary key default gen_random_uuid(),
  nonce text not null unique check (nonce ~ '^[0-9a-f]{32}$'),
  state text not null default 'reserved'
    check (state in ('reserved','job_submitted','evidence_verified','finalized','rejected')),
  git_sha text not null check (git_sha ~ '^[0-9a-f]{40}$'),
  worker_image_digest text not null
    check (worker_image_digest ~ '^sha256:[0-9a-f]{64}$'),
  font_manifest_sha256 text not null
    check (font_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  github_repository text not null
    check (github_repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  github_repository_id bigint not null check (github_repository_id > 0),
  github_repository_owner_id bigint not null check (github_repository_owner_id > 0),
  github_workflow_ref text not null,
  github_workflow_name text not null,
  github_release_ref text not null check (github_release_ref ~ '^refs/tags/[A-Za-z0-9._-]+$'),
  github_environment text not null,
  github_workflow_run_id bigint not null check (github_workflow_run_id > 0),
  github_workflow_run_attempt integer not null check (github_workflow_run_attempt > 0),
  isolated_job_name text,
  isolated_job_queue_arn text,
  isolated_job_definition_arn text,
  isolated_batch_job_id text,
  artifact_uri text,
  manifest_s3_version_id text,
  manifest_sha256 text check (
    manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  matrix_uri text,
  matrix_s3_version_id text,
  matrix_sha256 text check (
    matrix_sha256 is null or matrix_sha256 ~ '^[0-9a-f]{64}$'
  ),
  expected_candidate_release_id uuid
    references shorts_mvp.editor_releases(id) on delete restrict,
  expected_state_revision bigint not null check (expected_state_revision >= 0),
  finalized_release_id uuid
    references shorts_mvp.editor_releases(id) on delete restrict,
  reserved_at timestamptz not null default clock_timestamp(),
  job_attached_at timestamptz,
  evidence_verified_at timestamptz,
  finalized_at timestamptz,
  expires_at timestamptz not null default (clock_timestamp() + interval '24 hours'),
  unique (
    github_repository_id,github_workflow_run_id,github_workflow_run_attempt,
    git_sha,worker_image_digest
  ),
  check (
    (state='reserved'
      and isolated_batch_job_id is null
      and artifact_uri is null
      and finalized_release_id is null)
    or (state='job_submitted'
      and isolated_job_name is not null
      and isolated_job_queue_arn is not null
      and isolated_job_definition_arn is not null
      and isolated_batch_job_id is not null
      and job_attached_at is not null
      and artifact_uri is null
      and finalized_release_id is null)
    or (state='evidence_verified'
      and isolated_batch_job_id is not null
      and artifact_uri is not null
      and manifest_s3_version_id is not null
      and manifest_sha256 is not null
      and matrix_uri is not null
      and matrix_s3_version_id is not null
      and matrix_sha256 is not null
      and evidence_verified_at is not null
      and finalized_release_id is null)
    or (state='finalized'
      and finalized_release_id is not null
      and finalized_at is not null)
    or state='rejected'
  )
);

create index if not exists editor_release_probe_runs_state_expiry_idx
  on shorts_mvp.editor_release_probe_runs(state,expires_at);

create or replace function shorts_mvp.protect_editor_release_probe_identity()
returns trigger
language plpgsql
set search_path=shorts_mvp,pg_temp
as $$
begin
  if tg_op='DELETE' then
    raise exception 'editor release probe identity is immutable';
  end if;
  if new.nonce is distinct from old.nonce
    or new.git_sha is distinct from old.git_sha
    or new.worker_image_digest is distinct from old.worker_image_digest
    or new.font_manifest_sha256 is distinct from old.font_manifest_sha256
    or new.github_repository is distinct from old.github_repository
    or new.github_repository_id is distinct from old.github_repository_id
    or new.github_repository_owner_id is distinct from old.github_repository_owner_id
    or new.github_workflow_ref is distinct from old.github_workflow_ref
    or new.github_workflow_name is distinct from old.github_workflow_name
    or new.github_release_ref is distinct from old.github_release_ref
    or new.github_environment is distinct from old.github_environment
    or new.github_workflow_run_id is distinct from old.github_workflow_run_id
    or new.github_workflow_run_attempt is distinct from old.github_workflow_run_attempt
    or new.expected_candidate_release_id is distinct from old.expected_candidate_release_id
    or new.expected_state_revision is distinct from old.expected_state_revision
  then
    raise exception 'editor release probe identity is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists editor_release_probe_runs_protect_identity
  on shorts_mvp.editor_release_probe_runs;
create trigger editor_release_probe_runs_protect_identity
before update or delete on shorts_mvp.editor_release_probe_runs
for each row execute function shorts_mvp.protect_editor_release_probe_identity();

create or replace function shorts_mvp.reserve_editor_release_probe_v4(
  p_git_sha text,
  p_worker_image_digest text,
  p_font_manifest_sha256 text,
  p_github_repository text,
  p_github_repository_id bigint,
  p_github_repository_owner_id bigint,
  p_github_workflow_ref text,
  p_github_workflow_name text,
  p_github_release_ref text,
  p_github_environment text,
  p_github_workflow_run_id bigint,
  p_github_workflow_run_attempt integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=shorts_mvp,extensions,pg_temp
as $$
declare
  v_state shorts_mvp.editor_release_state%rowtype;
  v_probe shorts_mvp.editor_release_probe_runs%rowtype;
begin
  select * into strict v_state
  from shorts_mvp.editor_release_state
  where singleton
  for update;

  select * into v_probe
  from shorts_mvp.editor_release_probe_runs
  where github_repository_id=p_github_repository_id
    and github_workflow_run_id=p_github_workflow_run_id
    and github_workflow_run_attempt=p_github_workflow_run_attempt
    and git_sha=p_git_sha
    and worker_image_digest=p_worker_image_digest
  for update;

  if found then
    if v_probe.font_manifest_sha256<>p_font_manifest_sha256
      or v_probe.github_repository<>p_github_repository
      or v_probe.github_repository_owner_id<>p_github_repository_owner_id
      or v_probe.github_workflow_ref<>p_github_workflow_ref
      or v_probe.github_workflow_name<>p_github_workflow_name
      or v_probe.github_release_ref<>p_github_release_ref
      or v_probe.github_environment<>p_github_environment
      or v_probe.expires_at<=clock_timestamp()
      or v_probe.state='rejected'
    then
      raise exception 'existing editor release probe identity is not reusable';
    end if;
    return to_jsonb(v_probe);
  end if;

  insert into shorts_mvp.editor_release_probe_runs (
    nonce,git_sha,worker_image_digest,font_manifest_sha256,
    github_repository,github_repository_id,github_repository_owner_id,
    github_workflow_ref,github_workflow_name,github_release_ref,
    github_environment,github_workflow_run_id,github_workflow_run_attempt,
    expected_candidate_release_id,expected_state_revision
  ) values (
    encode(gen_random_bytes(16),'hex'),p_git_sha,p_worker_image_digest,
    p_font_manifest_sha256,p_github_repository,p_github_repository_id,
    p_github_repository_owner_id,p_github_workflow_ref,p_github_workflow_name,
    p_github_release_ref,p_github_environment,p_github_workflow_run_id,
    p_github_workflow_run_attempt,v_state.candidate_release_id,
    v_state.release_registration_revision
  ) returning * into v_probe;
  return to_jsonb(v_probe);
end;
$$;

create or replace function shorts_mvp.attach_editor_release_probe_job_v4(
  p_probe_id uuid,
  p_nonce text,
  p_isolated_job_name text,
  p_isolated_job_queue_arn text,
  p_isolated_job_definition_arn text,
  p_isolated_batch_job_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_probe shorts_mvp.editor_release_probe_runs%rowtype;
begin
  select * into strict v_probe
  from shorts_mvp.editor_release_probe_runs
  where id=p_probe_id and nonce=p_nonce
  for update;
  if v_probe.state='reserved' then
    update shorts_mvp.editor_release_probe_runs
    set state='job_submitted',isolated_job_name=p_isolated_job_name,
      isolated_job_queue_arn=p_isolated_job_queue_arn,
      isolated_job_definition_arn=p_isolated_job_definition_arn,
      isolated_batch_job_id=p_isolated_batch_job_id,
      job_attached_at=clock_timestamp()
    where id=p_probe_id and nonce=p_nonce and state='reserved'
    returning * into strict v_probe;
  elsif v_probe.state in ('job_submitted','evidence_verified','finalized') then
    if v_probe.isolated_job_name<>p_isolated_job_name
      or v_probe.isolated_job_queue_arn<>p_isolated_job_queue_arn
      or v_probe.isolated_job_definition_arn<>p_isolated_job_definition_arn
      or v_probe.isolated_batch_job_id<>p_isolated_batch_job_id
    then
      raise exception 'editor release probe job identity differs';
    end if;
  else
    raise exception 'editor release probe cannot attach a job in state %',v_probe.state;
  end if;
  return to_jsonb(v_probe);
end;
$$;

create or replace function shorts_mvp.attach_editor_release_probe_evidence_v4(
  p_probe_id uuid,
  p_nonce text,
  p_artifact_uri text,
  p_manifest_s3_version_id text,
  p_manifest_sha256 text,
  p_matrix_uri text,
  p_matrix_s3_version_id text,
  p_matrix_sha256 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_probe shorts_mvp.editor_release_probe_runs%rowtype;
begin
  select * into strict v_probe
  from shorts_mvp.editor_release_probe_runs
  where id=p_probe_id and nonce=p_nonce
  for update;
  if v_probe.state='job_submitted' then
    update shorts_mvp.editor_release_probe_runs
    set state='evidence_verified',artifact_uri=p_artifact_uri,
      manifest_s3_version_id=p_manifest_s3_version_id,
      manifest_sha256=p_manifest_sha256,matrix_uri=p_matrix_uri,
      matrix_s3_version_id=p_matrix_s3_version_id,
      matrix_sha256=p_matrix_sha256,evidence_verified_at=clock_timestamp()
    where id=p_probe_id and nonce=p_nonce and state='job_submitted'
    returning * into strict v_probe;
  elsif v_probe.state in ('evidence_verified','finalized') then
    if v_probe.artifact_uri<>p_artifact_uri
      or v_probe.manifest_s3_version_id<>p_manifest_s3_version_id
      or v_probe.manifest_sha256<>p_manifest_sha256
      or v_probe.matrix_uri<>p_matrix_uri
      or v_probe.matrix_s3_version_id<>p_matrix_s3_version_id
      or v_probe.matrix_sha256<>p_matrix_sha256
    then
      raise exception 'editor release probe evidence identity differs';
    end if;
  else
    raise exception 'editor release probe cannot attach evidence in state %',v_probe.state;
  end if;
  return to_jsonb(v_probe);
end;
$$;

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

alter table shorts_mvp.editor_release_probe_runs enable row level security;
revoke all on shorts_mvp.editor_release_probe_runs
  from public,anon,authenticated,service_role;
grant select on shorts_mvp.editor_release_probe_runs to service_role;

revoke all on function shorts_mvp.advance_editor_release_state_revision()
  from public,anon,authenticated;
revoke all on function shorts_mvp.protect_editor_release_probe_identity()
  from public,anon,authenticated;
revoke all on function shorts_mvp.reserve_editor_release_probe_v4(
  text,text,text,text,bigint,bigint,text,text,text,text,bigint,integer
) from public,anon,authenticated;
revoke all on function shorts_mvp.attach_editor_release_probe_job_v4(
  uuid,text,text,text,text,text
) from public,anon,authenticated;
revoke all on function shorts_mvp.attach_editor_release_probe_evidence_v4(
  uuid,text,text,text,text,text,text,text
) from public,anon,authenticated;
revoke all on function shorts_mvp.finalize_editor_render_v4_release(
  uuid,text,text,jsonb,jsonb,text,text
) from public,anon,authenticated;

grant execute on function shorts_mvp.advance_editor_release_state_revision()
  to service_role;
grant execute on function shorts_mvp.protect_editor_release_probe_identity()
  to service_role;
grant execute on function shorts_mvp.reserve_editor_release_probe_v4(
  text,text,text,text,bigint,bigint,text,text,text,text,bigint,integer
) to service_role;
grant execute on function shorts_mvp.attach_editor_release_probe_job_v4(
  uuid,text,text,text,text,text
) to service_role;
grant execute on function shorts_mvp.attach_editor_release_probe_evidence_v4(
  uuid,text,text,text,text,text,text,text
) to service_role;
grant execute on function shorts_mvp.finalize_editor_render_v4_release(
  uuid,text,text,jsonb,jsonb,text,text
) to service_role;

comment on table shorts_mvp.editor_release_probe_runs is
  'Single-use server-nonce release evidence bound to one protected GitHub run and isolated Batch job.';
comment on column shorts_mvp.editor_release_state.release_registration_revision is
  'Monotonic compare-and-swap revision for candidate release registration.';

commit;
