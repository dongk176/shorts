# 더페이원 로컬 카드 등록 테스트

이 화면은 개발자 본인이 더페이원 `/api/auth`의 0원 카드 등록과 `/api/audt`의 카드 등록 폐기를 확인하기 위한 로컬 전용 도구입니다. 운영 배포에서는 항상 404로 닫힙니다.

## 로컬 설정

루트 `.env.local`에 아래 값을 추가합니다. 연동 KEY와 암호화 키는 Git이나 채팅에 올리지 않습니다.

```dotenv
PAYMENT_TEST_MODE=true
PAYMENT_TESTER_EMAILS=로그인에_사용할_이메일
THEPAYONE_MID=발급받은_MID
THEPAYONE_PAY_KEY=발급받은_연동_KEY
THEPAYONE_API_BASE_URL=https://api.thepayone.com
THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY=32바이트_base64_키
```

암호화 키는 로컬 터미널에서 다음 명령으로 생성합니다.

```bash
openssl rand -base64 32
```

설정을 바꾼 뒤 개발 서버를 다시 시작합니다.

```bash
npm run dev
```

브라우저에서 `http://localhost:3000/payment-test`를 열고 허용목록에 넣은 계정으로 로그인합니다.

## 보안 동작

- `NODE_ENV=production`에서는 환경변수와 관계없이 비활성화됩니다.
- `localhost`, `127.0.0.1`, `0.0.0.0`, `::1` 이외의 Host를 거부합니다.
- 동일 출처 JSON 요청만 허용합니다.
- 로그인 이메일 허용목록을 적용합니다.
- 카드번호, 유효기간, 생년월일/사업자번호, 비밀번호 앞 2자리는 DB와 로그에 저장하지 않습니다.
- 더페이원 `cardId`는 AES-256-GCM으로 암호화해 `shorts_mvp`에 저장합니다.
- 화면과 API 응답에는 카드 끝 4자리와 비민감 승인 정보만 표시합니다.
- 등록 폐기 성공 시 암호화된 `cardId`도 DB에서 제거합니다.

`udf2="00"`을 사용하므로 이 테스트 자체는 자동청구 일정을 만들지 않습니다. 실제 결제 및 유료 플랜 활성화는 별도의 결제 구현에서 다룹니다.
