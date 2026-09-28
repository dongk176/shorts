import json
from copy import deepcopy
from pathlib import Path

import pytest
from PIL import Image

from shorts_worker.editor_renderer import create_editor_channel_layer
from shorts_worker.preset_channel_position import (
    preset_channel_center_y,
    with_preset_channel_position,
)
from shorts_worker.schemas import EditorDocument

CASES = [("16:9", 1400, 1464), ("5:4", 1520, 1752), ("1:1", 1620, 1824),
         ("4:5", 1520, 1840), ("9:16", 1520, 1840)]
FIXTURE = Path(__file__).resolve().parents[2] / "test-fixtures/editor-document-v3.json"


@pytest.mark.parametrize("ratio,general,comment", CASES)
@pytest.mark.parametrize("template", [
    "dark-red", "dark-minimal", "paper", "white-yellow", "comment-capture",
])
def test_channel_pixels_only_translate_and_saved_edits_keep_the_same_origin(
    tmp_path, ratio, general, comment, template,
):
    old_center = 1840 if template == "comment-capture" else 1580
    new_center = comment if template == "comment-capture" else general
    assert preset_channel_center_y(template, ratio, 3) == old_center
    assert preset_channel_center_y(template, ratio, 4) == new_center
    value = json.loads(FIXTURE.read_text())
    value["template"] = {"id": template, "customTemplateId": None,
                         "presetVersion": 3, "snapshot": {"presetVersion": 3}}
    value["video"]["aspectRatio"] = ratio
    value["overlays"]["offsets"]["channel"] = {"x": 0, "y": 0}
    value["renderSpec"]["channel"].update(offsetX=0, offsetY=0)
    images = []
    for version, offset in [(3, 0), (4, 0), (4, -30)]:
        value["template"].update(presetVersion=version, snapshot={"presetVersion": version})
        value["overlays"]["offsets"]["channel"]["y"] = offset
        value["renderSpec"]["channel"]["offsetY"] = offset
        document = EditorDocument.model_validate_json(json.dumps(value))
        path = create_editor_channel_layer(document, tmp_path / f"{version}-{offset}.png", None)
        with Image.open(path).convert("RGBA") as image:
            bounds = image.getbbox()
            images.append((bounds, image.crop(bounds).tobytes()))
    old, new, moved = images
    assert new[0][0::2] == old[0][0::2]  # x and width remain identical
    assert new[0][1] - old[0][1] == new_center - old_center
    assert new[0][3] - old[0][3] == new_center - old_center
    assert old[1] == new[1] == moved[1]  # fonts, avatar and all row pixels unchanged
    assert moved[0][1] - new[0][1] == -30


def test_saved_caption_layout_changes_only_channel_and_preserves_custom_templates():
    spec = {"layout": {"channel": {"x": 0, "y": 1710, "width": 1080, "height": 160},
                       "caption": {"x": 120, "y": 1088, "width": 840, "height": 140}}}
    original = deepcopy(spec)
    item = {"template_id": "dark-red", "video_aspect_ratio": "16:9",
            "template_snapshot": {"presetVersion": 4}}
    result = with_preset_channel_position(spec, item)
    assert spec == original
    assert result["layout"]["channel"]["y"] == 1320
    result["layout"]["channel"]["y"] = original["layout"]["channel"]["y"]
    assert result == original
    for snapshot in [{"presetVersion": 3}, {"presetVersion": 4, "config": {}}]:
        assert with_preset_channel_position(spec, {**item, "template_snapshot": snapshot}) is spec


def test_translated_comment_keeps_saved_card_and_channel_below_it():
    spec = {"layout": {"channel": {"x": 0, "y": 1760, "width": 1080, "height": 160},
                       "comment": {"x": 0, "y": 1491, "width": 1080, "height": 285}}}
    result = with_preset_channel_position(spec, {"template_id": "comment-capture",
        "video_aspect_ratio": "16:9", "template_snapshot": {"presetVersion": 4}})
    assert result["layout"]["comment"] == spec["layout"]["comment"]
    assert result["layout"]["channel"]["y"] + 80 - 27 >= 1491 + 285 + 16
