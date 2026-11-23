begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Editing-only release control. Never changes generation admission, project
-- target registries, the global stable pointer, or existing request bindings.
create table shorts_mvp.editor_render_successor (
  singleton boolean primary key default true check(singleton),
  predecessor_release_id uuid not null references shorts_mvp.editor_releases(id),
  successor_release_id uuid not null unique references shorts_mvp.editor_releases(id),
  web_source_sha text not null check(web_source_sha ~ '^[0-9a-f]{40}$'),
  phase text not null default 'off' check(phase in ('off','internal','public')),
  proof jsonb not null,
  baseline_flags jsonb not null,
  updated_by_user_id uuid not null references shorts_mvp.app_users(id),
  updated_at timestamptz not null default clock_timestamp(),
  check(predecessor_release_id<>successor_release_id)
);
alter table shorts_mvp.editor_render_successor enable row level security;
revoke all on shorts_mvp.editor_render_successor from public,anon,authenticated,service_role;
grant select on shorts_mvp.editor_render_successor to service_role;

create function shorts_mvp._editor_render_successor_proof(p_previous uuid,p_successor uuid)
returns jsonb language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare state shorts_mvp.editor_release_state%rowtype; proof jsonb;
begin
  select * into strict state from shorts_mvp.editor_release_state where singleton for share;
  if state.stable_release_id is distinct from p_previous
    or state.public_enabled is distinct from true or state.render_v4_kill_switch is distinct from false
    or state.canary_enabled is distinct from false
    or (state.render_v4_infra_lease_id is not null
      and state.render_v4_infra_lease_expires_at>clock_timestamp())
    or (state.render_v4_target_successor is not null
      and (state.render_v4_target_successor->'version' is distinct from '1'::jsonb
        or state.render_v4_target_successor->>'phase' is distinct from 'active'))
    or not exists(select 1 from shorts_mvp.runtime_feature_flags
      where flag_key='editor_rendering_v2' and enabled)
  then raise exception 'EDITOR_RENDER_SUCCESSOR_BASELINE_CHANGED' using errcode='40001'; end if;
  -- Reuse the existing finalized-artifact and fifteen-check attestation. This
  -- reads the generation targets as provenance; it does not rotate them.
  proof:=shorts_mvp._project_target_successor_contract(p_previous,p_successor);
  if not exists(select 1 from shorts_mvp.editor_releases old_release
    join shorts_mvp.editor_releases new_release on new_release.id=p_successor
    where old_release.id=p_previous and old_release.ui_version=3 and old_release.document_version=3
      and new_release.ui_version=old_release.ui_version
      and new_release.document_version=old_release.document_version
      and new_release.font_manifest_sha256=old_release.font_manifest_sha256)
  then raise exception 'EDITOR_RENDER_SUCCESSOR_FORMAT_CHANGED' using errcode='23514'; end if;
  return proof;
end;
$$;

create function shorts_mvp.configure_editor_render_successor(
  p_admin uuid,p_previous uuid,p_successor uuid,p_web_source_sha text,p_phase text
)
returns void language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare existing shorts_mvp.editor_render_successor%rowtype; proof jsonb; flags jsonb;
  required_checks constant text[]:=array['save-render-download','gemini-comments',
    'reopen-reedit','rollback-drill','initial-project-admission'];
