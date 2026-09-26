# Paddle 해외 월 구독

## 작업 상태 (2026-09-26)

- 운영 조회로 확인한 기준: 배포 `dpl_8241YpSbQiNaFDcg5tbeAB6UXPJb`, 커밋 `3a60f90a6b70088485a49e2ca56dad0d339882cd`.
- Vercel 운영 프로젝트 `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`. 운영 DB는 `mvcprswvfybudtopepuj` / `shorts_mvp`. 2026-09-26 후속 작업에서 `transaction_read_only=on`으로 관련 테이블 구조만 조회했고 데이터/스키마는 변경하지 않았다.
- 작업트리 `.tmp/paddle-integration-20260926`, 브랜치 `codex/paddle-integration-20260926`. 기존 작업트리 변경은 보존.
- Paddle live Vendor 427481: 상품 3개, 가격 6개 등록 완료. 공개 식별자는 `live-catalog.json` 참조.
- 서버 API 키 `EasyCut billing server` 발급 완료. 사용자가 다섯 권한/만료일을 명시한 확인 요청에 “승인”으로 답한 후 발급했다. 권한은 `transaction.read`, `transaction.write`, `subscription.read`, `adjustment.read`, `customer_portal_session.write`; 만료일 2026-12-25. 키 ID `apikey_01m3dthfsgd6sr1fvb28cn7e8z`. 비밀값은 Git 제외된 작업트리 `.secrets/paddle-live.env`에 파일 권한 0600/상위 폴더 0700으로 보관했고 로그/채팅/문서에는 출력하지 않았다. 운영 환경변수에는 등록하지 않았다.
- 실제 Paddle API의 `GET /transactions?per_page=1` 읽기 전용 인증 확인: HTTP 200, 정상 목록 형식. 고객/거래 내용은 출력하지 않았으며 거래 생성/결제는 실행하지 않았다. 공개 토큰 `EasyCut web checkout`도 별도 사용자 승인 후 발급 완료했다. 토큰 ID `ctkn_01m3dwbyh147dy3cbbzftqwx70`, Active 상태를 확인했고 같은 로컬 보호 파일에 6개 가격 ID와 함께 보관했다. 웹훅 설정은 미완료.
- 운영 DB migration, 후보 배포/승격, 실제 돈을 사용하는 결제는 실행하지 않았다. 아래 샌드박스 검증은 가상 카드와 격리된 로컬 DB만 사용한다.
- 비용: 상품 등록 및 로컬 테스트에서 구매/유료 인프라 생성 없음. 이 작업의 사용자 승인 한계는 **10,000원 이상 비용 발생 전 확인**. 실제 Lite 결제도 이 금액을 넘을 수 있으므로 자동으로 실행하지 않는다.

## 요금

| 요금제 | 월 처리시간 | 동시 작업 | USD/월 | JPY/월 |
| --- | ---: | ---: | ---: | ---: |
| Lite | 60분 | 1 | $9.90 | ¥1,480 |
| Creator | 200분 | 2 | $19.90 | ¥2,980 |
| Pro | 600분 | 3 | $49.90 | ¥7,480 |

모두 세금 포함(`internal`), 매월 자동 갱신, 수량 1, 체험 없음. 자료 보관 30일, 미사용 월 시간 이월 없음.
초기 가격 가설이며 특정 문화에서 전환율이 검증되었다고 주장하지 않는다. 영어권은 우선 USD 단일 가격, 일본어는 JPY로 단순화했다.
국내 기존 고객의 이용 중인 국내 상품은 그대로 관리한다. Paddle 가입자는 언어 변경으로 다른 결제사로 중복 가입하지 못한다.

## 구현

