from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.config import Settings
from app.renderer import VideoRenderer
from app.schemas import HighlightClip, TemplateId

pytestmark = pytest.mark.render


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
        shell=False,
    )


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_synthetic_video_renders_as_browser_playable_vertical_mp4(tmp_path: Path) -> None:
    source = tmp_path / "source.mp4"
    _run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=12",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "2.5",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(source),
        ]
    )

    settings = Settings(
        storage_dir=tmp_path / "storage",
        database_path=tmp_path / "storage" / "jobs.sqlite3",
        temp_dir=tmp_path / "temp",
        ffmpeg_timeout_seconds=120,
    )
    output = tmp_path / "storage" / "fixture.mp4"
    renderer = VideoRenderer(settings)
    renderer.render(
        source_path=source,
        output_path=output,
        clip=HighlightClip(
            start_seconds=0.25,
            end_seconds=2.25,
            hook_title="한글 제목 렌더링 확인",
        ),
        clip_index=1,
        channel_name="테스트 채널",
        template_id=TemplateId.DARK_RED,
        transcript=[],
        work_dir=tmp_path / "work",
    )

    probe = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(output),
        ]
    )
    info = json.loads(probe.stdout)
    video = next(stream for stream in info["streams"] if stream["codec_type"] == "video")
    audio = next(stream for stream in info["streams"] if stream["codec_type"] == "audio")
    assert (video["width"], video["height"]) == (1080, 1920)
    assert video["codec_name"] == "h264"
    assert audio["codec_name"] == "aac"
    assert float(info["format"]["duration"]) == pytest.approx(2.0, abs=0.35)
    assert output.stat().st_size > 10_000

