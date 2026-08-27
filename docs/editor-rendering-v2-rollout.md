# 편집기 v2 안전 테스트·승격

편집기 v2는 웹 배포와 사용자 공개를 분리한다. 후보 코드가 운영 웹에
포함되어도 서버 판정이 `legacy`이면 기존 JSX, 저장 요청, 레거시
재렌더 Job Definition만 사용한다. 후보 워커는 격리 테스트와 내부
카나리를 통과한 같은 ECR digest를 재빌드 없이 `stable`로 승격한다.

## 절대 조건

- `EDITOR_OVERLAY_PREVIEW_ENABLED=false`: 운영에서는 로컬 실험 UI를
  활성화하지 않는다.
- 최초 배포 때 `EDITOR_RENDERING_V2_ENABLED=false`,
  `EDITOR_RENDERING_V2_GLOBAL_ENABLED=false`를 유지한다.
- `LEGACY_RERENDER_IMAGE_TAG`는 현재 정상 동작 중인 불변 이미지 태그로
  명시한다. 후보 SHA로 자동 교체하지 않는다.
- 운영 DB 변경은
  `202607310003_editor_release_channels.sql`의 추가형 변경만 허용한다.
- 일반 사용자의 v2 저장 API는 서버 릴리스 판정이 `legacy`이면 404로
  거부한다. 클라이언트 플래그만으로 저장할 수 없다.
- 후보 이미지, 현재 stable, 직전 stable은 최소 30일 보존한다.

## 최초 기반 배포

아래 단계는 각각 diff를 확인하고 별도로 실행한다. 후보 릴리스
workflow는 Vercel, CDK, 운영 DB를 자동 배포하지 않는다.

1. 깨끗한 브랜치에서 `make verify`를 통과시킨다.
2. 현재 운영 재렌더 Job Definition의 이미지 태그를 확인하여
   `LEGACY_RERENDER_IMAGE_TAG`로 기록한다.
   setup은 해당 digest에 `legacy-rerender-<digest>` 보호 태그를 먼저
   붙이고 레거시 Job Definition도 그 태그에 고정한다.
3. `cdk diff`에서 다음 추가만 확인한다.
   - 운영 내부 카나리 Fargate 큐(최대 4 vCPU)
   - `EditorReleaseRegistrar` Lambda와 최소 권한
   - opt-in `ShortsMvpEditorTest` 스택의 별도 S3, 로그, secret, 큐
4. 운영 CDK와 `ShortsMvpEditorTest`를 배포한다. 레거시 재렌더 정의의
   이미지가 이전과 같은지 다시 확인한다.
5. 운영 DB에 추가형 마이그레이션을 적용한다. 즉시
   `editor_release_state.public_enabled=false`,
   `canary_enabled=false`, `runtime_feature_flags.editor_rendering_v2=false`
   인지 확인한다.
6. 운영 웹을 두 환경변수가 모두 `false`인 상태로 배포하고 레거시
   DOM·문구·댓글 더블클릭·저장 요청 회귀를 확인한다.
7. 기반 배포가 정상임을 확인한 뒤 두 서버 스위치를 `true`로 바꾸어
   웹을 한 번 배포한다. DB 공개/카나리 상태가 모두 꺼져 있으므로
   일반 사용자에게는 계속 레거시 편집기만 보인다.

## GitHub Actions 설정

`Verify editor release candidate` workflow에 다음 값이 필요하다.

- variable: `AWS_WORKER_BUILD_ROLE_ARN`,
  `EDITOR_RELEASE_ECR_REPOSITORY_URI`
- variable: `EDITOR_TEST_JOB_QUEUE`,
  `EDITOR_TEST_TEMPLATE_JOB_DEFINITION`,
  `EDITOR_PRODUCTION_TEMPLATE_JOB_DEFINITION`,
  `EDITOR_RELEASE_REGISTRAR_FUNCTION`
- variable: `EDITOR_TEST_SUPABASE_PROJECT_REF`,
  `PRODUCTION_SUPABASE_PROJECT_REF` (둘은 반드시 달라야 함)
- secret: `EDITOR_TEST_DATABASE_URL`,
  `EDITOR_TEST_DATABASE_FINGERPRINT` (password를 제외한 고정 DB identity)

격리 AWS secret과 GitHub secret에는 테스트 전용 Supabase 값만 넣는다.
운영 데이터를 격리 프로젝트에 복제하지 않는다.

## 후보 생성

검증 전용 `codex/render-parity-v4-20260826` 브랜치에서 workflow를 수동
실행한다. `main`과 다른 임의 ref에서는 실행하지 않는다. workflow는 다음
순서를 강제한다.

