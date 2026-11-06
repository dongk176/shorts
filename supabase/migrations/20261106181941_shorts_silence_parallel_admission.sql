begin;
-- Additive parallel admission. Does not rotate stable targets or stop intake.
set local lock_timeout='2s';
set local statement_timeout='30s';
create table shorts_mvp.shorts_silence_routes (
  release_id uuid primary key references shorts_mvp.editor_releases(id),
  predecessor_release_id uuid not null references shorts_mvp.editor_releases(id),
  proof jsonb not null,
  registered_by uuid not null references shorts_mvp.app_users(id),
  registered_at timestamptz not null default clock_timestamp()
);
create table shorts_mvp.shorts_silence_routing (
  singleton boolean primary key default true check(singleton),
  release_id uuid references shorts_mvp.shorts_silence_routes(release_id),
  enabled boolean not null default false,
  percentage smallint not null default 0 check(percentage between 0 and 100)
);
insert into shorts_mvp.shorts_silence_routing(singleton) values(true);
alter table shorts_mvp.shorts_silence_routes enable row level security;
alter table shorts_mvp.shorts_silence_routing enable row level security;
revoke all on shorts_mvp.shorts_silence_routes,shorts_mvp.shorts_silence_routing from public,anon,authenticated,service_role;
grant select on shorts_mvp.shorts_silence_routes,shorts_mvp.shorts_silence_routing to service_role;
alter table shorts_mvp.video_jobs add column silence_inline_release_id uuid references shorts_mvp.shorts_silence_routes(release_id);

alter table shorts_mvp.video_jobs drop constraint video_jobs_language_test_context;
alter table shorts_mvp.video_jobs add constraint video_jobs_language_test_context check (
  (language_test_release_id is null and source_language_hint is null)
  or (language_test_release_id is not null and source_language_hint is not null
    and source_language_hint in ('auto','ko','en','ja') and output_language in ('ko','en','ja')
    and source_type is not distinct from 'youtube' and pipeline_version is not distinct from 2
    and initial_editor_release_id is not distinct from language_test_release_id
    and initial_render_spec_version is not distinct from 4 and initial_caption_render_spec_version is not distinct from 4)
  or (silence_test_release_id is not null and language_test_release_id is null
    and source_language_hint is not null and source_language_hint in ('auto','ko','en','ja')
    and output_language in ('ko','en','ja')
    and source_type is not distinct from 'youtube' and pipeline_version is not distinct from 2
    and initial_editor_release_id is not distinct from silence_test_release_id
    and initial_render_spec_version is not distinct from 4 and initial_caption_render_spec_version is not distinct from 4)
  or (silence_inline_release_id is not null and language_test_release_id is null and silence_test_release_id is null
    and source_language_hint is not null and source_language_hint in ('auto','ko','en','ja')
    and output_language in ('ko','en','ja') and source_type is not distinct from 'youtube'
    and pipeline_version is not distinct from 2 and initial_editor_release_id is not distinct from silence_inline_release_id
    and initial_render_spec_version is not distinct from 4 and initial_caption_render_spec_version is not distinct from 4)
) not valid;

create function shorts_mvp.register_shorts_silence_route(p_previous uuid,p_release uuid,p_admin uuid)
returns void language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare evidence jsonb;
begin
  if not exists(select 1 from shorts_mvp.app_users where id=p_admin and is_admin) then
    raise exception 'SILENCE_ROUTE_ADMIN_REQUIRED' using errcode='42501';
  end if;
  -- Reuse all fifteen finalized checks, attested targets and predecessor contracts.
  -- This reads their proof only; no successor fence or pointer is changed.
  evidence:=shorts_mvp._project_target_successor_contract(p_previous,p_release,false);
  insert into shorts_mvp.shorts_silence_routes(release_id,predecessor_release_id,proof,registered_by)
    values(p_release,p_previous,evidence,p_admin);
