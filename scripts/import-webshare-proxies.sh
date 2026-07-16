#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "사용법: $0 /path/to/webshare-proxies.txt" >&2
  exit 2
fi

SECRET_ARN="$(bash scripts/stack-outputs.sh RuntimeSecretArn Foundation)"
export SECRET_ARN
node scripts/import-webshare-proxies.mjs "$1"