1. 전체 `make verify`
2. render 이미지를 `editor-release-<git sha>` 태그로 한 번만 빌드·게시
3. ECR scan 완료 및 Critical 0건 확인
4. 프로젝트 ref를 대조한 뒤 격리 Supabase에만 마이그레이션 적용
5. 같은 digest로 격리 Job Definition 등록
6. 합성 영상 프로브 실행 및 격리 S3에 증거 저장
   - 분할·삭제·리플, 댓글 빈 구간, 자막, 추가 텍스트
   - 폰트 8종, 채널 이미지, 배경, 레이어 순서
   - 1080×1920 H.264/AAC, ±1프레임, 영상 경계 ±2px
7. 같은 digest로 운영 카나리 Job Definition 등록
8. Registrar가 Batch 성공, 두 Job Definition의 동일 digest와 템플릿
   계약, ECR scan, S3 manifest를 다시 확인한 뒤 `canary_ready` 후보를
   기록한다.

후보 이미지는 일반 worker 이미지의 개수 기반 정리 정책과 분리된
`shorts-mvp-editor-releases-production` ECR 저장소에 둔다. 활성 stable,
직전 stable, candidate 이미지를 나이만으로 자동 삭제하지 않으며,
30일이 지난 비활성 릴리스 정리는 DB 포인터와 감사 기록을 대조하는
별도 유지보수 작업에서만 수행한다.

어느 단계든 실패하면 후보 포인터를 공개하지 않는다.

## 운영 내부 카나리

1. 관리자 `편집기 릴리스`에서 내부 계정을 등록한다.
2. 후보의 격리 검사 전부가 `passed`인지 확인한다.
3. 확인 오버레이를 거쳐 `카나리 시작`을 누른다.
4. 등록된 계정으로 아래를 실제 확인한다.
   - 저장 → 렌더 → 다운로드
   - Gemini 댓글 재생성 1회와 60초 사용량 차감
   - 재진입 → 문서 복원 → 재편집
   - 레거시/직전 stable 롤백 훈련
5. 각 항목을 관리자 화면에서 통과 또는 실패로 기록한다.
6. 성공한 운영 카나리 렌더가 1건 이상이고 실패·고착 렌더는 0건이며
   모든 필수 검사가 통과해야만 `전체 승격` 버튼이 동작한다.

## 승격과 롤백

- 전체 승격은 한 DB 트랜잭션에서 stable 포인터와
  `public_enabled=true`를 바꾼다. 웹 재배포와 워커 재빌드는 없다.
- 신규 요청은 `release_id`, 채널, 실제 digest, Batch Job ID를 기록한다.
- 이미 열린 v2 화면은 자신의 릴리스 ID를 저장 요청에 보낸다. 현재
  stable과 직전 stable만 지원하며, 롤백된 릴리스의 신규 저장은
  서버가 거부한다.
- 진행 중인 작업은 저장 당시 Job Definition으로 끝난다. 재시도도
  같은 release와 Job Definition을 유지하고 Batch Job ID만 새로 만든다.
- `레거시 롤백`은 신규 저장을 즉시 레거시로 돌린다. 마지막 성공 영상과
  편집 문서는 유지하고 pending 상태만 실패로 해제한다.
- 마이그레이션과 감사 행은 롤백 때 삭제하지 않는다.

## 레거시 보호 확인

- `scripts/editor-release-guard.test.mjs`는 승인된 `globals.css`의 해시를
  고정한다.
- 후보 스타일은 `web/app/editor-v2.css`에만 추가하며 모든 selector가
  `.editor-v2-root`로 시작해야 한다.
- 일반 사용자 기준 DOM, 버튼 문구, 댓글 더블클릭 수정, 영상 길이,
  제목·자막·댓글의 기존 요청 형식을 변경하지 않는다.
- 고정 기준을 의도적으로 바꿔야 한다면 별도 사용자 영향 검토와
  스크린샷 승인을 먼저 받고 해시를 갱신한다.

## Render-spec v4 단계적 공개

- `NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED=true`는 Stage B 무별칭 후보를
  빌드하기 전에 Vercel Production 빌드 환경에 있어야 한다. 이 값은
  브라우저의 v4 컴파일러 포함 여부만 결정하며 계정을 단독으로 허용하지
  않는다. 실제 허용은 불변 4/4 릴리스, DB rollout bucket,
  `render_v4_kill_switch`가 계속 결정한다. 값이 없거나 `true`가 아니면
  v4 배정 계정이 정확한 명세를 저장할 수 없으므로 승격을 중단한다.

- v4 릴리스는 top-level 문서 버전 `3`을 유지하면서
  `render_spec_version=4`, `caption_render_spec_version=4`, 검증된 Linux
  폰트 manifest SHA-256을 하나의 불변 capability로 등록한다.
- workflow는 render 이미지를 한 번만 빌드하고 그 digest에서 폰트
  manifest와 격리 probe 증거를 만든 뒤, 같은 digest로 다섯 project lane
  (`legacy_project`, `source_range`, `elevenlabs_transcription`,
  `subtitle_templates`, `unified_template_subtitles`)을 각각 등록한다.
