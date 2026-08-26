#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-ap-northeast-2}"
ENVIRONMENT="${DEPLOY_ENV:-production}"
cd "$ROOT"
if [[ -z "${WORKER_IMAGE_TAG:-}" ]] \
  && [[ -n "$(git status --porcelain -- worker infra/aws/lambda infra/aws/lib/stacks.ts supabase/migrations)" ]]; then
  echo "Worker/Batch 변경을 먼저 커밋하고 이미지 빌드가 끝난 뒤 배포하세요." >&2
  exit 2
fi
WORKER_IMAGE_TAG="${WORKER_IMAGE_TAG:-$(git rev-parse HEAD)}"
if [[ "$ENVIRONMENT" == "production" ]]; then
  LEGACY_RERENDER_IMAGE_TAG="${LEGACY_RERENDER_IMAGE_TAG:?Set LEGACY_RERENDER_IMAGE_TAG to the currently deployed known-good rerender image tag}"
else
  LEGACY_RERENDER_IMAGE_TAG="${LEGACY_RERENDER_IMAGE_TAG:-$WORKER_IMAGE_TAG}"
fi
if [[ "$LEGACY_RERENDER_IMAGE_TAG" == "latest" || "$LEGACY_RERENDER_IMAGE_TAG" == "latest-prepare" ]]; then
  echo "레거시 재렌더 이미지는 불변 태그로 고정해야 합니다." >&2
  exit 2
fi

echo "생성 예정: private S3, CloudFront, ECR, NAT 없는 VPC, Prepare Fargate, Render EC2 Spot/On-Demand, SQS, IAM/OIDC, EventBridge/Lambda"

for command in aws git openssl node npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "필수 명령을 찾을 수 없습니다: $command" >&2
    exit 2
  fi
done
aws sts get-caller-identity >/dev/null

PRODUCTION_WORKER_RELEASE_FILE="${PRODUCTION_WORKER_RELEASE_FILE:-$ROOT/production-worker-release.json}"
if [[ "$ENVIRONMENT" == "production" ]]; then
  : "${UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN:?UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN is required in production}"
  : "${UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN:?UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN is required in production}"
  while IFS='=' read -r release_name release_value; do
    [[ -n "$release_name" && -n "$release_value" ]] || continue
    export "$release_name=$release_value"
  done < <(node scripts/production-worker-release.mjs env "$PRODUCTION_WORKER_RELEASE_FILE")
  node scripts/verify-production-worker-release.mjs \
    --release "$PRODUCTION_WORKER_RELEASE_FILE" \
    --lambda-function shorts-mvp-batch-submitter-production \
    --region "$REGION"
fi

echo "Supabase schema migration을 먼저 적용합니다."
npm run db:migrate