begin
  perform 1 from shorts_mvp.app_users where id=p_admin and is_admin
    and withdrawn_at is null for share;
  if not found then raise exception 'EDITOR_RENDER_SUCCESSOR_ADMIN_REQUIRED'; end if;
  -- Serialize with other release-state transitions without setting any
  -- admission-blocking lease or rewriting that state.
  perform 1 from shorts_mvp.editor_release_state where singleton for update;
  select * into existing from shorts_mvp.editor_render_successor where singleton for update;
  if p_phase not in ('off','internal','public') or p_phase is null
    or p_web_source_sha is null or p_web_source_sha !~ '^[0-9a-f]{40}$'
  then raise exception 'EDITOR_RENDER_SUCCESSOR_INVALID_TRANSITION'; end if;
  if existing.singleton and (existing.predecessor_release_id is distinct from p_previous
    or existing.successor_release_id is distinct from p_successor
    or existing.web_source_sha is distinct from p_web_source_sha)
  then raise exception 'EDITOR_RENDER_SUCCESSOR_IDENTITY_CHANGED'; end if;
  if p_phase='off' then
    if not existing.singleton then raise exception 'EDITOR_RENDER_SUCCESSOR_NOT_REGISTERED'; end if;
    update shorts_mvp.editor_render_successor set phase='off',updated_by_user_id=p_admin,
      updated_at=clock_timestamp() where singleton;
  else
    proof:=shorts_mvp._editor_render_successor_proof(p_previous,p_successor);
    flags:=shorts_mvp._project_target_successor_flags();
    if existing.singleton and (existing.proof is distinct from proof
      or existing.baseline_flags is distinct from flags)
    then raise exception 'EDITOR_RENDER_SUCCESSOR_PROOF_CHANGED'; end if;
    if p_phase='internal' and not exists(select 1 from shorts_mvp.editor_release_testers
      where user_id=p_admin and enabled)
    then raise exception 'EDITOR_RENDER_SUCCESSOR_TESTER_REQUIRED'; end if;
    if p_phase='public' then
      if existing.phase is distinct from 'internal' then
        raise exception 'EDITOR_RENDER_SUCCESSOR_INTERNAL_REQUIRED';
      end if;
      if exists(select 1 from unnest(required_checks) name where not exists(
        select 1 from shorts_mvp.editor_release_checks c where c.release_id=p_successor
          and c.environment='production_canary' and c.check_name=name and c.status='passed'
          and c.completed_at is not null and c.artifact_uri is not null
          and c.details->>'webSourceGitSha'=p_web_source_sha
          and c.details->>'deploymentId' ~ '^dpl_[A-Za-z0-9]+$'))
        or (select count(distinct c.details->>'deploymentId')
          from shorts_mvp.editor_release_checks c where c.release_id=p_successor
          and c.environment='production_canary' and c.check_name=any(required_checks))<>1
      then raise exception 'EDITOR_RENDER_SUCCESSOR_CANARY_CHECKS_REQUIRED'; end if;
      if exists(select 1 from shorts_mvp.editor_render_requests where release_id=p_successor
        and status in ('queued','rendering','failed'))
        or not exists(select 1 from shorts_mvp.editor_render_requests where release_id=p_successor
          and release_channel='canary' and status='succeeded' and completed_at is not null
          and batch_job_id is not null and worker_image_digest=proof->>'workerImageDigest')
      then raise exception 'EDITOR_RENDER_SUCCESSOR_CANARY_RENDER_REQUIRED'; end if;
    end if;
    insert into shorts_mvp.editor_render_successor(singleton,predecessor_release_id,
      successor_release_id,web_source_sha,phase,proof,baseline_flags,updated_by_user_id)
    values(true,p_previous,p_successor,p_web_source_sha,p_phase,proof,flags,p_admin)
    on conflict(singleton) do update set phase=excluded.phase,
      updated_by_user_id=p_admin,updated_at=clock_timestamp();
  end if;
  insert into shorts_mvp.admin_audit_logs(actor_user_id,action,entity_type,entity_id,metadata)
    values(p_admin,'editor_release.render_successor_'||p_phase,'editor_release',p_successor::text,
      jsonb_build_object('predecessorReleaseId',p_previous,'webSourceGitSha',p_web_source_sha,
        'generationTargetsChanged',false));
end;
$$;

create function shorts_mvp.resolve_editor_render_successor(
  p_user uuid,p_short uuid,p_previous uuid,p_web_source_sha text
)
returns table(release_id uuid,release_channel text,ui_version integer,document_version integer,
  render_spec_version integer,caption_render_spec_version integer,font_manifest_sha256 text)
