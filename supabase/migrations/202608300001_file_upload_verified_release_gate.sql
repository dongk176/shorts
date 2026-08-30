begin;

set local lock_timeout = '3s';
set local statement_timeout = '2min';

-- Release evidence must only be mutated through the audited security-definer
-- function below. Direct service-role writes could otherwise change the
-- upload release identity while public sessions are being admitted.
revoke insert,update on shorts_mvp.file_upload_release_checks from service_role;
grant select on shorts_mvp.file_upload_release_checks to service_role;

create or replace function shorts_mvp.record_file_upload_release_check(
  p_check_key text,
  p_passed boolean,
  p_details jsonb,
  p_admin_user_id uuid
)
returns shorts_mvp.file_upload_release_checks
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_row shorts_mvp.file_upload_release_checks;
  v_existing shorts_mvp.file_upload_release_checks%rowtype;
  v_public_enabled boolean := false;
begin
  if not exists (
    select 1 from shorts_mvp.app_users
    where id=p_admin_user_id and is_admin
  ) then
    raise exception 'administrator required' using errcode='42501';
  end if;
  if p_check_key not in (
    'admin_end_to_end','render_parity','upload_1gb','upload_5gb',
    'source_cleanup','usage_integrity','runtime_identity',
    'no_proxy_environment','no_stuck_sessions'
  ) then
    raise exception 'invalid file upload release check' using errcode='22023';
  end if;
  if p_details is null or jsonb_typeof(p_details)<>'object' then
    raise exception 'file upload release check details must be an object'
      using errcode='22023';
  end if;

  select enabled into v_public_enabled
  from shorts_mvp.runtime_feature_flags
  where flag_key='file_upload_public'
  for share;

  if p_check_key='runtime_identity' and p_passed then
    if not (
      coalesce(p_details->>'releaseId','')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and coalesce(p_details->>'sourceGitSha','') ~ '^[0-9a-f]{40}$'
      and coalesce(p_details->>'workerImageDigest','')
        ~ '^sha256:[0-9a-f]{64}$'
      and coalesce(p_details->>'fontManifestSha256','') ~ '^[0-9a-f]{64}$'
      and p_details->>'renderSpecVersion'='4'
      and p_details->>'captionRenderSpecVersion'='4'
    ) then
      raise exception 'file upload runtime identity evidence is incomplete'
        using errcode='23514';
    end if;

  end if;

  select * into v_existing
  from shorts_mvp.file_upload_release_checks
  where check_key=p_check_key
  for update;

  if coalesce(v_public_enabled,false) then
    if p_check_key='runtime_identity' then
      if p_passed and (
        v_existing.details->>'releaseId' is distinct from p_details->>'releaseId'
        or v_existing.details->>'sourceGitSha'
          is distinct from p_details->>'sourceGitSha'
        or v_existing.details->>'workerImageDigest'
          is distinct from p_details->>'workerImageDigest'
        or v_existing.details->>'fontManifestSha256'
          is distinct from p_details->>'fontManifestSha256'
        or v_existing.details->>'renderSpecVersion'
          is distinct from p_details->>'renderSpecVersion'
        or v_existing.details->>'captionRenderSpecVersion'
          is distinct from p_details->>'captionRenderSpecVersion'
      ) then
        raise exception 'stop public file upload before changing release identity'
          using errcode='23514';
      end if;
      if not p_passed then
        p_details := p_details || jsonb_build_object(
          'releaseId',v_existing.details->>'releaseId',
          'sourceGitSha',v_existing.details->>'sourceGitSha',
          'workerImageDigest',v_existing.details->>'workerImageDigest',
          'fontManifestSha256',v_existing.details->>'fontManifestSha256',
          'renderSpecVersion',(v_existing.details->>'renderSpecVersion')::integer,
          'captionRenderSpecVersion',
            (v_existing.details->>'captionRenderSpecVersion')::integer
        );
      end if;
    elsif v_existing.details->>'sourceGitSha' is not null then
      if p_passed and p_details->>'sourceGitSha'
        is distinct from v_existing.details->>'sourceGitSha'
      then
        raise exception 'stop public file upload before changing release evidence identity'
          using errcode='23514';
      elsif not p_passed then
        p_details := p_details || jsonb_build_object(
          'sourceGitSha',v_existing.details->>'sourceGitSha'
        );
      end if;
      if v_existing.details->>'releaseId' is not null then
        if p_passed and p_details->>'releaseId'
          is distinct from v_existing.details->>'releaseId'
        then
          raise exception 'stop public file upload before changing release evidence'
            using errcode='23514';
        elsif not p_passed then
          p_details := p_details || jsonb_build_object(
            'releaseId',v_existing.details->>'releaseId'
          );
        end if;
      end if;
    end if;
  end if;

  insert into shorts_mvp.file_upload_release_checks (
    check_key,passed,details,verified_at,verified_by_user_id,updated_at
  ) values (
    p_check_key,p_passed,p_details,clock_timestamp(),p_admin_user_id,
    clock_timestamp()
  )
  on conflict (check_key) do update
  set passed=excluded.passed,
      details=excluded.details,
      verified_at=excluded.verified_at,
      verified_by_user_id=excluded.verified_by_user_id,
      updated_at=excluded.updated_at
  returning * into v_row;

  insert into shorts_mvp.admin_audit_logs (
    actor_user_id,action,entity_type,entity_id,metadata
  ) values (
    p_admin_user_id,'file_upload.release_check_recorded',
    'file_upload_release',p_check_key,
    jsonb_build_object('passed',p_passed,'details',p_details)
  );
  return v_row;
