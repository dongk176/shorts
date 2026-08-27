from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image, ImageFont

from shorts_worker.caption_templates import compile_caption_render_spec
from shorts_worker.config import Settings
from shorts_worker.editor_renderer import (
    EditorDocumentRenderer,
    EditorLayerAsset,
    _clamp_centered_layer_position,
    _draw_styled_title_content,
    _editor_caption_composition_spec,
    _editor_video_input_filter,
    _prepare_editor_layer_asset,
    _timed_overlay_enable_expression,
    _timed_overlay_input_filter,
    create_editor_channel_layer,
    create_editor_comment_layers,
    create_editor_text_layer,
    create_editor_title_layer,
    editor_font_path,
    editor_highlight_caption_spec,
    editor_highlight_subtitles_enabled,
    editor_layer_order,
    editor_render_timeout_seconds,
    editor_subtitle_render_mode,
    editor_subtitle_style,
    editor_video_frame,
    load_editor_font,
    project_caption_render_spec_v4,
    retime_editor_caption_spec,
    retime_editor_subtitles,
    verify_editor_fonts,
)
from shorts_worker.render_spec_v4 import compile_initial_editor_render_spec_v4
from shorts_worker.schemas import (
    CustomTemplateConfig,
    EditorDocument,
    EditorFontId,
    EditorTextOverlay,
    TemplateId,
    VideoAspectRatio,
)
from shorts_worker.subtitles import TranscriptWord

pytestmark = pytest.mark.render

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "test-fixtures"
    / "editor-document-v2.json"
)
V3_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "test-fixtures"
    / "editor-document-v3.json"
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


def _document_v3() -> EditorDocument:
    return EditorDocument.model_validate_json(V3_FIXTURE.read_text())


def _document_v3_with_subtitle_layout(
    *,
    offset_y: int = -260,
    scale: float = 1.5,
    accent_color: str | None = None,
    cue_edits: list[dict[str, object]] | None = None,
) -> EditorDocument:
    value = json.loads(V3_FIXTURE.read_text())
    value["renderSpec"]["version"] = 2
    value["renderSpec"]["subtitles"] = {
        "centerX": 540,
        "offsetY": offset_y,
        "scale": scale,
        **({"accentColor": accent_color} if accent_color else {}),
        **({"cueEdits": cue_edits} if cue_edits else {}),
    }
    return EditorDocument.model_validate(value)


def _document_v3_with_absolute_subtitle_style(
    *,
    font_size: int = 96,
    color: str = "#F3F0E9",
) -> EditorDocument:
    value = json.loads(V3_FIXTURE.read_text())
    value["renderSpec"]["version"] = 3
    value["renderSpec"]["subtitles"] = {
        "centerX": 540,
        "offsetY": -180,
        "scale": 1,
        "fontId": "paperlogy",
        "fontSize": font_size,
        "color": color,
        "accentColor": "#FFD84D",
        "cueEdits": [],
    }
    return EditorDocument.model_validate(value)


def _caption_spec_v4() -> dict[str, object]:
    return compile_caption_render_spec(
        [
            TranscriptWord(
                text="첫째",
                start=3,
                end=3.45,
                provider="elevenlabs",
            ),
            TranscriptWord(
                text="둘째",
                start=3.6,
                end=4.2,
                provider="elevenlabs",
            ),
        ],
        template_id="pop",
        clip_start=0,
        clip_end=10,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        schema_version=4,
    )


def _document_v4_with_contiguous_caption_clip(
    caption_render_spec: dict[str, object],
    *,
    clip_start_seconds: float,
    clip_end_seconds: float,
) -> EditorDocument:
    value = json.loads(V3_FIXTURE.read_text())
    value["overlays"]["textOverlays"] = []
    value["overlays"]["layerOrder"] = [
        "video",
        "title",
        "comment",
        "channel",
    ]
    value["video"].update({
        "clips": [{
            "id": "one-contiguous-v4-clip",
            "sourceStartSeconds": clip_start_seconds,
            "sourceEndSeconds": clip_end_seconds,
        }],
        "selectionStartSeconds": 10 + clip_start_seconds,
        "selectionEndSeconds": 10 + clip_end_seconds,
    })
    value["renderSpec"] = compile_initial_editor_render_spec_v4(
        title=value["title"]["text"],
        template_id=value["template"]["id"],
        video_aspect_ratio=value["video"]["aspectRatio"],
        font_scale=value["title"]["fontScale"],
        caption_render_spec=caption_render_spec,
    )
    return EditorDocument.model_validate(value)


def _v5_custom_template_config() -> dict[str, object]:
    return {
        "schemaVersion": 5,
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
            "x": 360,
            "y": 260,
            "maxWidth": 600,
            "fontSize": 72,
            "fontId": "pretendard",
            "primaryColor": "#FFFFFF",
            "accentColor": "#FF4D4F",
            "primaryBackgroundColor": "#16A34A",
            "accentBackgroundColor": "#2563EB",
        },
        "subtitle": {
            "visible": True,
            "variant": "highlight",
            "x": 540,
            "y": 250,
            "maxWidth": 900,
            "fontId": "paperlogy",
            "fontSize": 48,
            "color": "#FFFFFF",
            "accentColor": "#FFD84D",
        },
        "channel": {
            "visible": True,
            "x": 720,
            "y": 1700,
            "maxWidth": 600,
            "fontSize": 42,
            "color": "#3B82F6",
            "backgroundColor": None,
        },
        "comment": {
            "visible": True,
            "theme": "light",
            "size": "small",
            "y": 1120,
            "dockedToVideo": False,
        },
    }


