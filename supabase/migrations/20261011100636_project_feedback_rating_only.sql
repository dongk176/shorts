-- Preserve old responses; absence of an answer is not "nothing disappointing".
begin;
set local lock_timeout = '5s';
alter table shorts_mvp.project_feedback_responses
  alter column disappointment_reason drop not null;
alter table shorts_mvp.project_feedback_responses
  add constraint project_feedback_low_rating_reason_check
  check (satisfaction_rating >= 4 or disappointment_reason is not null);
commit;
