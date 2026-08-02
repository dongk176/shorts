from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image, ImageFont

from shorts_worker.config import Settings
from shorts_worker.editor_renderer import (
    EditorDocumentRenderer,
    EditorLayerAsset,
    _clamp_centered_layer_position,
    _draw_styled_title_content,
    _prepare_editor_layer_asset,
    _timed_overlay_enable_expression,
    _timed_overlay_input_filter,
    create_editor_comment_layers,
    create_editor_text_layer,
    create_editor_title_layer,
    editor_font_path,
    editor_layer_order,
    editor_render_timeout_seconds,
    editor_video_frame,
    load_editor_font,
    retime_editor_subtitles,
    verify_editor_fonts,
)
from shorts_worker.schemas import EditorDocument, EditorFontId, EditorTextOverlay

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


def test_movable_overlay_positions_are_clamped_after_scaling() -> None:
    layer = Image.new("RGBA", (712, 160), (255, 255, 255, 255))

    assert _clamp_centered_layer_position(layer, 724, 160) == (724, 160)
    scaled = layer.resize((997, 224))
    assert _clamp_centered_layer_position(scaled, 724, 160) == (540, 160)


def test_oversized_overlay_axes_are_centered() -> None:
    layer = Image.new("RGBA", (1200, 2100), (255, 255, 255, 255))

    assert _clamp_centered_layer_position(layer, 900, 1400) == (540, 960)


def test_title_line_boxes_match_the_browser_for_every_editor_font() -> None:
    document = _document()
    document.title.text = "첫 번째 제목\n두 번째 제목"
    document.title.text_styles = []

    for font_id in EditorFontId:
        content = _draw_styled_title_content(
            document,
            font_id=font_id,
            font_size=84,
            custom_config=None,
        )
        assert content.height == 84 * 2 + 18


def test_title_layer_uses_every_selected_editor_font(tmp_path: Path) -> None:
    document = _document()
    document.title.text = "선택한 폰트 검증"
    document.title.text_styles = []
    document.overlays.scales["title"] = 1
    rendered_pixels: set[bytes] = set()
    for font_id in EditorFontId:
        document.overlays.fonts["title"] = font_id
        output = create_editor_title_layer(
            document,
            tmp_path / f"{font_id.value}.png",
        )
        with Image.open(output) as image:
            rendered_pixels.add(image.tobytes())

    assert len(rendered_pixels) == len(EditorFontId)


def test_noto_serif_title_uses_the_same_bold_weight_as_the_browser() -> None:
    text = "후킹 제목 굵기"
    preview_weight_font = load_editor_font(EditorFontId.NOTO_SERIF_KR, 84)
    default_weight_font = ImageFont.truetype(
        str(editor_font_path(EditorFontId.NOTO_SERIF_KR)),
        size=84,
    )
    preview_weight_mask = preview_weight_font.getmask(text, mode="L")
    default_weight_mask = default_weight_font.getmask(text, mode="L")

    assert sum(preview_weight_mask) > sum(default_weight_mask) * 1.35


def test_title_ignores_horizontal_offset_and_preserves_vertical_offset(
    tmp_path: Path,
) -> None:
    document = _document()
    document.title.text = "후킹 제목 위치"
    document.title.text_styles = []
    document.overlays.offsets["title"] = document.overlays.offsets[
        "title"
    ].model_copy(update={"x": 240, "y": 0})
    right = create_editor_title_layer(document, tmp_path / "right.png")
    document.overlays.offsets["title"] = document.overlays.offsets[
        "title"
    ].model_copy(update={"x": -240, "y": 0})
    left = create_editor_title_layer(document, tmp_path / "left.png")

    assert Image.open(right).tobytes() == Image.open(left).tobytes()

    base_box = Image.open(left).getchannel("A").getbbox()
    document.overlays.offsets["title"] = document.overlays.offsets[
        "title"
    ].model_copy(update={"x": 0, "y": 31})
    lowered = create_editor_title_layer(document, tmp_path / "lowered.png")
    lowered_box = Image.open(lowered).getchannel("A").getbbox()
    assert base_box is not None
    assert lowered_box is not None
    assert lowered_box[1] - base_box[1] == 31
    assert lowered_box[3] - base_box[3] == 31


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


def test_editor_channel_is_always_rendered_as_the_front_layer() -> None:
    document = _document()
    document.overlays.layer_order = [
        "channel",
        "video",
        "title",
        "comment",
    ]

    assert editor_layer_order(document) == [
        "video",
        "title",
        "comment",
        "channel",
    ]


def test_prepared_editor_layer_is_cropped_without_losing_canvas_position(
    tmp_path: Path,
) -> None:
    source_path = tmp_path / "layer.png"
    source = Image.new("RGBA", (1080, 1920), (0, 0, 0, 0))
    source.paste((255, 77, 79, 255), (140, 320, 460, 520))
    source.save(source_path)

    prepared = _prepare_editor_layer_asset(
        EditorLayerAsset(
            path=source_path,
            start_seconds=1.25,
            end_seconds=3.5,
            fade_in=True,
            fade_out=True,
        ),
        tmp_path / "prepared.png",
    )

    assert prepared is not None
    assert (prepared.x, prepared.y) == (140, 320)
    assert (prepared.start_seconds, prepared.end_seconds) == (1.25, 3.5)
    assert prepared.fade_in is True
    assert prepared.fade_out is True
    with Image.open(prepared.path) as cropped:
        assert cropped.size == (320, 200)


