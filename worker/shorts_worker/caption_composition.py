"""Saved composition bounds, shared by first rendering and subsequent edits."""
from copy import deepcopy


def caption_composition_rect(
    spec: dict[str, object] | None, name: str,
) -> dict[str, float] | None:
    layout = spec.get("layout") if isinstance(spec, dict) else None
    rect = layout.get(name) if isinstance(layout, dict) else None
    if not isinstance(rect, dict):
        return None
    if not all(isinstance(rect.get(key), int | float) for key in ("x", "y", "width", "height")):
        return None
    return rect


def with_caption_comment_layout(
    spec: dict[str, object], *, template_id: str, video_aspect_ratio: str,
    custom_template: object | None = None,
) -> dict[str, object]:
    """Reserve a complete comment card above the persistent channel row.

    Store the extra rectangle only on newly compiled translated landscape
    presets. Old projects keep their saved layout and pinned renderer.
    """
    if (template_id != "comment-capture" or video_aspect_ratio != "16:9"
            or custom_template is not None or spec.get("templateId") != "basic"
            or spec.get("schemaVersion") != 4):
        return spec
    result = deepcopy(spec)
    layout = result["layout"]
    layout["channel"] = {"x": 0, "y": 1760, "width": 1080, "height": 160}
    # 285px card, 24px gap, then the 80px channel row centered at 1840.
    layout["comment"] = {"x": 0, "y": 1491, "width": 1080, "height": 285}
    return result
