"""Channel-only preset revision; old projects keep their saved render origin."""

from copy import deepcopy

from .caption_composition import caption_composition_rect

GENERAL_CENTERS = {"16:9": 1400, "5:4": 1520, "1:1": 1620, "4:5": 1520, "9:16": 1520}
COMMENT_CENTERS = {"16:9": 1464, "5:4": 1752, "1:1": 1824, "4:5": 1840, "9:16": 1840}


def preset_channel_center_y(template_id: str, ratio: str, preset_version: int = 3) -> int:
    if preset_version < 4:
        return 1840 if template_id == "comment-capture" else 1580
    return (COMMENT_CENTERS if template_id == "comment-capture" else GENERAL_CENTERS)[ratio]


def preset_version(item: dict[str, object]) -> int:
    snapshot = item.get("template_snapshot")
    value = snapshot.get("presetVersion") if isinstance(snapshot, dict) else None
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def with_preset_channel_position(
    spec: dict[str, object] | None, item: dict[str, object],
) -> dict[str, object] | None:
    """Persist only the channel rectangle; comments/captions never move with it."""
    snapshot = item.get("template_snapshot")
    if (preset_version(item) < 4 or not isinstance(snapshot, dict)
            or isinstance(snapshot.get("config"), dict)):
        return spec
    rect = caption_composition_rect(spec, "channel")
    if rect is None:
        return spec
    template = str(item["template_id"])
    center = preset_channel_center_y(template, str(item.get("video_aspect_ratio") or "1:1"), 4)
    comment = caption_composition_rect(spec, "comment")
    caption = caption_composition_rect(spec, "caption")
    if comment is not None:
        # Translated comments have separately saved cards; keep the row below them.
        center = max(center, comment["y"] + comment["height"] + 16 + 27)
    elif caption is not None:
        center = max(center, caption["y"] + caption["height"] + 72 + 32)
    result = deepcopy(spec)
    result["layout"]["channel"] = {**rect, "y": center - rect["height"] / 2}
    return result
