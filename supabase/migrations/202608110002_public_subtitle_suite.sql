begin;

-- A document version is not a sufficient public-release boundary: the
-- current stable and the subtitle candidate both use editor document v3.
-- Keep the subtitle capability on the immutable release identity so rolling
-- back to an older v3 release also disables the new subtitle editor.
alter table shorts_mvp.editor_releases
  add column if not exists subtitle_editing_capable boolean not null default false;

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'editor_subtitle_editing_public',
  false,
  '검증된 자막 편집 capability를 가진 stable 편집기 릴리스를 전체 사용자에게 공개하는 스위치'
)
on conflict (flag_key) do nothing;

insert into shorts_mvp.runtime_feature_flags (
  flag_key,enabled,description
) values (
  'elevenlabs_public_compliance_approved',
  false,
  'ElevenLabs 데이터 사용 설정, 미성년자 음성 정책, 개인정보·국외이전 고지를 확인한 뒤에만 켜는 공개 승인 스위치'
)
on conflict (flag_key) do nothing;

create or replace function shorts_mvp.protect_editor_release_identity()
returns trigger
language plpgsql
set search_path=shorts_mvp,pg_temp
as $$
begin
  if new.git_sha is distinct from old.git_sha
    or new.ui_version is distinct from old.ui_version
    or new.document_version is distinct from old.document_version
    or new.worker_image_digest is distinct from old.worker_image_digest
    or new.production_job_definition_arn
      is distinct from old.production_job_definition_arn
    or new.subtitle_editing_capable
      is distinct from old.subtitle_editing_capable
  then
    raise exception 'editor release identity is immutable';
  end if;
  return new;
end;
$$;

comment on column shorts_mvp.editor_releases.subtitle_editing_capable is
  'Immutable evidence that this exact worker release passed the public subtitle editing suite.';

commit;
