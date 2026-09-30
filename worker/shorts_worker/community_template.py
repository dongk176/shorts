"""Community layout; SNS owns copy, media, fonts, and the editor pipeline."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageOps

from .overlays import contrasting_title_text_color
from .sns_template import SnsLayout, draw_text, fit_text, font, text_width

COMMUNITY_RELEASE_ID = "a7db3266-7fc0-4175-a818-39aaff712ad3"
COMMUNITY_EDITOR_RELEASE_ID = "601d3d10-62b9-47f2-a34e-78b53ab1ec99"
FRAMES = {
    "16:9": (60, 690, 960, 540), "5:4": (60, 690, 960, 768),
    "1:1": (60, 690, 960, 960), "4:5": (80, 690, 920, 1150),
    "9:16": (216, 690, 648, 1152),
}


def community_layout(ratio: str) -> SnsLayout:
    return SnsLayout(ratio, FRAMES[ratio], (0, 0, 1080, 1920), 60, 960, 1, False, 0)


def create_community_overlay(
    path: Path, *, ratio: str, content: dict[str, Any], language: str,
    brand_color: str, channel: str, avatar: Path | None = None,
) -> SnsLayout:
    layout = community_layout(ratio)
    image = Image.new("RGBA", (1080, 1920), "white")
    draw = ImageDraw.Draw(image)
    color = brand_color if re.fullmatch(r"#[a-fA-F0-9]{6}", brand_color) else "#303e78"
    # Full bleed at the top. All text positions stay fixed across video ratios.
    draw.rectangle((0, 0, 1079, 269), fill=color)
    heading = {"ko": "커뮤니티", "en": "Community", "ja": "コミュニティ"}[language]
    face = font(96, language)
    draw_text(draw, ((1080 - text_width(heading, face, -3)) / 2, 156),
              heading, face, contrasting_title_text_color(color), -3)
    label = {"ko": "실시간 베스트", "en": "Trending now", "ja": "話題の投稿"}[language]
    draw_text(draw, (60, 305), label, font(42, language), "#303e78")
    draw.line((0, 375, 1079, 375), fill="#303e78", width=3)
    draw_text(draw, (60, 411), fit_text(content["title"], font(58, language), 960, -1.5),
              font(58, language), "#111111", -1.5)
    draw.ellipse((60, 502, 124, 566), fill="#eeeeee")
    if avatar and avatar.is_file():
        with Image.open(avatar) as original:
            thumb = ImageOps.fit(original.convert("RGBA"), (64, 64))
        mask = Image.new("L", (64, 64))
        ImageDraw.Draw(mask).ellipse((0, 0, 63, 63), fill=255)
        image.paste(thumb, (60, 502), mask)
    else:
        draw_text(draw, (78, 516), (channel or "C")[0], font(30, language), "#333333")
    draw_text(draw, (144, 516), fit_text(channel, font(36, language), 876),
              font(36, language), "#444444")
    body = (content.get("body") or [""])[0]
    draw_text(draw, (60, 605), fit_text(body, font(46, language, 600), 960, -1),
              font(46, language, 600), "#222222", -1)
    x, y, width, height = layout.video
    draw.rectangle((x, y, x + width - 1, y + height - 1), fill=(0, 0, 0, 0))
    image.save(path)
    return layout
