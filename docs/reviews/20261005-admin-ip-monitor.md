# 관리자 IP 상태 연결

## 대상과 기준

- 작업트리 `.tmp/admin-native-20261005`, 브랜치 `codex/admin-native-20261005`.
- 현재 운영 소스 `b14b0a7f0de2ed99c59ec7f9cb3e97f18031ef74`, 배포 `dpl_4V35Ve8UK97JEVuHVTNdWik2JgAZ`가 기준이다. 작업 시작 HEAD `a798478c`와의 차이는 이전 작업 문서뿐이다.
- 운영 AWS `181651591905`, Vercel `prj_bQyHRVC3Pfzq2dvUnAqEDlw66GOw`, Supabase `mvcprswvfybudtopepuj` / `shorts_mvp`를 실제 조회했다. lab은 이 작업 대상이 아니다.
- 최근 72시간 YouTube 작업은 5개 정확한 revision을 사용하며 모두 같은 운영 IP 설정을 참조한다. 등록 정의를 직접 조회했다. SNS `08aaa3d8b7bb:1` image `c99dd86c6cf6af61feef931b202029295aad211345f3ed0707401e27caac9c1d`, SNS `e5ac690a53bb:1` image `08b09cf5f8c026e65df0cb101b9d47dbbcaaf6fcb7463739927b53ccb7966f62`, subtitle/unified `8c1412a17187:1` image `3d9827a640b41061aaca7c4ba2c82a164eb88d467a088e953376dd764eae9ff7`가 최근 하루 사용됐다. 함수는 호출마다 실제 전달된 revision들을 재확인한다.

## 변경 범위

관리자 IP 조회 함수와 해당 함수 호출 권한만 별도 `EasyCutAdminIpInventory` 스택으로 추가한다. 함수는 정확히 허용된 기존 runtime secret 하나의 조회와 Batch 정의 조회 권한만 가진다. 웹에는 비밀값 조회 권한을 주지 않는다. 기존 Vercel 역할 trust는 `owner:artiroom:project:shorts:environment:production`으로 실제 확인했다. Vercel 민감 환경값은 조회 API에서 마스킹되어 있어 후보의 실제 호출 성공을 연결 검증으로 삼는다.

기존 worker/queue/secret 값/사용자 DB 데이터/스키마는 변경하지 않는다. Lambda는 요청시에만 실행하고 예약 용량이 없으며 동시 실행 2개·15초 제한이다. 로그 권한도 없다. 기존 관리자 cron과 화면 요청만 사용한다. 일반 테스트 비용 범위에서 계량 사용료만 발생하며 사전 검사/후보 빌드는 소규모로 제한한다.

`scripts/admin-ip-inventory-template.mjs`는 템플릿을 렌더링만 한다. 배포 전에 운영 identity와 템플릿 변경 목록을 확인한다. 새 설정 `ADMIN_IP_INVENTORY_FUNCTION_ARN`은 관리자 전용 코드에서만 사용한다.

## 검증

- 기존 관리자/권한/푸시/IP 집계 테스트 31개, inventory 이력·경계 테스트 6개 통과.
- `make lint` (worker/infra Python, 전체 웹 lint/typecheck) 통과.
- 로컬 새 조회 코드로 운영의 실제 5개 정의와 20개 현재 IP 이력을 읽기 전용 검증했다.
- 현재 IP 경계의 4구간, 교체 전 시작한 작업 배제, 분류 불명 실패 미확인, 비활성 경로 알림 배제, 교체 후 이전 사건 종료, 중복 억제를 검증했다.
- 390px 화면에서 경로 목록·상세의 4구간 및 교체 후 범위를 확인했고 브라우저 오류는 없었다.
- 후보 빌드/5개 보호 경로/기존 전체 경로 비교/운영 반영 결과는 실행 후 아래에 추가한다. 현재 결과를 운영 적용으로 간주하지 않는다.

## 한계

실패 유형이 `other_error`로만 저장된 구간은 성공률을 확정하지 않는다. 72시간 내 시도가 없는 IP도 정상으로 단정하지 않는다. 미래 worker가 새 secret을 쓰거나 명시적 stage rollback/메타데이터 변경으로 변경 시각이 불명확하면 미확인으로 표시한다. 최근 생성 작업을 기준으로 교체 전 worker의 보고를 보수적으로 제외하며, IP를 자동으로 바꾸지 않는다.