def test_v5_custom_template_rejects_subtitle_background_field() -> None:
    config = _v5_custom_template_config()
    subtitle = config["subtitle"]
    assert isinstance(subtitle, dict)
    subtitle["backgroundColor"] = None

    with pytest.raises(ValueError, match="backgroundColor"):
        CustomTemplateConfig.model_validate(config)


def _document_v3_with_v5_custom_template() -> EditorDocument:
    value = json.loads(V3_FIXTURE.read_text())
    value["template"] = {
        "id": "comment-capture",
        "customTemplateId": "00000000-0000-4000-8000-000000000001",
        "presetVersion": 3,
        "snapshot": {
            "id": "00000000-0000-4000-8000-000000000001",
            "name": "v5 editor rerender",
            "baseTemplateId": "comment-capture",
            "version": 1,
            "config": _v5_custom_template_config(),
        },
    }
    value["title"].update({"text": "커스텀 재렌더", "textStyles": []})
    value["channel"]["displayName"] = "v5 채널"
    value["video"] = {
        "clips": [{
            "id": "clip-v5",
            "sourceStartSeconds": 0,
            "sourceEndSeconds": 1,
        }],
        "aspectRatio": "16:9",
        "timelineStartSeconds": 0,
        "timelineEndSeconds": 1,
        "selectionStartSeconds": 0,
        "selectionEndSeconds": 1,
    }
    value["subtitles"] = {
        "enabled": True,
        "segments": [{"start": 0.1, "end": 0.8, "text": "통합 자막"}],
    }
    value["comments"] = [{
        "id": "comment-v5",
        "startSeconds": 0,
        "endSeconds": 1,
        "text": "자막과 함께 렌더되는 댓글",
        "initial": "댓",
        "avatarColor": "#2674C8",
        "nickname": "댓글검증",
        "likeCount": 321,
        "ageLabel": "방금 전",
    }]
    value["overlays"].update({
        "commentOffsets": {"comment-v5": {"x": 0, "y": 0}},
        "textOverlays": [],
        "layerOrder": ["video", "title", "comment", "channel"],
        "commentTheme": None,
        "background": {"kind": "color", "color": "#16A34A"},
    })
    value["overlays"]["visible"].update({
        "title": True,
        "comment": True,
        "channel": True,
    })
    value["overlays"]["offsets"] = {
        layer: {"x": 0, "y": 0}
        for layer in ("video", "title", "comment", "channel")
    }
    value["overlays"]["scales"] = {"video": 1, "title": 1, "channel": 1}
    value["renderSpec"].update({
        "version": 3,
        "layerOrder": ["video", "title", "comment", "channel"],
        "comments": [{
            "id": "comment-v5",
            "offsetY": 0,
            "startFrame": 0,
            "endFrame": 30,
        }],
        "textOverlays": [],
        "subtitles": {
            "centerX": 540,
            "offsetY": 0,
            "scale": 1,
            "fontId": "paperlogy",
            "fontSize": 48,
            "color": "#FFFFFF",
            "accentColor": "#FFD84D",
            "cueEdits": [],
        },
    })
    value["renderSpec"]["title"].update({
        "lines": ["커스텀 재렌더"],
        "fontSize": 72,
    })
    value["renderSpec"]["video"] = {"offsetX": 0, "offsetY": 0, "scale": 1}
    return EditorDocument.model_validate(value)


def _v5_custom_caption_spec() -> dict[str, object]:
    return compile_caption_render_spec(
        [
            TranscriptWord(
                text="통합",
                start=0.1,
                end=0.45,
                provider="elevenlabs",
            ),
            TranscriptWord(
                text="자막",
                start=0.45,
                end=0.8,
                provider="elevenlabs",
                space_before=True,
            ),
        ],
        template_id="highlight",
        clip_start=0,
        clip_end=1,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        caption_center_y=250,
        caption_max_width=900,
        font_id=EditorFontId.PAPERLOGY,
        font_size=48,
        text_color="#FFFFFF",
        accent_color="#FFD84D",
        background_color="#000000",
    )


def test_v3_font_files_are_byte_identical_in_web_and_worker() -> None:
    root = Path(__file__).resolve().parents[2]
    for font_id in EditorFontId:
        worker_font = editor_font_path(font_id)
        web_font = root / "web" / "public" / "fonts" / "editor" / worker_font.name
        assert web_font.is_file()
        assert hashlib.sha256(worker_font.read_bytes()).digest() == hashlib.sha256(
            web_font.read_bytes()
        ).digest()


def test_caption_editor_font_override_is_persisted_in_render_spec() -> None:
    document = _document_v3_with_subtitle_layout()
    assert document.render_spec is not None
    assert document.render_spec.subtitles is not None
    document.render_spec.subtitles.font_id = EditorFontId.JUA
    original = compile_caption_render_spec(
        [TranscriptWord(text="글씨체", start=1.2, end=1.8, provider="elevenlabs")],
        template_id="highlight",
        clip_start=0,
        clip_end=6,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
    )

    rendered = retime_editor_caption_spec(document, original)

    assert rendered is not None
    assert rendered["font"] == {
        "fontId": "jua",
        "fileId": "Jua-Regular.ttf",
        "sha256": rendered["font"]["sha256"],
        "family": "Jua",
        "weight": 400,
    }