- 서버에 정의된 상품/가격만 사용해 결제 트랜잭션을 생성한다. 브라우저에서 가격, 사용자를 지정할 수 없다.
- 공개 Paddle.js 토큰만 브라우저에 전달한다. 서버 키와 webhook 비밀값은 서버 환경변수로만 저장한다.
- `/api/paddle/webhook`는 원문 HMAC, timestamp를 검증한다. 브라우저 완료 이벤트는 사용시간을 지급하지 않고 서버 상태만 다시 확인한다.
- `transaction.completed`에서 canonical transaction/subscription을 조회하고 가격·통화·수량·주기·기간·고객 매핑을 확인한 다음 결제 기록과 사용시간을 원자적으로 저장한다.
- 결제 ID 및 월별 grant 고유 제약으로 중복 지급을 방지한다. 도착 순서가 뒤바뀐 이벤트는 공급자의 최신 객체와 기간 비교로 처리한다.
- 월 갱신마다 새 이용시간 grant를 발급한다. 결제 실패는 새로운 시간을 발급하지 않는다. 기존 지불 기간 이후에는 사용 권한이 만료된다.
- 해지 예약은 현재 지불 기간을 유지하고 실제 canceled 이벤트는 이용 권한을 회수한다. paused는 접근을 막고, 재개 시 남은 지불 기간으로 제한한다.
- 고객의 해지·결제수단 변경·영수증은 소유권을 확인해 생성한 Paddle 고객 포털 링크로 제공한다.
- 환불 실행/승인은 Paddle 대시보드에서 한다. 승인된 전액 환불은 남은 시간을 회수하고, 부분 환불은 비례 삭감한다. 세금 제외 원금 비율로 계산하므로 세금만 환급되면 이용시간은 유지한다. 분쟁 취소는 기존 분쟁의 최신 상태까지 함께 조회하여 별도 환불을 취소하지 않는다. 이미 소비/예약된 사용량을 지워 장부 제약을 깨지 않는다. 처리 중 환불은 지급량을 바꾸지 않는다. 환불과 구독 해지는 별개다.
- 환불 승인 알림이 결제 완료 알림보다 먼저 와도 이후 결제 지급 시 회수 상태를 적용한다.
- 새로운 결제 비활성화(`PADDLE_ENABLED=false`)와 기존 구독 관리·웹훅 처리를 구분한다.
- 해외 결제를 KRW 주문 금액으로 기록하지 않고 별도 통화/minor-unit 장부에 기록한다.
- 기존 한국 갱신 작업은 Paddle 구독을 처리하지 않는다. 국내 주문 및 Toss 결제 준비와 Paddle 결제 준비가 같은 사용자를 동시에 예약하지 못하도록 DB 보호가 있다.
- 회원 탈퇴 시 원격 구독 또는 미완료 결제가 남으면 차단한다. 국내 관리자 구독 변경 API로 Paddle 구독을 임의로 변경할 수 없다.
- 언어별 결제 페이지는 얇은 `/en`, `/jp` 별칭을 쓰고 동일 컴포넌트를 공유한다. 내부 rewrite의 재실행으로 서버 언어가 한국어로 덮이는 현상을 피한다.

## 설정 순서

1. 발급된 서버 키를 안전하게 배포 비밀값에 등록하고 만료 전 교체한다. 서버 키 권한: `transaction.read`, `transaction.write`, `subscription.read`, `adjustment.read`, `customer_portal_session.write`만. 2026-09-26 발급, 2026-12-25 만료이며 만료 전 교체해야 한다.
2. 샌드박스는 별도 Paddle 계정/상품/가격/키를 사용한다. 별도 로컬 PostgreSQL 및 필요한 앱 schema/auth 구성에서 검증한다. 이 코드의 sandbox 환경은 원격 DB 및 Vercel production에 연결할 수 없다. lab의 `shorts_lab`용 코드가 아니므로 기존 lab DB에 그대로 적용하면 안 된다.
3. 실제 운영 계정/DB/schema/배포 기준을 다시 확인하고, `202609260010_paddle_billing.sql`만 검토·적용한다. 결제 기능을 먼저 켜지 않는다. 기존 데이터/스키마 전체 복사 금지.
4. 서버 환경변수 준비: `PADDLE_ENVIRONMENT=live`, `PADDLE_ENABLED=false`, `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`, 6개 가격 식별자. 예시의 공개 가격은 live 전용이다. secret은 Git/로그/문서/채팅에 쓰지 않는다.
5. Paddle 기본 payment link를 배포된 `https://www.easycut.co.kr/en/billing/paddle`로 설정한다. `/jp/billing/paddle`도 같은 화면이다. `_ptxn`의 소유권은 로그인한 고객과 서버 매핑으로 확인한다.
6. Notifications URL: `https://www.easycut.co.kr/api/paddle/webhook`, 실제 이벤트 delivery. 구독 이벤트, transaction.completed/canceled, adjustment.created/updated를 선택한다. 새 webhook 수신 설정도 보안/개인정보 전달 범위에 맞는 확인 후 적용한다. simulator 이벤트로 운영 사용자 시간을 지급하지 않는다.
7. 현재 운영 기준과 후보 route manifest, 보호 경로, 기존 실험 제외 기준을 확인한다. clean commit의 unaliased 후보를 먼저 검사한 뒤 정확히 그 배포를 승격한다. 가격/수량/세금(사업자 VAT ID 면세 포함)/언어/환불/해지/중복 알림을 샌드박스에서 검증한 후 결제 기능을 켠다.
8. 실제 결제·환불 점검은 비용 한계와 실제 결제수단 소유자의 참여를 확인한 후 별도로 시행한다. 환불을 해도 수수료가 모두 복구된다고 가정하지 않는다.

