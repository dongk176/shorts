#!/usr/bin/env bash
set -euo pipefail

URL="${1:?usage: verify-production.sh https://your-domain.example}"
cookie_file="$(mktemp)"
trap 'rm -f "$cookie_file"' EXIT
for path in \
  / \
  /guidebook \
  /pricing \
  /templates \
  /purchase-terms \
  /refund \
  /admin/easycutcutcutcutcutcut; do
  curl --fail --silent --show-error --location "${URL}${path}" >/dev/null
done
curl --fail --silent --show-error --location "$URL/api/mvp/state" \
  --cookie-jar "$cookie_file" >/dev/null
echo "Production 핵심 페이지, 템플릿, 관리자 진입 경로와 MVP state API smoke test 완료"
