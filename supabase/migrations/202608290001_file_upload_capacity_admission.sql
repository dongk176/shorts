begin;

set local lock_timeout = '3s';

create table if not exists shorts_mvp.file_upload_capacity_requests (
  id uuid primary key,
  mvp_session_id uuid not null
    references shorts_mvp.mvp_sessions(id) on delete cascade,
  user_id uuid not null
    references shorts_mvp.app_users(id) on delete cascade,
  request_id uuid not null unique,
  job_id uuid not null unique
    references shorts_mvp.video_jobs(id) on delete cascade,
  intent_hash text not null check (length(intent_hash)=64),
  original_filename text not null
    check (char_length(original_filename) between 1 and 255),
  declared_content_type text not null
    check (char_length(declared_content_type)<=120),
  expected_bytes bigint not null
    check (expected_bytes between 1 and 5368709120),
  declared_duration_seconds numeric(12,3) not null,
  declared_width integer,
  declared_height integer,
  declared_has_audio boolean not null,
  range_start_seconds numeric(12,3) not null,
  range_end_seconds numeric(12,3) not null,
  rights_confirmed boolean not null check (rights_confirmed),
  token_hash text not null unique check (length(token_hash)=64),
  upload_url text not null check (upload_url ~ '^https://'),
  status text not null default 'waiting'
    check (status in ('waiting','granted','cancelled','expired')),
  queue_expires_at timestamptz not null,
  granted_at timestamptz,
  upload_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint file_upload_capacity_request_window_check check (
    queue_expires_at>created_at
    and queue_expires_at<=created_at + interval '30 minutes'
    and (
      (status='waiting' and granted_at is null and upload_expires_at is null)
      or (
        status='granted'
        and granted_at is not null
        and upload_expires_at>granted_at
        and upload_expires_at<=granted_at + interval '15 minutes'
      )
      or status in ('cancelled','expired')
    )
  )
);

create index if not exists file_upload_capacity_requests_waiting_idx
  on shorts_mvp.file_upload_capacity_requests (queue_expires_at,created_at)
  where status='waiting';

alter table shorts_mvp.file_upload_capacity_requests enable row level security;
revoke all on shorts_mvp.file_upload_capacity_requests from anon,authenticated;
grant all on shorts_mvp.file_upload_capacity_requests to service_role;

drop trigger if exists file_upload_capacity_requests_set_updated_at
  on shorts_mvp.file_upload_capacity_requests;
create trigger file_upload_capacity_requests_set_updated_at
before update on shorts_mvp.file_upload_capacity_requests
for each row execute function shorts_mvp.set_updated_at();

comment on table shorts_mvp.file_upload_capacity_requests is
  'Additive pre-upload queue. It becomes a normal 15-minute upload_session only after one healthy receiver slot is granted.';

commit;
