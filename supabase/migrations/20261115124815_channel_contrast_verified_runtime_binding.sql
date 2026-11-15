begin;
set local lock_timeout='3s';
-- Add only the exact verified channel-contrast editor successors.
-- Preserve old versions, ownership, expiry, image/font and unified-editor proof checks.
do $$ declare signature text; body text; expected text; begin
  foreach signature in array array[
    'shorts_mvp.assert_sns_editor_request(shorts_mvp.editor_render_requests)',
    'shorts_mvp.assert_community_editor_request(shorts_mvp.editor_render_requests)',
    'shorts_mvp.enforce_language_test_editor_binding()'
  ] loop
    body:=pg_get_functiondef(signature::regprocedure);
    expected:=case split_part(split_part(signature,'.',2),'(',1)
      when 'assert_community_editor_request' then '6261bcdf971381fd631d8e6b1d05a51f'
      when 'assert_sns_editor_request' then 'ab743d23d8e1a2c0d33f94814ea05923'
      when 'enforce_language_test_editor_binding' then '270e7b561b3887390b4989fde7680201'
    end;
    if expected is null or md5(body)<>expected then
      raise exception 'CHANNEL_CONTRAST_EDITOR_BASELINE_CHANGED';
    end if;
    body:=replace(body,$old$'34df634e-d49a-4171-b3ea-f86199543ec1'::uuid$old$,
      $new$'34df634e-d49a-4171-b3ea-f86199543ec1'::uuid,'c8324dfe-06f1-4765-b6d3-14410d8bd114'::uuid$new$);
    body:=replace(body,$old$'6f50a87c-250c-4d3e-a8c9-b79d1fbc2f91'::uuid$old$,
      $new$'6f50a87c-250c-4d3e-a8c9-b79d1fbc2f91'::uuid,'3355b631-73ec-4f0f-a669-1fd460d2c284'::uuid$new$);
    execute body;
  end loop;
end $$;
commit;
