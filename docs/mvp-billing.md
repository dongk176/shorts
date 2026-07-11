# MVP billing and usage

MVP에는 결제 기능이 없습니다. 카드 클릭은 브라우저의 `mvp_sessions.selected_plan_code`만 바꾸며 `app_users`나 `user_subscriptions`를 만들지 않습니다.

과금 단위는 “쇼츠 생성에 실제 처리한 원본 YouTube 영상 전체 길이(초)”입니다. 12분 원본에서 30초 쇼츠 3개를 만들면 720초입니다.

1. 링크 분석만 하면 0초입니다.
2. Job 생성 transaction에서 원본 초를 `reserved`로 기록합니다.
3. 성공하면 reservation을 `consumed`로 바꾸고 `source_consumed` event를 한 번만 넣습니다.
4. 시스템 실패나 Batch 최종 실패면 `released`로 바꾸며 사용량은 0초입니다.
5. 제목/채널명/자막/템플릿 재렌더링은 0초입니다.
6. 완성 결과를 사용자가 삭제해도 이미 처리한 원본 초는 환급하지 않습니다.

`MVP_PLAN_ENFORCEMENT=false`에서는 limit 초과 안내만 하고 생성은 허용합니다. 동시 작업 1개/하루 3개 기본 제한은 비용 악용 방지이며 plan entitlement가 아닙니다.

실제 결제 도입 시 Supabase Auth user를 `app_users`에 연결하고, 결제 webhook만 `user_subscriptions` 상태/기간을 변경하도록 합니다. Job 생성 transaction은 활성 subscription entitlement를 잠근 뒤 reservation을 만들어야 하며 session 단위 과거 event를 user 단위 ledger로 이관해야 합니다.