def test_v4_caption_projection_preserves_stored_absolute_geometry() -> None:
    canonical = _caption_spec_v4()
    source_cue = canonical["cues"][0]
    projected = project_caption_render_spec_v4(
        canonical,
        clip_start_seconds=2,
        clip_end_seconds=8,
    )
    projected_cue = projected["cues"][0]

    assert projected["clipStartSeconds"] == 2
    assert projected["clipEndSeconds"] == 8
    assert projected_cue["startFrame"] == source_cue["startFrame"] - 60
    assert projected_cue["endFrame"] == source_cue["endFrame"] - 60
    assert projected_cue["words"][0]["centerX"] == source_cue["words"][0][
        "centerX"
    ]
    assert projected_cue["words"][0]["centerY"] == source_cue["words"][0][
        "centerY"
    ]
    assert projected_cue["events"][0]["positions"] == source_cue["events"][0][
        "positions"
    ]


def test_v4_padded_timeline_noop_uses_the_same_canonical_projection() -> None:
    canonical = _caption_spec_v4()
    document = _document_v4_with_contiguous_caption_clip(
        canonical,
        clip_start_seconds=2,
        clip_end_seconds=8,
    )
    expected = project_caption_render_spec_v4(
        canonical,
        clip_start_seconds=2,
        clip_end_seconds=8,
    )

    first_rerender = retime_editor_caption_spec(document, canonical)
    second_rerender = retime_editor_caption_spec(document, canonical)

    assert first_rerender == expected
    assert second_rerender == expected


def test_v4_boundary_projection_is_identical_on_first_and_noop_rerender() -> None:
    canonical = compile_caption_render_spec(
        [
            TranscriptWord(
                text="경계",
                start=1.9,
                end=2.6,
                provider="elevenlabs",
            ),
            TranscriptWord(
                text="자막",
                start=2.7,
                end=3.2,
                provider="elevenlabs",
            ),
        ],
        template_id="pop",
        clip_start=0,
        clip_end=10,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        schema_version=4,
    )
    document = _document_v4_with_contiguous_caption_clip(
        canonical,
        clip_start_seconds=2,
        clip_end_seconds=8,
    )
    first_render_projection = project_caption_render_spec_v4(
        canonical,
        clip_start_seconds=2,
        clip_end_seconds=8,
    )

    assert retime_editor_caption_spec(document, canonical) == first_render_projection
    assert first_render_projection == project_caption_render_spec_v4(
        canonical,
        clip_start_seconds=2,
        clip_end_seconds=8,
    )


def test_v4_selected_clip_noop_keeps_the_original_caption_spec_exact() -> None:
    canonical = _caption_spec_v4()
    document = _document_v4_with_contiguous_caption_clip(
        canonical,
        clip_start_seconds=0,
        clip_end_seconds=10,
    )

    assert retime_editor_caption_spec(document, canonical) == canonical


def test_editor_render_spec_v3_applies_absolute_caption_size_and_color_once() -> None:
    document = _document_v3_with_absolute_subtitle_style()
    original = compile_caption_render_spec(
        [
            TranscriptWord(
                text="편집",
                start=1.2,
                end=1.8,
                provider="elevenlabs",
            )
        ],
        template_id="highlight",
        clip_start=0,
        clip_end=6,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        font_size=72,
    )

    rendered = retime_editor_caption_spec(document, original)

    assert rendered is not None
    assert rendered["font"]["fontId"] == "paperlogy"
    assert rendered["style"]["fontSize"] == 96
    assert rendered["style"]["textColor"] == "#F3F0E9"
    assert rendered["style"]["accentColor"] == "#FFD84D"
    assert all(cue["fontSize"] == 96 for cue in rendered["cues"])


def test_v3_noto_serif_text_800_is_heavier_than_title_700() -> None:
    text = "후킹 제목과 추가 텍스트"
    title_font = load_editor_font(EditorFontId.NOTO_SERIF_KR, 72, weight=700)
    text_font = load_editor_font(EditorFontId.NOTO_SERIF_KR, 72, weight=800)

    assert sum(text_font.getmask(text, mode="L")) > sum(
        title_font.getmask(text, mode="L")
    ) * 1.05


def test_v3_text_layer_uses_authoritative_lines_and_weight(tmp_path: Path) -> None:
    document = _document_v3()
    overlay = document.overlays.text_overlays[0]
    spec = document.render_spec
    assert spec is not None
    output = create_editor_text_layer(
        overlay,
        tmp_path / "v3-text.png",
        spec.text_overlays[0],
    )

    with Image.open(output) as image:
        assert image.getchannel("A").getbbox() is not None
    assert spec.text_overlays[0].font.resolved_weight == 800
    assert spec.text_overlays[0].start_frame == 15
    assert spec.text_overlays[0].end_frame == 75


def test_admin_subtitle_layout_maps_to_ass_position_and_font_size() -> None:
    legacy = editor_subtitle_style(_document_v3())
    admin = editor_subtitle_style(
        _document_v3_with_subtitle_layout(offset_y=-260, scale=1.5)
    )

    assert (legacy.margin_v, legacy.font_size) == (445, 48)
    assert (admin.margin_v, admin.font_size) == (705, 72)


