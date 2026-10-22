begin;
set local lock_timeout='3s';
-- Extend only the two exact editor identities. All existing generation,
-- ownership, expiry, base-version and immutable image checks stay in place.
do $$ declare signature text; body text; old text; anchor text; begin
  foreach signature in array array[
    'shorts_mvp.assert_sns_editor_request(shorts_mvp.editor_render_requests)',
    'shorts_mvp.assert_community_editor_request(shorts_mvp.editor_render_requests)',
    'shorts_mvp.enforce_language_test_editor_binding()'
  ] loop
    body:=pg_get_functiondef(signature::regprocedure);
    if position('66f640ba-d156-4c90-9c4f-f79038bf9d14' in body)>0
      or position('a576138e-1ddf-4469-8494-252058595705' in body)>0 then
      raise exception 'UNIFIED_EDITOR_BASELINE_CHANGED';
    end if;
    old:=body;
    body:=replace(body,$old$'4fbfeeaa-e210-4143-aece-c17029d962a0'::uuid)$old$,
      $new$'4fbfeeaa-e210-4143-aece-c17029d962a0'::uuid,'66f640ba-d156-4c90-9c4f-f79038bf9d14'::uuid)$new$);
    body:=replace(body,$old$'ca57c1ae-c841-4f44-835a-f566a3c097c1'::uuid)$old$,
      $new$'ca57c1ae-c841-4f44-835a-f566a3c097c1'::uuid,'a576138e-1ddf-4469-8494-252058595705'::uuid)$new$);
    if body=old then raise exception 'UNIFIED_EDITOR_BASELINE_CHANGED'; end if;
    if signature<>'shorts_mvp.enforce_language_test_editor_binding()' then
      anchor:=$anchor$and c.details->>'sourceGitSha'=e.git_sha$anchor$;
      if position(anchor in body)=0 then raise exception 'UNIFIED_EDITOR_PROOF_BASELINE_CHANGED'; end if;
      body:=replace(body,anchor,$proof$and (p_request.release_id not in (
          '66f640ba-d156-4c90-9c4f-f79038bf9d14'::uuid,'a576138e-1ddf-4469-8494-252058595705'::uuid)
          or c.details->'unifiedTemplateEditorVersion'='1'::jsonb)
        and c.details->>'sourceGitSha'=e.git_sha$proof$);
    end if;
    execute body;
  end loop;
end $$;
commit;
