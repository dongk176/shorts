# 더페이원 로컬 정기결제 테스트

이 화면은 허용된 개발자 계정으로 더페이원 `/api/auth`의 0원 카드 등록과 등록된 `cardId`를 이용한 `/api/pay` 반복 승인을 확인하는 로컬 전용 도구입니다. 운영 배포에서는 항상 닫힙니다.

## 테스트 시나리오

1. `/api/auth`에 `amount=0`, `udf2=00`, `recurring=true`와 카드 인증정보를 전송합니다.
2. `metadata.authPw`에는 카드 비밀번호 앞 2자리를 반드시 포함합니다.
3. 등록 응답의 `cardId`만 AES-256-GCM으로 암호화해 저장하고 카드번호, 유효기간, 생년월일/사업자번호, 비밀번호는 저장하지 않습니다.
4. 등록 직후 `cardId`로 1,000원 첫 승인을 실행합니다.
5. 첫 성공 시점부터 3분 간격으로 총 5회까지 승인합니다.

가맹점의 더페이원 설정은 `cardId` 승인에서도 구인증 메타데이터인 `metadata.authDob`, `metadata.authPw`, `metadata.cardAuth="true"`를 요구합니다. 생년월일/사업자번호와 카드 비밀번호 앞 2자리는 테스트 페이지가 열린 동안 브라우저 메모리에만 유지해 각 `/api/pay` 요청에 전달하며 DB, 로그, `localStorage`, `sessionStorage`에는 저장하지 않습니다. 새로고침하거나 페이지를 다시 열면 사용자가 다시 입력해야 합니다.

더페이원 자동청구 기능은 매월 지정 결제일 방식이므로 3분 간격 테스트에는 사용하지 않습니다. 테스트 일정은 로컬 DB에 저장하고, 브라우저에서 도래 시각을 감지해 `/api/pay`를 한 번씩 호출합니다. 페이지를 닫으면 실행도 멈추며, 다시 열면 저장된 일정에서 이어집니다.

## 로컬 설정

루트 `.env.local`에 다음 값을 설정합니다. 연동 키와 암호화 키는 Git, 로그, 채팅에 올리지 않습니다.

```dotenv
PAYMENT_TEST_MODE=true
PAYMENT_TESTER_EMAILS=로그인에_사용할_이메일
THEPAYONE_MID=발급받은_MID
THEPAYONE_PAY_KEY=발급받은_연동_KEY
THEPAYONE_API_BASE_URL=https://api.thepayone.com
THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY=32바이트_base64_키
```

암호화 키는 `openssl rand -base64 32`로 생성합니다. 설정을 바꾼 뒤 개발 서버를 다시 시작하고 `http://localhost:3000/billing/checkout?mode=subscribe&plan=plus&cycle=monthly` 또는 `http://localhost:3000/payment-test`를 엽니다. 로컬 테스트 모드에서는 구독 카드 등록 진입점이 더페이원 테스트 화면으로 이동합니다.

## 주의사항

- 더페이원 답변 기준으로 별도 테스트 서버가 제공되지 않습니다. `/api/pay` 성공은 실제 승인일 수 있으며 최대 합계는 5,000원입니다.
- 네트워크 단절처럼 승인 결과가 불명확하면 자동 재시도하지 않고 `unknown`으로 중단합니다.
- 이미 승인된 거래는 테스트 중단만으로 취소되지 않습니다.
- 테스트 종료 후 등록된 `cardId`를 화면에서 `폐기`하고, 더페이원 관리자에서 각 `trackId`의 승인 결과를 대조합니다.
- 웹훅 서명이 제공되기 전까지 결과 통지를 연동할 경우 더페이원이 안내한 발신 IP만으로 신뢰하지 말고 추가 검증 방식을 협의해야 합니다.
