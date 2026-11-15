-- Independent language/social admission guards must not bypass a durable handoff.
-- INSERT only: already admitted jobs, retries and edits retain their pinned runtime.
create or replace function shorts_mvp.enforce_project_successor_all_routes_fence()
returns trigger language plpgsql security definer
set search_path=shorts_mvp,pg_temp
as $$
declare v_operation jsonb; v_admin_release uuid;
begin
  if new.source_type='upload' or new.pipeline_version<>2 then return new; end if;
  select render_v4_target_successor into v_operation
    from shorts_mvp.editor_release_state where singleton for share;
  if v_operation is null or (v_operation->'version'='1'::jsonb
    and v_operation->>'phase'='active') then return new; end if;
  if v_operation->'version'='1'::jsonb and v_operation->>'phase'='admin_ready' then
    v_admin_release:=shorts_mvp.editor_target_successor_admin_release(new.user_id);
    if v_admin_release is not null and new.initial_editor_release_id=v_admin_release
      and new.initial_render_spec_version=4 and new.initial_caption_render_spec_version=4
    then return new; end if;
  end if;
  raise exception 'INITIAL_RENDER_RELEASE_HANDOFF' using errcode='P0001';
end;
$$;
revoke all on function shorts_mvp.enforce_project_successor_all_routes_fence()
  from public,anon,authenticated,service_role;
create trigger video_jobs_project_successor_all_routes_fence
  before insert on shorts_mvp.video_jobs
  for each row execute function shorts_mvp.enforce_project_successor_all_routes_fence();
