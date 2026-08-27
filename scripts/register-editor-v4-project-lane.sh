#!/usr/bin/env bash
set -euo pipefail

lane="${1:?usage: register-editor-v4-project-lane.sh <lane> <exact-template-arn>}"
template_definition="${2:?exact current template Job Definition ARN is required}"
repository_uri="${EDITOR_RELEASE_ECR_REPOSITORY_URI:?EDITOR_RELEASE_ECR_REPOSITORY_URI is required}"
git_sha="${EDITOR_RELEASE_GIT_SHA:?EDITOR_RELEASE_GIT_SHA is required}"
image_digest="${EDITOR_RELEASE_IMAGE_DIGEST:?EDITOR_RELEASE_IMAGE_DIGEST is required}"
render_spec_version="${EDITOR_RELEASE_RENDER_SPEC_VERSION:?EDITOR_RELEASE_RENDER_SPEC_VERSION is required}"
caption_render_spec_version="${EDITOR_RELEASE_CAPTION_RENDER_SPEC_VERSION:?EDITOR_RELEASE_CAPTION_RENDER_SPEC_VERSION is required}"
font_manifest_sha256="${EDITOR_RELEASE_FONT_MANIFEST_SHA256:?EDITOR_RELEASE_FONT_MANIFEST_SHA256 is required}"
region="${AWS_REGION:-ap-northeast-2}"

case "$lane" in
  legacy_project|source_range|elevenlabs_transcription|subtitle_templates|unified_template_subtitles) ;;
  *)
    echo "lane must be one of the five production project target lanes" >&2
    exit 2
    ;;
esac
if [[ ! "$git_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "EDITOR_RELEASE_GIT_SHA must be a lowercase 40-character commit SHA" >&2
  exit 2
fi
if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "EDITOR_RELEASE_IMAGE_DIGEST must be an immutable sha256 digest" >&2
  exit 2
fi
if [[ "$render_spec_version" != "4" || "$caption_render_spec_version" != "4" ]]; then
  echo "project lane registration requires the exact 4/4 render capability" >&2
  exit 2
fi
if [[ ! "$font_manifest_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "EDITOR_RELEASE_FONT_MANIFEST_SHA256 must be lowercase raw 64-hex" >&2
  exit 2
fi
if [[ ! "$region" =~ ^[a-z0-9-]+$ ]]; then
  echo "AWS_REGION is invalid" >&2
  exit 2
fi
if [[ ! "$template_definition" =~ ^arn:aws:batch:${region}:[0-9]{12}:job-definition/[A-Za-z0-9_-]+:[1-9][0-9]*$ ]]; then
  echo "template must be an exact revision-pinned Job Definition ARN in AWS_REGION" >&2
  exit 2
fi
if [[ ! "$repository_uri" =~ ^[0-9]{12}\.dkr\.ecr\.${region}\.amazonaws\.com/[A-Za-z0-9._/-]+$ ]]; then
  echo "EDITOR_RELEASE_ECR_REPOSITORY_URI must be an exact private ECR repository URI" >&2
  exit 2
fi

lane_slug="${lane//_/-}"
definition_name="shorts-mvp-editor-v4-${lane_slug}-${git_sha:0:12}"
release_id="${lane_slug}-${git_sha:0:12}-v4"
task_dir="$(mktemp -d)"
trap 'rm -rf "$task_dir"' EXIT

aws batch describe-job-definitions \
  --region "$region" \
  --status ACTIVE \
  --job-definitions "$template_definition" \
  --query "jobDefinitions[0]" \
  --output json > "$task_dir/template.json"

if ! jq -e --arg arn "$template_definition" '
  .status == "ACTIVE"
  and .jobDefinitionArn == $arn
  and .type == "container"
  and (.containerProperties.image | type == "string")
  and ((.platformCapabilities // []) | index("FARGATE") != null)
' "$task_dir/template.json" >/dev/null; then
  echo "current lane template is not an exact active Fargate container definition" >&2
  exit 2
fi

jq \
  --arg name "$definition_name" \
  --arg gitSha "$git_sha" \
  --arg image "${repository_uri}@${image_digest}" \
  --arg digest "$image_digest" \
  --arg renderSpecVersion "$render_spec_version" \
  --arg captionRenderSpecVersion "$caption_render_spec_version" \
  --arg fontManifestSha256 "$font_manifest_sha256" '
  {
    jobDefinitionName:$name,
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
      (.tags // {})
      | with_entries(select(
          (.key | ascii_downcase) as $key
          | ($key | startswith("aws:") | not)
          and $key != "releasesha"
          and $key != "workerimagedigest"
          and $key != "renderspecversion"
          and $key != "captionrenderspecversion"
          and $key != "fontmanifestsha256"
        ))
      + {
          ReleaseSha:$gitSha,
          WorkerImageDigest:$digest,
          RenderSpecVersion:$renderSpecVersion,
          CaptionRenderSpecVersion:$captionRenderSpecVersion,
          FontManifestSha256:$fontManifestSha256
        }
    )
  | .containerProperties.environment=(
      (.containerProperties.environment // [])
      | map(select(
          .name!="WORKER_IMAGE_TAG"
          and .name!="WORKER_IMAGE_DIGEST"
          and .name!="EDITOR_RELEASE_GIT_SHA"
          and .name!="EDITOR_RENDER_SPEC_VERSION"
          and .name!="EDITOR_CAPTION_RENDER_SPEC_VERSION"
          and .name!="EDITOR_FONT_MANIFEST_SHA256"
        ))
      + [
          {name:"WORKER_IMAGE_TAG",value:$digest},
          {name:"WORKER_IMAGE_DIGEST",value:$digest},
          {name:"EDITOR_RELEASE_GIT_SHA",value:$gitSha},
          {name:"EDITOR_RENDER_SPEC_VERSION",value:$renderSpecVersion},
          {name:"EDITOR_CAPTION_RENDER_SPEC_VERSION",value:$captionRenderSpecVersion},
          {name:"EDITOR_FONT_MANIFEST_SHA256",value:$fontManifestSha256}
        ]
    )
  | with_entries(select(.value != null))
' "$task_dir/template.json" > "$task_dir/register.json"

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
    --region "$region" \
    --status ACTIVE \
    --job-definitions "$existing_arn" \
    --query "jobDefinitions[0]" \
    --output json > "$task_dir/existing.json"
  jq '{jobDefinitionName,type,parameters,containerProperties,platformCapabilities,retryStrategy,timeout,propagateTags,tags}' \
    "$task_dir/existing.json" > "$task_dir/existing-contract.json"
  if ! diff -u \
    <(jq -S . "$task_dir/register.json") \
    <(jq -S . "$task_dir/existing-contract.json") >/dev/null; then
    echo "existing v4 lane definition differs from the immutable clone contract" >&2
    exit 2
  fi
  registered_arn="$existing_arn"
else
  registered_arn="$(
    aws batch register-job-definition \
      --region "$region" \
      --cli-input-json "file://$task_dir/register.json" \
      --query "jobDefinitionArn" \
      --output text
  )"
fi

candidate_pattern="^arn:aws:batch:${region}:[0-9]{12}:job-definition/${definition_name}:[1-9][0-9]*$"
if [[ ! "$registered_arn" =~ $candidate_pattern ]]; then
  echo "v4 lane registration did not return the exact candidate ARN" >&2
  exit 2
fi

output_name="${lane^^}_JOB_DEFINITION_ARN"
echo "job_definition_arn=$registered_arn"
echo "${output_name,,}=$registered_arn"
echo "batch_target_release_id=$release_id"
