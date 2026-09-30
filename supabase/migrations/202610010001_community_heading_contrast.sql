begin;
set local lock_timeout='3s';
-- Extend only exact immutable community releases. Ownership, verification and old gates stay intact.
do $$ declare signature text; body text; old text; begin
  foreach signature in array array[
    'shorts_mvp.assert_community_template_job(shorts_mvp.video_jobs)',
    'shorts_mvp.assert_community_editor_request(shorts_mvp.editor_render_requests)',
    'shorts_mvp.assert_sns_template_job(shorts_mvp.video_jobs)',
    'shorts_mvp.assert_sns_editor_request(shorts_mvp.editor_render_requests)',
    'shorts_mvp.enforce_language_test_editor_binding()'
  ] loop
    body:=pg_get_functiondef(signature::regprocedure);
    if position('8b0a6b0f-ab5d-43dd-afce-b3a2409b59b9' in body)>0 or position('ca57c1ae-c841-4f44-835a-f566a3c097c1' in body)>0 then
      raise exception 'COMMUNITY_CONTRAST_BASELINE_CHANGED';
    end if;
    old:=body;
    body:=replace(body,$old$p_job.language_test_release_id='46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid$old$,$new$p_job.language_test_release_id in ('46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid,'8b0a6b0f-ab5d-43dd-afce-b3a2409b59b9'::uuid)$new$);
    body:=replace(body,$old$p_request.release_id='d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33'::uuid$old$,$new$p_request.release_id in ('d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33'::uuid,'ca57c1ae-c841-4f44-835a-f566a3c097c1'::uuid)$new$);
    body:=replace(body,$old$l.id='46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid then$old$,$new$l.id in ('46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid,'8b0a6b0f-ab5d-43dd-afce-b3a2409b59b9'::uuid) then$new$);
    body:=replace(body,$old$'46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid)$old$,$new$'46d7f96b-7e16-4fa6-920f-b3c915cad8e8'::uuid,'8b0a6b0f-ab5d-43dd-afce-b3a2409b59b9'::uuid)$new$);
    body:=replace(body,$old$'d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33'::uuid)$old$,$new$'d1bb4c9d-f055-4cbe-bdbd-318e51ffdf33'::uuid,'ca57c1ae-c841-4f44-835a-f566a3c097c1'::uuid)$new$);
    if body=old then raise exception 'COMMUNITY_CONTRAST_BASELINE_CHANGED'; end if;
    execute body;
  end loop;
end $$;
commit;
