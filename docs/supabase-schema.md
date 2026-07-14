# Supabase schema

모든 객체는 `shorts_mvp` custom schema에 있습니다. `public` schema는 migration 전후 객체 목록을 비교해 변경이 없음을 자동 확인합니다. 모든 table은 RLS enabled이고 `anon`, `authenticated`에는 권한/정책이 없습니다.

- `plans`: Plus/Standard/Pro 한도와 1~30일 retention source of truth
- `app_users`: `auth.users` Google 계정, 이메일/표시명/프로필 이미지, 계정 plan
- `user_subscriptions`: 향후 결제 상태
- `mvp_sessions`: hashed browser token, 선택 plan, 로그인 사용자 연결
- `video_jobs`: 원본 metadata, deadline/retry/Batch/stage/heartbeat/expiry
- `generated_shorts`: 구간, render shard/progress, private object keys, render version/hash
- `youtube_analyses`: 짧게 유지되는 YouTube 사전 분석 결과와 사용자 소유권
- `job_outbox`, `dispatch_batches`, `dispatch_batch_items`: Prepare 제출과 Array child 매핑
- `batch_submission_claims`: SQS 중복 전달과 Batch 제출 응답 유실 중복 방지
- `short_outbox`: 재렌더 제출
- `ingestion_attempts`, `ingestion_circuit`: 수집 성공률과 1분 회로 차단
- `usage_reservations`: queued/running 원본 초
- `usage_events`: 성공한 원본 초, `(job_id,event_type)` idempotency
- `job_events`: stage 변경 이벤트

적용은 `npm run db:migrate`입니다. 서버와 Worker는 schema-qualified SQL만 사용합니다. Cleanup Lambda에서 PostgREST를 쓸 경우 Supabase API exposed schemas에 `shorts_mvp`를 추가하되, schema/table 권한은 service role에만 유지합니다.

월 경계는 Asia/Seoul 매월 1일 00:00이며 DB에는 UTC `timestamptz`로 저장합니다. Plan 변경은 사용 event를 지우지 않고 새 limit에 기존 사용량을 대입합니다.

로그인 사용자의 작업·쇼츠·사용량 조회는 `app_users.id` 소유권으로 묶여 여러 브라우저 세션에서도 같은 데이터를 봅니다. 익명 사용자는 기존처럼 현재 `mvp_session_id`만 볼 수 있으며, 로그인 순간 현재 익명 세션의 행들에 `user_id`를 원자적으로 연결합니다.
