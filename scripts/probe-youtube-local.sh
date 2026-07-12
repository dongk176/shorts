#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo 'Usage: scripts/probe-youtube-local.sh "https://www.youtube.com/watch?v=VIDEO_ID"' >&2
  exit 2
fi

image_name="${SHORTS_WORKER_IMAGE:-shorts-worker:local}"
youtube_url="$1"

docker build --tag "$image_name" worker

docker run --rm "$image_name" \
  python -c \
  'import json, sys; from dataclasses import asdict; from shorts_worker.ingestion import YtDlpIngestionProvider; print(json.dumps(asdict(YtDlpIngestionProvider(timeout_seconds=120).analyze_url(sys.argv[1])), ensure_ascii=False, indent=2))' \
  "$youtube_url"