def test_editor_render_timeout_scales_for_complex_longer_outputs() -> None:
    assert editor_render_timeout_seconds(300, 3.5) == 300
    assert editor_render_timeout_seconds(300, 30) == 570
    assert editor_render_timeout_seconds(300, 120) == 1_200
    assert editor_render_timeout_seconds(1_500, 30) == 1_500


def test_timed_overlay_enable_expression_uses_half_open_window() -> None:
    expression = _timed_overlay_enable_expression(1.25, 3.5, 30)

    assert expression == "gte(n,38)*lt(n,105)"
    assert "between" not in expression


def test_timed_overlay_boundaries_are_quantized_to_the_same_output_frame() -> None:
    first = _timed_overlay_enable_expression(6.692, 12.265, 30)
    second = _timed_overlay_enable_expression(12.265, 16.015, 30)

    assert first == "gte(n,201)*lt(n,368)"
    assert second == "gte(n,368)*lt(n,481)"


def test_timed_overlay_filter_uses_short_alpha_transitions() -> None:
    value = _timed_overlay_input_filter(
        EditorLayerAsset(
            path=Path("overlay.png"),
            start_seconds=3.977,
            end_seconds=24.2,
            fade_in=True,
            fade_out=True,
        ),
        input_index=2,
        output_label="asset2",
        fps=30,
    )

    assert "fps=30.000" in value
    assert "fade=t=in:start_frame=120:nb_frames=3:alpha=1" in value
    assert "fade=t=out:start_frame=723:nb_frames=3:alpha=1" in value


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None,
    reason="ffmpeg is required",
)
def test_timed_overlay_without_fade_never_drops_at_one_second_ticks(
    tmp_path: Path,
) -> None:
    overlay_path = tmp_path / "black-overlay.png"
    Image.new("RGBA", (64, 64), (0, 0, 0, 255)).save(overlay_path)
    asset = EditorLayerAsset(
        path=overlay_path,
        start_seconds=0,
        end_seconds=3,
    )
    prepared = _timed_overlay_input_filter(
        asset,
        input_index=1,
        output_label="asset1",
        fps=30,
    )
    enable = _timed_overlay_enable_expression(0, 3, 30)
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=white:s=64x64:r=30:d=3",
            "-loop",
            "1",
            "-framerate",
            "1",
            "-i",
            str(overlay_path),
            "-filter_complex",
            (
                f"{prepared};"
                "[0:v][asset1]overlay=x=0:y=0:"
                f"eof_action=repeat:repeatlast=1:enable='{enable}'[out]"
            ),
            "-map",
            "[out]",
            "-frames:v",
            "90",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=30,
        shell=False,
    )
    frame_size = 64 * 64 * 3
    center_offset = (32 * 64 + 32) * 3
    center_pixels = [
        result.stdout[
            frame_index * frame_size + center_offset:
            frame_index * frame_size + center_offset + 3
        ]
        for frame_index in range(90)
    ]

    assert all(max(pixel) < 5 for pixel in center_pixels)


def test_contiguous_comments_swap_without_fading_to_the_background(
    tmp_path: Path,
) -> None:
    value = json.loads(FIXTURE.read_text())
    comment = {
        "id": "comment-1",
        "startSeconds": 0,
        "endSeconds": 1.5,
        "text": "첫 댓글",
        "initial": "첫",
        "avatarColor": "#2563EB",
        "nickname": "첫댓글",
        "likeCount": 30,
        "ageLabel": "방금 전",
    }
    value["comments"] = [
        comment,
        {
            **comment,
            "id": "comment-2",
            "startSeconds": 1.5,
            "endSeconds": 2.5,
            "text": "둘째 댓글",
        },
        {
            **comment,
            "id": "comment-3",
            "startSeconds": 2.8,
            "endSeconds": 3.5,
            "text": "셋째 댓글",
        },
    ]
    value["overlays"]["visible"]["comment"] = True
    document = EditorDocument.model_validate(value)

    assets = create_editor_comment_layers(document, tmp_path)

    assert [(asset.fade_in, asset.fade_out) for asset in assets] == [
        (False, False),
        (False, True),
        (True, False),
    ]


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None,
    reason="ffmpeg is required",
)
def test_adjacent_timed_overlays_do_not_share_the_boundary_frame() -> None:
    first = _timed_overlay_enable_expression(0, 1, 10)
    second = _timed_overlay_enable_expression(1, 2, 10)
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x64:r=10:d=2",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=32x64:r=1:d=2",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=32x64:r=1:d=2",
            "-filter_complex",
            (
                f"[0:v][1:v]overlay=x=0:y=0:eof_action=repeat:repeatlast=1:"
                f"enable='{first}'[first];"
                f"[first][2:v]overlay=x=32:y=0:eof_action=repeat:repeatlast=1:"
                f"enable='{second}'[out]"
            ),
            "-map",
            "[out]",
            "-frames:v",
            "20",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=30,
        shell=False,
    )
    frame_size = 64 * 64 * 3

    def pixel(frame_index: int, x: int, y: int) -> tuple[int, int, int]:
        offset = frame_index * frame_size + (y * 64 + x) * 3
        return tuple(result.stdout[offset:offset + 3])

    before_left = pixel(9, 16, 32)
    before_right = pixel(9, 48, 32)
    boundary_left = pixel(10, 16, 32)
    boundary_right = pixel(10, 48, 32)

    assert before_left[0] > 200 and max(before_left[1:]) < 40
    assert max(before_right) < 40
    assert max(boundary_left) < 40
    assert boundary_right[2] > 200 and max(boundary_right[:2]) < 40


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
