# AWS runbook

## Provision and publish

1. `aws sts get-caller-identity`가 대상 계정인지 확인합니다.
2. `VERCEL_TEAM_SLUG`, `VERCEL_PROJECT_NAME`, `AWS_REGION=ap-northeast-2`를 설정합니다.
3. 현재 승격된 운영 커밋의 후속 커밋만 main에 반영합니다. Worker를 변경하지 않는 릴리스는 `production-worker-release.json`의 기존 검증 digest를 재사용합니다.
4. Worker 변경 릴리스에서만 `Build and publish worker` workflow와 격리 검증을 거쳐 새 digest와 네 Job Definition을 `production-worker-release.json`에 기록합니다. `npm run infra:setup`은 이 파일이 없거나 Lambda·Batch 실제값과 다르면 운영 배포를 중단합니다.
5. 최초 환경이라면 CDK 출력의 `GithubWorkerBuildRoleArn`,
   `WorkerRepositoryUri`, `EditorReleaseRepositoryUri`를 각각 GitHub
   Actions variables `AWS_WORKER_BUILD_ROLE_ARN`,
   `AWS_ECR_REPOSITORY_URI`, `EDITOR_RELEASE_ECR_REPOSITORY_URI`로
   등록한 뒤 해당 workflow를 한 번 수동 실행합니다.
6. `scripts/sync-vercel-env.sh`를 실행합니다. 이 명령은 Vercel 값을 쓰기 전에
   다섯 프로젝트 Batch 대상이 `shorts-mvp-batch-submitter-production` Lambda의
   신뢰 ARN과 정확히 일치하고 각 Job Definition/queue가 ACTIVE 및
   VALID/ENABLED 상태인지 검사하며, 하나라도 다르면 배포를 중단합니다.
7. 현재 운영 커밋과 후보의 route manifest를 `scripts/verify-production-release.mjs --base <운영 SHA> --baseline-manifest <운영 manifest>`로 비교합니다.
8. `vercel deploy --prod --skip-domain`으로 무별칭 운영 후보를 만든 뒤 핵심 경로와 UI를 검증합니다.
9. 검증한 후보를 `vercel promote <후보 URL>`로 재빌드 없이 승격하고 `scripts/verify-production.sh <운영 URL>`을 실행합니다.
10. `node scripts/verify-production-worker-release.mjs`와 `node scripts/audit-production-billing.mjs --since <점검 시작 시각> --env-file <운영 env 파일>`으로 Worker drift와 결제 불일치를 확인합니다.

CloudFront private key는 `.secrets/cloudfront-private.pem`과 Vercel secret에만 둡니다. 분실 시 새 key pair/public key/key group을 배포하고 Vercel env를 교체합니다.

통합 편집 렌더러는 일반 배포보다 순서가 엄격합니다. 레거시 재렌더
이미지를 `LEGACY_RERENDER_IMAGE_TAG`로 별도 고정하고, 격리 AWS/Supabase,
불변 digest, 운영 내부 카나리, 관리자 승격 순서는
[편집기 v2 안전 테스트·승격](editor-rendering-v2-rollout.md)을 따릅니다.
후보 workflow는 Vercel·CDK·운영 DB를 자동 배포하지 않습니다.

## 통합 템플릿 자막 최초 생성 후보

`Verify editor release candidate` workflow는 검증한 단일 이미지 digest로
기존 재렌더 후보와 별도로 최초 생성용 Job Definition을 등록합니다. Workflow
summary와 등록 step output의
`UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN`은 revision까지 포함한 정확한
ARN이어야 합니다. 템플릿 입력
`UNIFIED_TEMPLATE_SUBTITLES_TEMPLATE_JOB_DEFINITION`은
`shorts-mvp-project-heavy-fargate-production` 이름 또는 그 정의의
revision-pinned ARN만 허용합니다.
등록 단계는 `production-worker-release.json`의 revision-pinned
`subtitleTemplates.jobDefinitionArn`에서 PoToken, 다운로드 제한, 기존 수집
프록시 secret을 검증해 복제합니다. 동일 이미지의 기존 후보라도 이 수집
계약이 다르면 재사용하지 않고 새 revision을 등록합니다.

후보 workflow는 queue를 만들거나 선택하지 않습니다. 최초 생성 카나리는
기존 수집 프록시 네트워크를 사용하면서 일반 프로젝트 queue(priority 20)보다
낮은 `shorts-mvp-prepare-production` queue(priority 10)를 공유합니다. 편집기
격리 queue는 재렌더용 HTTPS/DB 송신만 허용하므로 링크 수집 대상으로 쓰지
않습니다. 이름을 환경변수에 넣지 말고 다음 읽기 전용 확인으로 실제 정확
ARN을 얻습니다.

