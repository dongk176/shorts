#!/bin/bash
set -euo pipefail

WARP_CONFIG_PATH="/app/worker/wireproxy.conf"
WARP_PROXY_URL=""
WARP_PROXY_ROUTES_JSON=""
declare -a wireproxy_pids=()

if [ "${INGESTION_EGRESS_MODE:-auto}" = "webshare_isp" ]; then
  echo "Dedicated ISP proxy pool mode is enabled; WARP tunnels are disabled."
  exec "$@"
fi

cleanup_wireproxies() {
  local pid
  for pid in "${wireproxy_pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${wireproxy_pids[@]:-}"; do
    wait "$pid" 2>/dev/null || true
  done
}

fail_warp_startup() {
  echo "$1" >&2
  cleanup_wireproxies
  exit 2
}

ensure_wireproxy_runtime() {
  # wireproxy v1.0.8 requires /dev/log to exist when installing its Landlock rules.
  # Fargate containers do not provide a syslog socket, and wireproxy does not use it
  # for this foreground process, so a private placeholder is sufficient.
  if [ ! -e /dev/log ]; then
    touch /dev/log
    chmod 600 /dev/log
  fi
}

STARTED_PROXY_URL=""
start_wireproxy() {
  local route_id="$1"
  local config_b64="$2"
  local port="$3"
  local config_path="$4"
  local wireproxy_pid

  umask 077
  if ! printf '%s' "$config_b64" | base64 -d > "$config_path"; then
    fail_warp_startup "WARP configuration for ${route_id} could not be decoded."
  fi

  if grep -qi '^\[Socks5\][[:space:]]*$' "$config_path"; then
    if ! grep -Eq "^[[:space:]]*BindAddress[[:space:]]*=[[:space:]]*127\\.0\\.0\\.1:${port}[[:space:]]*$" "$config_path"; then
      fail_warp_startup "WARP configuration for ${route_id} must bind SOCKS5 to its assigned local port."
    fi
  else
    printf '\n[Socks5]\nBindAddress = 127.0.0.1:%s\n' "$port" >> "$config_path"
  fi

  echo "Starting wireproxy route ${route_id}..."
  wireproxy -c "$config_path" &
  wireproxy_pid=$!
  wireproxy_pids+=("$wireproxy_pid")

  for _ in $(seq 1 40); do
    if ! kill -0 "$wireproxy_pid" 2>/dev/null; then
      wait "$wireproxy_pid" || true
      fail_warp_startup "wireproxy route ${route_id} exited before opening its SOCKS5 port."
    fi
    if (echo > "/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1; then
      STARTED_PROXY_URL="socks5://127.0.0.1:${port}"
      echo "wireproxy route ${route_id} is ready."
      return
    fi
    sleep 0.25
  done

  fail_warp_startup "wireproxy route ${route_id} did not open its SOCKS5 port in time."
}

ensure_wireproxy_runtime

multi_route_count=0
route_entries=""
for suffix in A B C D; do
  config_variable="WARP_CONF_${suffix}_B64"
  config_value="${!config_variable:-}"
  if [ -z "$config_value" ]; then
    continue
  fi

  if [ -n "${WARP_CONF_B64:-}" ]; then
    fail_warp_startup "Legacy WARP_CONF_B64 cannot be combined with WARP_CONF_A_B64 through WARP_CONF_D_B64."
  fi

  case "$suffix" in
    A) port=1081 ;;
    B) port=1082 ;;
    C) port=1083 ;;
    D) port=1084 ;;
  esac
  route_id="warp-${suffix,,}"
  config_path="/app/worker/wireproxy-${route_id}.conf"
  start_wireproxy "$route_id" "$config_value" "$port" "$config_path"

  if [ -n "$route_entries" ]; then
    route_entries+=","
  fi
  route_entries+="{\"id\":\"${route_id}\",\"proxy_url\":\"${STARTED_PROXY_URL}\"}"
  multi_route_count=$((multi_route_count + 1))
done

if [ "$multi_route_count" -gt 0 ]; then
  WARP_PROXY_ROUTES_JSON="[${route_entries}]"
  export WARP_PROXY_ROUTES_JSON
  unset WARP_PROXY_URL
  echo "${multi_route_count} preconfigured WARP routes are ready."
elif [ -n "${WARP_CONF_B64:-}" ]; then
  start_wireproxy "warp" "$WARP_CONF_B64" 1080 "$WARP_CONFIG_PATH"
  WARP_PROXY_URL="$STARTED_PROXY_URL"
  export WARP_PROXY_URL
else
  echo "No WARP configuration is set. Direct YouTube access will be used."
fi

exec "$@"
