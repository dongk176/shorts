#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo 'Usage: scripts/probe-youtube-download-local.sh "https://www.youtube.com/watch?v=VIDEO_ID"' >&2
  exit 2
fi

image_name="${SHORTS_WORKER_IMAGE:-shorts-worker:local}"
youtube_url="$1"

docker build --tag "$image_name" worker

docker run --rm "$image_name" \
  python -c \
  'import json, sys, tempfile; from dataclasses import asdict; from pathlib import Path; from shorts_worker.ingestion import YtDlpIngestionProvider; root=tempfile.TemporaryDirectory(); bundle=YtDlpIngestionProvider(timeout_seconds=900).download_bundle(sys.argv[1], Path(root.name)); print(json.dumps({"metadata": asdict(bundle.metadata), "video_bytes": bundle.video_path.stat().st_size, "subtitle": bundle.subtitle_path.name if bundle.subtitle_path else None}, ensure_ascii=False, indent=2)); root.cleanup()' \
  "$youtube_url"
