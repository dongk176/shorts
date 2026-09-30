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
    if position('1ce342d0-cf2d-41b4-961b-f3abd9f4e336' in body)>0 or position('242f96a3-fe3b-4f20-a006-3c6559d98573' in body)>0 then
      raise exception 'COMMUNITY_BOARD_BASELINE_CHANGED';
    end if;
    old:=body;
    body:=replace(body,$old$'0641d236-5e76-467e-95f3-bf695e6d6083'::uuid)$old$,$new$'0641d236-5e76-467e-95f3-bf695e6d6083'::uuid,'1ce342d0-cf2d-41b4-961b-f3abd9f4e336'::uuid)$new$);
    body:=replace(body,$old$'11a62875-b24a-4874-9794-4aac13b0c305'::uuid)$old$,$new$'11a62875-b24a-4874-9794-4aac13b0c305'::uuid,'242f96a3-fe3b-4f20-a006-3c6559d98573'::uuid)$new$);
    if body=old then raise exception 'COMMUNITY_BOARD_BASELINE_CHANGED'; end if;
    execute body;
  end loop;
end $$;
commit;
