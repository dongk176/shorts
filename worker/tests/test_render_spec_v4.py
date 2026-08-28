from __future__ import annotations

from copy import deepcopy

import pytest
from PIL import Image

from shorts_worker.editor_release_probe import _document
from shorts_worker.render_spec_v4 import (
    compile_editor_title_spec_v4,
    compile_initial_editor_render_spec_v4,
    draw_editor_title_spec_v4,
)
from shorts_worker.schemas import (
    EditorDocument,
    EditorRenderSpec,
    EditorRenderTitleSpec,
    TitleTextStyle,
)


def test_initial_render_spec_v4_is_complete_without_synthetic_subtitles() -> None:
    value = compile_initial_editor_render_spec_v4(
        title="정확한 최초 렌더",
        template_id="dark-red",
        video_aspect_ratio="16:9",
        font_scale=1,
    )

    parsed = EditorRenderSpec.model_validate(value)
    assert parsed.version == 4
    assert parsed.subtitles is None
    assert parsed.title.line_boxes
    assert parsed.channel.visible is True
    assert parsed.layer_order == ["video", "title", "comment", "channel"]


def test_initial_render_spec_v4_uses_canonical_unified_layout_and_hides_empty_channel() -> None:
    config = {
        "schemaVersion": 5,
        "background": {"kind": "color", "color": "#000000"},
        "video": {
            "aspectRatio": "16:9",
            "x": 0,
            "y": 432,
            "width": 1080,
            "height": 608,
            "fit": "cover",
        },
        "title": {
            "visible": True,
            "x": 540,
            "y": 295,
            "maxWidth": 920,
            "fontSize": 84,
            "fontId": "pretendard",
            "primaryColor": "#FFFFFF",
            "accentColor": "#35E6E3",
            "primaryBackgroundColor": None,
            "accentBackgroundColor": None,
        },
        "subtitle": {
            "visible": True,
            "variant": "pop",
            "x": 540,
            "y": 1158,
            "maxWidth": 840,
            "fontSize": 92,
            "fontId": "pretendard",
            "color": "#FFFFFF",
            "accentColor": "#35E6E3",
        },
        "channel": {
            "visible": True,
            "x": 540,
            "y": 1790,
            "maxWidth": 800,
            "fontSize": 48,
            "color": "#FFFFFF",
            "backgroundColor": None,
        },
        "comment": {
            "visible": False,
            "theme": "dark",
            "size": "medium",
            "y": 1040,
            "dockedToVideo": True,
        },
    }
    value = compile_initial_editor_render_spec_v4(
        title="정확한 팝형 제목",
        template_id="dark-minimal",
        video_aspect_ratio="16:9",
        font_scale=1,
        custom_template_config=config,
        channel_visible=False,
    )

    parsed = EditorRenderSpec.model_validate(value)
    assert parsed.title.center_y == 295
    assert parsed.channel.visible is False


def test_comment_capture_full_vertical_uses_default_size_and_portrait_panel() -> None:
    value = compile_editor_title_spec_v4(
        title="짧은 제목",
        template_id="comment-capture",
        video_aspect_ratio="9:16",
        font_id="pretendard",
        font_scale=1,
    )

    assert value["fontSize"] == 84
    assert value["centerY"] < 285
    assert all(box["centerY"] < 285 for box in value["lineBoxes"])


def test_title_line_boxes_use_the_deterministic_configured_em_box() -> None:
    value = compile_editor_title_spec_v4(
        title="아주 긴 한글 후킹 제목도\n미리보기와 똑같이 줄어듭니다",
        template_id="dark-red",
        video_aspect_ratio="16:9",
        font_id="gmarket-sans",
        font_scale=1,
    )

    expected_height = value["fontSize"] + value["linePaddingY"] * 2
    assert all(box["height"] == expected_height for box in value["lineBoxes"])


def test_title_draw_honors_authoritative_stored_advance_width() -> None:
    title = "Stored width"
    value = compile_editor_title_spec_v4(
        title=title,
        template_id="dark-red",
        video_aspect_ratio="16:9",
        font_id="paperlogy",
        font_scale=1,
    )
    original_spec = EditorRenderTitleSpec.model_validate(value)
    original_image = draw_editor_title_spec_v4(
        title_spec=original_spec,
        source_title=title,
        title_text_styles=[],
        primary_color="#FFFFFF",
        accent_color="#35E6E3",
    )
    original_alpha_box = original_image.getchannel("A").getbbox()
    assert original_alpha_box is not None
    original_rendered_width = original_alpha_box[2] - original_alpha_box[0]

    box = value["lineBoxes"][0]
    original_advance = float(box["width"]) - float(value["linePaddingX"]) * 2
    box["width"] = float(box["width"]) + 120
    value["lineBoxes"][0] = box
    spec = EditorRenderTitleSpec.model_validate(value)

    image = draw_editor_title_spec_v4(
        title_spec=spec,
        source_title=title,
        title_text_styles=[],
        primary_color="#FFFFFF",
        accent_color="#35E6E3",
    )
    alpha_box = image.getchannel("A").getbbox()
    assert alpha_box is not None
    rendered_width = alpha_box[2] - alpha_box[0]
    target_advance = float(box["width"]) - float(value["linePaddingX"]) * 2
    expected_ink_width = original_rendered_width * target_advance / original_advance
    assert abs(rendered_width - expected_ink_width) <= 2


def test_title_background_uses_its_final_stored_rectangle() -> None:
    title = "배경 너비"
    value = compile_editor_title_spec_v4(
        title=title,
        template_id="dark-red",
        video_aspect_ratio="16:9",
        font_id="pretendard",
        font_scale=1,
        title_text_styles=[
            TitleTextStyle(start=0, end=len(title), background_color="#FF715E")
        ],
    )
    background_width = value["lineBoxes"][0]["backgroundRuns"][0]["width"]
    value["lineBoxes"][0]["width"] += 90
    spec = EditorRenderTitleSpec.model_validate(value)

    image = draw_editor_title_spec_v4(
        title_spec=spec,
        source_title=title,
        title_text_styles=[
            TitleTextStyle(start=0, end=len(title), background_color="#FF715E")
        ],
        primary_color="#FFFFFF",
        accent_color="#35E6E3",
    )
    background_mask = Image.new("1", image.size)
    background_mask.putdata([
        1 if pixel == (255, 113, 94, 255) else 0
        for pixel in image.getdata()
    ])
    background_box = background_mask.getbbox()
    assert background_box is not None
    rendered_background_width = background_box[2] - background_box[0]
    assert abs(rendered_background_width - background_width) <= 2
    assert abs(rendered_background_width - value["lineBoxes"][0]["width"]) > 2
    assert isinstance(image, Image.Image)


def test_render_spec_v4_rejects_title_background_without_final_geometry() -> None:
    value = _document("baseline").render_spec.model_dump(by_alias=True)
    text = value["title"]["lineBoxes"][0]["text"]
    value["title"]["lineBoxes"][0]["backgroundRuns"] = [{
        "start": 0,
        "end": min(1, len(text)),
        "color": "#FF715E",
    }]

    with pytest.raises(ValueError, match="background geometry is missing"):
        EditorRenderSpec.model_validate(value)


def test_editor_document_rejects_v4_boxes_for_another_source_title() -> None:
    value = _document("baseline").model_dump(by_alias=True)
    stale = deepcopy(value)
    stale["title"]["text"] = "완전히 다른 제목"

    with pytest.raises(ValueError, match="source title"):
        EditorDocument.model_validate(stale)
