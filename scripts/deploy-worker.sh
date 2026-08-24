#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh workflow run deploy-worker.yml --repo dongk176/shorts
  echo "GitHub Actions worker build를 시작했습니다."
else
  echo "GitHub 저장소 Actions 변수 AWS_WORKER_BUILD_ROLE_ARN, AWS_ECR_REPOSITORY_URI를 설정한 뒤 'Build and publish worker' workflow를 실행하세요." >&2
  exit 2
fi
