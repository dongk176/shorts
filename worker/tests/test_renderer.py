from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from shorts_worker.config import Settings
from shorts_worker.renderer import (
    COMMENT_CAPTURE_SQUARE_CHANNEL_CENTER_Y,
    PRESET_SQUARE_CHANNEL_CENTER_Y,
    VideoRenderer,
    create_comment_timeline_manifest,
    custom_video_geometry_filters,
    lifted_comment_landscape_layout,
    saved_comment_windows,
    video_layout,
)
from shorts_worker.schemas import (
    CommentOverlay,
    CustomTemplateConfig,
    HighlightClip,
    TemplateId,
    TemplateTitleLayer,
    VideoAspectRatio,
    default_comment_overlays,
)
from shorts_worker.worker_pipeline import edit_timeline_clip

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
    comment_template = video_aspect_ratio in {
        VideoAspectRatio.LANDSCAPE,
        VideoAspectRatio.LANDSCAPE_FIVE_FOUR,
        VideoAspectRatio.SQUARE,
    }
    comments = (
        [CommentOverlay.model_validate(comment) for comment in default_comment_overlays(2.0)]
        if comment_template
        else []
    )
    if comment_template:
        assert len(comments) == 5
        assert all(10 <= comment.like_count <= 8_000 for comment in comments)
        assert all(
            comments[index].start_seconds >= comments[index - 1].end_seconds
            for index in range(1, len(comments))
        )
    render_metrics: dict[str, object] = {}
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
        comment_channel_fixed=comment_template,
        fixed_preset_channel=True,
        metrics_callback=render_metrics.update,
    )
    if comment_template:
        assert render_metrics["commentInputCount"] == 1
        assert render_metrics["commentCount"] == len(comments)
        assert float(render_metrics["ffmpegSeconds"]) > 0

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


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_edit_timeline_capture_keeps_exact_handles_media_shape_and_audio(
    tmp_path: Path,
) -> None:
    source = tmp_path / "long-source.mp4"
    _run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=navy:size=160x90:rate=2",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000",
        "-t", "65", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(source),
    ])
    selected = HighlightClip(
        start_seconds=31,
        end_seconds=32,
        hook_title="가운데 1초",
    )
    timeline = edit_timeline_clip(selected, 65)
    assert timeline.start_seconds == 1
    assert timeline.end_seconds == 62

    renderer = VideoRenderer(Settings(
        temp_dir=tmp_path / "temp",
        ffmpeg_timeout_seconds=120,
        clean_clip_preset="ultrafast",
        clean_clip_crf=30,
    ))
    clean = renderer.extract_clean_clip(
        source_path=source,
        output_path=tmp_path / "clean.mp4",
        clip=selected,
        work_dir=tmp_path / "clean-work",
        video_aspect_ratio=VideoAspectRatio.SQUARE,
    )
    padded = renderer.extract_clean_clip(
        source_path=source,
        output_path=tmp_path / "timeline.mp4",
        clip=timeline,
        work_dir=tmp_path / "timeline-work",
        video_aspect_ratio=VideoAspectRatio.SQUARE,
    )

    probes = []
    for path in (clean, padded):
        result = _run([
            "ffprobe", "-v", "error", "-show_streams", "-show_format",
            "-of", "json", str(path),
        ])
        probes.append(json.loads(result.stdout))
    for info in probes:
        video = next(stream for stream in info["streams"] if stream["codec_type"] == "video")
        audio = next(stream for stream in info["streams"] if stream["codec_type"] == "audio")
        assert (video["width"], video["height"]) == (1080, 1080)
        assert video["avg_frame_rate"] == "2/1"
        assert audio["codec_name"] == "aac"
    assert float(probes[0]["format"]["duration"]) == pytest.approx(1, abs=0.4)
    assert float(probes[1]["format"]["duration"]) == pytest.approx(61, abs=0.4)


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


def test_versioned_comment_landscape_layout_moves_the_whole_stack_up() -> None:
    centered = video_layout(VideoAspectRatio.LANDSCAPE)
    lifted = lifted_comment_landscape_layout()

    assert lifted.video_y == centered.video_y - 160
    assert lifted.top_height == centered.top_height - 160
    assert lifted.bottom_y == centered.bottom_y - 160
    assert lifted.bottom_height == centered.bottom_height + 160
    assert lifted.subtitle_margin_v == centered.subtitle_margin_v + 160


