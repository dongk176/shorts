#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

source scripts/load-env.sh
load_env_file .env.local

for name in DATABASE_URL OPENAI_API_KEY; do
  [[ -n "${!name:-}" ]] || { echo "필수 환경변수가 없습니다: $name" >&2; exit 2; }
done
command -v docker >/dev/null 2>&1 || { echo "Docker Desktop이 필요합니다." >&2; exit 2; }
command -v aws >/dev/null 2>&1 || { echo "AWS CLI가 필요합니다." >&2; exit 2; }
aws sts get-caller-identity >/dev/null

export AWS_REGION="${AWS_REGION:-ap-northeast-2}"
export EDIT_TIMELINE_CAPTURE_ENABLED="${EDIT_TIMELINE_CAPTURE_ENABLED:-true}"
if [[ -z "${AWS_S3_OUTPUT_BUCKET:-}" ]]; then
  export AWS_S3_OUTPUT_BUCKET="$(bash scripts/stack-outputs.sh MediaBucketName Foundation)"
fi
export TEMP_ROOT="/tmp/shorts-mac-worker"

worker_id="${MAC_WORKER_ID:-$(hostname -s)}"
container_name="shorts-mac-worker-${worker_id//[^A-Za-z0-9_.-]/-}"
image_name="${SHORTS_WORKER_IMAGE:-shorts-worker:mac}"
poll_seconds="${MAC_WORKER_POLL_SECONDS:-5}"

docker build --tag "$image_name" worker

echo "Mac worker 시작: $worker_id (Ctrl-C로 종료)"
while true; do
  # aws login credentials are short-lived. Refresh them before every claimed job.
  eval "$(aws configure export-credentials --format env)"
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  docker run --rm \
    --name "$container_name" \
    --env DATABASE_URL \
    --env AWS_REGION \
    --env AWS_S3_OUTPUT_BUCKET \
    --env AWS_ACCESS_KEY_ID \
    --env AWS_SECRET_ACCESS_KEY \
    --env AWS_SESSION_TOKEN \
    --env OPENAI_API_KEY \
    --env OPENAI_TRANSCRIBE_MODEL \
    --env OPENAI_HIGHLIGHT_FALLBACK_MODEL \
    --env OPENAI_COMMENT_FALLBACK_MODEL \
    --env OPENAI_TRANSCRIBE_CHUNK_SECONDS \
    --env OPENAI_TRANSCRIBE_MAX_WORKERS \
    --env EDIT_TIMELINE_CAPTURE_ENABLED \
    --env GEMINI_API_KEY \
    --env GEMINI_PAID_DATA_PROCESSING_CONFIRMED \
    --env GEMINI_TEXT_MODEL \
    --env GEMINI_COMMENT_MODEL \
    --env GEMINI_OPENAI_BASE_URL \
    --env TEMP_ROOT \
    "$image_name" \
    python -m shorts_worker pull \
      --worker-id "$worker_id" \
      --poll-seconds "$poll_seconds" \
      --max-jobs 1 \
      --idle-timeout 300
  sleep "$poll_seconds"
done
