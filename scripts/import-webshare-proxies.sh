#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 || $# -gt 2 || ! -f "$1" || ( $# -eq 2 && "$2" != "--dry-run" ) ]]; then
  echo "사용법: $0 /path/to/webshare-proxies.txt [--dry-run]" >&2
  exit 2
fi

SECRET_ARN="$(bash scripts/stack-outputs.sh RuntimeSecretArn Foundation)"
export SECRET_ARN
node scripts/import-webshare-proxies.mjs "$@"