def test_preset_channel_positions_use_the_square_layout_reference() -> None:
    square = video_layout(VideoAspectRatio.SQUARE)

    assert PRESET_SQUARE_CHANNEL_CENTER_Y == square.bottom_y + 80
    assert COMMENT_CAPTURE_SQUARE_CHANNEL_CENTER_Y == square.bottom_y + 340


def test_comment_windows_preserve_editor_created_gaps() -> None:
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

    windows = saved_comment_windows(comments, 12.0)

    assert [(start, end) for _, start, end in windows] == [
        (1.2, 2.0),
        (4.8, 5.4),
        (8.0, 9.0),
    ]


def test_comment_timeline_normalizes_rgba_frames_and_uses_safe_relative_paths(
    tmp_path: Path,
) -> None:
    panels = []
    for index, size in enumerate(((320, 90), (280, 140), (300, 110))):
        panel = tmp_path / f"panel-{index}.png"
        Image.new("RGBA", size, (20 * index, 40, 180, 255)).save(panel)
        panels.append(panel)
    comments = [
        CommentOverlay.model_validate({
            "id": f"comment-{index}",
            "startSeconds": start,
            "endSeconds": end,
            "text": f"댓글 {index}",
            "initial": "댓",
            "avatarColor": "#2674C8",
            "nickname": "테스트",
            "likeCount": 10,
            "ageLabel": "방금 전",
        })
        for index, (start, end) in enumerate(((0, 1.25), (1.25, 3.0), (3.0, 5.0)))
    ]
    windows = list(zip(comments, (0.0, 1.25, 3.0), (1.25, 3.0, 5.0), strict=True))

    manifest, height = create_comment_timeline_manifest(
        panels,
        windows,
        duration=5.0,
        directory=tmp_path / "timeline",
        prefix="safe",
    )

    assert height == 140
    normalized = sorted((tmp_path / "timeline").glob("safe_comment_frame_*.png"))
    assert len(normalized) == 3
    assert all(Image.open(frame).size == (320, 140) for frame in normalized)
    lines = manifest.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "ffconcat version 1.0"
    assert [line for line in lines if line.startswith("duration ")] == [
        "duration 1.250000",
        "duration 1.750000",
        "duration 2.000000",
    ]
    file_lines = [line for line in lines if line.startswith("file ")]
    assert len(file_lines) == 4
    assert all("/" not in line and "\\" not in line for line in file_lines)
    assert file_lines[-1] == file_lines[-2]


def test_comment_timeline_inserts_transparent_frames_for_saved_gaps(
    tmp_path: Path,
) -> None:
    panels = []
    for index in range(2):
        panel = tmp_path / f"panel-gap-{index}.png"
        Image.new("RGBA", (320, 90), (20 * index, 40, 180, 255)).save(panel)
        panels.append(panel)
    comments = [
        CommentOverlay.model_validate({
            "id": f"comment-gap-{index}",
            "startSeconds": start,
            "endSeconds": end,
            "text": f"댓글 {index}",
            "initial": "댓",
            "avatarColor": "#2674C8",
            "nickname": "테스트",
            "likeCount": 10,
            "ageLabel": "방금 전",
        })
        for index, (start, end) in enumerate(((1.0, 2.0), (3.5, 4.0)))
    ]
    windows = saved_comment_windows(comments, 5.0)

    manifest, _ = create_comment_timeline_manifest(
        panels,
        windows,
        duration=5.0,
        directory=tmp_path / "timeline-gap",
        prefix="gapped",
    )

    gap_frame = tmp_path / "timeline-gap" / "gapped_comment_gap.png"
    assert gap_frame.exists()
    with Image.open(gap_frame) as image:
        assert image.getbbox() is None
    lines = manifest.read_text(encoding="utf-8").splitlines()
    assert [line for line in lines if line.startswith("duration ")] == [
        "duration 1.000000",
        "duration 1.000000",
        "duration 1.500000",
        "duration 0.500000",
        "duration 1.000000",
    ]
    assert [line for line in lines if line == "file gapped_comment_gap.png"] == [
        "file gapped_comment_gap.png",
        "file gapped_comment_gap.png",
        "file gapped_comment_gap.png",
        "file gapped_comment_gap.png",
    ]


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


