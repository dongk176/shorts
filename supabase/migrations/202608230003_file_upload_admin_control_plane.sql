begin;

set local lock_timeout = '3s';

-- Existing link-created jobs keep the default source identity. This migration
-- intentionally does not relax any YouTube columns or enqueue upload jobs; the
-- upload data plane will do that in a later, separately gated release.
alter table shorts_mvp.video_jobs
  add column if not exists source_type text not null default 'youtube';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='shorts_mvp.video_jobs'::regclass
      and conname='video_jobs_source_type_check'
  ) then
    alter table shorts_mvp.video_jobs
      add constraint video_jobs_source_type_check
      check (source_type in ('youtube','upload')) not valid;
  end if;
end;
$$;

create table if not exists shorts_mvp.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  mvp_session_id uuid not null
    references shorts_mvp.mvp_sessions(id) on delete cascade,
  user_id uuid not null
    references shorts_mvp.app_users(id) on delete cascade,
  request_id uuid not null unique,
  job_id uuid unique
    references shorts_mvp.video_jobs(id) on delete set null,
  original_filename text not null
    check (char_length(original_filename) between 1 and 255),
  declared_content_type text not null
    check (char_length(declared_content_type) between 1 and 120),
  expected_bytes bigint not null
    check (expected_bytes between 1 and 5368709120),
  declared_duration_seconds numeric(12,3) not null
    check (declared_duration_seconds between 180 and 10800),
  declared_width integer
    check (declared_width is null or declared_width between 1 and 16384),
  declared_height integer
    check (declared_height is null or declared_height between 1 and 16384),
  declared_has_audio boolean not null,
  range_start_seconds numeric(12,3) not null,
  range_end_seconds numeric(12,3) not null,
  rights_confirmed boolean not null check (rights_confirmed),
  token_hash text unique
    check (token_hash is null or length(token_hash)=64),
  received_bytes bigint
    check (received_bytes is null or received_bytes between 0 and expected_bytes),
  probe_metadata jsonb
    check (probe_metadata is null or jsonb_typeof(probe_metadata)='object'),
  source_thumbnail_s3_key text
    check (
      source_thumbnail_s3_key is null
      or char_length(source_thumbnail_s3_key) between 1 and 1024
    ),
  status text not null default 'awaiting_upload' check (status in (
    'awaiting_upload','claimed','completed','expired','cancelled','failed'
  )),
  failure_code text
    check (failure_code is null or char_length(failure_code) between 1 and 100),
  failure_reason text
    check (failure_reason is null or char_length(failure_reason) between 1 and 1000),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  consumed_at timestamptz,
  heartbeat_at timestamptz,
  source_deleted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upload_sessions_range_check check (
    range_start_seconds >= 0
    and range_end_seconds > range_start_seconds
    and range_end_seconds <= declared_duration_seconds
    and (
      (
        declared_duration_seconds < 240
        and range_start_seconds = 0
        and range_end_seconds = declared_duration_seconds
      )
      or (
        declared_duration_seconds >= 240
        and range_end_seconds - range_start_seconds between 240 and 3600
      )
    )
  ),
  constraint upload_sessions_lifecycle_check check (
    (status <> 'claimed' or claimed_at is not null)
    and (status <> 'completed' or completed_at is not null)
    and (consumed_at is null or claimed_at is not null)
  )
);

create index if not exists upload_sessions_pending_expiry_idx
  on shorts_mvp.upload_sessions (expires_at)
  where status in ('awaiting_upload','claimed');

create index if not exists upload_sessions_user_created_idx
  on shorts_mvp.upload_sessions (user_id,created_at desc);

alter table shorts_mvp.upload_sessions enable row level security;
revoke all on shorts_mvp.upload_sessions from anon, authenticated;
grant all on shorts_mvp.upload_sessions to service_role;

drop trigger if exists upload_sessions_set_updated_at
  on shorts_mvp.upload_sessions;
create trigger upload_sessions_set_updated_at
before update on shorts_mvp.upload_sessions
for each row execute function shorts_mvp.set_updated_at();

-- Insert-only defaults keep deployment inert. Replaying the migration never
-- overwrites a value deliberately changed by an administrator.
insert into shorts_mvp.runtime_feature_flags (flag_key,enabled,description)
values
  (
    'file_upload',
    false,
    '관리자 전용 원본 영상 파일 업로드 제어면의 서버 실행 스위치'
  ),
  (
    'file_upload_public',
    false,
    '검증된 파일 업로드 기능의 향후 전체 공개 스위치'
  )
on conflict (flag_key) do nothing;

comment on column shorts_mvp.video_jobs.source_type is
  'Immutable source identity. Existing and stable-path jobs default to youtube.';
comment on table shorts_mvp.upload_sessions is
  'Short-lived JSON control-plane intents. It never stores source bytes or filesystem paths.';
comment on column shorts_mvp.upload_sessions.original_filename is
  'Display-only sanitized filename; never use it as a filesystem or object-storage key.';
comment on column shorts_mvp.upload_sessions.token_hash is
  'Reserved for a later isolated receiver release; raw upload tokens are never persisted.';
comment on column shorts_mvp.upload_sessions.probe_metadata is
  'Receiver-verified ffprobe metadata only; browser declarations remain untrusted.';

commit;
