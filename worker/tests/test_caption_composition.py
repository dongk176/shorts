import json
from copy import deepcopy
from pathlib import Path

import pytest
from PIL import Image

from shorts_worker.caption_composition import with_caption_comment_layout
from shorts_worker.caption_templates import caption_layout
from shorts_worker.editor_renderer import create_editor_channel_layer, create_editor_comment_layers
from shorts_worker.schemas import EditorDocument, VideoAspectRatio


@pytest.mark.parametrize("template,ratio,custom,schema", [
    ("dark-minimal", "16:9", None, 4),
    ("comment-capture", "1:1", None, 4),
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


def test_new_comment_layout_keeps_video_and_subtitles_and_does_not_mutate_old_spec():
    spec = {"schemaVersion": 4, "templateId": "basic",
            "layout": caption_layout(VideoAspectRatio.LANDSCAPE)}
    original = deepcopy(spec)
    result = with_caption_comment_layout(
        spec, template_id="comment-capture", video_aspect_ratio="16:9",
    )
    assert spec == original
    assert result["layout"]["video"] == original["layout"]["video"]
    assert result["layout"]["caption"] == original["layout"]["caption"]
    assert result["layout"]["comment"]["y"] >= (
        result["layout"]["caption"]["y"] + result["layout"]["caption"]["height"]
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
