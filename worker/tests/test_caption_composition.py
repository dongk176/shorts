import json
from copy import deepcopy
from pathlib import Path

import pytest
from PIL import Image, ImageChops

from shorts_worker.caption_composition import with_caption_comment_layout
from shorts_worker.caption_templates import caption_layout
from shorts_worker.editor_renderer import create_editor_channel_layer, create_editor_comment_layers
from shorts_worker.overlays import create_comment_panel
from shorts_worker.schemas import CommentOverlay, EditorDocument, VideoAspectRatio


def test_custom_template_comment_height_matches_browser_metadata_line(tmp_path):
    comment = CommentOverlay.model_validate({
        "id": "c", "text": "아 진짜 ㅋㅋㅋㅋㅋㅋㅋㅋ", "nickname": "소담기록24", "initial": "소",
        "ageLabel": "5개월 전", "likeCount": 1312, "avatarColor": "#8B2CC4",
        "startSeconds": 0, "endSeconds": 1,
    })
    path = create_comment_panel(comment, tmp_path / "custom.png", theme="light", size="large")
    with Image.open(path) as image:
        # Chrome measured 101.92px at a 360px canvas (305.77px at 1080).
        assert abs(image.height - 305.77) <= 2


@pytest.mark.parametrize("template,ratio,custom,schema", [
    ("dark-minimal", "16:9", None, 4),
    ("comment-capture", "4:5", None, 4),
    ("comment-capture", "9:16", None, 4),
    ("comment-capture", "16:9", {"title": {}}, 4),
    ("comment-capture", "16:9", None, 3),
])
def test_other_compositions_remain_unchanged(template, ratio, custom, schema):
    spec = {"schemaVersion": schema, "templateId": "basic",
            "layout": caption_layout(VideoAspectRatio.LANDSCAPE)}
    original = deepcopy(spec)
    result = with_caption_comment_layout(
        spec, template_id=template, video_aspect_ratio=ratio, custom_template=custom,
    )
    assert result == original
    assert spec == original


@pytest.mark.parametrize("ratio", ["16:9", "5:4", "1:1"])
def test_new_comment_layout_keeps_video_and_subtitles_and_does_not_mutate_old_spec(ratio):
    spec = {"schemaVersion": 4, "templateId": "basic",
            "layout": caption_layout(VideoAspectRatio(ratio))}
    original = deepcopy(spec)
    result = with_caption_comment_layout(
        spec, template_id="comment-capture", video_aspect_ratio=ratio,
    )
    assert spec == original
    assert result["layout"]["video"] == original["layout"]["video"]
    assert result["layout"]["caption"] == original["layout"]["caption"]
    assert result["layout"]["comment"]["y"] >= (
        result["layout"]["caption"]["y"] + result["layout"]["caption"]["height"]
    )
    assert result["layout"]["comment"]["y"] >= (
        result["layout"]["video"]["y"] + result["layout"]["video"]["height"]
    )


def test_saved_layout_retains_manual_movement_and_channel_visibility(tmp_path):
    fixture = Path(__file__).parents[2] / "test-fixtures/editor-document-v3.json"
    value = json.loads(fixture.read_text())
    value["template"]["id"] = "comment-capture"
    value["overlays"]["visible"].update(channel=True, comment=True)
    value["comments"] = [{
        "id": "c1", "text": "An intact comment", "nickname": "Viewer", "initial": "V",
        "ageLabel": "1 day ago", "likeCount": 20, "avatarColor": "#2674C8",
        "startSeconds": 0, "endSeconds": 1,
    }]
    value["renderSpec"]["comments"] = [
        {"id": "c1", "offsetY": 0, "startFrame": 0, "endFrame": 30},
    ]
    spec = with_caption_comment_layout(
        {"schemaVersion": 4, "templateId": "basic",
         "layout": caption_layout(VideoAspectRatio.LANDSCAPE)},
        template_id="comment-capture", video_aspect_ratio="16:9",
    )
    document = EditorDocument.model_validate(value)
    normal = create_editor_channel_layer(document, tmp_path / "channel.png", None, spec)
    with Image.open(normal) as image:
        normal_bounds = image.getbbox()
    value["overlays"]["offsets"]["channel"] = {"x": 80, "y": -100}
    value["overlays"]["offsets"]["comment"]["y"] = 1000
    value["renderSpec"]["channel"].update(offsetX=80, offsetY=-100)
    value["renderSpec"]["comments"][0]["offsetY"] = 1000
    moved_document = EditorDocument.model_validate(value)
    moved = create_editor_channel_layer(moved_document, tmp_path / "moved.png", None, spec)
    with Image.open(moved) as image:
        moved_bounds = image.getbbox()
    assert moved_bounds == (normal_bounds[0] + 80, normal_bounds[1] - 100,
                            normal_bounds[2] + 80, normal_bounds[3] - 100)
    comment = create_editor_comment_layers(moved_document, tmp_path, spec)[0].path
    with Image.open(comment) as image:
        bounds = image.getbbox()
    assert bounds[3] == 1920
    assert bounds[3] - bounds[1] == spec["layout"]["comment"]["height"]
    value["overlays"]["visible"]["channel"] = False
    hidden = create_editor_channel_layer(
        EditorDocument.model_validate(value), tmp_path / "hidden.png", None, spec,
    )
    with Image.open(hidden) as image:
        assert image.getbbox() is None