- 다섯 lane의 current 정의와 release registry의 source SHA, image digest,
  4/4/font hash가 모두 일치하기 전에는 신규 작업의 v4 필드를 저장하지
  않는다. 기존 작업은 NULL을 유지해 레거시 경로를 사용한다.
- 공개 순서는 kill switch가 켜진 기본 상태에서 시작해 내부 tester,
  5%, 25%, 100% 순서로만 올린다. 허용되는 공개 비율도
  `0`, `5`, `25`, `100`뿐이다.
- 이상 징후가 있으면 먼저 `render_v4_kill_switch`를 켠다. 목표 공개
  비율과 DB 기록은 삭제하지 않는다. 긴급 중단된 동일 immutable release는
  다시 켜지 않으며, 새 소스·이미지·release ID로 격리 검증부터 다시 진행한다.
  새 후보를 시작할 때 공개 비율은 0으로 초기화되고 이전 release의 긴급
  중단 이력이 새 release를 막지 않는다. DB 직접 수정으로 복구하지 않는다.
- previous 정의는 해당 정의를 참조하는 비종결 작업이 0건인 상태가
  15분 유지된 뒤 별도 인프라 변경으로 제거한다. v4 후보용 정확한 GitHub
  OIDC branch allowlist도 릴리스 완료 후 함께 제거한다.

### Stage B 인프라 변경 경계

- Stage A용 `infra:deploy-control-plane` 명령은 Stage B에 사용하지 않는다.
  그 명령의 고정 logical-ID 계약은 이번 registrar/IAM 변경과 다르다.
- Stage B는 `deploy-stage-b-release-control.mjs`의 네 phase만 사용한다.
  - `bootstrap`: registrar code와 고정 registry 경로, release build role의
    단일 exact OIDC subject, policy의 `shorts-mvp-editor-v4-*` TagResource ARN,
    Batch submitter code만 허용한다.
  - `renewal`: 불변 후보가 운영 연결 전에 실패했을 때만 사용한다. 새 exact
    tag를 가리키는 registrar code/environment, release build role trust,
    release verifier role trust만 Editor stack에서 변경하며 Compute 실행은
    거절한다. 세 리소스 중 이미 exact 후보와 일치하는 항목은 건드리지 않고,
    어긋난 항목만 1~3개 복구한다.
  - `rotation`: registrar의 registry asset, Batch submitter의 registry asset과
    registry에서 다시 계산한 current target 환경값만 허용한다. 이 phase의
    `--prior-stage-head..--head`에는
    `production-project-targets.json` 한 파일 변경만 존재해야 한다.
  - `lockdown`: release build role subject를
    `refs/tags/__disabled_editor_release__`로 바꾸는 IAM-only 변경만 허용한다.
- Compute Environment, Batch Queue, 기존 Job Definition, 그 밖의 Lambda/IAM,
  template envelope, DB, Vercel 변경은 모두 거절한다. 모든 변경은 `Modify`,
  scope는 허용된 property뿐이며 CloudFormation replacement가 정확히
  `False`여야 한다.
- OIDC subject는 기본적으로
  `refs/tags/__disabled_editor_release__`이고, 이번 검증 중에만
  `refs/tags/editor-v4-render-parity-20260827-5` exact ref를 허용한다. 와일드카드나
  다른 브랜치는 허용하지 않는다. Stage B 완료 후 disabled sentinel로
  되돌리는 별도 IAM-only 변경을 준비한다.
- 운영 적용은 두 stack의 현재 live template과 합성 template을 비교해 위
  phase별 허용 리소스만 복사한 exact template을 만든 뒤, stack별 change
  set만 준비한다. exact template은 versioning이 켜진 CDK asset bucket에
  SHA-256 checksum과 고정 version ID로 올리고, CloudFormation에는 그 URL을
  직접 전달한다. 두 preview와 template hash를 별도 검토한 뒤 EditorCanary를
  먼저 실행한다. Compute 실행은 Editor의 승인된 후보 hash가 실제 live
  template hash가 된 경우에만 가능하다.
- prepare 또는 검증이 중간 실패하면 그 실행에서 만든 미실행 change set만
  정리한다. 전체 `cdk deploy`, `--all`, Stage A 배포 명령, 수동 IAM 편집은
  사용하지 않는다. 구체적인 명령과 hash 전달 순서는
  [AWS runbook](aws-runbook.md)의 Stage B 절차를 따른다.
- AWS stack 실행 중에는 운영 DB의 TTL infrastructure lease를 유지한다.
  유효한 lease 동안 내부 활성화·승격·5→25→100 전환·일반 rollback은
  거절하고 긴급 중단만 항상 허용한다. lease는 process session이 아닌 DB
  만료시각과 owner/ID로 관리해 transaction pooler에서도 고아 lock을 남기지
  않는다.
