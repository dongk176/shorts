import json
from pathlib import Path

import pytest
from PIL import Image

from shorts_worker.channel_contrast import channel_contrast_color, channel_overlaps_video
from shorts_worker.overlays import _draw_custom_channel
from shorts_worker.schemas import TemplateTextLayer

CASES = json.loads((Path(__file__).parents[2] / "test-fixtures/channel-contrast.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda item: item["name"])
def test_shared_geometry(case):
    active = channel_overlaps_video(tuple(case["video"]), *case["channel"], case["background"])
    assert active == case["active"]
    if case["active"]:
        assert channel_contrast_color(case["color"]) == case["stroke"]


@pytest.mark.parametrize("color,stroke", [("#FFFFFF", (0, 0, 0)), ("#111111", (255, 255, 255))])
def test_actual_channel_pixels_have_contrasting_edges(color, stroke):
    layer = TemplateTextLayer.model_validate({"visible": True, "x": 540, "y": 100,
        "fontSize": 48, "maxWidth": 800, "color": color, "backgroundColor": None})
    images = []
    for enabled in [False, True]:
        image = Image.new("RGBA", (1080, 200))
        _draw_custom_channel(image, channel_name="EasyCut Test", layer=layer,
                             center_y=100, channel_thumbnail_path=None, protect_contrast=enabled)
        images.append(image)
    # Inspect only added opaque edge pixels, not the avatar or existing glyphs.
    edges = [b for a, b in zip(images[0].getdata(), images[1].getdata(), strict=True)
             if a[3] == 0 and b[3] == 255 and b[:3] == stroke]
    assert len(edges) > 100
