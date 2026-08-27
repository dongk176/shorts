#!/usr/bin/env bash
set -euo pipefail

release_kind="${1:?usage: register-editor-release-job.sh production|isolated|unified-template-subtitles}"
template_definition="${2:?template job definition is required}"
repository_uri="${EDITOR_RELEASE_ECR_REPOSITORY_URI:?EDITOR_RELEASE_ECR_REPOSITORY_URI is required}"
git_sha="${EDITOR_RELEASE_GIT_SHA:?EDITOR_RELEASE_GIT_SHA is required}"
image_digest="${EDITOR_RELEASE_IMAGE_DIGEST:?EDITOR_RELEASE_IMAGE_DIGEST is required}"
render_spec_version="${EDITOR_RELEASE_RENDER_SPEC_VERSION:-}"
caption_render_spec_version="${EDITOR_RELEASE_CAPTION_RENDER_SPEC_VERSION:-}"
font_manifest_sha256="${EDITOR_RELEASE_FONT_MANIFEST_SHA256:-}"
region="${AWS_REGION:-ap-northeast-2}"
candidate_vcpus="4"
candidate_ffmpeg_threads="4"
unified_template_name="shorts-mvp-project-heavy-fargate-production"

if [[ ! "$git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "EDITOR_RELEASE_GIT_SHA must be a lowercase 40-character commit SHA" >&2
  exit 2
fi
if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "EDITOR_RELEASE_IMAGE_DIGEST must be an immutable sha256 digest" >&2
  exit 2
fi
if [[ ! "$region" =~ ^[a-z0-9-]+$ ]]; then
  echo "AWS_REGION is invalid" >&2
  exit 2
fi
v4_capability_count=0
[[ -n "$render_spec_version" ]] && v4_capability_count=$((v4_capability_count + 1))
[[ -n "$caption_render_spec_version" ]] && v4_capability_count=$((v4_capability_count + 1))
[[ -n "$font_manifest_sha256" ]] && v4_capability_count=$((v4_capability_count + 1))
if [[ "$v4_capability_count" != "0" && "$v4_capability_count" != "3" ]]; then
  echo "v4 render, caption, and font capability environment must be complete" >&2
  exit 2
fi
if [[ "$v4_capability_count" == "3" && (
  "$render_spec_version" != "4"
  || "$caption_render_spec_version" != "4"
  || ! "$font_manifest_sha256" =~ ^[0-9a-f]{64}$
) ]]; then
  echo "v4 release requires exact 4/4 versions and lowercase raw font manifest sha256" >&2
  exit 2
fi
case "$release_kind" in
  production)
    definition_name="shorts-mvp-editor-release-${git_sha:0:12}-4vcpu"
    ;;
  isolated)
    definition_name="shorts-mvp-editor-test-release-${git_sha:0:12}-4vcpu"
    ;;
  unified-template-subtitles)
    definition_name="shorts-mvp-unified-template-subtitles-${git_sha:0:12}-4vcpu"
    unified_template_arn_pattern="^arn:aws:batch:${region}:[0-9]{12}:job-definition/${unified_template_name}:[1-9][0-9]*$"
    if [[ "$template_definition" != "$unified_template_name" \
      && ! "$template_definition" =~ $unified_template_arn_pattern ]]; then
      echo "unified template subtitles must clone the production project-heavy Job Definition name or exact ARN" >&2
      exit 2
    fi
    if [[ ! "$repository_uri" =~ ^[0-9]{12}\.dkr\.ecr\.${region}\.amazonaws\.com/[A-Za-z0-9._/-]+$ ]]; then
      echo "EDITOR_RELEASE_ECR_REPOSITORY_URI must be an exact private ECR repository URI" >&2
      exit 2
    fi
    ;;
  *)
    echo "release kind must be production, isolated, or unified-template-subtitles" >&2
    exit 2
    ;;
esac

