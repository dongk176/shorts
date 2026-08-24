begin;

create table if not exists shorts_mvp.project_feedback_prompt_deferrals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shorts_mvp.app_users(id) on delete cascade,
  request_id uuid not null unique,
  prompt_completion_count integer not null check (
    prompt_completion_count in (1,3,6,9,12)
  ),
  completed_project_count integer not null check (completed_project_count >= prompt_completion_count),
  created_at timestamptz not null default now(),
  unique (user_id,prompt_completion_count)
);

create index if not exists project_feedback_deferrals_user_created_idx
  on shorts_mvp.project_feedback_prompt_deferrals (user_id,created_at desc);

create table if not exists shorts_mvp.project_feedback_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references shorts_mvp.app_users(id) on delete cascade,
  request_id uuid not null unique,
  satisfaction_rating smallint not null check (satisfaction_rating between 1 and 5),
  disappointment_reason text not null check (disappointment_reason in (
    'result_quality',
    'editing_difficulty',
    'slow_generation',
    'confusing_usage',
    'error_occurred',
    'price_or_limits',
    'nothing_disappointing',
    'other'
  )),
  improvement_text text check (
    improvement_text is null or char_length(improvement_text) between 1 and 1000
  ),
  prompt_completion_count integer not null check (
    prompt_completion_count in (1,3,6,9,12)
  ),
  completed_project_count integer not null check (completed_project_count >= prompt_completion_count),
  reward_seconds integer not null default 1800 check (reward_seconds = 1800),
  reward_grant_id uuid not null unique references shorts_mvp.usage_grants(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists project_feedback_responses_created_idx
  on shorts_mvp.project_feedback_responses (created_at desc);
create index if not exists project_feedback_responses_rating_created_idx
  on shorts_mvp.project_feedback_responses (satisfaction_rating,created_at desc);
create unique index if not exists usage_grants_one_feedback_reward_per_user_idx
  on shorts_mvp.usage_grants (user_id,product_code)
  where product_code='feedback_reward_30m';

alter table shorts_mvp.project_feedback_prompt_deferrals enable row level security;
alter table shorts_mvp.project_feedback_responses enable row level security;
revoke all on table shorts_mvp.project_feedback_prompt_deferrals from anon, authenticated;
revoke all on table shorts_mvp.project_feedback_responses from anon, authenticated;
grant all on table shorts_mvp.project_feedback_prompt_deferrals to service_role;
grant all on table shorts_mvp.project_feedback_responses to service_role;
grant usage, select on all sequences in schema shorts_mvp to service_role;

comment on table shorts_mvp.project_feedback_prompt_deferrals is
  'Audit trail for users who defer the project feedback prompt at completion counts 1, 3, 6, 9, and 12.';
comment on table shorts_mvp.project_feedback_responses is
  'One rewarded post-completion product feedback response per user.';
comment on column shorts_mvp.project_feedback_responses.reward_grant_id is
  'The idempotently issued 1,800-second usage grant, valid for 90 days from submission.';

commit;