end;
$$;

create or replace function shorts_mvp.set_file_upload_release_mode(
  p_mode text,
  p_admin_user_id uuid
)
returns table (
  mode text,
  feature_enabled boolean,
  public_enabled boolean,
  emergency_stopped boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=shorts_mvp,pg_temp
as $$
declare
  v_feature boolean;
  v_public boolean;
  v_emergency boolean;
  v_updated_at timestamptz;
  v_missing_checks text[];
  v_runtime_details jsonb;
  v_render_details jsonb;
  v_admin_details jsonb;
  v_release_id uuid;
  v_source_git_sha text;
  v_worker_image_digest text;
  v_font_manifest_sha256 text;
  v_target_count integer;
begin
  if not exists (
    select 1 from shorts_mvp.app_users
    where id=p_admin_user_id and is_admin
  ) then
    raise exception 'administrator required' using errcode='42501';
  end if;
  if p_mode not in ('stopped','admin_test','public','emergency_stop') then
    raise exception 'invalid file upload mode' using errcode='22023';
  end if;

  -- Lock the three flags before reading evidence. Session creation takes a
  -- shared lock on the same rows, so public enable/disable and job insertion
  -- cannot observe a mixed release state.
  perform 1 from shorts_mvp.runtime_feature_flags
  where flag_key in (
    'file_upload','file_upload_public','file_upload_emergency_stop'
  )
  order by flag_key
  for update;
  if (
    select count(*)
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      'file_upload','file_upload_public','file_upload_emergency_stop'
    )
  ) <> 3 then
    raise exception 'file upload release flags are incomplete'
      using errcode='23514';
  end if;

  if p_mode='public' then
    perform 1
    from shorts_mvp.file_upload_release_checks
    order by check_key
    for share;

    select array_agg(required.check_key order by required.check_key)
    into v_missing_checks
    from (
      values
        ('admin_end_to_end'),('render_parity'),('upload_1gb'),('upload_5gb'),
        ('source_cleanup'),('usage_integrity'),('runtime_identity'),
        ('no_proxy_environment'),('no_stuck_sessions')
    ) required(check_key)
    left join shorts_mvp.file_upload_release_checks checked
      on checked.check_key=required.check_key
      and checked.passed
      and checked.verified_at>=clock_timestamp()-interval '24 hours'
    where checked.check_key is null;
    if coalesce(cardinality(v_missing_checks),0)>0 then
      raise exception 'file upload public checks are incomplete: %',
        array_to_string(v_missing_checks,',') using errcode='23514';
    end if;

    select details into v_runtime_details
    from shorts_mvp.file_upload_release_checks
    where check_key='runtime_identity';
    select details into v_render_details
    from shorts_mvp.file_upload_release_checks
    where check_key='render_parity';
    select details into v_admin_details
    from shorts_mvp.file_upload_release_checks
    where check_key='admin_end_to_end';

    if not (
      coalesce(v_runtime_details->>'releaseId','')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and coalesce(v_runtime_details->>'sourceGitSha','') ~ '^[0-9a-f]{40}$'
      and coalesce(v_runtime_details->>'workerImageDigest','')
        ~ '^sha256:[0-9a-f]{64}$'
      and coalesce(v_runtime_details->>'fontManifestSha256','')
        ~ '^[0-9a-f]{64}$'
      and v_runtime_details->>'renderSpecVersion'='4'
      and v_runtime_details->>'captionRenderSpecVersion'='4'
    ) then
      raise exception 'file upload runtime identity evidence is incomplete'
        using errcode='23514';
    end if;

    v_release_id := (v_runtime_details->>'releaseId')::uuid;
    v_source_git_sha := v_runtime_details->>'sourceGitSha';
    v_worker_image_digest := v_runtime_details->>'workerImageDigest';
    v_font_manifest_sha256 := v_runtime_details->>'fontManifestSha256';

    if v_render_details->>'releaseId' is distinct from v_release_id::text
      or v_render_details->>'sourceGitSha' is distinct from v_source_git_sha
      or v_admin_details->>'sourceGitSha' is distinct from v_source_git_sha
      or v_admin_details->>'releaseId' is distinct from v_release_id::text
      or exists (
        select 1
        from shorts_mvp.file_upload_release_checks checked
        where checked.details->>'sourceGitSha' is distinct from v_source_git_sha
      )
    then
      raise exception 'file upload release evidence identities do not match'
        using errcode='23514';
    end if;

    perform 1
    from shorts_mvp.editor_release_state state
    join shorts_mvp.runtime_feature_flags runtime
      on runtime.flag_key='editor_rendering_v2'
    join shorts_mvp.editor_releases release
      on release.id=v_release_id
    where state.singleton
      and v_release_id in (state.stable_release_id,state.candidate_release_id)
      and runtime.enabled
      and not state.render_v4_kill_switch
      and not (
        state.render_v4_infra_lease_id is not null
        and state.render_v4_infra_lease_expires_at>clock_timestamp()
      )
      and release.git_sha=v_source_git_sha
      and release.worker_image_digest=v_worker_image_digest
      and release.font_manifest_sha256=v_font_manifest_sha256
      and release.render_spec_version=4
      and release.caption_render_spec_version=4
      and release.status in (
        'staging_verified','canary_ready','canary_active','approved','stable'
      )
      and release.staging_verified_at is not null
      and (release.status<>'stable' or release.promoted_at is not null)
    for share of state,runtime,release;
    if not found then
      raise exception 'file upload verified release is unavailable'
        using errcode='23514';
    end if;

    select count(*)::integer into v_target_count
    from shorts_mvp.editor_release_project_targets target
    where target.release_id=v_release_id
      and target.target_key in (
        'legacy_project','source_range','elevenlabs_transcription',
        'subtitle_templates','unified_template_subtitles'
      )
      and target.worker_source_git_sha=v_source_git_sha
      and target.worker_image_digest=v_worker_image_digest;
    if v_target_count<>5 then
      raise exception 'file upload verified release targets are incomplete'
        using errcode='23514';
    end if;
  end if;

  v_feature := p_mode in ('admin_test','public');
  v_public := p_mode='public';
  v_emergency := p_mode='emergency_stop';

  update shorts_mvp.runtime_feature_flags
  set enabled=case flag_key
      when 'file_upload' then v_feature
      when 'file_upload_public' then v_public
      when 'file_upload_emergency_stop' then v_emergency
    end,
    updated_by_user_id=p_admin_user_id
  where flag_key in (
    'file_upload','file_upload_public','file_upload_emergency_stop'
  );
  select max(flag.updated_at) into v_updated_at
  from shorts_mvp.runtime_feature_flags flag
  where flag.flag_key in (
    'file_upload','file_upload_public','file_upload_emergency_stop'
  );

  insert into shorts_mvp.admin_audit_logs (
    actor_user_id,action,entity_type,entity_id,metadata
  ) values (
    p_admin_user_id,'file_upload.release_mode_changed',
    'file_upload_release','singleton',
    jsonb_strip_nulls(jsonb_build_object(
      'mode',p_mode,'releaseId',v_release_id
    ))
  );

  return query select p_mode,v_feature,v_public,v_emergency,v_updated_at;
end;
$$;

revoke all on function shorts_mvp.record_file_upload_release_check(
  text,boolean,jsonb,uuid
) from public,anon,authenticated;
grant execute on function shorts_mvp.record_file_upload_release_check(
  text,boolean,jsonb,uuid
) to service_role;
revoke all on function shorts_mvp.set_file_upload_release_mode(text,uuid)
  from public,anon,authenticated;
grant execute on function shorts_mvp.set_file_upload_release_mode(text,uuid)
  to service_role;

comment on function shorts_mvp.set_file_upload_release_mode(text,uuid) is
  'Atomically changes file-upload flags and pins public mode to fresh exact release evidence.';

comment on function shorts_mvp.record_file_upload_release_check(
  text,boolean,jsonb,uuid
) is 'Stores audited release evidence and prevents live public identity replacement.';

commit;