def test_general_v3_subtitles_compile_to_highlight_cues() -> None:
    document = _document_v3_with_subtitle_layout(
        offset_y=120,
        scale=0.75,
        accent_color="#16A34A",
        cue_edits=[{"cueIndex": 0, "text": "수정한 강조 자막"}],
    )

    source = editor_highlight_caption_spec(document)
    assert source is not None
    assert source["templateId"] == "highlight"
    assert source["timingLeadFrames"] == 7
    assert source["style"]["accentColor"] == "#16A34A"
    assert [
        event["activeWordIndex"]
        for cue in source["cues"]
        for event in cue["events"]
    ] == [0, 1, 0]

    rendered = retime_editor_caption_spec(document, source)
    assert rendered is not None
    assert rendered["style"]["fontSize"] == 54
    assert rendered["style"]["accentColor"] == "#16A34A"
    assert [
        word["text"]
        for word in rendered["cues"][0]["words"]
    ] == ["수정한", "강조", "자막"]
    assert all(
        rendered["cues"][index]["endFrame"]
        <= rendered["cues"][index + 1]["startFrame"]
        for index in range(len(rendered["cues"]) - 1)
    )


def test_general_highlight_subtitles_require_admin_word_timing_marker() -> None:
    assert editor_highlight_subtitles_enabled(
        _document_v3_with_subtitle_layout()
    )
    assert not editor_highlight_subtitles_enabled(_document_v3())
    assert not editor_highlight_subtitles_enabled(_document())


def test_v3_subtitles_never_fall_back_to_deprecated_plain_ass() -> None:
    assert editor_subtitle_render_mode(
        _document_v3_with_subtitle_layout(),
        None,
    ) == "editor-highlight"
    assert editor_subtitle_render_mode(_document_v3(), None) == "invalid-v3"
    assert editor_subtitle_render_mode(_document(), None) == "legacy-v2"


def test_comment_capture_channel_offset_matches_saved_editor_pixels(
    tmp_path: Path,
) -> None:
    value = json.loads(V3_FIXTURE.read_text())
    value["template"] = {
        "id": "comment-capture",
        "customTemplateId": None,
        "presetVersion": 3,
        "snapshot": {"presetVersion": 3},
    }
    value["overlays"]["offsets"]["channel"] = {"x": 0, "y": 0}
    value["renderSpec"]["channel"]["offsetX"] = 0
    value["renderSpec"]["channel"]["offsetY"] = 0
    baseline = EditorDocument.model_validate(value)
    baseline_path = create_editor_channel_layer(
        baseline,
        tmp_path / "channel-baseline.png",
        None,
    )

    value["overlays"]["offsets"]["channel"] = {"x": 0, "y": -165}
    value["renderSpec"]["channel"]["offsetY"] = -165
    moved = EditorDocument.model_validate(value)
    moved_path = create_editor_channel_layer(
        moved,
        tmp_path / "channel-moved.png",
        None,
    )

    with Image.open(baseline_path) as image:
        baseline_box = image.getchannel("A").getbbox()
    with Image.open(moved_path) as image:
        moved_box = image.getchannel("A").getbbox()
    assert baseline_box is not None
    assert moved_box is not None
    assert moved_box[1] - baseline_box[1] == -165
    assert moved_box[3] - baseline_box[3] == -165


def test_admin_caption_template_layout_scales_and_retimes_trusted_pop_spec() -> None:
    document = _document_v3_with_subtitle_layout(offset_y=-260, scale=1.5)
    original = {
        "schemaVersion": 3,
        "templateId": "pop",
        "fps": 30,
        "safeArea": {"x": 120, "y": 1025, "width": 840, "height": 140},
        "layout": {
            "caption": {"x": 120, "y": 1025, "width": 840, "height": 140}
        },
        "style": {"fontSize": 92, "outlineWidth": 8},
        "cues": [{
            "startFrame": 30,
            "endFrame": 150,
            "words": [{
                "text": "자막",
                "fontSize": 92,
                "centerX": 500,
                "centerY": 1095,
            }],
            "events": [
                {
                    "startFrame": 30,
                    "endFrame": 60,
                    "activeWordIndex": 0,
                    "positions": [{"centerX": 500, "centerY": 1095}],
                },
                {
                    "startFrame": 120,
                    "endFrame": 150,
                    "activeWordIndex": 0,
                    "positions": [{"centerX": 500, "centerY": 1095}],
                },
            ],
        }],
    }

    rendered = retime_editor_caption_spec(document, original)

    assert rendered is not None
    assert original["style"] == {"fontSize": 92, "outlineWidth": 8}
    assert rendered["style"] == {"fontSize": 138.0, "outlineWidth": 12.0}
    assert rendered["safeArea"] == {
        "x": -90.0,
        "y": 730.0,
        "width": 1260.0,
        "height": 210.0,
    }
    cue = rendered["cues"][0]
    assert cue["words"][0]["fontSize"] == 138.0
    assert cue["words"][0]["centerX"] == 480.0
    assert cue["words"][0]["centerY"] == 835.0
    assert [
        (event["startFrame"], event["endFrame"])
        for event in cue["events"]
    ] == [(0, 30), (45, 75)]
    assert cue["events"][0]["positions"] == [
        {"centerX": 480.0, "centerY": 835.0}
    ]


