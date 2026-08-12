#!/usr/bin/env bash
set -euo pipefail

template_definition_arn="${1:?existing ElevenLabs Job Definition ARN is required}"
image_digest="${2:?immutable subtitle worker image digest is required}"
release_sha="${3:?subtitle release Git SHA is required}"
aws_region="${AWS_REGION:-ap-northeast-2}"

if [[ ! "$template_definition_arn" =~ ^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/[^:]+:[1-9][0-9]*$ ]]; then
  echo "existing Job Definition ARN is invalid" >&2
  exit 2
fi
if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "worker image must be pinned by sha256 digest" >&2
  exit 2
fi
if [[ ! "$release_sha" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "release SHA is invalid" >&2
  exit 2
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

aws batch describe-job-definitions \
  --region "$aws_region" \
  --job-definitions "$template_definition_arn" \
  --status ACTIVE \
  --output json > "$work_dir/template.json"

if ! jq -e '
  def resources($type):
    [.jobDefinitions[0].containerProperties.resourceRequirements[]?
      | select(.type == $type)];
  def environment($name):
    [.jobDefinitions[0].containerProperties.environment[]?
      | select(.name == $name)];
  (.jobDefinitions | length) == 1
  and (resources("VCPU") | length) == 1
  and (resources("VCPU")[0].value == "8")
  and (resources("MEMORY") | length) == 1
  and (resources("MEMORY")[0].value == "16384")
  and (environment("TASK_VCPUS") | length) == 1
  and (environment("TASK_VCPUS")[0].value == "8")
  and (environment("FFMPEG_THREADS") | length) == 1
  and (environment("FFMPEG_THREADS")[0].value == "2")
  and (environment("WORKER_IMAGE_TAG") | length) == 1
  and (environment("WORKER_IMAGE_DIGEST") | length) == 1
' "$work_dir/template.json" > /dev/null; then
  echo "template Job Definition does not match the trusted 8-vCPU subtitle contract" >&2
  exit 2
fi

template_image="$(jq -r '.jobDefinitions[0].containerProperties.image' "$work_dir/template.json")"
if [[ ! "$template_image" =~ ^[^@]+@sha256:[0-9a-f]{64}$ ]]; then
  echo "template Job Definition image is not pinned by digest" >&2
  exit 2
fi
repository_reference="${template_image%@*}"
repository_prefix="${repository_reference%/*}"
repository_name="${repository_reference##*/}"
repository_name="${repository_name%%:*}"
if [[ "$repository_prefix" == "$repository_reference" || -z "$repository_name" ]]; then
  echo "template Job Definition repository URI is invalid" >&2
  exit 2
fi
repository_uri="${repository_prefix}/${repository_name}"

candidate_name="shorts-mvp-subtitle-templates-${release_sha:0:12}-production"
jq \
  --arg name "$candidate_name" \
  --arg image "${repository_uri}@${image_digest}" \
  --arg imageDigest "$image_digest" \
  --arg releaseSha "$release_sha" \
  '{
    jobDefinitionName: $name,
    type: .jobDefinitions[0].type,
    parameters: .jobDefinitions[0].parameters,
    containerProperties: (
      .jobDefinitions[0].containerProperties
      | .image = $image
      | .environment = (
          (
            .environment
            | map(select(
                .name != "GEMINI_TEXT_MODEL"
                and .name != "GEMINI_COMMENT_MODEL"
              ))
            | map(
              if .name == "WORKER_IMAGE_TAG"
                or .name == "WORKER_IMAGE_DIGEST"
              then .value = $imageDigest
              else .
              end
            )
          ) + [
            {name: "GEMINI_TEXT_MODEL", value: "gemini-3.5-flash-lite"},
            {name: "GEMINI_COMMENT_MODEL", value: "gemini-2.5-flash-lite"}
          ]
        )
    ),
    nodeProperties: .jobDefinitions[0].nodeProperties,
    retryStrategy: .jobDefinitions[0].retryStrategy,
    propagateTags: .jobDefinitions[0].propagateTags,
    timeout: .jobDefinitions[0].timeout,
    platformCapabilities: .jobDefinitions[0].platformCapabilities,
    eksProperties: .jobDefinitions[0].eksProperties,
    ecsProperties: .jobDefinitions[0].ecsProperties,
    tags: (((.jobDefinitions[0].tags // {})
      | with_entries(select((.key | ascii_downcase | startswith("aws:")) | not))) + {
      Purpose: "subtitle-templates-admin-canary",
      ReleaseSha: $releaseSha
    })
  } | with_entries(select(.value != null))' \
  "$work_dir/template.json" > "$work_dir/register.json"

candidate_arn="$(
  aws batch register-job-definition \
    --region "$aws_region" \
    --cli-input-json "file://$work_dir/register.json" \
    --query jobDefinitionArn \
    --output text
)"
if [[ ! "$candidate_arn" =~ ^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/[^:]+:[1-9][0-9]*$ ]]; then
  echo "registered subtitle Job Definition ARN is invalid" >&2
  exit 2
fi

aws batch describe-job-definitions \
  --region "$aws_region" \
  --job-definitions "$candidate_arn" \
  --status ACTIVE \
  --output json > "$work_dir/registered.json"

if ! jq -e \
  --arg image "${repository_uri}@${image_digest}" \
  --arg imageDigest "$image_digest" '
  def resources($type):
    [.jobDefinitions[0].containerProperties.resourceRequirements[]?
      | select(.type == $type)];
  def environment($name):
    [.jobDefinitions[0].containerProperties.environment[]?
      | select(.name == $name)];
  (.jobDefinitions | length) == 1
  and (.jobDefinitions[0].status == "ACTIVE")
  and (.jobDefinitions[0].containerProperties.image == $image)
  and (resources("VCPU") | length) == 1
  and (resources("VCPU")[0].value == "8")
  and (resources("MEMORY") | length) == 1
  and (resources("MEMORY")[0].value == "16384")
  and (environment("TASK_VCPUS") | length) == 1
  and (environment("TASK_VCPUS")[0].value == "8")
  and (environment("FFMPEG_THREADS") | length) == 1
  and (environment("FFMPEG_THREADS")[0].value == "2")
  and (environment("WORKER_IMAGE_TAG") | length) == 1
  and (environment("WORKER_IMAGE_TAG")[0].value == $imageDigest)
  and (environment("WORKER_IMAGE_DIGEST") | length) == 1
  and (environment("WORKER_IMAGE_DIGEST")[0].value == $imageDigest)
  and (environment("GEMINI_TEXT_MODEL") | length) == 1
  and (environment("GEMINI_TEXT_MODEL")[0].value == "gemini-3.5-flash-lite")
  and (environment("GEMINI_COMMENT_MODEL") | length) == 1
  and (environment("GEMINI_COMMENT_MODEL")[0].value == "gemini-2.5-flash-lite")
' "$work_dir/registered.json" > /dev/null; then
  echo "registered subtitle Job Definition identity verification failed" >&2
  exit 2
fi

printf '%s\n' "$candidate_arn"
