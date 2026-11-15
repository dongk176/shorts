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
      when 'assert_community_editor_request' then '70edc95ee5f967049d16e57e9722a009'
      when 'assert_sns_editor_request' then 'd7f05664348b23d69d542847ccc897f5'
      when 'enforce_language_test_editor_binding' then 'cc8e8125808bee1b251e2522bf19d716'
    end;
    if expected is null or md5(body)<>expected then
      raise exception 'CHANNEL_CONTRAST_EDITOR_BASELINE_CHANGED';
    end if;
    body:=replace(body,$old$'66f640ba-d156-4c90-9c4f-f79038bf9d14'::uuid$old$,
      $new$'66f640ba-d156-4c90-9c4f-f79038bf9d14'::uuid,'34df634e-d49a-4171-b3ea-f86199543ec1'::uuid$new$);
    body:=replace(body,$old$'a576138e-1ddf-4469-8494-252058595705'::uuid$old$,
      $new$'a576138e-1ddf-4469-8494-252058595705'::uuid,'6f50a87c-250c-4d3e-a8c9-b79d1fbc2f91'::uuid$new$);
    if signature='shorts_mvp.assert_sns_editor_request(shorts_mvp.editor_render_requests)' then
      -- This already-promoted generation release has exact-image compatibility
      -- evidence, but was omitted from the editor membership list.
      perform 1 from shorts_mvp.editor_releases e
        join shorts_mvp.language_test_releases l on l.id=e.id
        where e.id='221b1fcd-9b06-499d-97e9-d2093db2a4e3'::uuid
          and e.git_sha='a730f07144dffc8e77af65b93949dcda4b6690de'
          and l.verified_at is not null and e.staging_verified_at is not null;
      if not found then raise exception 'CHANNEL_CONTRAST_SNS_GENERATION_UNVERIFIED'; end if;
      body:=replace(body,$old$'8af2c7e6-5421-4e93-9671-b0e8bb41de8a'::uuid)$old$,
        $new$'8af2c7e6-5421-4e93-9671-b0e8bb41de8a'::uuid,'221b1fcd-9b06-499d-97e9-d2093db2a4e3'::uuid)$new$);
    end if;
    execute body;
  end loop;
end $$;
commit;
