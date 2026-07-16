from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from shorts_worker.config import Settings
from shorts_worker.renderer import VideoRenderer, video_layout
from shorts_worker.schemas import HighlightClip, TemplateId, VideoAspectRatio

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
@pytest.mark.parametrize(
    ("video_aspect_ratio", "expected_clean_size"),
    [
        (VideoAspectRatio.LANDSCAPE, (1080, 608)),
        (VideoAspectRatio.LANDSCAPE_FIVE_FOUR, (1080, 864)),
        (VideoAspectRatio.SQUARE, (1080, 1080)),
        (VideoAspectRatio.PORTRAIT, (1080, 1350)),
        (VideoAspectRatio.FULL_VERTICAL, (1080, 1920)),
    ],
)
def test_synthetic_video_renders_as_browser_playable_vertical_mp4(
    tmp_path: Path,
    video_aspect_ratio: VideoAspectRatio,
    expected_clean_size: tuple[int, int],
) -> None:
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

    settings = Settings(temp_dir=tmp_path / "temp", ffmpeg_timeout_seconds=120)
    output = tmp_path / "storage" / "fixture.mp4"
    renderer = VideoRenderer(settings)
    clean = tmp_path / "clean.mp4"
    channel_thumbnail = tmp_path / "channel-thumbnail.png"
    Image.new("RGB", (128, 128), "#2166d1").save(channel_thumbnail)
    clip = HighlightClip(
        start_seconds=0.25,
        end_seconds=2.25,
        hook_title="한글 제목 렌더링 확인",
    )
    renderer.extract_clean_clip(
        source_path=source,
        output_path=clean,
        clip=clip,
        work_dir=tmp_path / "work",
        video_aspect_ratio=video_aspect_ratio,
    )
    renderer.render_clean_clip(
        clean_path=clean,
        output_path=output,
        title=clip.hook_title,
        channel_name="테스트 채널",
        template_id=TemplateId.DARK_RED,
        transcript=[],
        subtitles_enabled=False,
        work_dir=tmp_path / "work",
        prefix="fixture",
        channel_thumbnail_path=channel_thumbnail,
        video_aspect_ratio=video_aspect_ratio,
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
    clean_probe = json.loads(
        _run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(clean)]).stdout
    )
    clean_video = next(
        stream for stream in clean_probe["streams"] if stream["codec_type"] == "video"
    )
    assert (clean_video["width"], clean_video["height"]) == expected_clean_size


def test_video_layout_centers_non_full_ratios_and_reserves_safe_overlays() -> None:
    assert video_layout(VideoAspectRatio.LANDSCAPE).video_y == 656
    assert video_layout(VideoAspectRatio.LANDSCAPE_FIVE_FOUR).video_y == 528
    assert video_layout(VideoAspectRatio.SQUARE).video_y == 420
    assert video_layout(VideoAspectRatio.PORTRAIT).video_y == 285
    full = video_layout(VideoAspectRatio.FULL_VERTICAL)
    assert full.video_y == 0
    assert full.overlay_mode is True
    assert full.top_y == 96
    assert full.bottom_y == 1620
