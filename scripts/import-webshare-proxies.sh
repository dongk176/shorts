#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 || $# -gt 2 || ! -f "$1" || ( $# -eq 2 && "$2" != "--dry-run" ) ]]; then
  echo "사용법: $0 /path/to/webshare-proxies.txt [--dry-run]" >&2
  exit 2
fi

: "${SECRET_ARN:?실제 운영 Job Definition이 참조하는 SECRET_ARN을 명시해야 합니다.}"
: "${JOB_DEFINITION_ARNS:?검증할 운영 Job Definition ARN을 쉼표로 구분해 명시해야 합니다.}"
node scripts/import-webshare-proxies.mjs "$@"
