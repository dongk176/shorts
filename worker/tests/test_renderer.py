from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from shorts_worker.config import Settings
from shorts_worker.renderer import VideoRenderer, continuous_comment_windows, video_layout
from shorts_worker.schemas import (
    CommentOverlay,
    CustomTemplateConfig,
    HighlightClip,
    TemplateId,
    VideoAspectRatio,
    default_comment_overlays,
)

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
    comment_template = video_aspect_ratio is VideoAspectRatio.FULL_VERTICAL
    comments = (
        [CommentOverlay.model_validate(comment) for comment in default_comment_overlays(2.0)]
        if comment_template
        else []
    )
    if comment_template:
        assert len(comments) == 5
        assert all(
            comments[index].start_seconds >= comments[index - 1].end_seconds
            for index in range(1, len(comments))
        )
    renderer.render_clean_clip(
        clean_path=clean,
        output_path=output,
        title=clip.hook_title,
        channel_name="테스트 채널",
        template_id=TemplateId.COMMENT_CAPTURE if comment_template else TemplateId.DARK_RED,
        transcript=[],
        subtitles_enabled=False,
        work_dir=tmp_path / "work",
        prefix="fixture",
        channel_thumbnail_path=channel_thumbnail,
        video_aspect_ratio=video_aspect_ratio,
        comment_overlays=comments,
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


def test_comment_windows_cover_entire_clip_even_when_saved_ranges_have_gaps() -> None:
    comments = [
        CommentOverlay.model_validate(
            {
                "id": f"comment-{index}",
                "startSeconds": start,
                "endSeconds": end,
                "text": f"댓글 {index}",
                "initial": "댓",
                "avatarColor": "#2674C8",
                "nickname": f"테스트{index}",
                "likeCount": 1312,
                "ageLabel": "1개월 전",
            }
        )
        for index, (start, end) in enumerate(((1.2, 2.0), (4.8, 5.4), (8.0, 9.0)), start=1)
    ]

    windows = continuous_comment_windows(comments, 12.0)

    assert [(start, end) for _, start, end in windows] == [(0.0, 4.8), (4.8, 8.0), (8.0, 12.0)]


def test_custom_template_config_rejects_video_outside_canvas() -> None:
    with pytest.raises(ValueError):
        CustomTemplateConfig.model_validate(
            {
                "schemaVersion": 1,
                "background": {"kind": "color", "color": "#111111"},
                "video": {
                    "aspectRatio": "16:9",
                    "x": 500,
                    "y": 0,
                    "width": 1080,
                    "height": 608,
                    "fit": "cover",
                },
                "title": {
                    "visible": True,
                    "x": 540,
                    "y": 200,
                    "maxWidth": 900,
                    "fontSize": 72,
                    "primaryColor": "#FFFFFF",
                    "accentColor": "#FF4D4F",
                    "backgroundColor": None,
                },
                "subtitle": {
                    "visible": True,
                    "x": 540,
                    "y": 1400,
                    "maxWidth": 900,
                    "fontSize": 48,
                    "color": "#FFFFFF",
                    "backgroundColor": "#000000",
                },
                "channel": {
                    "visible": True,
                    "x": 540,
                    "y": 1650,
                    "maxWidth": 800,
                    "fontSize": 42,
                    "color": "#FFFFFF",
                    "backgroundColor": None,
                },
            }
        )


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_custom_color_template_renders_to_vertical_mp4(tmp_path: Path) -> None:
    clean = tmp_path / "clean.mp4"
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
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(clean),
        ]
    )
    config = CustomTemplateConfig.model_validate(
        {
            "schemaVersion": 1,
            "background": {"kind": "color", "color": "#111111"},
            "video": {
                "aspectRatio": "16:9",
                "x": 140,
                "y": 600,
                "width": 800,
                "height": 450,
                "fit": "cover",
            },
            "title": {
                "visible": True,
                "x": 540,
                "y": 260,
                "maxWidth": 900,
                "fontSize": 72,
                "primaryColor": "#FFFFFF",
                "accentColor": "#FF4D4F",
                "backgroundColor": None,
            },
            "subtitle": {
                "visible": True,
                "x": 540,
                "y": 1400,
                "maxWidth": 900,
                "fontSize": 48,
                "color": "#FFFFFF",
                "backgroundColor": "#000000",
            },
            "channel": {
                "visible": True,
                "x": 540,
                "y": 1700,
                "maxWidth": 800,
                "fontSize": 42,
                "color": "#FFFFFF",
                "backgroundColor": None,
            },
        }
    )
    output = tmp_path / "custom.mp4"

    VideoRenderer(
        Settings(temp_dir=tmp_path / "temp", ffmpeg_timeout_seconds=120)
    ).render_clean_clip(
        clean_path=clean,
        output_path=output,
        title="개인 템플릿\n렌더링 확인",
        channel_name="테스트 채널",
        template_id=TemplateId.DARK_MINIMAL,
        transcript=[],
        subtitles_enabled=False,
        work_dir=tmp_path / "work",
        prefix="custom",
        custom_template_config=config,
    )

    probe = json.loads(
        _run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(output)]).stdout
    )
    video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    assert output.stat().st_size > 10_000


def test_bundled_custom_backgrounds_are_full_vertical_rgb_images() -> None:
    directory = Path(__file__).parents[1] / "shorts_worker" / "assets" / "template_backgrounds"
    assets = sorted(directory.glob("*.png"))
    assert len(assets) == 8
    for asset in assets:
        with Image.open(asset) as image:
            assert image.size == (1080, 1920)
            assert image.mode == "RGB"
