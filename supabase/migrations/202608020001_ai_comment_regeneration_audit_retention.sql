begin;

set local lock_timeout = '3s';

-- AI generation requests are billing/audit records. A browser or test session
-- can expire independently, so deleting a session must not erase the consumed
-- usage evidence or its allocation rows.
alter table shorts_mvp.ai_comment_regeneration_requests
  drop constraint if exists ai_comment_regeneration_requests_mvp_session_id_fkey;

alter table shorts_mvp.ai_comment_regeneration_requests
  alter column mvp_session_id drop not null;

alter table shorts_mvp.ai_comment_regeneration_requests
  add constraint ai_comment_regeneration_requests_mvp_session_id_fkey
  foreign key (mvp_session_id)
  references shorts_mvp.mvp_sessions(id)
  on delete set null
  not valid;

comment on column shorts_mvp.ai_comment_regeneration_requests.mvp_session_id is
  '요청 당시 세션. 세션 만료 후에도 AI 사용량 감사 기록은 유지된다.';

commit;
