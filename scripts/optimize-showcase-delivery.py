#!/usr/bin/env python3
"""Create bounded, content-addressed web previews from approved local renders."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
source_dir = root / "web/public/showcase-examples/curated-pilot-v1"
output_dir = Path(sys.argv[1]).resolve()
output_dir.mkdir(parents=True, exist_ok=True)


def run(args):
    return subprocess.run(args, check=True, capture_output=True, timeout=180).stdout


def probe(path):
    return json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)]))


def optimize(source):
    key = source.stem
    horizontal = key.endswith("-source")
    width, height = (960, 540) if horizontal else (540, 960)
    video = output_dir / (key + ".mp4")
    run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(source),
         "-vf", f"scale={width}:{height},fps=24", "-c:v", "libx264", "-preset", "fast", "-crf", "25",
         "-maxrate", "900k", "-bufsize", "1800k", "-pix_fmt", "yuv420p", "-threads", "2",
         "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", "-y", str(video)])
    before, after = probe(source), probe(video)
    assert abs(float(before["format"]["duration"]) - float(after["format"]["duration"])) < 0.15, key
    assert any(s["codec_type"] == "audio" for s in after["streams"]), key
    stream = next(s for s in after["streams"] if s["codec_type"] == "video")
    assert (stream["width"], stream["height"]) == (width, height), key
    poster = output_dir / (key + ".webp")
    run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", str(source.with_suffix(".jpg")),
         "-vf", f"scale={width}:{height}", "-frames:v", "1", "-c:v", "libwebp", "-quality", "80", "-y", str(poster)])
    paths = {}
    for kind, file in [("video", video), ("poster", poster)]:
        digest = hashlib.sha256(file.read_bytes()).hexdigest()[:16]
        name = f"{key}-{digest}{file.suffix}"
        file.rename(output_dir / name)
        paths[kind] = f"easycut/showcase/v2/{name}"
    return key, paths, {"id": key, "before": source.stat().st_size, "after": int(after["format"]["size"]),
                        "duration": float(after["format"]["duration"]), "width": width, "height": height}


sources = sorted(source_dir.glob("*.mp4"))
assert len(sources) == 72
assets, metrics = {}, []
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    for key, paths, metric in pool.map(optimize, sources):
        assets[key] = paths
        metrics.append(metric)
        print(f"{len(assets)}/72 {key}: {metric['before']} -> {metric['after']}", flush=True)
manifest = {"origin": "https://d1mzwx29nljvyq.cloudfront.net", "assets": assets}
(root / "web/lib/showcase-delivery.json").write_text(json.dumps(manifest, indent=2) + "\n")
(output_dir / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
print(json.dumps({"before": sum(m["before"] for m in metrics), "after": sum(m["after"] for m in metrics)}))
