# AWS runbook

## Provision and publish

1. `aws sts get-caller-identity`가 대상 계정인지 확인합니다.
2. `VERCEL_TEAM_SLUG`, `VERCEL_PROJECT_NAME`, `AWS_REGION=ap-northeast-2`를 설정합니다.
3. `npm run infra:setup`으로 CDK와 server secrets를 적용합니다.
4. CDK 출력의 `GithubWorkerBuildRoleArn`, `WorkerRepositoryUri`를 GitHub Actions variables `AWS_WORKER_BUILD_ROLE_ARN`, `AWS_ECR_REPOSITORY_URI`로 등록합니다.
5. `Build and publish worker` workflow를 실행합니다.
6. `vercel deploy --prod` 후 `scripts/verify-production.sh <url>`을 실행합니다.

CloudFront private key는 `.secrets/cloudfront-private.pem`과 Vercel secret에만 둡니다. 분실 시 새 key pair/public key/key group을 배포하고 Vercel env를 교체합니다.

## Failed/stale jobs

- CloudWatch `/shorts-mvp/<env>/worker`에서 job UUID stage를 확인합니다. 비밀값이나 full signed URL은 로그에 남지 않습니다.
- Batch 최종 FAILED라면 EventBridge Lambda가 job `failed`, reservation `released`로 바꿔야 합니다.
- heartbeat와 cleanup Lambda 실행 기록을 확인합니다. 정상 RUNNING Batch job은 stale cleanup이 실패 처리하지 않습니다.
- 부분 업로드 실패 시 Worker가 해당 job의 세 prefix를 지우고 partial rows를 제거합니다.

## Cleanup verification

- EventBridge hourly rule과 cleanup Lambda 오류/Throttle을 확인합니다.
- S3 lifecycle `ExpireMvpMedia`가 enabled, 30일, incomplete multipart 1일인지 확인합니다.
- `edit-sources/`가 CloudFront에서 403인지 확인합니다.
- cleanup Lambda에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 들어 있는 runtime secret 접근 권한이 있는지 확인합니다.

CDK stack 삭제는 media bucket/ECR/runtime secret을 RETAIN하므로 사용자 파일을 실수로 지우지 않습니다. Retained resource의 실제 삭제는 별도 승인과 백업 확인 후 수동 수행합니다.