def test_admin_caption_template_layout_updates_highlight_font_and_y_only() -> None:
    document = _document_v3_with_subtitle_layout(offset_y=120, scale=0.75)
    spec = {
        "schemaVersion": 3,
        "templateId": "highlight",
        "fps": 30,
        "safeArea": {"x": 120, "y": 1025, "width": 840, "height": 140},
        "style": {"fontSize": 72, "outlineWidth": 7},
        "cues": [{
            "startFrame": 30,
            "endFrame": 60,
            "fontSize": 72,
            "scaleX": 100,
            "centerX": 540,
            "centerY": 1095,
            "words": [{"text": "강조"}],
            "lines": [[0]],
            "events": [{
                "startFrame": 30,
                "endFrame": 60,
                "activeWordIndex": 0,
            }],
        }],
    }

    rendered = retime_editor_caption_spec(document, spec)

    assert rendered is not None
    cue = rendered["cues"][0]
    assert cue["fontSize"] == 54.0
    assert cue["centerX"] == 540.0
    assert cue["centerY"] == 1215.0
    assert rendered["style"]["outlineWidth"] == 5.25


def test_admin_caption_template_edits_point_color_text_and_bottom_position() -> None:
    document = _document_v3_with_subtitle_layout(
        offset_y=700,
        scale=1,
        accent_color="#16A34A",
        cue_edits=[{"cueIndex": 0, "text": "바뀐 자막"}],
    )
    spec = {
        "schemaVersion": 3,
        "templateId": "pop",
        "fps": 30,
        "safeArea": {"x": 120, "y": 1025, "width": 840, "height": 140},
        "style": {
            "fontSize": 92,
            "textColor": "#FFFFFF",
            "accentColor": "#35E6E3",
            "outlineColor": "#080808",
            "outlineWidth": 8,
        },
        "cues": [{
            "startFrame": 30,
            "endFrame": 90,
            "words": [{
                "text": "원래",
                "fontSize": 92,
                "centerX": 540,
                "centerY": 1095,
            }],
            "events": [{
                "startFrame": 30,
                "endFrame": 90,
                "activeWordIndex": 0,
                "positions": [{"centerX": 540, "centerY": 1095}],
            }],
        }],
    }

    rendered = retime_editor_caption_spec(document, spec)

    assert rendered is not None
    assert rendered["style"]["accentColor"] == "#16A34A"
    assert [word["text"] for word in rendered["cues"][0]["words"]] == [
        "바뀐",
        "자막",
    ]
    assert all(
        position["centerY"] == 1795.0
        for event in rendered["cues"][0]["events"]
        for position in event["positions"]
    )


def test_caption_edit_rebuilds_after_leading_trim_in_renderer() -> None:
    value = json.loads(V3_FIXTURE.read_text())
    value["video"].update({
        "clips": [{
            "id": "project-3781-leading-trim",
            "sourceStartSeconds": 58 / 30,
            "sourceEndSeconds": 4,
        }],
        "timelineStartSeconds": 0,
        "timelineEndSeconds": 4,
        "selectionStartSeconds": 58 / 30,
        "selectionEndSeconds": 4,
    })
    value["overlays"]["textOverlays"] = []
    value["overlays"]["layerOrder"] = [
        layer
        for layer in value["overlays"]["layerOrder"]
        if not layer.startswith("text:")
    ]
    value["renderSpec"]["version"] = 2
    value["renderSpec"]["textOverlays"] = []
    value["renderSpec"]["layerOrder"] = [
        layer
        for layer in value["renderSpec"]["layerOrder"]
        if not layer.startswith("text:")
    ]
    value["renderSpec"]["subtitles"] = {
        "centerX": 540,
        "offsetY": 0,
        "scale": 1,
        "cueEdits": [{
            "cueIndex": 2,
            "text": "무너지고 있습니다 파일럿",
        }],
    }
    document = EditorDocument.model_validate(value)
    spec = {
        "schemaVersion": 3,
        "templateId": "pop",
        "fps": 30,
        "safeArea": {"x": 120, "y": 666, "width": 840, "height": 140},
        "style": {
            "fontSize": 92,
            "textColor": "#FFFFFF",
            "accentColor": "#35E6E3",
            "outlineColor": "#080808",
            "outlineWidth": 8,
        },
        "cues": [{
            "sourceCueIndex": 2,
            "startFrame": 39,
            "endFrame": 66,
            "words": [
                {
                    "text": "무너지고",
                    "startFrame": 39,
                    "endFrame": 52,
                    "speechStartFrame": 39,
                    "speechEndFrame": 52,
                },
                {
                    "text": "있습니다",
                    "startFrame": 52,
                    "endFrame": 67,
                    "speechStartFrame": 52,
                    "speechEndFrame": 67,
                    "spaceBefore": True,
                },
            ],
            "events": [
                {"startFrame": 39, "endFrame": 52, "activeWordIndex": 0},
                {"startFrame": 52, "endFrame": 66, "activeWordIndex": 1},
            ],
        }],
    }

    rendered = retime_editor_caption_spec(document, spec)

    assert rendered is not None
    assert [
        (word["text"], word["startFrame"], word["endFrame"])
        for cue in rendered["cues"]
        for word in cue["words"]
    ] == [
        ("무너지고", 0, 3),
        ("있습니다", 3, 6),
        ("파일럿", 6, 8),
    ]
    assert {cue["sourceCueIndex"] for cue in rendered["cues"]} == {2}
    assert all(
        0 <= event["startFrame"] < event["endFrame"] <= 8
        for cue in rendered["cues"]
        for event in cue["events"]
    )


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


