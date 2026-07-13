#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web"
if [[ -f ../.env.local ]]; then
  set -a
  source ../.env.local
  set +a
fi
command -v vercel >/dev/null 2>&1 || { echo "vercel CLI가 필요합니다." >&2; exit 2; }
vercel whoami >/dev/null
if [[ ! -f .vercel/project.json ]]; then
  vercel link --yes --project "${VERCEL_PROJECT_NAME:?VERCEL_PROJECT_NAME is required}" >/dev/null
fi

export AWS_ROLE_ARN="$(bash ../scripts/stack-outputs.sh VercelRoleArn Compute)"
export AWS_S3_OUTPUT_BUCKET="$(bash ../scripts/stack-outputs.sh MediaBucketName Foundation)"
export CLOUDFRONT_DOMAIN="$(bash ../scripts/stack-outputs.sh CloudFrontDomain Foundation)"
export CLOUDFRONT_KEY_PAIR_ID="$(bash ../scripts/stack-outputs.sh CloudFrontKeyPairId Foundation)"
export CLOUDFRONT_PRIVATE_KEY_B64="$(base64 < ../.secrets/cloudfront-private.pem | tr -d '\n')"
export AWS_REGION="${AWS_REGION:-ap-northeast-2}"
export MVP_PLAN_ENFORCEMENT="${MVP_PLAN_ENFORCEMENT:-false}"
export MVP_MAX_ACTIVE_JOBS_PER_SESSION="${MVP_MAX_ACTIVE_JOBS_PER_SESSION:-1}"
export VIDEO_JOB_BACKEND="${VIDEO_JOB_BACKEND:-aws_batch}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
for name in DATABASE_URL YOUTUBE_API_KEY AWS_ROLE_ARN AWS_REGION AWS_S3_OUTPUT_BUCKET \
  CLOUDFRONT_DOMAIN CLOUDFRONT_KEY_PAIR_ID CLOUDFRONT_PRIVATE_KEY_B64 \
  MVP_PLAN_ENFORCEMENT MVP_MAX_ACTIVE_JOBS_PER_SESSION VIDEO_JOB_BACKEND; do
  value="${!name:-}"
  [[ -n "$value" ]] || { echo "건너뜀(값 없음): $name"; continue; }
  printf '%s' "$value" > "$tmp"
  vercel env add "$name" production --force < "$tmp" >/dev/null
done
echo "Vercel production 환경변수 동기화 완료"