@pytest.mark.parametrize("language,text", [
    ("ko", "댓글의 색상을 바꿔도 글자와 아이콘 크기는 그대로 유지됩니다."),
    ("en", "Changing a comment color keeps its text and icons in exactly the same position."),
    ("ja", "コメントの色を変えても文字とアイコンのサイズや位置はそのままです。"),
])
def test_caption_comment_color_keeps_geometry_and_reselecting_dark_is_identical(
    tmp_path, language, text,
):
    fixture = Path(__file__).parents[2] / "test-fixtures/editor-document-v3.json"
    value = json.loads(fixture.read_text())
    value["template"]["id"] = "comment-capture"
    value["overlays"]["visible"]["comment"] = True
    value["comments"] = [{
        "id": "c1", "text": text, "nickname": "Viewer", "initial": "V",
        "ageLabel": "1 day ago", "likeCount": 20, "avatarColor": "#2674C8",
        "startSeconds": 0, "endSeconds": 1,
    }]
    value["renderSpec"]["comments"] = [
        {"id": "c1", "offsetY": 0, "startFrame": 0, "endFrame": 30},
    ]
    spec = with_caption_comment_layout(
        {"schemaVersion": 4, "templateId": "basic",
         "layout": caption_layout(VideoAspectRatio.LANDSCAPE)},
        template_id="comment-capture", video_aspect_ratio="16:9",
    )
    images = []
    for theme in (None, "dark", "light", "dark"):
        value["overlays"]["commentTheme"] = theme
        create_editor_comment_layers(
            EditorDocument.model_validate(value), tmp_path, spec, output_language=language,
        )
        with Image.open(tmp_path / "comment-panel-00.png") as image:
            images.append(image.copy())
    default, dark, light, restored = images
    assert all(image.size == (1080, 285) for image in images)
    assert default.tobytes() == dark.tobytes() == restored.tobytes()
    # Compare rendered ink bounds, allowing one antialiasing pixel when the
    # contrast reverses. A theme must not switch to larger fonts or avatars.
    details_box = (145, 98, 1036, 285)
    dark_ink = dark.crop(details_box).convert("L").point(lambda px: 255 if px > 128 else 0)
    light_ink = light.crop(details_box).convert("L").point(lambda px: 255 if px < 180 else 0)
    assert all(abs(a - b) <= 1 for a, b in zip(
        dark_ink.getbbox(), light_ink.getbbox(), strict=True,
    ))
    avatar_masks = [
        ImageChops.subtract(image.getchannel("B"), image.getchannel("R"))
        .crop((0, 0, 140, 145)).point(lambda px: 255 if px > 60 else 0)
        for image in (dark, light)
    ]
    assert all(abs(a - b) <= 1 for a, b in zip(
        avatar_masks[0].getbbox(), avatar_masks[1].getbbox(), strict=True,
    ))
    assert dark.getpixel((0, 0)) == (4, 4, 4, 244)
    assert light.getpixel((0, 0)) == (255, 255, 255, 255)
    assert dark.convert("RGB").tobytes() != light.convert("RGB").tobytes()
