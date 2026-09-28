import json
from pathlib import Path

import pytest
from PIL import Image

from shorts_worker.editor_renderer import create_editor_channel_layer
from shorts_worker.preset_channel_position import (
    preset_channel_center_y,
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