## 범위와 복구

- 첫 버전은 정해진 월 상품만 지원한다. 할인코드·무료체험·수량 변경·일할 계산·중도 플랜 변경은 제공하지 않는다. 고객 포털에서 임의 상품 변경이 열리지 않도록 설정을 확인한다. 이 범위를 벗어난 결제는 webhook이 성공 처리하지 않고 재시도/운영자 검토 대상으로 남긴다.
- 결제 생성 요청이 timeout으로 결과 불명확하면 자동 재시도하지 않는다. `paddle_checkouts.status=unknown`을 보고 Paddle Transactions의 `custom_data.easycut_checkout_id`로 실제 생성/결제를 먼저 확인한다. 확인 없이 새 결제를 만들거나 데이터를 삭제하지 않는다.
- 미완료 결제 취소는 Paddle에서 canceled가 확인된 경우에만 로컬 예약을 해제한다. 완료/청구 중이면 취소 대신 결제 결과를 확인한다.
- webhook 실패 로그에는 event ID/type만 남는다. Paddle delivery logs에서 원인을 확인하고 복구 후 재전송한다. 동일 이벤트 재전송은 중복 지급되지 않는다.
- 운영 가격을 변경할 때 기존 구독 가격은 유지해야 한다. 현재 서버 catalog는 고정 가격 검증을 하므로 환경변수만 새 가격으로 덮으면 기존 갱신이 거부된다. 가격 버전을 보존하는 migration/코드 변경을 먼저 수행한다.
- Paddle 공급자 API 자체 장애, 라이브 결제 승인률, 실제 카드사 3DS, 송금 수취는 로컬 검증으로 증명하지 않았다.

## 검증 기록

검증 대상은 이 브랜치의 로컬 변경이며 운영 배포 검증이 아니다. Node 22.19, Next 15.5.20, TypeScript 5.8.3, Vitest 4.1.10, PGlite 0.3.14에서 확인했다. 운영 환경변수/DB를 로컬로 복사하지 않았다.

- `make verify`: worker/Lambda lint, worker pytest(합성 FFmpeg 포함), scripts 테스트 209개, 당시 웹 테스트 3,057개, 인프라 테스트 36개, 웹 빌드 및 CDK synth 통과. 이후 worker/인프라 코드는 변경하지 않았다. synth는 배포가 아니다.
- 이후 웹 전체 검사: 390개 파일 / 3,073개 테스트 통과, 기존 6개 파일 / 139개 테스트 skipped. skipped 영역은 검증했다고 간주하지 않는다.
- 최종 보완 후 영향 범위: 9개 파일 / 76개 테스트 통과. HMAC, 소유권/인증, SQL migration 두 번 적용, 갱신/중복/순서 역전, 결제 실패, 해지, 환불/분쟁 취소/세금 환급, 면세 총액, 중복 구독/탈퇴, 국내 구독 관리 경로 포함.
- 최종 소스에서 web lint / production build / typecheck 및 `git diff --check` 통과. 기존 `budoux` → `linkedom`의 optional `canvas` 모듈 경고는 있으나 빌드는 성공했다.
- 최종 build manifest에 `/`, `/guidebook`, `/pricing`, `/admin/easycutcutcutcutcutcut`, `/projects/[projectNumber]/edit/[shortId]`가 유지됨을 확인했다. `/en/pricing`, `/jp/pricing`, Paddle API/결제 페이지도 생성됐다. 실제 production candidate와의 원격 비교는 미실행.
- Chrome 로컬 guest 화면: `/en/pricing` 달러, `/jp/pricing` 엔화가 첫 서버 렌더부터 표시됨을 확인했다. 데스크톱/390px 모바일, 영문 로그인 callback(`/en/pricing`) 점검. 임시 viewport는 복구했고 로컬 서버/미리보기 탭은 정리했다.
- 동작 테스트의 API 호출은 mock, SQL은 최소 관련 스키마를 만든 PGlite였다. 이후 실제 live 서버 키의 읽기 전용 인증만 별도 확인했다. 운영 스키마 호환성, 로그인 이후 실제 Paddle Checkout/3DS, Paddle 발송 webhook, 정산 입금은 아직 미확인이다.

