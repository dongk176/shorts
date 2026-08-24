#!/usr/bin/env bash
set -euo pipefail

URL="${1:?usage: verify-production.sh https://your-domain.example}"
cookie_file="$(mktemp)"
trap 'rm -f "$cookie_file"' EXIT
for path in / /guidebook /pricing /purchase-terms /refund; do
  curl --fail --silent --show-error --location "${URL}${path}" >/dev/null
done
curl --fail --silent --show-error --location "$URL/api/mvp/state" \
  --cookie-jar "$cookie_file" >/dev/null
echo "Production 핵심 공개 페이지와 MVP state API smoke test 완료"
