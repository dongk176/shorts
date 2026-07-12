#!/bin/bash
set -e

# WARP 설정이 Base64 환경 변수로 주입된 경우 파일로 생성
if [ -n "$WARP_CONF_B64" ]; then
  echo "$WARP_CONF_B64" | base64 -d > /app/worker/wireproxy.conf
fi

# wireproxy 설정 파일이 존재하면 백그라운드에서 실행
if [ -f "/app/worker/wireproxy.conf" ]; then
  echo "Starting wireproxy in background..."
  wireproxy -d -c /app/worker/wireproxy.conf &
  
  # wireproxy가 SOCKS5 포트(예: 1080)를 열 때까지 잠시 대기
  sleep 2
else
  echo "No wireproxy.conf found or WARP_CONF_B64 not set. WARP proxy will not be available."
fi

# 기존 CMD 실행
exec "$@"
