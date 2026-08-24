begin;

create table if not exists shorts_mvp.user_onboarding_profiles (
  user_id uuid primary key references shorts_mvp.app_users(id) on delete cascade,
  request_id uuid not null unique,
  occupation text not null check (occupation in (
    'creator',
    'marketing',
    'brand',
    'video_production',
    'education',
    'employee_freelancer',
    'other'
  )),
  occupation_other text check (
    occupation_other is null or char_length(occupation_other) between 1 and 100
  ),
  usage_purposes text[] not null check (
    cardinality(usage_purposes) between 1 and 8
    and array_position(usage_purposes,null) is null
    and usage_purposes <@ array[
      'youtube_shorts',
      'instagram_reels',
      'tiktok',
      'promotion',
      'education_content',
      'save_editing_time',
      'monetization',
      'other'
    ]::text[]
  ),
  usage_purpose_other text check (
    usage_purpose_other is null or char_length(usage_purpose_other) between 1 and 100
  ),
  onboarding_version smallint not null default 1 check (onboarding_version = 1),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (
    (occupation='other' and occupation_other is not null)
    or (occupation<>'other' and occupation_other is null)
  ),
  check (
    ('other'=any(usage_purposes) and usage_purpose_other is not null)
    or (not ('other'=any(usage_purposes)) and usage_purpose_other is null)
  )
);

alter table shorts_mvp.user_onboarding_profiles enable row level security;
revoke all on table shorts_mvp.user_onboarding_profiles from anon, authenticated;
grant all on table shorts_mvp.user_onboarding_profiles to service_role;

comment on table shorts_mvp.user_onboarding_profiles is
  'Required first-login occupation and usage-purpose onboarding, stored once per Easy Cut account.';
comment on column shorts_mvp.user_onboarding_profiles.request_id is
  'Client-generated idempotency key for the first onboarding submission.';

commit;