end;
$$;
revoke all on function shorts_mvp.register_shorts_silence_route(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function shorts_mvp.register_shorts_silence_route(uuid,uuid,uuid) to service_role;

create function shorts_mvp.silence_rollout_bucket(p_user uuid,p_release uuid)
returns integer language sql immutable security invoker set search_path=shorts_mvp,pg_temp as $$
  select ((('x'||substr(encode(sha256(convert_to('silence-inline:'||p_release::text||':'||p_user::text,'UTF8')),'hex'),1,8))::bit(32)::bigint)%100)::integer;
$$;
revoke all on function shorts_mvp.silence_rollout_bucket(uuid,uuid) from public,anon,authenticated;
grant execute on function shorts_mvp.silence_rollout_bucket(uuid,uuid) to service_role;

create function shorts_mvp.assert_shorts_silence_inline_job(p_job shorts_mvp.video_jobs,p_admitting boolean default true)
returns void language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare route record; target record; settings record; state record; admin boolean;
begin
  select r.*,e.git_sha,e.worker_image_digest,e.font_manifest_sha256,e.status,
    e.staging_verified_at,e.render_spec_version,e.caption_render_spec_version into route
    from shorts_mvp.shorts_silence_routes r join shorts_mvp.editor_releases e on e.id=r.release_id
    where r.release_id=p_job.silence_inline_release_id for share of r,e;
  if not found or route.status not in ('canary_ready','canary_active','approved','stable')
    or route.staging_verified_at is null or route.render_spec_version<>4 or route.caption_render_spec_version<>4
    or route.proof->>'sourceGitSha' is distinct from route.git_sha
    or route.proof->>'workerImageDigest' is distinct from route.worker_image_digest
    or route.proof->>'fontManifestSha256' is distinct from route.font_manifest_sha256
  then raise exception 'SILENCE_ROUTE_UNVERIFIED'; end if;
  select is_admin into admin from shorts_mvp.app_users where id=p_job.user_id;
  if not found then raise exception 'SILENCE_ROUTE_OWNER_REQUIRED'; end if;
  select * into state from shorts_mvp.editor_release_state where singleton for share;
  if not found or state.render_v4_kill_switch
    or (state.render_v4_infra_lease_id is not null and state.render_v4_infra_lease_expires_at>clock_timestamp())
    or not exists(select 1 from shorts_mvp.runtime_feature_flags where flag_key='editor_rendering_v2' and enabled)
  then raise exception 'SILENCE_ROUTE_RENDERING_STOPPED'; end if;
  if p_admitting then
    select * into settings from shorts_mvp.shorts_silence_routing where singleton for share;
    if not found or not settings.enabled or settings.release_id is distinct from route.release_id
      or (not admin and (shorts_mvp.silence_rollout_bucket(p_job.user_id,route.release_id)>=settings.percentage
        or not exists(select 1 from shorts_mvp.runtime_feature_flags where flag_key='public_shorts_silence' and enabled)))
      or not exists(select 1 from shorts_mvp.runtime_feature_flags where flag_key='admin_shorts_silence' and enabled)
    then raise exception 'SILENCE_ROUTE_NOT_SELECTED'; end if;
  end if;
  if p_job.source_type is distinct from 'youtube' or p_job.pipeline_version is distinct from 2
    or p_job.is_example is distinct from false or p_job.output_language not in ('ko','en','ja')
    or p_job.output_language is null or p_job.midform_request is not null
    or p_job.language_test_release_id is not null or p_job.silence_test_release_id is not null
    or p_job.template_snapshot->'shortsSilenceRemoval' is distinct from '{"version":1,"preset":"aggressive"}'::jsonb
    or p_job.initial_editor_release_id is distinct from route.release_id
    or p_job.initial_render_spec_version is distinct from 4 or p_job.initial_caption_render_spec_version is distinct from 4
  then raise exception 'SILENCE_ROUTE_BINDING_INVALID'; end if;
  select * into target from shorts_mvp.editor_release_project_targets
    where release_id=route.release_id and target_key=p_job.batch_target_key for share;
  if not found or p_job.batch_target_release_id is distinct from target.batch_target_release_id
    or p_job.batch_job_definition is distinct from target.job_definition_arn
    or p_job.batch_job_queue is distinct from target.job_queue_arn
    or target.job_queue_arn like '%editor-test%'
    or target.worker_source_git_sha is distinct from route.git_sha
    or target.worker_image_digest is distinct from route.worker_image_digest
    or route.proof#>>array['newTargets',p_job.batch_target_key,'jobDefinitionArn'] is distinct from target.job_definition_arn
    or route.proof#>>array['newTargets',p_job.batch_target_key,'jobQueueArn'] is distinct from target.job_queue_arn
  then raise exception 'SILENCE_ROUTE_TARGET_INVALID'; end if;
end;
$$;
revoke all on function shorts_mvp.assert_shorts_silence_inline_job(shorts_mvp.video_jobs,boolean) from public,anon,authenticated;
grant execute on function shorts_mvp.assert_shorts_silence_inline_job(shorts_mvp.video_jobs,boolean) to service_role;

-- Both triggers validate the same non-counting assertion. Existing bodies remain
-- byte-for-byte intact after the new, narrowly marked branch.
do $$ declare body text; name text;
begin
  foreach name in array array['enforce_project_target_successor_admission','enforce_language_request_binding'] loop
    body:=pg_get_functiondef(('shorts_mvp.'||name||'()')::regprocedure);
    if position(E'begin\n' in body)=0 or position('silence_inline_release_id' in body)>0
      or (name='enforce_project_target_successor_admission' and position('assert_silence_test_job' in body)=0)
      or (name='enforce_language_request_binding' and position('LANGUAGE_RELEASE_REQUIRED' in body)=0)
    then raise exception 'SILENCE_ROUTE_GUARD_BASELINE_CHANGED'; end if;
    body:=overlay(body placing E'begin\n  if new.silence_inline_release_id is not null then\n    perform shorts_mvp.assert_shorts_silence_inline_job(new,true);\n    return new;\n  end if;\n' from position(E'begin\n' in body) for 6);
    execute body;
  end loop;
end $$;

create function shorts_mvp.preserve_shorts_silence_inline_binding() returns trigger
language plpgsql security invoker set search_path=shorts_mvp,pg_temp as $$
begin
  if new.silence_inline_release_id is distinct from old.silence_inline_release_id
    or (old.silence_inline_release_id is not null and
      row(new.user_id,new.source_type,new.pipeline_version,new.is_example,new.output_language,new.custom_template_id,new.source_language_hint,
        new.template_snapshot,new.midform_request,new.language_test_release_id,new.silence_test_release_id,
        new.initial_editor_release_id,new.initial_render_spec_version,new.initial_caption_render_spec_version,
        new.batch_target_key,new.batch_target_release_id,new.batch_job_definition,new.batch_job_queue)
      is distinct from
      row(old.user_id,old.source_type,old.pipeline_version,old.is_example,old.output_language,old.custom_template_id,old.source_language_hint,
        old.template_snapshot,old.midform_request,old.language_test_release_id,old.silence_test_release_id,
        old.initial_editor_release_id,old.initial_render_spec_version,old.initial_caption_render_spec_version,
        old.batch_target_key,old.batch_target_release_id,old.batch_job_definition,old.batch_job_queue))
  then raise exception 'SILENCE_ROUTE_IDENTITY_IMMUTABLE'; end if;
  return new;
end;
$$;
revoke all on function shorts_mvp.preserve_shorts_silence_inline_binding() from public,anon,authenticated;
create trigger video_jobs_silence_inline_identity before update on shorts_mvp.video_jobs
for each row execute function shorts_mvp.preserve_shorts_silence_inline_binding();

create function shorts_mvp.assert_shorts_silence_inline_render(p_request shorts_mvp.editor_render_requests)
returns boolean language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare job shorts_mvp.video_jobs%rowtype;
begin
  select j.* into job from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
    where s.id=p_request.short_id and j.silence_inline_release_id is not null
      and s.user_id=p_request.user_id and j.user_id=p_request.user_id
      and s.deleted_at is null and j.user_deleted_at is null and s.expires_at>clock_timestamp();
  if not found then
    if exists(select 1 from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
      where s.id=p_request.short_id and j.silence_inline_release_id is not null) then
      raise exception 'SILENCE_ROUTE_EDITOR_OWNER_INVALID';
    end if;
    return false;
  end if;
  if p_request.release_id is distinct from job.silence_inline_release_id or p_request.release_channel is distinct from 'canary' then
    raise exception 'SILENCE_ROUTE_EDITOR_PIN_INVALID';
  end if;
  perform shorts_mvp.assert_shorts_silence_inline_job(job,false);
  return true;
end;
$$;
revoke all on function shorts_mvp.assert_shorts_silence_inline_render(shorts_mvp.editor_render_requests) from public,anon,authenticated;
grant execute on function shorts_mvp.assert_shorts_silence_inline_render(shorts_mvp.editor_render_requests) to service_role;

do $$ declare body text;
begin
  body:=pg_get_functiondef('shorts_mvp.enforce_silence_test_editor_binding()'::regprocedure);
  if position(E'begin\n' in body)=0 or position('SILENCE_TEST_EDITOR_BINDING_INVALID' in body)=0
    or position('assert_shorts_silence_inline_render' in body)>0 then
    raise exception 'SILENCE_ROUTE_EDITOR_BASELINE_CHANGED';
  end if;
  body:=overlay(body placing E'begin\n  if shorts_mvp.assert_shorts_silence_inline_render(new) then return new; end if;\n'
    from position(E'begin\n' in body) for 6);
  execute body;
end $$;

create function shorts_mvp.shorts_silence_route_for_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=shorts_mvp,pg_temp as $$
declare job shorts_mvp.video_jobs%rowtype; route record; registry jsonb;
begin
  select * into strict job from shorts_mvp.video_jobs where id=p_job_id;
  perform shorts_mvp.assert_shorts_silence_inline_job(job,false);
  select e.*,r.proof into strict route from shorts_mvp.shorts_silence_routes r
    join shorts_mvp.editor_releases e on e.id=r.release_id where r.release_id=job.silence_inline_release_id;
  select jsonb_build_object('version',1,'environment','production','lanes',jsonb_object_agg(t.target_key,
    jsonb_build_object('previous',null,'schedulingMode',case when t.target_key='unified_template_subtitles' then 'fifo' else 'fair_share' end,
    'current',jsonb_build_object('releaseId',t.batch_target_release_id,'workerSourceGitSha',t.worker_source_git_sha,
      'imageUri','181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/shorts-mvp-editor-releases-production@'||t.worker_image_digest,
      'jobDefinitionArn',t.job_definition_arn,'jobQueueArn',t.job_queue_arn,'renderSpecVersion',4,
      'captionRenderSpecVersion',4,'fontManifestSha256',route.font_manifest_sha256)))) into registry
    from shorts_mvp.editor_release_project_targets t where t.release_id=route.id;
  if (select count(*) from jsonb_object_keys(registry->'lanes'))<>5 then raise exception 'SILENCE_ROUTE_TARGETS_INCOMPLETE'; end if;
  return jsonb_build_object('id',route.id,'userId',job.user_id,'registry',registry,
    'release',jsonb_build_object('git_sha',route.git_sha,'worker_image_digest',route.worker_image_digest,
      'font_manifest_sha256',route.font_manifest_sha256,'production_job_definition_arn',route.production_job_definition_arn));
end;
$$;
revoke all on function shorts_mvp.shorts_silence_route_for_job(uuid) from public,anon,authenticated;
grant execute on function shorts_mvp.shorts_silence_route_for_job(uuid) to service_role;
commit;