```sh
approved_queue_name=shorts-mvp-prepare-production
UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN="$(
  aws batch describe-job-queues \
    --region ap-northeast-2 \
    --job-queues "$approved_queue_name" \
    --query 'jobQueues[?status==`VALID` && state==`ENABLED`]|[0].jobQueueArn' \
    --output text
)"
case "$UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN" in
  arn:aws:batch:ap-northeast-2:????????????:job-queue/*) ;;
  *) echo "approved Batch queue exact ARN 확인 실패" >&2; exit 2 ;;
esac
```

Workflow 실행 전 위 exact ARN을 GitHub Actions variable
`UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN`에 등록합니다. 템플릿을 이름이
아닌 revision으로 고정하려면 project-heavy exact ARN을
`UNIFIED_TEMPLATE_SUBTITLES_TEMPLATE_JOB_DEFINITION` variable에 등록합니다.
둘 다 기존 리소스를 가리킬 뿐 workflow가 queue를 생성하지는 않습니다.

Workflow가 출력한 정확 Job Definition ARN과 위 queue ARN을 각각
`UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN`,
`UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN`으로 배포 환경에 넣습니다. 기존
네 definition 중 하나를 재사용하면 안 되며 queue 공유만 허용됩니다.
`scripts/verify-project-batch-targets.mjs`가 다섯 definition의 격리, 웹과 제출
Lambda의 exact pair 일치, ACTIVE/VALID/ENABLED 상태를 모두 확인한 뒤에만
Vercel 동기화를 진행합니다.

### v5 카나리 활성화 순서

1. 운영에는 추가형
   `202608240002_unified_template_subtitles_canary_flag.sql`만 적용하고 새
   플래그가 `false`인지 확인합니다. 기존 자막·편집·전사 공개 플래그는
   변경하지 않습니다.
2. 깨끗한 후보 브랜치에서 workflow를 실행해 재렌더 정의와 최초 생성 정의가
   동일한 이미지 digest인지 확인합니다.
3. 위의 정확한 최초 생성 definition/queue pair를 Batch submitter와 Vercel에
   동기화합니다. 독립 플래그가 꺼져 있으므로 이 단계에서 v5 요청은 없습니다.
4. 웹을 alias 없는 후보 URL에 배포하고 `/`, `/guidebook`, `/pricing`, 관리자
   페이지, 편집기 경로, `/templates`를 확인합니다. 일반 계정과 비관리자
   tester에서 v5 카드와 API가 모두 차단되어야 합니다.
5. 검증한 동일 배포를 재빌드 없이 승격합니다. 그 뒤 자막 편집 capability가
   있는 candidate release를 시작하고 지정된 관리자 계정만 tester로 등록합니다.
6. 관리자 화면에서 `통합 자막 카나리 켜기`를 실행합니다. 링크 생성과 로컬
   업로드, 편집 재렌더를 검증한 뒤 전체 공개 없이 멈춥니다.

로컬 직접 업로드는 `NODE_ENV`가 production이 아니고,
`UNIFIED_TEMPLATE_SUBTITLE_LOCAL_UPLOAD_ENABLED=true`이며 receiver가
`localhost`, `127.0.0.1`, `[::1]` 중 하나일 때만 허용됩니다. 운영 업로드
receiver로 바꾸거나 production에서 이 예외를 켜지 않습니다.

문제가 생기면 관리자 화면에서 `통합 자막 카나리 중단`을 실행해
`unified_template_subtitles_canary=false`로 만듭니다. 기존
`subtitle_templates`와 공개 플래그, 이미 시작된 정상 작업, 저장된 DB 행은
건드리지 않습니다.

## Failed/stale jobs

- CloudWatch `/shorts-mvp/<env>/worker`에서 job UUID stage를 확인합니다. 비밀값이나 full signed URL은 로그에 남지 않습니다.
- Prepare/Render Batch FAILED라면 EventBridge Lambda가 원래 Array child를 찾아 60초 재시도를 예약해야 합니다. deadline 또는 시도 한도를 넘긴 경우에만 job `failed`, reservation `released`가 됩니다.
- heartbeat와 cleanup Lambda 실행 기록을 확인합니다. 정상 RUNNING Batch job은 stale cleanup이 실패 처리하지 않습니다.
- 부분 업로드 실패 시 Worker가 해당 job의 세 prefix를 지우고 partial rows를 제거합니다.

## Cleanup verification

- EventBridge 1분 rule과 cleanup Lambda 오류/Throttle을 확인합니다.
- S3 lifecycle `ExpireMvpMedia`가 enabled, 30일, incomplete multipart 1일인지 확인합니다.
- `edit-sources/`가 CloudFront에서 403인지 확인합니다.
- cleanup Lambda에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 들어 있는 runtime secret 접근 권한이 있는지 확인합니다.

CDK stack 삭제는 media bucket/ECR/runtime secret을 RETAIN하므로 사용자 파일을 실수로 지우지 않습니다. Retained resource의 실제 삭제는 별도 승인과 백업 확인 후 수동 수행합니다.
