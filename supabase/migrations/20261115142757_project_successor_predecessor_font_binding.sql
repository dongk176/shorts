-- Compare each registry against its own finalized font identity.
-- The protected contract has already verified the immutable additive-font proof.
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
    p_binding->'oldRegistry',v_proof->'oldTargets',v_proof#>>'{compatibleSuccessor,fontManifestSha256}');
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
