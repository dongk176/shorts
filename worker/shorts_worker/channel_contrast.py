"""Automatic channel glyph contrast; mirrored by web/lib/channel-contrast.ts."""

from __future__ import annotations


def channel_contrast_color(color: str) -> str:
    rgb = color.lstrip("#")
    values = [int(rgb[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in values]
    luminance = sum(c * weight for c, weight in zip(linear, (0.2126, 0.7152, 0.0722), strict=True))
    return "#000000" if luminance > 0.179 else "#FFFFFF"


def channel_overlaps_video(
    video: tuple[float, float, float, float] | None,
    x: float,
    y: float,
    width: float,
    font_size: float,
    background: str | None = None,
) -> bool:
    if video is None or background:
        return False
    vx, vy, vw, vh = video
    height = font_size * 1.5
    return min(x + width / 2, vx + vw, 1080) > max(x - width / 2, vx, 0) and min(
        y + height / 2, vy + vh, 1920
    ) > max(y - height / 2, vy, 0)


def channel_stroke(enabled: bool, color: str) -> dict:
    return {"stroke_width": 3, "stroke_fill": channel_contrast_color(color)} if enabled else {}