def test_caption_editor_title_keeps_the_original_caption_accent() -> None:
    document = _document_v3()
    document.title.text = "첫 번째 제목\n두 번째 제목"
    document.title.text_styles = []
    assert document.render_spec is not None
    document.render_spec.title.lines = ["첫 번째 제목", "두 번째 제목"]

    content = _draw_styled_title_content(
        document,
        font_id=EditorFontId.PRETENDARD,
        font_size=84,
        custom_config=None,
        title_accent_color="#16A34A",
    )

    assert (22, 163, 74, 255) in set(content.getdata())


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


def test_caption_editor_uses_the_server_authored_composition_layout(
    tmp_path: Path,
) -> None:
    document = _document_v3()
    caption_spec = compile_caption_render_spec(
        [
            TranscriptWord(
                text="레이아웃",
                start=0.2,
                end=0.8,
                provider="elevenlabs",
            ),
        ],
        template_id="pop",
        clip_start=0,
        clip_end=1,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
    )
    layout = caption_spec["layout"]

    frame = editor_video_frame(document, caption_spec)
    title_path = create_editor_title_layer(
        document,
        tmp_path / "caption-title.png",
        caption_render_spec=caption_spec,
    )
    channel_path = create_editor_channel_layer(
        document,
        tmp_path / "caption-channel.png",
        None,
        caption_spec,
    )

    assert (frame.x, frame.y, frame.width, frame.height) == (
        layout["video"]["x"],
        layout["video"]["y"],
        layout["video"]["width"],
        layout["video"]["height"],
    )
    with Image.open(title_path) as title_image:
        title_box = title_image.getchannel("A").getbbox()
    with Image.open(channel_path) as channel_image:
        channel_box = channel_image.getchannel("A").getbbox()
    assert title_box is not None
    assert channel_box is not None
    assert title_box[3] <= layout["title"]["y"] + layout["title"]["height"]
    assert (channel_box[1] + channel_box[3]) / 2 == pytest.approx(
        layout["channel"]["y"] + layout["channel"]["height"] / 2,
        abs=2,
    )


def test_dynamic_v3_caption_is_overlay_only_for_preset_geometry() -> None:
    document = _document_v3()
    caption_spec = compile_caption_render_spec(
        [
            TranscriptWord(
                text="동적",
                start=0.2,
                end=0.8,
                provider="elevenlabs",
            ),
        ],
        template_id="highlight",
        clip_start=0,
        clip_end=1,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
    )

    overlay_only_spec = _editor_caption_composition_spec(
        caption_spec,
        caption_overlay_only=True,
    )
    stored_legacy_spec = _editor_caption_composition_spec(
        caption_spec,
        caption_overlay_only=False,
    )

    assert overlay_only_spec is None
    assert stored_legacy_spec is caption_spec
    assert editor_video_frame(document, overlay_only_spec) == editor_video_frame(document)
    assert editor_video_frame(document, stored_legacy_spec) != editor_video_frame(document)


def test_v5_custom_editor_geometry_ignores_caption_composition(
    tmp_path: Path,
) -> None:
    document = _document_v3_with_v5_custom_template()
    caption_spec = _v5_custom_caption_spec()

    frame = editor_video_frame(document, caption_spec)
    title_path = create_editor_title_layer(
        document,
        tmp_path / "v5-title.png",
        caption_render_spec=caption_spec,
    )
    channel_path = create_editor_channel_layer(
        document,
        tmp_path / "v5-channel.png",
        None,
        caption_spec,
    )
    comment_assets = create_editor_comment_layers(
        document,
        tmp_path / "v5-comments",
        caption_spec,
    )

    assert (frame.x, frame.y, frame.width, frame.height) == (140, 600, 800, 450)
    with Image.open(title_path) as title_image:
        title_box = title_image.getchannel("A").getbbox()
    with Image.open(channel_path) as channel_image:
        channel_box = channel_image.getchannel("A").getbbox()
    assert title_box is not None
    assert channel_box is not None
    assert (title_box[0] + title_box[2]) / 2 == pytest.approx(360, abs=2)
    assert (title_box[1] + title_box[3]) / 2 == pytest.approx(260, abs=2)
    assert (channel_box[0] + channel_box[2]) / 2 == pytest.approx(720, abs=2)
    assert (channel_box[1] + channel_box[3]) / 2 == pytest.approx(1700, abs=2)
    assert len(comment_assets) == 1
    with Image.open(comment_assets[0].path) as comment_image:
        comment_box = comment_image.getchannel("A").getbbox()
    assert comment_box is not None
    assert comment_box[1] == 1120