repository_name="shorts-mvp-worker-$ENVIRONMENT"
if aws ecr describe-repositories --region "$REGION" \
  --repository-names "$repository_name" >/dev/null 2>&1; then
  for image_tag in "$WORKER_IMAGE_TAG" "$WORKER_IMAGE_TAG-prepare"; do
    if ! aws ecr describe-images --region "$REGION" --repository-name "$repository_name" \
      --image-ids "imageTag=$image_tag" >/dev/null 2>&1; then
      echo "ECR에 Worker 이미지 $image_tag 가 없습니다. GitHub Actions 완료 후 다시 배포하세요." >&2
      exit 2
    fi
  done
  if ! aws ecr describe-images --region "$REGION" --repository-name "$repository_name" \
    --image-ids "imageTag=$LEGACY_RERENDER_IMAGE_TAG" >/dev/null 2>&1; then
    echo "ECR에 레거시 재렌더 이미지 $LEGACY_RERENDER_IMAGE_TAG 가 없습니다." >&2
    exit 2
  fi
  legacy_rerender_digest="$(
    aws ecr describe-images --region "$REGION" \
      --repository-name "$repository_name" \
      --image-ids "imageTag=$LEGACY_RERENDER_IMAGE_TAG" \
      --query "imageDetails[0].imageDigest" --output text
  )"
  if [[ ! "$legacy_rerender_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "레거시 재렌더 이미지 digest를 확인할 수 없습니다." >&2
    exit 2
  fi
  protected_legacy_tag="legacy-rerender-${legacy_rerender_digest:7:40}"
  if ! aws ecr describe-images --region "$REGION" \
    --repository-name "$repository_name" \
    --image-ids "imageTag=$protected_legacy_tag" >/dev/null 2>&1; then
    legacy_rerender_manifest="$(
      aws ecr batch-get-image --region "$REGION" \
        --repository-name "$repository_name" \
        --image-ids "imageDigest=$legacy_rerender_digest" \
        --query "images[0].imageManifest" --output text
    )"
    if [[ -z "$legacy_rerender_manifest" || "$legacy_rerender_manifest" == "None" ]]; then
      echo "레거시 재렌더 이미지 manifest를 확인할 수 없습니다." >&2
      exit 2
    fi
    aws ecr put-image --region "$REGION" \
      --repository-name "$repository_name" \
      --image-tag "$protected_legacy_tag" \
      --image-manifest "$legacy_rerender_manifest" >/dev/null
  fi
  LEGACY_RERENDER_IMAGE_TAG="$protected_legacy_tag"
elif [[ "$ENVIRONMENT" == "production" ]]; then
  echo "운영 레거시 재렌더 ECR 저장소를 찾을 수 없습니다." >&2
  exit 2
fi

mkdir -p .secrets
if [[ ! -s .secrets/cloudfront-private.pem || ! -s .secrets/cloudfront-public.pem ]]; then
  openssl genrsa -out .secrets/cloudfront-private.pem 2048 >/dev/null 2>&1
  openssl rsa -pubout -in .secrets/cloudfront-private.pem -out .secrets/cloudfront-public.pem >/dev/null 2>&1
  chmod 600 .secrets/cloudfront-private.pem
fi

export VERCEL_TEAM_SLUG="${VERCEL_TEAM_SLUG:?VERCEL_TEAM_SLUG is required for a restricted OIDC trust policy}"
export VERCEL_PROJECT_NAME="${VERCEL_PROJECT_NAME:?VERCEL_PROJECT_NAME is required for a restricted OIDC trust policy}"

npm --prefix infra/aws install
npx --prefix infra/aws cdk bootstrap "aws://${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}/$REGION"
context_args=()
github_oidc_arn="${GITHUB_OIDC_PROVIDER_ARN:-$(aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn | [0]" --output text)}"
if [[ -n "$github_oidc_arn" && "$github_oidc_arn" != "None" ]]; then
  context_args+=("-c" "githubOidcProviderArn=$github_oidc_arn")
fi
if [[ -n "${VERCEL_OIDC_PROVIDER_ARN:-}" ]]; then
  for client_id in "https://vercel.com/$VERCEL_TEAM_SLUG" "sts.amazonaws.com"; do
    aws iam add-client-id-to-open-id-connect-provider \
      --open-id-connect-provider-arn "$VERCEL_OIDC_PROVIDER_ARN" \
      --client-id "$client_id" >/dev/null
  done
  context_args+=("-c" "vercelOidcProviderArn=$VERCEL_OIDC_PROVIDER_ARN")
