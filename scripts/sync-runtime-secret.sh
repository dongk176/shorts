#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f .env.local ]]; then
  set -a
  source .env.local
  set +a
fi
SECRET_ARN="$(bash scripts/stack-outputs.sh RuntimeSecretArn Foundation)"
export SECRET_ARN
node scripts/sync-runtime-secret.mjs
