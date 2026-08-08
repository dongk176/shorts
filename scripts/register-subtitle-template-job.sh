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
  --arg releaseSha "$release_sha" \
  '{
    jobDefinitionName: $name,
    type: .jobDefinitions[0].type,
    parameters: .jobDefinitions[0].parameters,
    containerProperties: (.jobDefinitions[0].containerProperties | .image = $image),
    nodeProperties: .jobDefinitions[0].nodeProperties,
    retryStrategy: .jobDefinitions[0].retryStrategy,
    propagateTags: .jobDefinitions[0].propagateTags,
    timeout: .jobDefinitions[0].timeout,
    platformCapabilities: .jobDefinitions[0].platformCapabilities,
    eksProperties: .jobDefinitions[0].eksProperties,
    ecsProperties: .jobDefinitions[0].ecsProperties,
    tags: ((.jobDefinitions[0].tags // {}) + {
      Purpose: "subtitle-templates-admin-canary",
      ReleaseSha: $releaseSha
    })
  } | with_entries(select(.value != null))' \
  "$work_dir/template.json" > "$work_dir/register.json"

aws batch register-job-definition \
  --region "$aws_region" \
  --cli-input-json "file://$work_dir/register.json" \
  --query jobDefinitionArn \
  --output text
