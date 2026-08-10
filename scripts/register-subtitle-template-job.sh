#!/usr/bin/env bash
set -euo pipefail

template_definition_arn="${1:?existing ElevenLabs Job Definition ARN is required}"
image_digest="${2:?immutable subtitle worker image digest is required}"
release_sha="${3:?subtitle release Git SHA is required}"
batch_submitter_function="${4:?production Batch Submitter Lambda name is required}"
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
if [[ ! "$batch_submitter_function" =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then
  echo "Batch Submitter Lambda name is invalid" >&2
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
    tags: (((.jobDefinitions[0].tags // {})
      | with_entries(select((.key | ascii_downcase | startswith("aws:")) | not))) + {
      Purpose: "subtitle-templates-admin-canary",
      ReleaseSha: $releaseSha
    })
  } | with_entries(select(.value != null))' \
  "$work_dir/template.json" > "$work_dir/register.json"

candidate_arn="$(aws batch register-job-definition \
  --region "$aws_region" \
  --cli-input-json "file://$work_dir/register.json" \
  --query jobDefinitionArn \
  --output text)"

if [[ ! "$candidate_arn" =~ ^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/[^:]+:[1-9][0-9]*$ ]]; then
  echo "registered subtitle Job Definition ARN is invalid" >&2
  exit 2
fi

registered_image="$(aws batch describe-job-definitions \
  --region "$aws_region" \
  --job-definitions "$candidate_arn" \
  --status ACTIVE \
  --query 'jobDefinitions[0].containerProperties.image' \
  --output text)"
if [[ "$registered_image" != "${repository_uri}@${image_digest}" ]]; then
  echo "registered subtitle Job Definition image verification failed" >&2
  exit 2
fi

# The Batch Submitter intentionally rejects stored project targets that are not
# pinned in its environment. Activate the new immutable target here, before the
# ARN is printed for a web environment, so registration and trust cannot drift.
aws lambda get-function-configuration \
  --region "$aws_region" \
  --function-name "$batch_submitter_function" \
  --query '{revisionId:RevisionId,variables:Environment.Variables}' \
  --output json > "$work_dir/lambda-current.json"

revision_id="$(jq -r '.revisionId // empty' "$work_dir/lambda-current.json")"
subtitle_queue_arn="$(
  jq -r '.variables.SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN // empty' \
    "$work_dir/lambda-current.json"
)"
if [[ ! "$revision_id" =~ ^[A-Za-z0-9+/=_-]+$ ]]; then
  echo "Batch Submitter Lambda revision id is invalid" >&2
  exit 2
fi
if [[ ! "$subtitle_queue_arn" =~ ^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-queue/[A-Za-z0-9_-]+$ ]]; then
  echo "Batch Submitter subtitle queue ARN is invalid" >&2
  exit 2
fi

jq \
  --arg arn "$candidate_arn" \
  '.variables.SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN = $arn
    | {Variables: .variables}' \
  "$work_dir/lambda-current.json" > "$work_dir/lambda-updated.json"

aws lambda update-function-configuration \
  --region "$aws_region" \
  --function-name "$batch_submitter_function" \
  --revision-id "$revision_id" \
  --environment "file://$work_dir/lambda-updated.json" \
  --query FunctionName \
  --output text > /dev/null
aws lambda wait function-updated-v2 \
  --region "$aws_region" \
  --function-name "$batch_submitter_function"

trusted_candidate_arn="$(aws lambda get-function-configuration \
  --region "$aws_region" \
  --function-name "$batch_submitter_function" \
  --query 'Environment.Variables.SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN' \
  --output text)"
if [[ "$trusted_candidate_arn" != "$candidate_arn" ]]; then
  echo "Batch Submitter subtitle target verification failed" >&2
  exit 2
fi

printf '%s\n' "$candidate_arn"
