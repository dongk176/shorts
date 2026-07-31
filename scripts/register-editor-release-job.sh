#!/usr/bin/env bash
set -euo pipefail

release_kind="${1:?usage: register-editor-release-job.sh production|isolated}"
template_definition="${2:?template job definition is required}"
repository_uri="${EDITOR_RELEASE_ECR_REPOSITORY_URI:?EDITOR_RELEASE_ECR_REPOSITORY_URI is required}"
git_sha="${EDITOR_RELEASE_GIT_SHA:?EDITOR_RELEASE_GIT_SHA is required}"
image_digest="${EDITOR_RELEASE_IMAGE_DIGEST:?EDITOR_RELEASE_IMAGE_DIGEST is required}"
region="${AWS_REGION:-ap-northeast-2}"

if [[ ! "$git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "EDITOR_RELEASE_GIT_SHA must be a lowercase 40-character commit SHA" >&2
  exit 2
fi
if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "EDITOR_RELEASE_IMAGE_DIGEST must be an immutable sha256 digest" >&2
  exit 2
fi
case "$release_kind" in
  production)
    definition_name="shorts-mvp-editor-release-${git_sha:0:12}"
    ;;
  isolated)
    definition_name="shorts-mvp-editor-test-release-${git_sha:0:12}"
    ;;
  *)
    echo "release kind must be production or isolated" >&2
    exit 2
    ;;
esac

existing_arn="$(
  aws batch describe-job-definitions \
    --region "$region" \
    --status ACTIVE \
    --job-definition-name "$definition_name" \
    --query "reverse(sort_by(jobDefinitions,&revision))[?containerProperties.image=='${repository_uri}@${image_digest}']|[0].jobDefinitionArn" \
    --output text
)"
if [[ -n "$existing_arn" && "$existing_arn" != "None" ]]; then
  echo "job_definition_arn=$existing_arn"
  exit 0
fi

task_dir="$(mktemp -d)"
trap 'rm -rf "$task_dir"' EXIT
aws batch describe-job-definitions \
  --region "$region" \
  --status ACTIVE \
  --job-definitions "$template_definition" \
  --query "jobDefinitions[0]" \
  --output json > "$task_dir/template.json"

jq \
  --arg name "$definition_name" \
  --arg image "${repository_uri}@${image_digest}" \
  --arg digest "$image_digest" \
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
  | .containerProperties.environment=(
      (.containerProperties.environment // [])
      | map(select(.name!="WORKER_IMAGE_TAG" and .name!="WORKER_IMAGE_DIGEST"))
      + [
          {name:"WORKER_IMAGE_TAG",value:$digest},
          {name:"WORKER_IMAGE_DIGEST",value:$digest}
        ]
    )
  | with_entries(select(.value != null))' \
  "$task_dir/template.json" > "$task_dir/register.json"

registered_arn="$(
  aws batch register-job-definition \
    --region "$region" \
    --cli-input-json "file://$task_dir/register.json" \
    --query "jobDefinitionArn" \
    --output text
)"
echo "job_definition_arn=$registered_arn"
