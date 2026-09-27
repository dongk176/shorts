begin;
-- Anonymous attempt IDs only. No account IDs, IPs, user agents or free text.
create table if not exists shorts_mvp.shorts_guide_events (
  id uuid primary key,
  survey_id uuid not null,
  sequence integer not null check (sequence between 1 and 500),
  event_name text not null check (event_name in ('quiz_started','question_viewed','answer_selected','quiz_completed','quiz_exited','guide_preview','pricing_clicked','result_action')),
  locale text not null check (locale in ('ko','en','ja')),
  guide_version text not null,
  environment text not null check (environment in ('production','preview','development')),
  question text check (question in ('category','goal','stage','source','format','time','readiness','obstacle')),
  answer text,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers)='object' and octet_length(answers::text)<=2048),
  guide text check (guide in ('first-short','affiliate','series','brand','sales')),
  action text check (action in ('copy_plan','create_short','filming_checklist','recommended_book','download_attempt','download_success')),
  received_at timestamptz not null default now(),
  unique (survey_id, sequence)
);
create unique index if not exists shorts_guide_events_one_start_idx on shorts_mvp.shorts_guide_events(survey_id) where event_name='quiz_started';
create index if not exists shorts_guide_events_received_idx on shorts_mvp.shorts_guide_events(environment,received_at);
alter table shorts_mvp.shorts_guide_events enable row level security;
revoke all on shorts_mvp.shorts_guide_events from public, anon, authenticated;
grant select, insert, delete on shorts_mvp.shorts_guide_events to service_role;
-- Latest snapshots use the client sequence, so retries arriving late cannot replace newer answers.
create or replace view shorts_mvp.shorts_guide_survey_summary with (security_invoker=true) as
select survey_id, environment, guide_version,
  min(received_at) filter (where event_name='quiz_started') as started_at,
  min(received_at) filter (where event_name='quiz_completed') as completed_at,
  max(received_at) as last_activity_at,
  (array_agg(locale order by sequence desc))[1] as locale,
  (array_agg(question order by sequence desc) filter (where event_name='question_viewed'))[1] as last_question,
  (array_agg(answers order by sequence desc) filter (where event_name in ('question_viewed','answer_selected','quiz_completed','quiz_exited')))[1] as latest_answers,
  (array_agg(answers order by sequence desc) filter (where event_name='quiz_completed'))[1] as completed_answers,
  count(*) filter (where event_name='answer_selected') as selection_count
from shorts_mvp.shorts_guide_events
group by survey_id, environment, guide_version;
revoke all on shorts_mvp.shorts_guide_survey_summary from public, anon, authenticated;
grant select on shorts_mvp.shorts_guide_survey_summary to service_role;
commit;