validate_unified_contract() {
  local source_file="$1"
  local expected_name="$2"
  local expected_vcpus="$3"
  local expected_ffmpeg_threads="$4"
  local expected_image="${5:-}"
  if ! jq -e \
    --arg expectedName "$expected_name" \
    --arg expectedVcpus "$expected_vcpus" \
    --arg expectedFfmpegThreads "$expected_ffmpeg_threads" \
    --arg expectedImage "$expected_image" '
    def resources($type):
      [.containerProperties.resourceRequirements[]? | select(.type == $type)];
    def environment($name):
      [.containerProperties.environment[]? | select(.name == $name)];
    def secrets($name):
      [.containerProperties.secrets[]? | select(.name == $name)];
    .jobDefinitionName == $expectedName
    and .type == "container"
    and ((.platformCapabilities // []) | index("FARGATE") != null)
    and .retryStrategy.attempts == 1
    and .timeout.attemptDurationSeconds == 7200
    and .containerProperties.ephemeralStorage.sizeInGiB == 30
    and (resources("VCPU") | length) == 1
    and (resources("VCPU")[0].value == $expectedVcpus)
    and (resources("MEMORY") | length) == 1
    and (resources("MEMORY")[0].value == "16384")
    and (environment("TASK_VCPUS") | length) == 1
    and (environment("TASK_VCPUS")[0].value == $expectedVcpus)
    and (environment("FFMPEG_THREADS") | length) == 1
    and (environment("FFMPEG_THREADS")[0].value == $expectedFfmpegThreads)
    and (environment("PROJECT_RESOURCE_TIER") | length) == 1
    and (environment("PROJECT_RESOURCE_TIER")[0].value == "heavy")
    and (secrets("INGESTION_PROXY_ROUTES_JSON") | length) == 1
    and (($expectedImage | length) == 0 or .containerProperties.image == $expectedImage)
  ' "$source_file" >/dev/null; then
    echo "unified template subtitles Job Definition does not match the trusted project-heavy contract" >&2
    exit 2
  fi
}

validate_v4_environment() {
  local source_file="$1"
  if [[ "$v4_capability_count" == "0" ]]; then
    return
  fi
  if ! jq -e \
    --arg gitSha "$git_sha" \
    --arg renderSpecVersion "$render_spec_version" \
    --arg captionRenderSpecVersion "$caption_render_spec_version" \
    --arg fontManifestSha256 "$font_manifest_sha256" '
    def environment($name):
      [.containerProperties.environment[]? | select(.name == $name)];
    (environment("EDITOR_RELEASE_GIT_SHA") | length) == 1
    and environment("EDITOR_RELEASE_GIT_SHA")[0].value == $gitSha
    and (environment("EDITOR_RENDER_SPEC_VERSION") | length) == 1
    and environment("EDITOR_RENDER_SPEC_VERSION")[0].value == $renderSpecVersion
    and (environment("EDITOR_CAPTION_RENDER_SPEC_VERSION") | length) == 1
    and environment("EDITOR_CAPTION_RENDER_SPEC_VERSION")[0].value == $captionRenderSpecVersion
    and (environment("EDITOR_FONT_MANIFEST_SHA256") | length) == 1
    and environment("EDITOR_FONT_MANIFEST_SHA256")[0].value == $fontManifestSha256
  ' "$source_file" >/dev/null; then
    echo "editor release Job Definition does not contain the exact v4 capability environment" >&2
    exit 2
  fi
}

emit_definition_arn() {
  local definition_arn="$1"
  if [[ "$release_kind" == "unified-template-subtitles" ]]; then
    local candidate_arn_pattern="^arn:aws:batch:${region}:[0-9]{12}:job-definition/${definition_name}:[1-9][0-9]*$"
    if [[ ! "$definition_arn" =~ $candidate_arn_pattern ]]; then
      echo "unified template subtitles registration did not return the exact candidate ARN" >&2
      exit 2
    fi
  fi
  echo "job_definition_arn=$definition_arn"
  if [[ "$release_kind" == "unified-template-subtitles" ]]; then
    echo "unified_template_subtitles_job_definition_arn=$definition_arn"
  fi
}

task_dir="$(mktemp -d)"
trap 'rm -rf "$task_dir"' EXIT

existing_arn="$(
  aws batch describe-job-definitions \
    --region "$region" \
    --status ACTIVE \
    --job-definition-name "$definition_name" \
    --query "reverse(sort_by(jobDefinitions,&revision))[?containerProperties.image=='${repository_uri}@${image_digest}']|[0].jobDefinitionArn" \
    --output text
)"
if [[ -n "$existing_arn" && "$existing_arn" != "None" ]]; then
  if [[ "$release_kind" == "unified-template-subtitles" || "$v4_capability_count" == "3" ]]; then
    aws batch describe-job-definitions \
      --region "$region" \
      --status ACTIVE \
      --job-definitions "$existing_arn" \
      --query "jobDefinitions[0]" \
      --output json > "$task_dir/existing.json"
    if [[ "$release_kind" == "unified-template-subtitles" ]]; then
      validate_unified_contract \
        "$task_dir/existing.json" \
        "$definition_name" \
        "$candidate_vcpus" \
        "$candidate_ffmpeg_threads" \
        "${repository_uri}@${image_digest}"
    fi
    validate_v4_environment "$task_dir/existing.json"
  fi
  emit_definition_arn "$existing_arn"
  exit 0
fi

if [[ "$release_kind" == "unified-template-subtitles" ]]; then
  aws batch describe-job-definitions \
    --region "$region" \
    --status ACTIVE \
    --job-definitions "$template_definition" \
    --query "reverse(sort_by(jobDefinitions,&revision))[0]" \
    --output json > "$task_dir/template.json"
  validate_unified_contract \
    "$task_dir/template.json" \
    "$unified_template_name" \
    "8" \
    "2"
else
  aws batch describe-job-definitions \
    --region "$region" \
    --status ACTIVE \
    --job-definitions "$template_definition" \
    --query "jobDefinitions[0]" \
    --output json > "$task_dir/template.json"
fi

jq \
  --arg name "$definition_name" \
  --arg image "${repository_uri}@${image_digest}" \
  --arg digest "$image_digest" \
  --arg gitSha "$git_sha" \
  --arg candidateVcpus "$candidate_vcpus" \
  --arg candidateFfmpegThreads "$candidate_ffmpeg_threads" \
  --arg renderSpecVersion "$render_spec_version" \
  --arg captionRenderSpecVersion "$caption_render_spec_version" \
  --arg fontManifestSha256 "$font_manifest_sha256" \
  --arg releaseKind "$release_kind" \
  '{
    jobDefinitionName: $name,
    type,
    parameters,
    containerProperties,
    platformCapabilities,
    retryStrategy,
    timeout,
    propagateTags,
    tags
  }
  | .containerProperties.image=$image
  | .tags=(
      if $releaseKind == "unified-template-subtitles"
      then {}
      else (
        (.tags // {})
        | with_entries(select(.key | ascii_downcase | startswith("aws:") | not))
      )
      end
  )
  | .containerProperties.resourceRequirements=(
      (.containerProperties.resourceRequirements // [])
      | map(select(.type!="VCPU"))
      + [{type:"VCPU",value:$candidateVcpus}]
    )
  | .containerProperties.environment=(
      (.containerProperties.environment // [])
      | map(select(
          .name!="WORKER_IMAGE_TAG"
          and .name!="WORKER_IMAGE_DIGEST"
          and .name!="EDITOR_RELEASE_GIT_SHA"
          and .name!="TASK_VCPUS"
          and .name!="FFMPEG_THREADS"
          and .name!="EDITOR_RENDER_SPEC_VERSION"
          and .name!="EDITOR_CAPTION_RENDER_SPEC_VERSION"
          and .name!="EDITOR_FONT_MANIFEST_SHA256"
        ))
      + [
          {name:"WORKER_IMAGE_TAG",value:$digest},
          {name:"WORKER_IMAGE_DIGEST",value:$digest},
          {name:"TASK_VCPUS",value:$candidateVcpus},
          {name:"FFMPEG_THREADS",value:$candidateFfmpegThreads}
        ]
      + (if ($renderSpecVersion | length) > 0 then [
          {name:"EDITOR_RELEASE_GIT_SHA",value:$gitSha},
          {name:"EDITOR_RENDER_SPEC_VERSION",value:$renderSpecVersion},
          {name:"EDITOR_CAPTION_RENDER_SPEC_VERSION",value:$captionRenderSpecVersion},
          {name:"EDITOR_FONT_MANIFEST_SHA256",value:$fontManifestSha256}
        ] else [] end)
    )
  | with_entries(select(.value != null))' \
  "$task_dir/template.json" > "$task_dir/register.json"

if [[ "$release_kind" == "unified-template-subtitles" ]]; then
  validate_unified_contract \
    "$task_dir/register.json" \
    "$definition_name" \
    "$candidate_vcpus" \
    "$candidate_ffmpeg_threads" \
    "${repository_uri}@${image_digest}"
fi
validate_v4_environment "$task_dir/register.json"

registered_arn="$(
  aws batch register-job-definition \
    --region "$region" \
    --cli-input-json "file://$task_dir/register.json" \
    --query "jobDefinitionArn" \
    --output text
)"
if [[ "$release_kind" == "unified-template-subtitles" || "$v4_capability_count" == "3" ]]; then
  aws batch describe-job-definitions \
    --region "$region" \
    --status ACTIVE \
    --job-definitions "$registered_arn" \
    --query "jobDefinitions[0]" \
    --output json > "$task_dir/registered.json"
  if [[ "$release_kind" == "unified-template-subtitles" ]]; then
    validate_unified_contract \
      "$task_dir/registered.json" \
      "$definition_name" \
      "$candidate_vcpus" \
      "$candidate_ffmpeg_threads" \
      "${repository_uri}@${image_digest}"
  fi
  validate_v4_environment "$task_dir/registered.json"
fi
emit_definition_arn "$registered_arn"
