#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/load-env.sh
load_env_file .env.local
SECRET_ARN="$(bash scripts/stack-outputs.sh RuntimeSecretArn Foundation)"
export SECRET_ARN
node scripts/sync-runtime-secret.mjs
