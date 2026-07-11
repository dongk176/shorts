#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-2}"
ENVIRONMENT="${DEPLOY_ENV:-production}"
OUTPUT_KEY="${1:?output key is required}"
STACK_KIND="${2:-Compute}"
aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "ShortsMvp${STACK_KIND}-${ENVIRONMENT}" \
  --query "Stacks[0].Outputs[?OutputKey=='${OUTPUT_KEY}'].OutputValue | [0]" \
  --output text
