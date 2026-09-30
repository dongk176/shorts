begin;
set local lock_timeout='3s';
do $$ declare signature text; body text; old text; begin
  foreach signature in array array[
    'shorts_mvp.assert_community_template_job(shorts_mvp.video_jobs)',
    'shorts_mvp.assert_community_editor_request(shorts_mvp.editor_render_requests)',
    'shorts_mvp.assert_sns_template_job(shorts_mvp.video_jobs)',
    'shorts_mvp.assert_sns_editor_request(shorts_mvp.editor_render_requests)',
    'shorts_mvp.enforce_language_test_editor_binding()'
  ] loop
    body:=pg_get_functiondef(signature::regprocedure);
    if position('46d7f96b-7e16-4fa6-920f-b3c915cad8e8' in body)>0 or position('d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33' in body)>0 then
      raise exception 'COMMUNITY_PUBLIC_BASELINE_CHANGED';
    end if;
    old:=body;
    body:=replace(body,$old$'1ce342d0-cf2d-41b4-961b-f3abd9f4e336'::uuid)$old$,$new$'1ce342d0-cf2d-41b4-961b-f3abd9f4e336'::uuid,'46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid)$new$);
    body:=replace(body,$old$'242f96a3-fe3b-4f20-a006-3c6559d98573'::uuid)$old$,$new$'242f96a3-fe3b-4f20-a006-3c6559d98573'::uuid,'d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33'::uuid)$new$);
    if body=old then raise exception 'COMMUNITY_PUBLIC_BASELINE_CHANGED'; end if;
    if signature='shorts_mvp.assert_community_template_job(shorts_mvp.video_jobs)' then
      if position('and is_admin for share' in body)=0 then raise exception 'COMMUNITY_PUBLIC_OWNER_BASELINE_CHANGED'; end if;
      body:=replace(body,'and is_admin for share',$public$and (is_admin or p_job.language_test_release_id='46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid) for share$public$);
      body:=replace(body,$old$l.verification->>'kind'='community_admin_generation_only'$old$,$new$l.verification->>'kind'=case when l.id='46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid then 'community_public_generation' else 'community_admin_generation_only' end$new$);
    elsif signature='shorts_mvp.assert_community_editor_request(shorts_mvp.editor_render_requests)' then
      if position('u.id=j.user_id and u.is_admin' in body)=0 then raise exception 'COMMUNITY_PUBLIC_OWNER_BASELINE_CHANGED'; end if;
      body:=replace(body,'u.id=j.user_id and u.is_admin',$public$u.id=j.user_id and (u.is_admin or p_request.release_id='d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33'::uuid)$public$);
    end if;
    execute body;
  end loop;
end $$;
commit;
