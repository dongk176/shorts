#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web"
source ../scripts/load-env.sh
load_env_file ../.env.local
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
export VIDEO_JOB_BACKEND="${VIDEO_JOB_BACKEND:-aws_batch}"
export BATCH_SUBMITTER_FUNCTION_NAME="${BATCH_SUBMITTER_FUNCTION_NAME:-shorts-mvp-batch-submitter-production}"

PRODUCTION_WORKER_RELEASE_FILE="${PRODUCTION_WORKER_RELEASE_FILE:-$ROOT/production-worker-release.json}"
while IFS='=' read -r release_name release_value; do
  [[ -n "$release_name" && -n "$release_value" ]] || continue
  export "$release_name=$release_value"
done < <(node ../scripts/production-worker-release.mjs env "$PRODUCTION_WORKER_RELEASE_FILE")

node ../scripts/verify-production-worker-release.mjs \
  --release "$PRODUCTION_WORKER_RELEASE_FILE" \
  --lambda-function "$BATCH_SUBMITTER_FUNCTION_NAME" \
  --region "$AWS_REGION"

# The web persists an immutable Batch target with every project. Fail before
# touching Vercel if those values differ from the submitter Lambda allowlist.
node ../scripts/verify-project-batch-targets.mjs \
  --env ../.env.local \
  --lambda-function "$BATCH_SUBMITTER_FUNCTION_NAME" \
  --region "$AWS_REGION"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
for name in DATABASE_URL SUPABASE_URL SUPABASE_PUBLISHABLE_KEY YOUTUBE_API_KEY \
  AWS_ROLE_ARN AWS_REGION AWS_S3_OUTPUT_BUCKET \
  CLOUDFRONT_DOMAIN CLOUDFRONT_KEY_PAIR_ID CLOUDFRONT_PRIVATE_KEY_B64 \
  NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY TOSS_BILLING_SECRET_KEY \
  TOSS_BILLING_KEY_ENCRYPTION_KEY \
  TOSS_BILLING_ENABLED TOSS_BILLING_CHARGES_ENABLED \
  TOSS_BILLING_RENEWALS_ENABLED TOSS_BILLING_COHORT_ASSIGNMENT_ENABLED \
  CRON_SECRET \
  THEPAYONE_BILLING_ENABLED THEPAYONE_MID THEPAYONE_TERMINAL_ID THEPAYONE_PAY_KEY \
  THEPAYONE_PACKAGE_PAYMENT_MODE THEPAYONE_ADDON_PAYMENT_MODE \
  THEPAYONE_PACKAGE_BILLING_ENABLED THEPAYONE_PACKAGE_MID \
  THEPAYONE_PACKAGE_TERMINAL_ID THEPAYONE_PACKAGE_PAY_KEY \
  THEPAYONE_API_BASE_URL THEPAYONE_WEBHOOK_BASE_URL THEPAYONE_WEBHOOK_SECRET \
  THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY THEPAYONE_RENEWAL_WEBHOOK_GRACE_HOURS \
  GEMINI_API_KEY GEMINI_PAID_DATA_PROCESSING_CONFIRMED \
  GEMINI_COMMENT_MODEL GEMINI_OPENAI_BASE_URL \
  EDITOR_RENDERING_V2_ENABLED EDITOR_RENDERING_V2_GLOBAL_ENABLED \
  EDITOR_RENDERING_V2_TEST_USER_IDS \
  LEGACY_PROJECT_JOB_DEFINITION_ARN LEGACY_PROJECT_BATCH_QUEUE_ARN \
  SOURCE_RANGE_JOB_DEFINITION_ARN SOURCE_RANGE_BATCH_QUEUE_ARN \
  ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN \
  ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN \
  SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN \
  VIDEO_JOB_BACKEND MVP_PLAN_ENFORCEMENT; do
  value="${!name:-}"
  [[ -n "$value" ]] || { echo "건너뜀(값 없음): $name"; continue; }
  printf '%s' "$value" > "$tmp"
  vercel env add "$name" production --force < "$tmp" >/dev/null
done
echo "Vercel production 환경변수 동기화 완료"
