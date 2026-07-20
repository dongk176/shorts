# Toss billing and usage

## 상품과 권한

- Free: 링크 분석과 템플릿 4종 미리보기만 가능
- Plus: 월 100분, 동시 작업 1개, 결과 7일 보관
- Standard: 월 200분, 동시 작업 2개, 결과 15일 보관
- Pro: 월 600분, 동시 작업 3개, 결과 30일 보관
- 연간 플랜은 12개월분을 결제하고 처리시간 grant는 매월 갱신
- 애드온은 50/100/300분 일반결제 상품이며 승인일부터 90일간 유효

`user_subscriptions`와 `usage_grants`만 유료 권한을 부여합니다. `app_users`와 `mvp_sessions`의 `selected_plan_code`는 호환성 캐시이며 API로 직접 변경할 수 없습니다.

## 사용량 처리

과금 단위는 생성된 쇼츠 길이가 아닌 처리한 원본 YouTube 영상 전체 길이입니다.

1. 링크 분석과 템플릿 미리보기는 0초입니다.
2. Job 생성 transaction이 활성 구독과 동시 작업 수를 확인합니다.
3. 기본 grant를 먼저, 이후 만료가 가까운 애드온 grant를 사용해 원본 초를 예약합니다.
4. 성공하면 allocation을 consumed로 바꾸고, 시스템 실패면 released로 반환합니다.
5. 제목·채널명·자막·템플릿 재렌더링은 0초입니다.
6. 결과 삭제는 처리 완료 사용량을 환급하지 않습니다.

## 결제 흐름

- 구독: Toss 카드 인증 → 빌링키 발급 → 첫 결제 승인 → 구독 및 첫 grant 생성
- 갱신: `/api/cron/billing-renewals`가 결제일 도래 구독을 승인하고 +1/+3/+7일에 재시도
- 연간 quota: 결제 없이 매월 새 base grant 생성
- 애드온: 일반결제 승인 API 성공 이후에만 90일 grant 생성
- 변경·해지: 다음 결제기간 경계에서 적용하며 자동 일할 계산이나 환불은 하지 않음
- `past_due`: 기존 결과 접근은 유지하지만 새 작업과 애드온 구매는 차단

빌링키는 AES-256-GCM으로 암호화하며 원본 카드번호를 저장하지 않습니다. 결제 로그에는 주문 ID와 비민감 오류 코드만 기록합니다. 알 수 없는 승인 결과는 새 결제를 만들기 전에 Toss 주문 조회로 대사합니다.

## 운영 설정

필수 환경변수는 `NEXT_PUBLIC_TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`, `TOSS_BILLING_KEY_ENCRYPTION_KEY`, `TOSS_WEBHOOK_SECRET`, `CRON_SECRET`입니다. Toss Developers에는 `PAYMENT_STATUS_CHANGED`, `BILLING_DELETED` 이벤트를 `/api/webhooks/toss/{TOSS_WEBHOOK_SECRET}`로 등록합니다.

`MVP_PLAN_ENFORCEMENT=false`인 동안에는 로그인 사용자 누구나 동시 작업 1개를 만들 수 있고, 활성 구독 확인과 usage grant 차감을 건너뜁니다. 다시 유료 권한을 적용할 때는 이 값을 `true`로 바꿉니다.

테스트 키는 실제 금액을 청구하지 않습니다. 라이브 전환 전 자동결제 계약·리스크 검토를 완료하고 같은 MID의 라이브 클라이언트/시크릿 키로 함께 교체해야 합니다.

운영 전에는 [Toss 자동결제 연동 가이드](https://docs.tosspayments.com/guides/v2/billing/integration)와 [웹훅 이벤트 레퍼런스](https://docs.tosspayments.com/reference/using-api/webhook-events)를 다시 확인합니다. 자동결제 완료 웹훅은 오지 않으므로 승인 응답과 주문 조회가 결제 상태의 기준입니다.