language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare config shorts_mvp.editor_render_successor%rowtype; proof jsonb;
begin
  perform 1 from shorts_mvp.editor_release_state where singleton for share;
  select * into config from shorts_mvp.editor_render_successor where singleton for share;
  if not found or config.phase='off' or config.predecessor_release_id is distinct from p_previous
    or config.web_source_sha is distinct from p_web_source_sha or p_user is null then return; end if;
  begin
    proof:=shorts_mvp._editor_render_successor_proof(p_previous,config.successor_release_id);
  exception when check_violation or serialization_failure or no_data_found then return;
  end;
  if config.proof is distinct from proof
    or config.baseline_flags is distinct from shorts_mvp._project_target_successor_flags()
  then return; end if;
  if config.phase='internal' and not exists(select 1 from shorts_mvp.app_users u
    join shorts_mvp.editor_release_testers t on t.user_id=u.id and t.enabled
    where u.id=p_user and u.is_admin and u.withdrawn_at is null) then return; end if;
  perform 1 from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
    join shorts_mvp.app_users u on u.id=s.user_id and u.withdrawn_at is null
    join shorts_mvp.editor_release_state state on state.singleton
    where s.id=p_short and s.user_id=p_user and j.user_id=p_user
      and s.deleted_at is null and j.user_deleted_at is null and s.expires_at>clock_timestamp()
      and j.source_type='youtube' and j.pipeline_version=2
      and to_jsonb(j)->>'language_test_release_id' is null
      and to_jsonb(j)->>'silence_test_release_id' is null
      and to_jsonb(j)->>'silence_inline_release_id' is null
      and to_jsonb(j)->>'midform_release_id' is null
      and j.template_snapshot->>'snsTemplateVersion' is null
      and j.template_snapshot->>'communityTemplateVersion' is null
      and state.render_v4_rollout_percent>((('x'||substr(md5(p_user::text||':editor-render-v4'),1,8))::bit(32)::bigint)%100)
    for share of s,j,u,state;
  if not found then return; end if;
  return query select e.id,case config.phase when 'internal' then 'canary' else 'stable' end,
    e.ui_version::integer,e.document_version::integer,e.render_spec_version::integer,
    e.caption_render_spec_version::integer,e.font_manifest_sha256
    from shorts_mvp.editor_releases e where e.id=config.successor_release_id;
end;
$$;

create function shorts_mvp.enforce_editor_render_successor_request()
returns trigger language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare config shorts_mvp.editor_render_successor%rowtype; assigned record;
begin
  perform 1 from shorts_mvp.editor_release_state where singleton for share;
  select * into config from shorts_mvp.editor_render_successor
    where singleton and successor_release_id=new.release_id for share;
  if not found then return new; end if;
  select * into assigned from shorts_mvp.resolve_editor_render_successor(
    new.user_id,new.short_id,config.predecessor_release_id,config.web_source_sha);
  if not found or assigned.release_id is distinct from new.release_id
    or assigned.release_channel is distinct from new.release_channel
    or not exists(select 1 from shorts_mvp.generated_shorts s where s.id=new.short_id
      and s.user_id=new.user_id and s.render_version=new.base_render_version)
  then raise exception 'EDITOR_RENDER_SUCCESSOR_REQUEST_REJECTED'; end if;
  return new;
end;
$$;
create trigger editor_requests_render_successor_binding before insert
  on shorts_mvp.editor_render_requests for each row
  execute function shorts_mvp.enforce_editor_render_successor_request();

revoke all on function shorts_mvp._editor_render_successor_proof(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function shorts_mvp.configure_editor_render_successor(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function shorts_mvp.resolve_editor_render_successor(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function shorts_mvp.enforce_editor_render_successor_request() from public,anon,authenticated,service_role;
grant execute on function shorts_mvp.configure_editor_render_successor(uuid,uuid,uuid,text,text) to service_role;
grant execute on function shorts_mvp.resolve_editor_render_successor(uuid,uuid,uuid,text) to service_role;
commit;