def test_full_vertical_caption_editor_draws_brand_background_on_both_title_rows(
    tmp_path: Path,
) -> None:
    document = _document_v3()
    document.render_spec = None
    document.video.aspect_ratio = VideoAspectRatio.FULL_VERTICAL
    document.title.text = "첫 번째 줄\n두 번째 줄"
    document.title.text_styles = []
    accent = "#F97316"
    caption_spec = compile_caption_render_spec(
        [
            TranscriptWord(
                text="자막",
                start=0.2,
                end=0.8,
                provider="elevenlabs",
            ),
        ],
        template_id="highlight",
        clip_start=0,
        clip_end=1,
        video_aspect_ratio=VideoAspectRatio.FULL_VERTICAL,
        accent_color=accent,
    )

    title_path = create_editor_title_layer(
        document,
        tmp_path / "full-vertical-caption-title.png",
        title_accent_color=accent,
        caption_render_spec=caption_spec,
    )

    with Image.open(title_path).convert("RGBA") as image:
        accent_rgba = (249, 115, 22, 255)
        accent_rows = sorted({
            y
            for y in range(image.height)
            for x in range(image.width)
            if image.getpixel((x, y)) == accent_rgba
        })
    assert accent_rows
    row_groups = 1 + sum(
        current - previous > 1
        for previous, current in zip(accent_rows, accent_rows[1:], strict=False)
    )
    assert row_groups == 2


def test_v3_full_vertical_comment_video_uses_preview_contain_fit() -> None:
    document = _document_v3()
    document.template.id = TemplateId.COMMENT_CAPTURE
    document.video.aspect_ratio = VideoAspectRatio.FULL_VERTICAL
    frame = editor_video_frame(document)

    value = _editor_video_input_filter(document, frame, 30)

    assert "force_original_aspect_ratio=decrease" in value
    assert f"pad={frame.width}:{frame.height}" in value
    assert "crop=" not in value


def test_v2_full_vertical_comment_video_keeps_existing_cover_fit() -> None:
    document = _document()
    document.template.id = TemplateId.COMMENT_CAPTURE
    document.video.aspect_ratio = VideoAspectRatio.FULL_VERTICAL
    frame = editor_video_frame(document)

    value = _editor_video_input_filter(document, frame, 30)

    assert "force_original_aspect_ratio=increase" in value
    assert f"crop={frame.width}:{frame.height}" in value
    assert "pad=" not in value


def test_v3_custom_or_caption_comment_video_keeps_preview_cover_fit() -> None:
    document = _document_v3()
    document.template.id = TemplateId.COMMENT_CAPTURE
    document.template.custom_template_id = "00000000-0000-4000-8000-000000000001"
    document.video.aspect_ratio = VideoAspectRatio.FULL_VERTICAL
    frame = editor_video_frame(document)

    custom_value = _editor_video_input_filter(document, frame, 30)
    document.template.custom_template_id = None
    caption_value = _editor_video_input_filter(document, frame, 30, {})

    assert "force_original_aspect_ratio=increase" in custom_value
    assert "force_original_aspect_ratio=increase" in caption_value
    assert "pad=" not in custom_value
    assert "pad=" not in caption_value


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