fi
deploy_args=(
  -c "environment=$ENVIRONMENT"
  -c "workerImageTag=$WORKER_IMAGE_TAG"
  -c "legacyRerenderImageTag=$LEGACY_RERENDER_IMAGE_TAG"
  -c "vercelTeamSlug=$VERCEL_TEAM_SLUG"
  -c "vercelProjectName=$VERCEL_PROJECT_NAME"
  -c "githubOrg=${GITHUB_ORG:-dongk176}"
  -c "githubRepo=${GITHUB_REPO:-shorts}"
)
if [[ "$ENVIRONMENT" == "production" ]]; then
  deploy_args+=(
    -c "legacyProjectJobDefinitionArn=$LEGACY_PROJECT_JOB_DEFINITION_ARN"
    -c "legacyProjectBatchQueueArn=$LEGACY_PROJECT_BATCH_QUEUE_ARN"
    -c "sourceRangeJobDefinitionArn=$SOURCE_RANGE_JOB_DEFINITION_ARN"
    -c "sourceRangeBatchQueueArn=$SOURCE_RANGE_BATCH_QUEUE_ARN"
    -c "elevenLabsTranscriptionJobDefinitionArn=$ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN"
    -c "elevenLabsTranscriptionBatchQueueArn=$ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN"
    -c "subtitleTemplatesJobDefinitionArn=$SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"
    -c "subtitleTemplatesBatchQueueArn=$SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"
    -c "unifiedTemplateSubtitlesJobDefinitionArn=$UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"
    -c "unifiedTemplateSubtitlesBatchQueueArn=$UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
  )
  if [[ -n "${UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN:-}" ]]; then
    deploy_args+=(
      -c "unifiedTemplateSubtitlesPreviousJobDefinitionArn=$UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN"
    )
  fi
fi
if [[ ${#context_args[@]} -gt 0 ]]; then
  deploy_args+=("${context_args[@]}")
fi
AWS_REGION="$REGION" npm --prefix infra/aws run deploy -- "${deploy_args[@]}"

bash scripts/sync-runtime-secret.sh
bash scripts/sync-vercel-env.sh
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh variable set AWS_WORKER_BUILD_ROLE_ARN --repo "${GITHUB_ORG:-dongk176}/${GITHUB_REPO:-shorts}" \
    --body "$(bash scripts/stack-outputs.sh GithubWorkerBuildRoleArn Compute)"
  gh variable set EDITOR_RELEASE_BUILD_ROLE_ARN --repo "${GITHUB_ORG:-dongk176}/${GITHUB_REPO:-shorts}" \
    --body "$(bash scripts/stack-outputs.sh EditorReleaseBuildRoleArn EditorCanary)"
  gh variable set AWS_ECR_REPOSITORY_URI --repo "${GITHUB_ORG:-dongk176}/${GITHUB_REPO:-shorts}" \
    --body "$(bash scripts/stack-outputs.sh WorkerRepositoryUri Foundation)"
  gh variable set EDITOR_RELEASE_ECR_REPOSITORY_URI \
    --repo "${GITHUB_ORG:-dongk176}/${GITHUB_REPO:-shorts}" \
    --body "$(bash scripts/stack-outputs.sh EditorReleaseRepositoryUri Foundation)"
  gh variable set EDITOR_PRODUCTION_TEMPLATE_JOB_DEFINITION \
    --repo "${GITHUB_ORG:-dongk176}/${GITHUB_REPO:-shorts}" \
    --body "$(bash scripts/stack-outputs.sh RerenderFargateBatchJobDefinition Compute)"
  gh variable set EDITOR_RELEASE_REGISTRAR_FUNCTION \
    --repo "${GITHUB_ORG:-dongk176}/${GITHUB_REPO:-shorts}" \
    --body "$(bash scripts/stack-outputs.sh EditorReleaseRegistrarFunctionArn Compute)"
  if [[ "${INCLUDE_EDITOR_TEST:-false}" == "true" ]]; then
    gh variable set EDITOR_TEST_JOB_QUEUE \
      --repo "${GITHUB_ORG:-dongk176}/${GITHUB_REPO:-shorts}" \
      --body "$(bash scripts/stack-outputs.sh EditorTestBatchJobQueue EditorTest)"
    gh variable set EDITOR_TEST_TEMPLATE_JOB_DEFINITION \
      --repo "${GITHUB_ORG:-dongk176}/${GITHUB_REPO:-shorts}" \
      --body "$(bash scripts/stack-outputs.sh EditorTestTemplateJobDefinitionArn EditorTest)"
  fi
fi
echo "AWS 인프라 구성이 완료되었습니다. GitHub Actions에서 worker image를 게시하세요."