def test_custom_video_geometry_uses_saved_pixels_without_rounding() -> None:
    config = CustomTemplateConfig.model_validate(
        {
            "schemaVersion": 3,
            "background": {"kind": "color", "color": "#111111"},
            "video": {
                "aspectRatio": "16:9",
                "x": 137,
                "y": 601,
                "width": 800,
                "height": 450,
                "fit": "cover",
            },
            "title": {
                "visible": False,
                "x": 540,
                "y": 260,
                "maxWidth": 900,
                "fontSize": 72,
                "primaryColor": "#FFFFFF",
                "accentColor": "#FF4D4F",
                "primaryBackgroundColor": None,
                "accentBackgroundColor": None,
            },
            "subtitle": {
                "visible": False,
                "x": 540,
                "y": 1400,
                "maxWidth": 900,
                "fontSize": 48,
                "color": "#FFFFFF",
                "backgroundColor": "#000000",
            },
            "channel": {
                "visible": False,
                "x": 540,
                "y": 1700,
                "maxWidth": 800,
                "fontSize": 42,
                "color": "#FFFFFF",
                "backgroundColor": None,
            },
        }
    )

    scale, overlay = custom_video_geometry_filters(config.video, fps=29.97)

    assert "scale=800:450" in scale
    assert "crop=800:450" in scale
    assert overlay == "[base][custom_video]overlay=x=137:y=601:shortest=1[with_video]"


def test_custom_title_layer_upgrades_a_legacy_shared_background() -> None:
    title = TemplateTitleLayer.model_validate(
        {
            "visible": True,
            "x": 540,
            "y": 260,
            "maxWidth": 900,
            "fontSize": 72,
            "primaryColor": "#FFFFFF",
            "accentColor": "#FF4D4F",
            "backgroundColor": "#E32626",
        }
    )

    assert title.primary_background_color == "#E32626"
    assert title.accent_background_color == "#E32626"


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
            "color=c=red:size=640x360:rate=12",
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
            "schemaVersion": 3,
            "background": {"kind": "color", "color": "#16A34A"},
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
                "primaryBackgroundColor": "#16A34A",
                "accentBackgroundColor": "#2563EB",
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
                "visible": False,
                "x": 540,
                "y": 1700,
                "maxWidth": 800,
                "fontSize": 42,
                "color": "#FFFFFF",
                "backgroundColor": None,
            },
            "comment": {
                "visible": True,
                "theme": "light",
                "size": "small",
                "y": 1050,
                "dockedToVideo": True,
            },
        }
    )
    output = tmp_path / "custom.mp4"
    render_metrics: dict[str, object] = {}

    VideoRenderer(
        Settings(temp_dir=tmp_path / "temp", ffmpeg_timeout_seconds=120)
    ).render_clean_clip(
        clean_path=clean,
        output_path=output,
        title="개인 템플릿\n렌더링 확인",
        channel_name="테스트 채널",
        template_id=TemplateId.COMMENT_CAPTURE,
        transcript=[],
        subtitles_enabled=False,
        work_dir=tmp_path / "work",
        prefix="custom",
        comment_overlays=[
            CommentOverlay(
                id="render-comment",
                startSeconds=0,
                endSeconds=1,
                text="렌더링 댓글 레이아웃 확인",
                initial="확",
                avatarColor="#D84572",
                nickname="렌더확인24",
                likeCount=121,
                ageLabel="2시간 전",
            )
        ],
        custom_template_config=config,
        metrics_callback=render_metrics.update,
    )
    assert render_metrics["commentInputCount"] == 1

    probe = json.loads(
        _run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(output)]).stdout
    )
    video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    assert output.stat().st_size > 10_000

    rendered_frame = tmp_path / "custom-frame.png"
    _run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            "0.2",
            "-i",
            str(output),
            "-frames:v",
            "1",
            str(rendered_frame),
        ]
    )
    with Image.open(rendered_frame).convert("RGB") as image:

        def is_video(pixel: tuple[int, int, int]) -> bool:
            return pixel[0] > pixel[1] * 1.5 and pixel[0] > pixel[2] * 1.5

        assert not is_video(image.getpixel((139, 800)))
        assert is_video(image.getpixel((140, 800)))
        assert is_video(image.getpixel((939, 800)))
        assert not is_video(image.getpixel((940, 800)))
        assert not is_video(image.getpixel((540, 599)))
        assert is_video(image.getpixel((540, 600)))
        assert is_video(image.getpixel((540, 1049)))
        assert not is_video(image.getpixel((540, 1050)))
        assert all(channel >= 245 for channel in image.getpixel((10, 1060)))


def test_bundled_custom_backgrounds_are_full_vertical_rgb_images() -> None:
    directory = Path(__file__).parents[1] / "shorts_worker" / "assets" / "template_backgrounds"
    assets = sorted(directory.glob("*.png"))
    assert len(assets) == 8
    for asset in assets:
        with Image.open(asset) as image:
            assert image.size == (1080, 1920)
            assert image.mode == "RGB"
