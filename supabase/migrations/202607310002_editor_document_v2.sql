begin;

alter table shorts_mvp.generated_shorts
  add column if not exists editor_document jsonb,
  add column if not exists editor_document_version smallint,
  add column if not exists pending_edit_request_id uuid;

create table if not exists shorts_mvp.editor_render_requests (
  id uuid primary key,
  short_id uuid not null
    references shorts_mvp.generated_shorts(id) on delete cascade,
  user_id uuid not null
    references shorts_mvp.app_users(id) on delete cascade,
  base_render_version integer not null check (base_render_version >= 0),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{32}$'),
  status text not null default 'queued'
    check (status in ('queued','rendering','succeeded','failed')),
  output_render_version integer,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (short_id,id),
  check (
    (status='succeeded' and output_render_version is not null and completed_at is not null)
    or status<>'succeeded'
  )
);

create index if not exists editor_render_requests_short_created_idx
  on shorts_mvp.editor_render_requests(short_id,created_at desc);

alter table shorts_mvp.generated_shorts
  drop constraint if exists generated_shorts_editor_document_check,
  drop constraint if exists generated_shorts_pending_edit_request_check;

alter table shorts_mvp.generated_shorts
  add constraint generated_shorts_editor_document_check check (
    (
      editor_document is null
      and editor_document_version is null
    ) or (
      editor_document is not null
      and jsonb_typeof(editor_document)='object'
      and editor_document_version is not null
      and editor_document_version=2
      and editor_document->'version'='2'::jsonb
    )
  ),
  add constraint generated_shorts_pending_edit_request_check check (
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
      and pending_edit_snapshot->'version'='2'::jsonb
      and pending_edit_request_id is not null
    )
  );

alter table shorts_mvp.editor_render_requests enable row level security;
revoke all on shorts_mvp.editor_render_requests from anon,authenticated;
grant all on shorts_mvp.editor_render_requests to service_role;

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'editor_rendering_v2',
  false,
  '1080x1920 통합 편집 문서를 저장하고 AWS 워커에서 최종 영상으로 렌더링'
)
on conflict (flag_key) do nothing;

comment on column shorts_mvp.generated_shorts.editor_document is
  '마지막으로 성공한 1080x1920 통합 편집 문서';
comment on column shorts_mvp.generated_shorts.pending_edit_snapshot is
  '워커가 검증·렌더링한 뒤에만 editor_document로 승격되는 대기 편집 문서';
comment on column shorts_mvp.generated_shorts.pending_edit_request_id is
  '중복 저장과 재시도를 식별하는 editor_render_requests 요청 ID';
comment on table shorts_mvp.editor_render_requests is
  '통합 편집 렌더링의 멱등 요청 및 성공·실패 감사 기록';

commit;
