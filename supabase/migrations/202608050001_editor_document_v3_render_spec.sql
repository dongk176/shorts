begin;

set local lock_timeout = '5s';
set local statement_timeout = '10min';

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_editor_document_v3_check check (
    (
      editor_document is null
      and editor_document_version is null
    ) or (
      editor_document is not null
      and jsonb_typeof(editor_document)='object'
      and editor_document_version in (2,3)
      and (editor_document->>'version')::smallint=editor_document_version
    )
  ) not valid,
  add constraint generated_shorts_pending_edit_request_v3_check check (
    (
      pending_edit_snapshot is null
      and pending_edit_request_id is null
    ) or (
      pending_edit_snapshot is not null
      and jsonb_typeof(pending_edit_snapshot)='object'
      and pending_edit_request_id is null
      and (
        pending_edit_snapshot->'version' is null
        or pending_edit_snapshot->'version'='1'::jsonb
      )
    ) or (
      pending_edit_snapshot is not null
      and jsonb_typeof(pending_edit_snapshot)='object'
      and (pending_edit_snapshot->>'version')::smallint in (2,3)
      and pending_edit_request_id is not null
    )
  ) not valid;

alter table shorts_mvp.generated_shorts
  validate constraint generated_shorts_editor_document_v3_check;
alter table shorts_mvp.generated_shorts
  validate constraint generated_shorts_pending_edit_request_v3_check;

alter table shorts_mvp.generated_shorts
  drop constraint generated_shorts_editor_document_check,
  drop constraint generated_shorts_pending_edit_request_check;

alter table shorts_mvp.generated_shorts
  rename constraint generated_shorts_editor_document_v3_check
    to generated_shorts_editor_document_check;
alter table shorts_mvp.generated_shorts
  rename constraint generated_shorts_pending_edit_request_v3_check
    to generated_shorts_pending_edit_request_check;

comment on column shorts_mvp.generated_shorts.editor_document_version is
  '성공한 편집 문서 버전. stable v2와 admin canary v3를 함께 허용한다.';

commit;
