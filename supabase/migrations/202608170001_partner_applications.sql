begin;

create table if not exists shorts_mvp.partner_applications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  mvp_session_id uuid references shorts_mvp.mvp_sessions(id) on delete set null,
  user_id uuid references shorts_mvp.app_users(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 100),
  applicant_email text not null check (char_length(applicant_email) between 3 and 320),
  phone text not null check (phone ~ '^\+?[0-9]{8,20}$'),
  channel_types text[] not null check (
    cardinality(channel_types) between 1 and 6
    and channel_types <@ array[
      'youtube','instagram','tiktok','blog','community','other'
    ]::text[]
  ),
  channel_url text not null check (
    char_length(channel_url) between 9 and 2048
    and channel_url like 'https://%'
  ),
  audience_size text not null check (audience_size in (
    'under_1000','1000_5000','5000_10000','10000_50000','over_50000'
  )),
  promotion_plan text not null check (char_length(promotion_plan) between 20 and 1000),
  income_goal text not null check (income_goal in (
    'under_100','over_300','over_1000'
  )),
  disclosure_agreed boolean not null check (disclosure_agreed),
  anti_abuse_agreed boolean not null check (anti_abuse_agreed),
  privacy_agreed boolean not null check (privacy_agreed),
  consent_version text not null check (char_length(consent_version) between 3 and 100),
  consented_at timestamptz not null default clock_timestamp(),
  source_ip_hash text not null check (source_ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent text check (
    user_agent is null or char_length(user_agent) between 1 and 512
  ),
  status text not null default 'new' check (status in (
    'new','reviewing','contacted','accepted','rejected'
  )),
  admin_note text check (
    admin_note is null or char_length(admin_note) <= 1000
  ),
  reviewed_by_user_id uuid references shorts_mvp.app_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists partner_applications_queue_idx
  on shorts_mvp.partner_applications (status,created_at desc);
create index if not exists partner_applications_email_created_idx
  on shorts_mvp.partner_applications (lower(applicant_email),created_at desc);
create index if not exists partner_applications_ip_created_idx
  on shorts_mvp.partner_applications (source_ip_hash,created_at desc);
create index if not exists partner_applications_user_created_idx
  on shorts_mvp.partner_applications (user_id,created_at desc)
  where user_id is not null;
create unique index if not exists partner_applications_one_active_email_idx
  on shorts_mvp.partner_applications (lower(applicant_email))
  where status in ('new','reviewing','contacted','accepted');

create table if not exists shorts_mvp.partner_application_submission_attempts (
  id bigint generated always as identity primary key,
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  source_ip_hash text not null check (source_ip_hash ~ '^[0-9a-f]{64}$'),
  accepted boolean not null default false,
  attempted_at timestamptz not null default clock_timestamp()
);

create index if not exists partner_application_attempts_email_idx
  on shorts_mvp.partner_application_submission_attempts (email_hash,attempted_at desc);
create index if not exists partner_application_attempts_ip_idx
  on shorts_mvp.partner_application_submission_attempts (source_ip_hash,attempted_at desc);

drop trigger if exists partner_applications_set_updated_at
  on shorts_mvp.partner_applications;
create trigger partner_applications_set_updated_at
before update on shorts_mvp.partner_applications
for each row execute function shorts_mvp.set_updated_at();

alter table shorts_mvp.partner_applications enable row level security;
alter table shorts_mvp.partner_application_submission_attempts enable row level security;
revoke all on table shorts_mvp.partner_applications from anon, authenticated;
revoke all on table shorts_mvp.partner_application_submission_attempts from anon, authenticated;
grant all on table shorts_mvp.partner_applications to service_role;
grant all on table shorts_mvp.partner_application_submission_attempts to service_role;
grant usage, select on all sequences in schema shorts_mvp to service_role;

comment on table shorts_mvp.partner_applications is
  'Applications submitted through the public Easy Cut partner recruitment page.';
comment on column shorts_mvp.partner_applications.request_id is
  'Client-generated idempotency key. Retried submissions return the original receipt.';
comment on column shorts_mvp.partner_applications.source_ip_hash is
  'HMAC-only abuse-prevention key. The source address itself is never stored.';
comment on column shorts_mvp.partner_applications.consent_version is
  'Version of the partner application disclosure and privacy consent shown at submission.';
comment on table shorts_mvp.partner_application_submission_attempts is
  'HMAC-only submission attempt log used for public form abuse prevention.';

commit;
