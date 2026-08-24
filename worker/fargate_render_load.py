from __future__ import annotations

import json
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

from shorts_worker.config import Settings
from shorts_worker.renderer import VideoRenderer
from shorts_worker.schemas import (
    CommentOverlay,
    TemplateId,
    VideoAspectRatio,
    fallback_comment_overlays,
)
from shorts_worker.worker_pipeline import _container_memory_peak_bytes


def _run(args: list[str], *, timeout: int = 900) -> None:
    subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
        shell=False,
    )


def run_load_test(work_root: Path) -> dict[str, int]:
    work_root.mkdir(parents=True, exist_ok=True)
    clean = work_root / "clean.mp4"
    _run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=12",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "60", "-c:v", "libx264", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(clean),
    ])
    channel_thumbnail = work_root / "channel-thumbnail.png"
    Image.new("RGB", (128, 128), "#2166d1").save(channel_thumbnail)
    comments = [
        CommentOverlay.model_validate(item)
        for item in fallback_comment_overlays(60, count=15, clip_index=1)
    ]
    if len(comments) != 15:
        raise AssertionError("comment load fixture must contain 15 comments")
    settings = Settings(
        temp_dir=work_root / "temp",
        ffmpeg_timeout_seconds=900,
        ffmpeg_threads=2,
        clean_clip_preset="superfast",
        clean_clip_crf=20,
    )

    def render(index: int) -> Path:
        output = work_root / f"output-{index}.mp4"
        VideoRenderer(settings).render_clean_clip(
            clean_path=clean,
            output_path=output,
            title=f"Fargate 동시 렌더 부하 테스트 {index}",
            channel_name="테스트 채널",
            template_id=TemplateId.COMMENT_CAPTURE,
            transcript=[],
            subtitles_enabled=False,
            work_dir=work_root / f"work-{index}",
            prefix=f"load-{index}",
            channel_thumbnail_path=channel_thumbnail,
            video_aspect_ratio=VideoAspectRatio.FULL_VERTICAL,
            comment_overlays=comments,
        )
        return output

    with ThreadPoolExecutor(max_workers=2) as executor:
        outputs = list(executor.map(render, (1, 2)))
    if not all(output.stat().st_size > 100_000 for output in outputs):
        raise AssertionError("one or more load-test outputs are incomplete")
    peak_memory_bytes = _container_memory_peak_bytes()
    if peak_memory_bytes >= 27 * 1024**3:
        raise AssertionError(f"peak memory exceeded 27 GiB: {peak_memory_bytes}")
    return {
        "peakMemoryBytes": peak_memory_bytes,
        "output1Bytes": outputs[0].stat().st_size,
        "output2Bytes": outputs[1].stat().st_size,
    }


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="fargate-render-load-") as temp_dir:
        print(json.dumps(run_load_test(Path(temp_dir)), separators=(",", ":")))