def test_editor_hook_title_is_always_rendered_in_front_of_video() -> None:
    document = _document()
    document.overlays.layer_order = [
        "title",
        "comment",
        "video",
        "channel",
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
def test_editor_sequence_pads_small_source_tail_drift_to_document_duration(
    tmp_path: Path,
) -> None:
    timeline = tmp_path / "short-tail-timeline.mp4"
    _run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000",
        "-t", "9.8", "-c:v", "libx264", "-preset", "ultrafast",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(timeline),
    ])
    value = json.loads(FIXTURE.read_text())
    value["video"]["clips"] = [{
        "id": "clip-tail",
        "sourceStartSeconds": 1,
        "sourceEndSeconds": 10,
    }]
    value["video"]["selectionStartSeconds"] = 11
    value["video"]["selectionEndSeconds"] = 20
    document = EditorDocument.model_validate(value)
    renderer = EditorDocumentRenderer(Settings(
        temp_dir=tmp_path / "temp",
        ffmpeg_timeout_seconds=120,
        ffmpeg_threads=2,
        clean_clip_preset="ultrafast",
        clean_clip_crf=28,
    ))

    clean = renderer.extract_sequence(
        timeline_path=timeline,
        output_path=tmp_path / "clean.mp4",
        document=document,
        work_dir=tmp_path / "cut-work",
    )

    probe = json.loads(_run([
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(clean),
    ]).stdout)
    video = next(
        stream for stream in probe["streams"] if stream["codec_type"] == "video"
    )
    audio = next(
        stream for stream in probe["streams"] if stream["codec_type"] == "audio"
    )
    assert float(probe["format"]["duration"]) == pytest.approx(9, abs=0.08)
    assert float(video["duration"]) == pytest.approx(9, abs=0.08)
    assert float(audio["duration"]) == pytest.approx(9, abs=0.08)


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
    subtitle_ass = tmp_path / "render-work" / "editor-assets" / "subtitles.ass"
    assert subtitle_ass.is_file()
    assert "첫 번째 조각" in subtitle_ass.read_text(encoding="utf-8")


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_editor_document_v3_renders_at_authoritative_30fps(
    tmp_path: Path,
) -> None:
    timeline = tmp_path / "timeline-v3.mp4"
    _run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
        "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=16000",
        "-t", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(timeline),
    ])
    document = _document_v3_with_subtitle_layout(offset_y=-260, scale=1.5)
    settings = Settings(
        temp_dir=tmp_path / "temp-v3",
        ffmpeg_timeout_seconds=120,
        ffmpeg_threads=2,
        clean_clip_preset="ultrafast",
        clean_clip_crf=28,
    )
    renderer = EditorDocumentRenderer(settings)
    caption_spec = compile_caption_render_spec(
        [
            TranscriptWord(
                text="첫자막",
                start=1.05,
                end=1.5,
                provider="elevenlabs",
            ),
            TranscriptWord(
                text="둘째자막",
                start=4.05,
                end=4.5,
                provider="elevenlabs",
            ),
        ],
        template_id="pop",
        clip_start=0,
        clip_end=10,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        caption_placement="center",
    )
    clean = renderer.extract_sequence(
        timeline_path=timeline,
        output_path=tmp_path / "clean-v3.mp4",
        document=document,
        work_dir=tmp_path / "cut-work-v3",
    )
    output = renderer.render(
        clean_path=clean,
        output_path=tmp_path / "output-v3.mp4",
        document=document,
        work_dir=tmp_path / "render-work-v3",
        channel_thumbnail_path=None,
        caption_render_spec=caption_spec,
    )
    subtitle_ass = (
        tmp_path / "render-work-v3" / "editor-assets" / "subtitles.ass"
    ).read_text(encoding="utf-8")
    probe = json.loads(_run([
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(output),
    ]).stdout)
    video = next(
        stream for stream in probe["streams"] if stream["codec_type"] == "video"
    )

    assert (video["width"], video["height"]) == (1080, 1920)
    assert video["codec_name"] == "h264"
    assert video["avg_frame_rate"] == "30/1"
    assert float(probe["format"]["duration"]) == pytest.approx(3.5, abs=0.2)
    assert "Style: Default,Pretendard,72," in subtitle_ass
    assert r"\fs138.0" in subtitle_ass
    assert r"\pos(" in subtitle_ass
    assert "Noto Sans CJK KR" not in subtitle_ass
    assert (
        tmp_path / "render-work-v3" / "caption-fonts" / "Pretendard-Bold.ttf"
    ).is_file()


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_v5_custom_editor_rerender_keeps_video_caption_and_comment_geometry(
    tmp_path: Path,
) -> None:
    clean = tmp_path / "v5-clean.mp4"
    _run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=red:size=640x360:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=16000",
        "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(clean),
    ])
    document = _document_v3_with_v5_custom_template()
    renderer = EditorDocumentRenderer(Settings(
        temp_dir=tmp_path / "v5-temp",
        ffmpeg_timeout_seconds=120,
        ffmpeg_threads=2,
        clean_clip_preset="ultrafast",
        clean_clip_crf=28,
    ))
    output = renderer.render(
        clean_path=clean,
        output_path=tmp_path / "v5-output.mp4",
        document=document,
        work_dir=tmp_path / "v5-render-work",
        channel_thumbnail_path=None,
        caption_render_spec=_v5_custom_caption_spec(),
    )

    probe = json.loads(_run([
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(output),
    ]).stdout)
    video = next(
        stream for stream in probe["streams"] if stream["codec_type"] == "video"
    )
    assert (video["width"], video["height"]) == (1080, 1920)
    assert video["avg_frame_rate"] == "30/1"
    assert float(probe["format"]["duration"]) == pytest.approx(1, abs=0.12)
    assert output.stat().st_size > 10_000

    assets = tmp_path / "v5-render-work" / "editor-assets"
    subtitle_ass = (assets / "subtitles.ass").read_text(encoding="utf-8")
    assert "Paperlogy" in subtitle_ass
    assert r"\pos(540.0,250.0)" in subtitle_ass
    with Image.open(assets / "comment-layer-00.png") as comment_image:
        comment_box = comment_image.getchannel("A").getbbox()
    assert comment_box is not None
    assert comment_box[1] == 1120

    rendered_frame = tmp_path / "v5-frame.png"
    _run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", "0.2", "-i", str(output), "-frames:v", "1",
        str(rendered_frame),
    ])
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


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_general_v3_subtitles_render_as_highlight_ass(tmp_path: Path) -> None:
    timeline = tmp_path / "timeline-general-highlight.mp4"
    _run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
        "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=16000",
        "-t", "10", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(timeline),
    ])
    document = _document_v3_with_subtitle_layout(
        offset_y=120,
        scale=0.75,
        accent_color="#16A34A",
    )
    renderer = EditorDocumentRenderer(Settings(
        temp_dir=tmp_path / "temp-general-highlight",
        ffmpeg_timeout_seconds=120,
        ffmpeg_threads=2,
        clean_clip_preset="ultrafast",
        clean_clip_crf=28,
    ))
    clean = renderer.extract_sequence(
        timeline_path=timeline,
        output_path=tmp_path / "clean-general-highlight.mp4",
        document=document,
        work_dir=tmp_path / "cut-general-highlight",
    )
    output = renderer.render(
        clean_path=clean,
        output_path=tmp_path / "output-general-highlight.mp4",
        document=document,
        work_dir=tmp_path / "render-general-highlight",
        channel_thumbnail_path=None,
        caption_render_spec=None,
    )

    subtitle_ass = (
        tmp_path / "render-general-highlight" / "editor-assets" / "subtitles.ass"
    ).read_text(encoding="utf-8")
    assert output.stat().st_size > 10_000
    assert subtitle_ass.count("Dialogue: 0,") >= 2
    assert r"\pos(" in subtitle_ass
    assert r"\1c&H004AA316&" in subtitle_ass
    assert (
        tmp_path
        / "render-general-highlight"
        / "caption-fonts"
        / "Pretendard-Bold.ttf"
    ).is_file()