새 checkout에서 SQL 테스트를 재현하려면 저장소의 기존 PGlite 테스트 관례에 따라 `test-tools`에 `@electric-sql/pglite@0.3.14`를 설치한다(`npm install --prefix test-tools --no-save @electric-sql/pglite@0.3.14`). 이번 작업은 이미 설치된 모듈을 재사용했다. 테스트 명령은 `npm --prefix web test -- lib/paddle app/api/paddle app/settings/plan/paddle-routing.test.tsx`이다.

## 후속 배포 전 점검 (2026-09-26)

사용자는 운영 배포 전 단계까지만 진행하도록 했다. 운영 DB migration, 운영 환경변수 변경, 후보/운영 배포는 수행하지 않았다.

- 실제 운영 DB의 관련 테이블 6개 / 컬럼 136개 / 제약조건 80개를 읽기 전용 조회했다. 개인정보/거래 내역은 조회하거나 복사하지 않았다. 기존 Paddle 테이블은 없었다.
- 관찰한 구조를 `test-fixtures/paddle-production-schema-20260926.sql`에 재현했다. 외부 테이블 FK, 기존 RLS/트리거, 실제 데이터는 제외한 부분 모델이다.
- 운영의 기존 CHECK 제약은 일부 `NOT VALID` 상태였다. 새 migration이 불필요하게 기존 데이터를 다시 검사하거나 실패하지 않도록 원래 표현식과 검증 상태를 보존한다. 신규 입력은 확장한 제약에 계속 검사된다.
- 위 구조에 migration 두 번 적용, 기존 제약 밖의 과거 가상 데이터 보존, 새 잘못된 상품 차단, 실제 컬럼/제약을 통과하는 Paddle 구독·시간 지급을 로컬에서 검증했다.
- 결과 불명확한 국내 결제 또는 유효기간이 지난 검토 중 Toss 결제가 있으면 새 Paddle 결제를 만들지 않도록 보완했다.
- 후속 변경에서 관련 테스트 6개 파일 / 33개, lint, typecheck, production build, diff 검사를 통과했다. 빌드는 로컬에서만 수행했다.
- 최초 서버 키 저장은 자동 승인 심사에서 차단되었으나, 이후 사용자의 구체적인 “승인” 답변 후 발급·로컬 보호 저장·읽기 전용 API 인증(HTTP 200)까지 완료했다. 공개 토큰은 이후 별도 승인 후 발급·보관했다. 당시 웹훅과 Paddle sandbox 결제는 미완료였다. 이후 샌드박스 검증 결과는 아래에 별도로 기록한다.

## 인증 준비 후 남은 작업

- 공개 결제창 토큰 `EasyCut web checkout`은 발급·로컬 보관 완료했다. 서버 키 비밀값을 클라이언트 토큰으로 대체 사용하면 안 된다. 운영 환경변수에는 아직 둘 다 등록하지 않았다.
- 사용자 별도 가입 후 sandbox 로그인 완료를 확인했다. Sandbox artiroom 판매자 ID `123613`, 운영 판매자 ID `427481`과 구분된다. 사용자의 구체적인 “ㄱㄱ” 승인 후 테스트 서버 키 `EasyCut sandbox integration`과 공개 결제창 토큰을 발급했다. 서버 키 ID `apikey_01m3dx8p0d41pjttgdap34e6kh`, 클라이언트 토큰 ID `ctkn_01m3dxatfn9jt7srtzdk1c5fmd`. 상품/가격/거래/구독/환불 read+write 및 customer portal session write 권한, 만료 2026-12-25. 값은 Git 제외 `.secrets/paddle-sandbox.env`에 권한 0600으로 보관한다. 상품 3개/월 가격 6개는 `sandbox-catalog.json`에 기록했고 API로 통화·금액·세금 포함·수량 1·체험 없음 조건을 확인했다.
- 샌드박스 테스트 대상은 이 작업트리의 코드와 격리된 로컬 DB/가상 사용자이다. 운영 DB/고객 데이터 또는 기존 lab 서비스를 연결하지 않는다. 실제 Paddle sandbox Checkout과 서비스 함수를 연결해 검증한다. 외부 웹훅 전달 및 실제 앱 로그인 흐름 전체는 이 검사에 포함하지 않는다.
- 발급된 live 서버 키는 이 작업트리 `.secrets/paddle-live.env`에만 있다. 작업트리 제거 전 사용자가 관리하는 비밀 저장소로 안전하게 옮기거나 Paddle에서 폐기해야 한다. 실제 배포 시에는 서버 전용 비밀값으로 넣고 2026-12-25 이전에 교체한다. `PADDLE_ENABLED=false` 상태를 유지한다.

