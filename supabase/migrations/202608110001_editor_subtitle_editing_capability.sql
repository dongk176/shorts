alter table shorts_mvp.editor_releases
  add column if not exists subtitle_editing_capable boolean not null default false;

-- A release may claim subtitle editing only when the isolated renderer probe
-- recorded that capability at the same immutable Git SHA and image digest.
-- Existing releases intentionally remain false; capability is never backfilled.
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

revoke all on function shorts_mvp.protect_editor_release_identity()
  from public,anon,authenticated;

comment on column shorts_mvp.editor_releases.subtitle_editing_capable is
  'Immutable capability verified by the isolated editor worker manifest; existing releases remain false.';
