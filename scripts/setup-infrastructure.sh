#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-ap-northeast-2}"
ENVIRONMENT="${DEPLOY_ENV:-production}"
cd "$ROOT"

echo "생성 예정: private S3, CloudFront, ECR, NAT 없는 VPC, Prepare Fargate, Render EC2 Spot/On-Demand, SQS, IAM/OIDC, EventBridge/Lambda"

for command in aws openssl node npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "필수 명령을 찾을 수 없습니다: $command" >&2
    exit 2
  fi
done
aws sts get-caller-identity >/dev/null

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
github_oidc_arn="$(aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')].Arn | [0]" --output text)"
vercel_oidc_arn="$(aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[?contains(Arn, 'oidc.vercel.com/${VERCEL_TEAM_SLUG}')].Arn | [0]" --output text)"
if [[ -n "$github_oidc_arn" && "$github_oidc_arn" != "None" ]]; then
  context_args+=("-c" "githubOidcProviderArn=$github_oidc_arn")
fi
if [[ -n "$vercel_oidc_arn" && "$vercel_oidc_arn" != "None" ]]; then
  aws iam add-client-id-to-open-id-connect-provider \
    --open-id-connect-provider-arn "$vercel_oidc_arn" \
    --client-id sts.amazonaws.com >/dev/null
  context_args+=("-c" "vercelOidcProviderArn=$vercel_oidc_arn")
fi
deploy_args=(
  -c "environment=$ENVIRONMENT"
  -c "vercelTeamSlug=$VERCEL_TEAM_SLUG"
  -c "vercelProjectName=$VERCEL_PROJECT_NAME"
  -c "githubOrg=${GITHUB_ORG:-dongk176}"
  -c "githubRepo=${GITHUB_REPO:-shorts}"
)
if [[ ${#context_args[@]} -gt 0 ]]; then
  deploy_args+=("${context_args[@]}")
fi
AWS_REGION="$REGION" npm --prefix infra/aws run deploy -- "${deploy_args[@]}"

bash scripts/sync-runtime-secret.sh
bash scripts/sync-vercel-env.sh
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh variable set AWS_WORKER_BUILD_ROLE_ARN --repo "${GITHUB_ORG:-dongk176}/${GITHUB_REPO:-shorts}" \
    --body "$(bash scripts/stack-outputs.sh GithubWorkerBuildRoleArn Compute)"
  gh variable set AWS_ECR_REPOSITORY_URI --repo "${GITHUB_ORG:-dongk176}/${GITHUB_REPO:-shorts}" \
    --body "$(bash scripts/stack-outputs.sh WorkerRepositoryUri Foundation)"
fi
echo "AWS 인프라 구성이 완료되었습니다. GitHub Actions에서 worker image를 게시하세요."