## 공식 참고

- https://developer.paddle.com/build/set-up-checklist/
- https://developer.paddle.com/api-reference/transactions/create-transaction/
- https://developer.paddle.com/webhooks/about/signature-verification/
- https://developer.paddle.com/api-reference/adjustments/list-adjustments/
- https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/


## 샌드박스 실제 API 검증 (2026-09-26)

- 소스: `5c1249fe41d4912a44422c414120a15680f7b12f`의 결제 서비스 + 새 `web/lib/paddle/sandbox.session.test.ts` 검사 화면. 앱 코드를 변경하지 않고 실제 sandbox API를 호출했다.
- 계정: sandbox Vendor `123613`; DB: 메모리 PGlite + 관찰한 운영 관련 스키마의 부분 fixture + 신규 migration. 가상 사용자 2명만 사용했다. AWS/lab/운영 DB를 사용하지 않았다.
- `RUN_PADDLE_SANDBOX=1 npm --prefix web test -- lib/paddle/sandbox.session.test.ts`로 명시 실행한다. 일반 테스트에서는 자동 skip한다. 로컬 주소는 `http://127.0.0.1:3419/`, Host/Origin/임의 세션 쿠키를 검사하며 외부에 공개하지 않는다.
- 기본 payment link 미설정 때문에 최초 API 생성이 실패했다. 거래 목록이 비어 있음을 확인한 후 sandbox Checkout Settings에 로컬 테스트 주소를 저장했고 새 격리 세션으로 재시작했다. 대시보드가 `https://127.0.0.1:3419/`로 정규화하므로 이 주소 자체의 복귀/결제 링크 동작은 검증하지 않았다. 실제 검사는 HTTP 로컬 페이지에서 transaction ID로 Paddle.js overlay를 연다. 배포 시 유효한 HTTPS 앱 결제 주소로 교체해야 한다.
- 영어/미국: Lite USD 9.90 세금 포함, 테스트 카드 결제 성공. 일본어/일본: Lite JPY 1,480 소비세 포함, 가상 3DS 인증 및 결제 성공. 실제 카드 청구는 없다.
- 두 결제 모두 실제 거래/구독을 API로 다시 조회해 로컬 이용시간 60분을 한 번만 지급했다. 같은 이벤트를 두 번 처리해 두 번째가 duplicate임을 확인했다.
- 두 구독 모두 다음 결제일 해지 예약을 API에서 확인했고, 로컬 상태 active/기간 종료 시 해지 예약을 확인했다. 환불 승인 전에는 이용시간이 유지됐다.
- 이벤트 envelope는 로컬에서 만든 것이다. 공급자 객체 조회/검증과 SQL 처리는 실제 서비스 함수를 사용하지만 Paddle → 공개 웹훅 전달, 서명 헤더, 재전송 네트워크를 종단 간 검증한 것은 아니다. HMAC/인증/갱신/실패는 기존 자동 테스트 결과와 구분해야 한다.
- 실제 Next.js 로그인 후 결제 전체 흐름, 공급자의 다음 달 자동 재청구, 외부 웹훅 수신, 운영 후보 배포, 실제 카드 승인/환불/정산은 남아 있다. 현재 상태를 운영 출시 완료로 간주하지 않는다.

- 환불 최종 결과: USD/JPY 모두 `approved`, 두 로컬 grant 모두 `revoked`. 대기 중에는 `active`를 유지하고 승인된 경우에만 회수했다. 두 테스트 구독은 다음 결제일 해지 예약 상태다.
- 고객 포털 링크 생성과 실제 화면을 확인했다. USD 고객은 영어/US$9.90, JPY 고객은 일본어/JP¥1,480로 표시되고 예약 해지일이 일치했다.
- 대화형 검사 1개 통과(실제 sandbox API, 가상 카드 2건), 이어서 결제 관련 자동 검사 31개 통과/대화형 1개 의도적 skip, typecheck 및 새 검사 파일 lint 통과. 대화형 실행 후 검사 파일의 환경 복원/출력 폴더 생성/서버 종료 처리만 보완했고, 이 보완된 파일의 원격 대화형 검사를 다시 실행하지는 않았다.
- 최소 증거는 `sandbox-verification-20260926.json`에 기록했다. 키/고객 포털 인증 링크/실사용자 정보는 기록 파일에 넣지 않았다. 테스트 서버는 종료했다.
- 참고: https://developer.paddle.com/sdks/sandbox/ 및 https://developer.paddle.com/concepts/sell/customer-portal/
