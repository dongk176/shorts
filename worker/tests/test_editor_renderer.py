from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from shorts_worker.config import Settings
from shorts_worker.editor_renderer import (
    EditorDocumentRenderer,
    create_editor_text_layer,
    editor_video_frame,
    retime_editor_subtitles,
    verify_editor_fonts,
)
from shorts_worker.schemas import EditorDocument, EditorTextOverlay

pytestmark = pytest.mark.render

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "test-fixtures"
    / "editor-document-v2.json"
)


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
        shell=False,
    )


def _document() -> EditorDocument:
    return EditorDocument.model_validate_json(FIXTURE.read_text())


def test_editor_video_frame_matches_browser_geometry_and_allows_crop() -> None:
    document = _document()
    document.overlays.scales["video"] = 1.2
    document.overlays.offsets["video"] = document.overlays.offsets["video"].model_copy(
        update={"x": 30, "y": -20}
    )

    frame = editor_video_frame(document)

    assert frame.width == 1296
    assert frame.height == 730
    assert frame.x == -78
    assert frame.y == 575


def test_editor_subtitles_are_retimed_across_deleted_video_gaps() -> None:
    document = _document()
    document.subtitles.segments = [
        document.subtitles.segments[0].model_copy(
            update={"start": 0.5, "end": 5.5, "text": "이어지는 자막"}
        )
    ]

    retimed = retime_editor_subtitles(document)

    assert [segment.model_dump() for segment in retimed] == [
        {"start": 0.0, "end": 1.5, "text": "이어지는 자막"},
        {"start": 1.5, "end": 3.0, "text": "이어지는 자막"},
    ]


def test_every_bundled_editor_font_and_text_effect_loads(tmp_path: Path) -> None:
    verify_editor_fonts()
    for effect in ("none", "outline", "shadow"):
        overlay = EditorTextOverlay.model_validate(
            {
                "id": f"text-{effect}",
                "text": "상업용 한글 폰트",
                "fontId": "spoqa-han-sans-neo",
                "color": "#FFFFFF",
                "effect": effect,
                "offset": {"x": 0, "y": 0},
                "width": 420,
                "scale": 1,
                "startSeconds": 0,
                "endSeconds": 1,
            }
        )
        output = create_editor_text_layer(
            overlay,
            tmp_path / f"{effect}.png",
        )
        with Image.open(output).convert("RGBA") as image:
            assert image.size == (1080, 1920)
            assert image.getbbox() is not None


def test_one_pixel_text_layout_wraps_without_clipping_the_glyphs(
    tmp_path: Path,
) -> None:
    overlay = EditorTextOverlay.model_validate({
        "id": "text-narrow",
        "text": "세로",
        "fontId": "pretendard",
        "color": "#FFFFFF",
        "effect": "outline",
        "offset": {"x": 0, "y": 0},
        "width": 1,
        "scale": 1,
        "startSeconds": 0,
        "endSeconds": 1,
    })

    output = create_editor_text_layer(overlay, tmp_path / "narrow.png")

    with Image.open(output).convert("RGBA") as image:
        alpha_box = image.getchannel("A").getbbox()
        assert alpha_box is not None
        assert alpha_box[2] - alpha_box[0] > 40
        assert alpha_box[3] - alpha_box[1] > 120


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_editor_document_cuts_and_renders_browser_playable_vertical_mp4(
    tmp_path: Path,
) -> None:
    timeline = tmp_path / "timeline.mp4"
    _run([
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=8",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=16000",
        "-t",
        "10",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        str(timeline),
    ])
    value = json.loads(FIXTURE.read_text())
    value["subtitles"]["segments"] = [
        {"start": 1, "end": 2.5, "text": "첫 번째 조각"},
        {"start": 4, "end": 6, "text": "두 번째 조각"},
    ]
    value["comments"] = [{
        "id": "comment-1",
        "startSeconds": 0,
        "endSeconds": 1.4,
        "text": "삭제 구간 없이 댓글 렌더링",
        "initial": "렌",
        "avatarColor": "#2674C8",
        "nickname": "렌더검증",
        "likeCount": 321,
        "ageLabel": "방금 전",
    }]
    value["overlays"]["visible"]["comment"] = True
    value["overlays"]["commentTheme"] = "light"
    value["overlays"]["commentOffsets"] = {
        "comment-1": {"x": 0, "y": 17}
    }
    value["overlays"]["textOverlays"] = [{
        "id": "text-1",
        "text": "추가 텍스트",
        "fontId": "do-hyeon",
        "color": "#FFD84D",
        "effect": "outline",
        "offset": {"x": 80, "y": -120},
        "width": 440,
        "scale": 1.15,
        "startSeconds": 1.4,
        "endSeconds": 3.5,
    }]
    value["overlays"]["layerOrder"] = [
        "video",
        "comment",
        "text:text-1",
        "title",
        "channel",
    ]
    value["overlays"]["scales"]["video"] = 1.2
    document = EditorDocument.model_validate(value)
    settings = Settings(
        temp_dir=tmp_path / "temp",
        ffmpeg_timeout_seconds=120,
        ffmpeg_threads=2,
        clean_clip_preset="ultrafast",
        clean_clip_crf=28,
    )
    renderer = EditorDocumentRenderer(settings)
    clean = renderer.extract_sequence(
        timeline_path=timeline,
        output_path=tmp_path / "clean.mp4",
        document=document,
        work_dir=tmp_path / "cut-work",
    )
    thumbnail = tmp_path / "channel.png"
    Image.new("RGB", (80, 80), "#2563EB").save(thumbnail)
    output = renderer.render(
        clean_path=clean,
        output_path=tmp_path / "output.mp4",
        document=document,
        work_dir=tmp_path / "render-work",
        channel_thumbnail_path=thumbnail,
    )

    probe = json.loads(_run([
        "ffprobe",
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        str(output),
    ]).stdout)
    video = next(
        stream for stream in probe["streams"] if stream["codec_type"] == "video"
    )
    audio = next(
        stream for stream in probe["streams"] if stream["codec_type"] == "audio"
    )
    assert (video["width"], video["height"]) == (1080, 1920)
    assert video["codec_name"] == "h264"
    assert audio["codec_name"] == "aac"
    assert float(probe["format"]["duration"]) == pytest.approx(3.5, abs=0.2)
    assert output.stat().st_size > 10_000
