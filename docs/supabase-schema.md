# Supabase schema

모든 객체는 `shorts_mvp` custom schema에 있습니다. `public` schema는 migration 전후 객체 목록을 비교해 변경이 없음을 자동 확인합니다. 모든 table은 RLS enabled이고 `anon`, `authenticated`에는 권한/정책이 없습니다.

- `plans`: Free/Plus/Standard/Pro 가격, 월 처리시간, 동시 작업, 보관기간의 source of truth
- `addon_products`: 50/100/300분 애드온 가격과 90일 유효기간
- `app_users`: `auth.users` Google 계정, Toss customer key, 호환성용 plan 캐시
- `billing_payment_methods`: AES-256-GCM 암호화 빌링키, 검색용 해시, 비민감 카드 요약
- `user_subscriptions`: 결제 주기, 현재 기간, 갱신·재시도·변경·해지 상태
- `billing_orders`, `billing_attempts`: 서버 가격 스냅샷과 모든 Toss 승인·재시도 기록
- `billing_webhook_events`: Toss 웹훅 transmission id 기반 멱등 처리 기록
- `mvp_sessions`: hashed browser token, 호환성용 plan 캐시, 로그인 사용자 연결
- `video_jobs`: 원본 metadata, 생성 시점 보관기간 스냅샷, queue/processing deadline, ISP route lease, retry/Batch/stage/heartbeat/expiry
- `generated_shorts`: 구간, render shard/progress, private object keys, render version/hash
- `youtube_analyses`: 짧게 유지되는 YouTube 사전 분석 결과와 사용자 소유권
- `job_outbox`, `dispatch_batches`, `dispatch_batch_items`: Prepare 제출과 Array child 매핑
- `batch_submission_claims`: SQS 중복 전달과 Batch 제출 응답 유실 중복 방지
- `short_outbox`: 재렌더 제출
- `ingestion_route_slots`: `webshare-01`~`webshare-10` 중앙 다운로드 lease와 cooldown; endpoint/인증정보는 저장하지 않음
- `ingestion_attempts`, `ingestion_circuit`: route별 수집 결과와 1분 회로 차단
- `usage_grants`: 월 기본 제공량과 90일 애드온의 예약·소진 잔량
- `usage_grant_allocations`: 작업 예약이 어떤 grant에서 몇 초를 사용했는지 기록
- `usage_reservations`: queued/running 원본 초와 grant allocation 전이 기준
- `usage_events`: 성공한 원본 초, `(job_id,event_type)` idempotency
- `job_events`: stage 변경 이벤트

적용은 `npm run db:migrate`입니다. 서버와 Worker는 schema-qualified SQL만 사용합니다. Cleanup Lambda에서 PostgREST를 쓸 경우 Supabase API exposed schemas에 `shorts_mvp`를 추가하되, schema/table 권한은 service role에만 유지합니다.

구독 기간은 최초 Toss 승인 시각을 기준으로 시작합니다. 월간은 매 결제일, 연간은 매년 결제하면서 처리시간 grant만 매월 같은 결제일에 갱신합니다. 시간은 DB에 UTC `timestamptz`로 저장합니다. 플랜 변경과 해지는 현재 결제기간 종료 시 적용합니다.

로그인 사용자의 작업·쇼츠·사용량 조회는 `app_users.id` 소유권으로 묶여 여러 브라우저 세션에서도 같은 데이터를 봅니다. 익명 사용자는 기존처럼 현재 `mvp_session_id`만 볼 수 있으며, 로그인 순간 현재 익명 세션의 행들에 `user_id`를 원자적으로 연결합니다.
