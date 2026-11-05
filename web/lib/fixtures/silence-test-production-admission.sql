CREATE OR REPLACE FUNCTION shorts_mvp.enforce_project_target_successor_admission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'shorts_mvp', 'pg_temp'
AS $function$
declare
  v_state shorts_mvp.editor_release_state%rowtype;
  v_operation jsonb; v_registry jsonb; v_target jsonb; v_admin_release uuid;
  v_expected_release uuid; v_runtime_enabled boolean; v_rollout_bucket smallint;
begin
  if new.midform_request is not null then
    perform shorts_mvp.assert_midform_job(new);
    return new;
  end if;
  if new.language_test_release_id is not null then
    perform shorts_mvp.assert_language_test_job(new);
    return new;
  end if;
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
$function$

