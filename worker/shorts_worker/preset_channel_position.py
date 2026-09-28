"""Channel-only preset revision; old projects keep their saved render origin."""

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
