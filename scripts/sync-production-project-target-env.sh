#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_ENV_FILE="${SOURCE_ENV_FILE:-$ROOT/.env.local}"
REGISTRY_FILE="${PROJECT_TARGET_REGISTRY_FILE:-$ROOT/production-project-targets.json}"

source "$ROOT/scripts/load-env.sh"
load_env_file "$SOURCE_ENV_FILE"

: "${VERCEL_TEAM_SLUG:?VERCEL_TEAM_SLUG is required}"
: "${VERCEL_PROJECT_NAME:?VERCEL_PROJECT_NAME is required}"
: "${AWS_REGION:=ap-northeast-2}"
: "${BATCH_SUBMITTER_FUNCTION_NAME:=shorts-mvp-batch-submitter-production}"

command -v vercel >/dev/null 2>&1 || {
  echo "vercel CLI가 필요합니다." >&2
  exit 2
}

live_project_file="$(mktemp)"
value_file="$(mktemp)"
pulled_file="$(mktemp)"
registry_env_file="$(mktemp)"
trap 'rm -f "$live_project_file" "$value_file" "$pulled_file" "$registry_env_file"' EXIT

cd "$ROOT/web"
vercel whoami --scope "$VERCEL_TEAM_SLUG" >/dev/null
if [[ ! -f .vercel/project.json ]]; then
  vercel link \
    --yes \
    --project "$VERCEL_PROJECT_NAME" \
    --scope "$VERCEL_TEAM_SLUG" >/dev/null
fi
vercel api "/v9/projects/$VERCEL_PROJECT_NAME" \
  --raw \
  --scope "$VERCEL_TEAM_SLUG" > "$live_project_file"
node "$ROOT/scripts/verify-vercel-project-link.mjs" \
  --link "$ROOT/web/.vercel/project.json" \
  --live "$live_project_file" \
  --expected-name "$VERCEL_PROJECT_NAME"

# Fail before touching Vercel unless the newly deployed submitter uses the
# exact registry asset and every current/previous Batch resource is ready.
node "$ROOT/scripts/verify-production-worker-release.mjs" \
  --release "$ROOT/production-worker-release.json" \
  --lambda-function "$BATCH_SUBMITTER_FUNCTION_NAME" \
  --region "$AWS_REGION"

target_names=(
  LEGACY_PROJECT_JOB_DEFINITION_ARN
  LEGACY_PROJECT_BATCH_QUEUE_ARN
  LEGACY_PROJECT_BATCH_TARGET_RELEASE_ID
  SOURCE_RANGE_JOB_DEFINITION_ARN
  SOURCE_RANGE_BATCH_QUEUE_ARN
  SOURCE_RANGE_BATCH_TARGET_RELEASE_ID
  ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN
  ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN
  ELEVENLABS_TRANSCRIPTION_BATCH_TARGET_RELEASE_ID
  SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN
  SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN
  SUBTITLE_TEMPLATES_BATCH_TARGET_RELEASE_ID
  UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN
  UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN
  UNIFIED_TEMPLATE_SUBTITLES_BATCH_TARGET_RELEASE_ID
)

node "$ROOT/scripts/production-project-targets.mjs" env "$REGISTRY_FILE" > "$registry_env_file"

for name in "${target_names[@]}"; do
  value=""
  while IFS='=' read -r candidate_name candidate_value; do
    if [[ "$candidate_name" == "$name" ]]; then
      value="$candidate_value"
      break
    fi
  done < "$registry_env_file"
  if [[ -z "$value" ]]; then
    echo "registry에서 필수 Vercel 대상 값을 찾을 수 없습니다: $name" >&2
    exit 2
  fi
  printf '%s' "$value" > "$value_file"
  vercel env add "$name" production \
    --force \
    --scope "$VERCEL_TEAM_SLUG" < "$value_file" >/dev/null
done

vercel env pull "$pulled_file" \
  --yes \
  --environment production \
  --scope "$VERCEL_TEAM_SLUG" >/dev/null

node "$ROOT/scripts/verify-project-batch-targets.mjs" \
  --env "$pulled_file" \
  --registry "$REGISTRY_FILE" \
  --lambda-function "$BATCH_SUBMITTER_FUNCTION_NAME" \
  --region "$AWS_REGION"

echo "Vercel production 프로젝트 Batch 대상 15개만 동기화했습니다."
