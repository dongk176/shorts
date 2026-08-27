#!/usr/bin/env bash
set -euo pipefail

unified_definition_arn="${1:?unified template subtitles Job Definition ARN is required}"
source_range_definition_arn="${2:?source-range Job Definition ARN is required}"
repository_uri="${UNIFIED_SOURCE_RANGE_ECR_REPOSITORY_URI:?UNIFIED_SOURCE_RANGE_ECR_REPOSITORY_URI is required}"
git_sha="${UNIFIED_SOURCE_RANGE_GIT_SHA:?UNIFIED_SOURCE_RANGE_GIT_SHA is required}"
image_digest="${UNIFIED_SOURCE_RANGE_IMAGE_DIGEST:?UNIFIED_SOURCE_RANGE_IMAGE_DIGEST is required}"
region="${AWS_REGION:-ap-northeast-2}"
definition_name="shorts-mvp-unified-source-range-${git_sha:0:12}-8vcpu"

if [[ ! "$git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "UNIFIED_SOURCE_RANGE_GIT_SHA must be a lowercase 40-character commit SHA" >&2
  exit 2
fi
if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "UNIFIED_SOURCE_RANGE_IMAGE_DIGEST must be an immutable sha256 digest" >&2
  exit 2
fi
if [[ ! "$region" =~ ^[a-z0-9-]+$ ]]; then
  echo "AWS_REGION is invalid" >&2
  exit 2
fi
definition_pattern="^arn:aws:batch:${region}:[0-9]{12}:job-definition/[A-Za-z0-9_-]+:[1-9][0-9]*$"
if [[ ! "$unified_definition_arn" =~ $definition_pattern \
  || ! "$source_range_definition_arn" =~ $definition_pattern ]]; then
  echo "both templates must be exact revision-pinned Job Definition ARNs" >&2
  exit 2
fi
if [[ "$unified_definition_arn" == "$source_range_definition_arn" ]]; then
  echo "unified and source-range templates must be separate definitions" >&2
  exit 2
fi
if [[ ! "$repository_uri" =~ ^[0-9]{12}\.dkr\.ecr\.${region}\.amazonaws\.com/[A-Za-z0-9._/-]+$ ]]; then
  echo "UNIFIED_SOURCE_RANGE_ECR_REPOSITORY_URI must be an exact private ECR repository URI" >&2
  exit 2
fi

validate_unified_template() {
  jq -e --arg image "${repository_uri}@${image_digest}" '
    def resource($type): [.containerProperties.resourceRequirements[]? | select(.type == $type)];
    def secret($name): [.containerProperties.secrets[]? | select(.name == $name)];
    .status == "ACTIVE"
    and .type == "container"
    and ((.platformCapabilities // []) | index("FARGATE") != null)
    and .containerProperties.image == $image
    and .retryStrategy.attempts == 1
    and .timeout.attemptDurationSeconds == 7200
    and .containerProperties.ephemeralStorage.sizeInGiB == 30
    and resource("VCPU")[0].value == "4"
    and resource("MEMORY")[0].value == "16384"
    and (secret("INGESTION_PROXY_ROUTES_JSON") | length) == 1
    and (secret("ELEVENLABS_API_KEY") | length) == 1
  ' "$1" >/dev/null || {
    echo "unified template does not match the trusted subtitle worker contract" >&2
    exit 2
  }
}

validate_source_range_template() {
  jq -e '
    def resource($type): [.containerProperties.resourceRequirements[]? | select(.type == $type)];
    def environment($name): [.containerProperties.environment[]? | select(.name == $name)];
    .status == "ACTIVE"
    and .type == "container"
    and ((.platformCapabilities // []) | index("FARGATE") != null)
    and .retryStrategy.attempts == 1
    and .timeout.attemptDurationSeconds == 18000
    and .containerProperties.ephemeralStorage.sizeInGiB == 80
    and resource("VCPU")[0].value == "8"
    and resource("MEMORY")[0].value == "16384"
    and environment("MAX_VIDEO_DURATION_SECONDS")[0].value == "14400"
    and environment("DOWNLOAD_TIMEOUT_SECONDS")[0].value == "14400"
    and environment("PROJECT_RESOURCE_TIER")[0].value == "source_range"
    and environment("TASK_VCPUS")[0].value == "8"
    and environment("FFMPEG_THREADS")[0].value == "2"
  ' "$1" >/dev/null || {
    echo "source-range template does not match the trusted 4-hour resource contract" >&2
    exit 2
  }
}

validate_candidate() {
  local source_file="$1"
  jq -e \
    --arg name "$definition_name" \
    --arg image "${repository_uri}@${image_digest}" \
    --arg gitSha "$git_sha" \
    --arg digest "$image_digest" '
    def resource($type): [.containerProperties.resourceRequirements[]? | select(.type == $type)];
    def environment($name): [.containerProperties.environment[]? | select(.name == $name)];
    def secret($name): [.containerProperties.secrets[]? | select(.name == $name)];
    .jobDefinitionName == $name
    and .type == "container"
    and ((.platformCapabilities // []) | index("FARGATE") != null)
    and .containerProperties.image == $image
    and .retryStrategy.attempts == 1
    and .timeout.attemptDurationSeconds == 18000
    and .containerProperties.ephemeralStorage.sizeInGiB == 80
    and resource("VCPU")[0].value == "8"
    and resource("MEMORY")[0].value == "16384"
    and environment("MAX_VIDEO_DURATION_SECONDS")[0].value == "14400"
    and environment("DOWNLOAD_TIMEOUT_SECONDS")[0].value == "14400"
    and environment("PROJECT_RESOURCE_TIER")[0].value == "source_range"
    and environment("TASK_VCPUS")[0].value == "8"
    and environment("FFMPEG_THREADS")[0].value == "2"
    and environment("WORKER_IMAGE_DIGEST")[0].value == $digest
    and environment("EDITOR_RELEASE_GIT_SHA")[0].value == $gitSha
    and (secret("INGESTION_PROXY_ROUTES_JSON") | length) == 1
    and (secret("ELEVENLABS_API_KEY") | length) == 1
  ' "$source_file" >/dev/null || {
    echo "registered candidate does not match the combined trusted contract" >&2
    exit 2
  }
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
  aws batch describe-job-definitions \
    --region "$region" --status ACTIVE --job-definitions "$existing_arn" \
    --query "jobDefinitions[0]" --output json > "$task_dir/existing.json"
  validate_candidate "$task_dir/existing.json"
  echo "job_definition_arn=$existing_arn"
  echo "batch_target_release_id=unified-source-range-${git_sha:0:12}-r1"
  exit 0
fi

aws batch describe-job-definitions \
  --region "$region" --status ACTIVE --job-definitions "$unified_definition_arn" \
  --query "jobDefinitions[0]" --output json > "$task_dir/unified.json"
aws batch describe-job-definitions \
  --region "$region" --status ACTIVE --job-definitions "$source_range_definition_arn" \
  --query "jobDefinitions[0]" --output json > "$task_dir/source-range.json"
validate_unified_template "$task_dir/unified.json"
validate_source_range_template "$task_dir/source-range.json"

jq -s \
  --arg name "$definition_name" \
  --arg gitSha "$git_sha" \
  --arg digest "$image_digest" '
  .[0] as $unified | .[1] as $range
  | ($unified | {
      jobDefinitionName: $name,
      type,
      parameters,
      containerProperties,
      platformCapabilities,
      retryStrategy,
      timeout: $range.timeout,
      propagateTags,
      tags
    })
  | .containerProperties.ephemeralStorage=$range.containerProperties.ephemeralStorage
  | .containerProperties.resourceRequirements=$range.containerProperties.resourceRequirements
  | .containerProperties.environment=(
      (.containerProperties.environment // [])
      | map(. as $entry | select([
          "MAX_VIDEO_DURATION_SECONDS",
          "DOWNLOAD_TIMEOUT_SECONDS",
          "PROJECT_RESOURCE_TIER",
          "TASK_VCPUS",
          "FFMPEG_THREADS",
          "WORKER_IMAGE_TAG",
          "WORKER_IMAGE_DIGEST",
          "EDITOR_RELEASE_GIT_SHA"
        ] | index($entry.name) | not))
      + [
          $range.containerProperties.environment[]
          | select(.name == "MAX_VIDEO_DURATION_SECONDS"
            or .name == "DOWNLOAD_TIMEOUT_SECONDS"
            or .name == "PROJECT_RESOURCE_TIER"
            or .name == "TASK_VCPUS"
            or .name == "FFMPEG_THREADS")
        ]
      + [
          {name:"WORKER_IMAGE_TAG",value:$digest},
          {name:"WORKER_IMAGE_DIGEST",value:$digest},
          {name:"EDITOR_RELEASE_GIT_SHA",value:$gitSha}
        ]
    )
  | .tags=((.tags // {})
      | with_entries(select(.key | ascii_downcase | startswith("aws:") | not)))
  | with_entries(select(.value != null))
  ' "$task_dir/unified.json" "$task_dir/source-range.json" > "$task_dir/register.json"
validate_candidate "$task_dir/register.json"

registered_arn="$(
  aws batch register-job-definition \
    --region "$region" \
    --cli-input-json "file://$task_dir/register.json" \
    --query "jobDefinitionArn" \
    --output text
)"
aws batch describe-job-definitions \
  --region "$region" --status ACTIVE --job-definitions "$registered_arn" \
  --query "jobDefinitions[0]" --output json > "$task_dir/registered.json"
validate_candidate "$task_dir/registered.json"
echo "job_definition_arn=$registered_arn"
echo "batch_target_release_id=unified-source-range-${git_sha:0:12}-r1"
