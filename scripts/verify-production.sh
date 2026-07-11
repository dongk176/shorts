#!/usr/bin/env bash
set -euo pipefail

URL="${1:?usage: verify-production.sh https://your-domain.example}"
cookie_file="$(mktemp)"
trap 'rm -f "$cookie_file"' EXIT
curl --fail --silent --show-error --location "$URL" >/dev/null
curl --fail --silent --show-error --location "$URL/api/mvp/state" \
  --cookie-jar "$cookie_file" >/dev/null
echo "Production page와 MVP state API smoke test 완료"
