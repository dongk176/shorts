#!/bin/bash
set -euo pipefail

WARP_CONFIG_PATH="/app/worker/wireproxy.conf"
WARP_PROXY_URL=""

if [ -n "${WARP_CONF_B64:-}" ]; then
  umask 077
  if ! printf '%s' "$WARP_CONF_B64" | base64 -d > "$WARP_CONFIG_PATH"; then
    echo "WARP configuration could not be decoded." >&2
    exit 2
  fi

  # wireproxy v1.0.8 requires /dev/log to exist when installing its Landlock rules.
  # Fargate containers do not provide a syslog socket, and wireproxy does not use it
  # for this foreground process, so a private placeholder is sufficient.
  if [ ! -e /dev/log ]; then
    touch /dev/log
    chmod 600 /dev/log
  fi

  echo "Starting wireproxy..."
  wireproxy -c "$WARP_CONFIG_PATH" &
  wireproxy_pid=$!

  for _ in $(seq 1 40); do
    if ! kill -0 "$wireproxy_pid" 2>/dev/null; then
      wait "$wireproxy_pid" || true
      echo "wireproxy exited before opening the SOCKS5 port." >&2
      exit 2
    fi
    if (echo > /dev/tcp/127.0.0.1/1080) >/dev/null 2>&1; then
      WARP_PROXY_URL="socks5://127.0.0.1:1080"
      export WARP_PROXY_URL
      echo "wireproxy is ready."
      break
    fi
    sleep 0.25
  done

  if [ -z "$WARP_PROXY_URL" ]; then
    kill "$wireproxy_pid" 2>/dev/null || true
    wait "$wireproxy_pid" 2>/dev/null || true
    echo "wireproxy did not open the SOCKS5 port in time." >&2
    exit 2
  fi
else
  echo "WARP_CONF_B64 is not set. Direct YouTube access will be used."
fi

exec "$@"
