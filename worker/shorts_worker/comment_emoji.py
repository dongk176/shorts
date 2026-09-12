"""Bundled color emoji for comment cards, using identical sizing for wrap and paint."""

from __future__ import annotations

import hashlib
import json
import unicodedata
from functools import lru_cache
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

DIRECTORY = Path(__file__).parent / "assets" / "emoji"


@lru_cache(maxsize=1)
def _font() -> ImageFont.FreeTypeFont:
    path = DIRECTORY / "NotoColorEmoji.ttf"
    manifest = json.loads((DIRECTORY / "manifest.json").read_text())
    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["files"][path.name]["sha256"]:
        raise ValueError("Bundled emoji font identity mismatch")
    return ImageFont.truetype(str(path), size=109)


@lru_cache(maxsize=1)
def _characters() -> frozenset[int]:
    _font()
    with TTFont(str(DIRECTORY / "NotoColorEmoji.ttf")) as font:
        return frozenset(font.getBestCmap() or {})


def display_units(text: str) -> list[str]:
    units: list[str] = []
    for char in text:
        code = ord(char)
        regional_pair = (0x1F1E6 <= code <= 0x1F1FF and bool(units)
                         and len(units[-1]) == 1 and 0x1F1E6 <= ord(units[-1]) <= 0x1F1FF)
        if units and (unicodedata.category(char) in {"Mn", "Mc", "Me"} or char == "\u200d"
                      or units[-1].endswith("\u200d") or 0xFE00 <= code <= 0xFE0F
                      or 0x1F3FB <= code <= 0x1F3FF or 0xE0020 <= code <= 0xE007F
                      or regional_pair):
            units[-1] += char
        else:
            units.append(char)
    return units


def _is_emoji(unit: str) -> bool:
    # ASCII digits and punctuation remain text unless part of an emoji sequence.
    return any((ord(c) >= 0x2300 or "\ufe0f" in unit or "\u20e3" in unit)
               and ord(c) in _characters() for c in unit)


def _runs(text: str) -> list[tuple[str, bool]]:
    runs: list[tuple[str, bool]] = []
    for unit in display_units(text):
        emoji = _is_emoji(unit)
        if not emoji and runs and not runs[-1][1]:
            runs[-1] = (runs[-1][0] + unit, False)
        else:
            runs.append((unit, emoji))
    return runs


def comment_text_width(text: str, font: ImageFont.FreeTypeFont) -> float:
    runs = _runs(text)
    if not any(emoji for _, emoji in runs):
        box = font.getbbox(text)
        return box[2] - box[0]
    return sum(font.size * 1.15 if emoji else font.getlength(run) for run, emoji in runs)


@lru_cache(maxsize=256)
def _stamp(text: str, size: int) -> Image.Image:
    font = _font()
    width = max(1, round(font.getlength(text)))
    image = Image.new("RGBA", (width, 128))
    ImageDraw.Draw(image).text((0, 0), text, font=font, embedded_color=True)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def draw_comment_text(
    image: Image.Image, xy: tuple[float, float], text: str,
    *, font: ImageFont.FreeTypeFont, fill: str,
) -> None:
    draw = ImageDraw.Draw(image)
    runs = _runs(text)
    if not any(emoji for _, emoji in runs):
        draw.text(xy, text, font=font, fill=fill)
        return
    x, y = xy
    for run, emoji in runs:
        if emoji:
            size = round(font.size * 1.15)
            stamp = _stamp(run, size)
            top = round(y + font.getmetrics()[0] - size * 0.9)
            image.paste(stamp, (round(x), top), stamp)
            x += font.size * 1.15
        else:
            draw.text((x, y), run, font=font, fill=fill)
            x += font.getlength(run)
