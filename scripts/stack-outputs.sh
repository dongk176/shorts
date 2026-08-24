#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-2}"
ENVIRONMENT="${DEPLOY_ENV:-production}"
OUTPUT_KEY="${1:?output key is required}"
STACK_KIND="${2:-Compute}"
if [[ "$STACK_KIND" == "EditorTest" ]]; then
  STACK_NAME="ShortsMvpEditorTest"
else
  STACK_NAME="ShortsMvp${STACK_KIND}-${ENVIRONMENT}"
fi
aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='${OUTPUT_KEY}'].OutputValue | [0]" \
  --output text
