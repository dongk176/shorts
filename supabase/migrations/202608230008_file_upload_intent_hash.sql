begin;

set local lock_timeout = '3s';
set local statement_timeout = '10min';

-- Bind a retryable request_id to one immutable upload intent. Older rows from
-- pre-release/local testing receive a non-replayable legacy digest so they can
-- never be reissued with newly supplied metadata.
alter table shorts_mvp.upload_sessions
  add column if not exists intent_hash text;

update shorts_mvp.upload_sessions
set intent_hash=(
  md5('easycut-upload-legacy-intent-v1:a:' || id::text)
  || md5('easycut-upload-legacy-intent-v1:b:' || id::text)
)
where intent_hash is null;

alter table shorts_mvp.upload_sessions
  alter column intent_hash set not null,
  drop constraint if exists upload_sessions_intent_hash_check,
  add constraint upload_sessions_intent_hash_check
    check (intent_hash ~ '^[0-9a-f]{64}$');

comment on column shorts_mvp.upload_sessions.intent_hash is
  'SHA-256 of the immutable normalized upload intent; request_id retries must match it exactly.';

commit;
