# Supabase schema

모든 객체는 `shorts_mvp` custom schema에 있습니다. `public` schema는 migration 전후 객체 목록을 비교해 변경이 없음을 자동 확인합니다. 모든 table은 RLS enabled이고 `anon`, `authenticated`에는 권한/정책이 없습니다.

- `plans`: Free, 이지컷 프로, 스타터·전문가 3·6·12개월 패키지의 가격, 월 처리시간, 동시 작업, 보관기간 source of truth
- `addon_products`: 얼리버드 300·600·1,000분 애드온 가격과 90일 유효기간
- `app_users`: `auth.users` 계정, DB 기반 관리자 플래그와 호환성용 plan 캐시
- `billing_payment_methods`: AES-256-GCM 암호화 더페이원 cardId·결제 연락처, 검색용 해시, 비민감 카드 요약과 자동결제 일정 상태
- `billing_card_verifications`: 가격 페이지 1단계의 0원 카드 인증 결과를 15분 동안 보관하는 임시 암호화 cardId와 폐기·소비 상태
- `user_subscriptions`: 결제 주기, 현재 기간, 더페이원 일정, 변경·해지·수동검토 상태
- `billing_orders`, `billing_attempts`: 서버 가격 스냅샷, 승인번호·PG 거래일, 할부개월·캠페인 조건 스냅샷, 패키지 상품별 계정당 1회 구매 제약, 주문별 `refund_policy_version`과 승인 시도 기록
- `billing_payment_events`: 더페이원 `trxId` 멱등성, 주문 대조 및 결과 통지 처리 기록
- `popular_filter_usage_events`: 유료 실시간 인기 필터 결과를 서버가 정상 제공한 시각·조건·결과 수와 당시 권한을 제공한 구독·주문 원장
- `admin_billing_refunds`, `admin_subscription_changes`, `admin_audit_logs`: 관리자 환불·회원 구독 상태 변경 멱등 원장, 환불정책 버전·계산 스냅샷·권한 종료 방식과 관리자 작업 감사 기록
- `subscription_upgrade_refunds`: 과거 판매 플랜의 수동 부분환불 기록 보존용 원장(신규 상품에서는 생성하지 않음)
- `installment_campaigns`, `installment_campaign_terms`: 관리자 초안·게시형 월별 카드 할부 혜택
- `payment_provider_installment_capabilities`: 더페이원 실제 승인 지원을 확인한 할부개월
- `payment_method_registrations`, `payment_test_one_time_orders`, `payment_test_recurring_runs`: 로컬 결제 테스트의 BID·단건·회차 상태
- `mvp_sessions`: hashed browser token, 호환성용 plan 캐시, 로그인 사용자 연결
- `video_jobs`: 원본 metadata, 생성 시점 보관기간 스냅샷, queue/processing deadline, ISP route lease, retry/Batch/stage/heartbeat/expiry
- `generated_shorts`: 구간, render shard/progress, private object keys, render version/hash
- `youtube_analyses`: 짧게 유지되는 YouTube 사전 분석 결과와 사용자 소유권
- `job_outbox`, `dispatch_batches`, `dispatch_batch_items`: Prepare 제출과 Array child 매핑
- `batch_submission_claims`: SQS 중복 전달과 Batch 제출 응답 유실 중복 방지
- `short_outbox`: 재렌더 제출
- `ingestion_route_slots`: `webshare-01`~`webshare-20` 중앙 다운로드 lease와 cooldown; endpoint/인증정보는 저장하지 않음
- `ingestion_attempts`, `ingestion_circuit`: route별 수집 결과와 1분 회로 차단
- `usage_grants`: 월 기본 제공량과 90일 애드온의 예약·소진 잔량. `credited_seconds`와 `carried_seconds`로 신규 지급과 업그레이드 이월을 분리
- `usage_grant_allocations`: 작업 예약이 어떤 grant에서 몇 초를 사용했는지 기록
- `usage_reservations`: queued/running 원본 초와 grant allocation 전이 기준
- `usage_events`: 성공한 원본 초, `(job_id,event_type)` idempotency
- `user_onboarding_profiles`, `member_campaign_announcements`: 최초 온보딩 멱등 응답과 비유료 회원 20분 체험 grant의 계정당 1회 안내 이력
- `job_events`: stage 변경 이벤트

적용은 `npm run db:migrate`입니다. 서버와 Worker는 schema-qualified SQL만 사용합니다. Cleanup Lambda에서 PostgREST를 쓸 경우 Supabase API exposed schemas에 `shorts_mvp`를 추가하되, schema/table 권한은 service role에만 유지합니다.

이지컷 프로는 최초 더페이원 승인 시각부터 유료기간을 시작하고, 자동 승인 결과 통지마다 기본시간 60분을 지급하면서 기존 Pro 이용기간 끝에 1개월을 추가합니다. 최종 해지 시 PG 일정을 즉시 중지하되 이미 결제한 이용기간은 유지합니다. 다시 구독하면 저장 카드를 확인해 즉시 결제하고 60분을 지급하며, 남은 이용기간 끝에 1개월을 추가한 뒤 기존 자동결제 일정을 재활성화합니다. 기간 패키지는 승인일부터 독립된 3·6·12개월 이용기간을 시작하고, 활성 상태인 동안 매월 상품별 시간을 지급하며 자동결제하지 않습니다. 스타터·전문가의 기간별 각 상품은 계정당 한 번만 구매할 수 있고, 서로 다른 상품을 구매한 경우 각 기간과 월 지급 일정을 독립적으로 보존합니다. 기존 주문은 환불정책 v1, 신규 주문은 v2로 기록하여 계산 기준을 소급 변경하지 않습니다. v2 패키지는 완료 월과 현재 사용 월을 계약 월단가로 정산하고, 현재 사용 월을 공제한 경우 월말 예약 종료, 현재 월 미사용 환불은 즉시 종료로 기록합니다. 모든 시각은 DB에 UTC `timestamptz`로 저장합니다.

로그인 사용자의 작업·쇼츠·사용량 조회는 `app_users.id` 소유권으로 묶여 여러 브라우저 세션에서도 같은 데이터를 봅니다. 익명 사용자는 기존처럼 현재 `mvp_session_id`만 볼 수 있으며, 로그인 순간 현재 익명 세션의 행들에 `user_id`를 원자적으로 연결합니다.

결제 이력이 없고 현재 유료·체험·연체·수동 권한이 없는 계정은 온보딩 완료 시 `onboarding_welcome_20min_v1` grant를 한 번 받습니다. 부분 고유 인덱스가 재로그인·재전송·동시 요청의 중복 지급을 막고, 예약 함수는 유료 권한이 없는 동안 해당 grant만 소비하도록 제한합니다. 이 grant는 `manual_service_access_until`을 설정하지 않으므로 실시간 인기 필터 권한과 분리됩니다.
