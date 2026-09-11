begin;
-- A valid public response can omit its view count. Preserve the discovery and
-- retry the identifier without treating that response as a full verification.
alter table shorts_mvp.youtube_catalog add column metadata_pending_at timestamptz;
comment on column shorts_mvp.youtube_catalog.metadata_pending_at is
  'Last incomplete public detail response; metadata stays hidden and verified_at is not advanced.';
commit;
