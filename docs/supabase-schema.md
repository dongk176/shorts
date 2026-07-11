# Supabase schema

모든 객체는 `shorts_mvp` custom schema에 있습니다. `public` schema는 migration 전후 객체 목록을 비교해 변경이 없음을 자동 확인합니다. 모든 table은 RLS enabled이고 `anon`, `authenticated`에는 권한/정책이 없습니다.

- `plans`: Plus/Standard/Pro 한도와 1~30일 retention source of truth
- `app_users`, `user_subscriptions`: 향후 인증/결제용; 현재 미사용
- `mvp_sessions`: hashed browser token과 선택 plan
- `video_jobs`: 원본 metadata, Batch/stage/heartbeat/expiry
- `generated_shorts`: 구간, 편집 데이터, private object keys, render version/hash
- `usage_reservations`: queued/running 원본 초
- `usage_events`: 성공한 원본 초, `(job_id,event_type)` idempotency
- `job_events`: stage 변경 이벤트

적용은 `npm run db:migrate`입니다. 서버와 Worker는 schema-qualified SQL만 사용합니다. Cleanup Lambda에서 PostgREST를 쓸 경우 Supabase API exposed schemas에 `shorts_mvp`를 추가하되, schema/table 권한은 service role에만 유지합니다.

월 경계는 Asia/Seoul 매월 1일 00:00이며 DB에는 UTC `timestamptz`로 저장합니다. Plan 변경은 사용 event를 지우지 않고 새 limit에 기존 사용량을 대입합니다.
