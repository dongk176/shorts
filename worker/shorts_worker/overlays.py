from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .schemas import SubtitleSegment, TemplateId

PANEL_WIDTH = 1080
PANEL_HEIGHT = 420
TITLE_BOTTOM_MARGIN = 44
TITLE_LINE_GAP = 18
TITLE_ACCENT_PADDING_X = 24
TITLE_ACCENT_PADDING_Y = 10
CHANNEL_TOP_MARGIN = 48


@dataclass(frozen=True, slots=True)
class TemplateStyle:
    background: str
    primary: str
    accent: str
    accent_background: str | None
    channel: str


TEMPLATE_STYLES = {
    TemplateId.DARK_RED: TemplateStyle("#000000", "#FFFFFF", "#FFFFFF", "#E32626", "#FFFFFF"),
    TemplateId.WHITE_YELLOW: TemplateStyle("#FFFFFF", "#111111", "#111111", "#FFD84D", "#111111"),
    TemplateId.DARK_MINIMAL: TemplateStyle("#000000", "#FFFFFF", "#F04444", None, "#FFFFFF"),
    TemplateId.PAPER: TemplateStyle("#F3F0E9", "#111111", "#D52B2B", None, "#363636"),
}


FONT_CANDIDATES = {
    "bold": (
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Bold.otf",
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ),
    "regular": (
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf",
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ),
}


def find_font(kind: str = "bold") -> str:
    env_path = os.getenv("KOREAN_FONT_PATH")
    if env_path and Path(env_path).is_file():
        return env_path
    for candidate in FONT_CANDIDATES[kind]:
        if Path(candidate).is_file():
            return candidate
    raise RuntimeError("한글을 표시할 수 있는 폰트를 찾지 못했습니다.")


def load_font(size: int, kind: str = "bold") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(find_font(kind), size=size)


def wrap_korean_title(title: str, max_chars: int = 20, max_lines: int = 2) -> list[str]:
    """Greedy Korean-safe wrapping that prefers spaces but can split long Korean words."""
    manual_lines = [" ".join(line.split()) for line in title.splitlines() if line.strip()]
    if len(manual_lines) > 1:
        return manual_lines[:max_lines]
    clean = " ".join(title.replace("\n", " ").split())[:40]
    if not clean:
        return ["핵심 장면"]
    if len(clean) > max_chars:
        balanced = [
            (clean[:index].strip(), clean[index + 1 :].strip())
            for index, char in enumerate(clean)
            if char == " "
            and clean[:index].strip()
            and clean[index + 1 :].strip()
            and len(clean[:index].strip()) <= max_chars
            and len(clean[index + 1 :].strip()) <= max_chars
        ]
        if balanced:
            return list(min(balanced, key=lambda pair: abs(len(pair[0]) - len(pair[1]))))
    lines: list[str] = []
    remaining = clean
    while remaining and len(lines) < max_lines:
        if len(remaining) <= max_chars:
            lines.append(remaining)
            remaining = ""
            break
        window = remaining[: max_chars + 1]
        split_at = window.rfind(" ", max_chars // 2, max_chars + 1)
        if split_at < 1:
            split_at = max_chars
        lines.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].strip()
    if remaining:
        last = lines[-1]
        lines[-1] = (last[: max(1, max_chars - 1)].rstrip() + "…")
    return lines


def wrap_caption(text: str, max_chars: int = 22) -> list[str]:
    clean = " ".join(text.split())
    if not clean:
        return []
    lines: list[str] = []
    remaining = clean
    while remaining and len(lines) < 2:
        if len(remaining) <= max_chars:
            lines.append(remaining)
            break
        window = remaining[: max_chars + 1]
        split_at = window.rfind(" ", max_chars // 2, max_chars + 1)
        if split_at < 1:
            split_at = max_chars
        lines.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].strip()
    if remaining and len(lines) == 2:
        lines[-1] = lines[-1][: max_chars - 1].rstrip() + "…"
    return lines


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def _title_font(draw: ImageDraw.ImageDraw, lines: list[str]) -> ImageFont.FreeTypeFont:
    for size in range(84, 21, -2):
        font = load_font(size, "bold")
        if max(_text_width(draw, line, font) for line in lines) <= 930:
            return font
    return load_font(22, "bold")


def create_title_panel(
    title: str,
    template_id: TemplateId,
    output_path: Path,
    *,
    text_color: str | None = None,
    font_size: int | None = None,
    font_scale: float = 1.0,
) -> Path:
    style = TEMPLATE_STYLES[template_id]
    image = Image.new("RGB", (PANEL_WIDTH, PANEL_HEIGHT), style.background)
    draw = ImageDraw.Draw(image)
    lines = wrap_korean_title(title)
    if font_size:
        font = load_font(font_size, "bold")
    else:
        fitted_font = _title_font(draw, lines)
        scaled_size = max(18, min(100, round(fitted_font.size * font_scale)))
        font = load_font(scaled_size, "bold")
    line_metrics: list[tuple[str, tuple[int, int, int, int], int, int, int]] = []
    for index, line in enumerate(lines):
        box = draw.textbbox((0, 0), line, font=font)
        width = box[2] - box[0]
        height = box[3] - box[1]
        accent_padding_y = (
            TITLE_ACCENT_PADDING_Y
            if index == 1 and style.accent_background
            else 0
        )
        line_metrics.append((line, box, width, height, accent_padding_y))

    total_height = sum(height + padding_y * 2 for _, _, _, height, padding_y in line_metrics)
    total_height += TITLE_LINE_GAP * max(0, len(line_metrics) - 1)
    row_y = PANEL_HEIGHT - TITLE_BOTTOM_MARGIN - total_height

    for index, (line, box, width, height, accent_padding_y) in enumerate(line_metrics):
        color = text_color or (style.primary if index == 0 else style.accent)
        visible_x = (PANEL_WIDTH - width) // 2
        visible_y = row_y + accent_padding_y
        draw_x = visible_x - box[0]
        draw_y = visible_y - box[1]
        if index == 1 and style.accent_background:
            draw.rounded_rectangle(
                (
                    visible_x - TITLE_ACCENT_PADDING_X,
                    row_y,
                    visible_x + width + TITLE_ACCENT_PADDING_X,
                    row_y + height + TITLE_ACCENT_PADDING_Y * 2,
                ),
                radius=8,
                fill=style.accent_background,
            )
        draw.text((draw_x, draw_y), line, font=font, fill=color, stroke_width=0)
        row_y += height + accent_padding_y * 2 + TITLE_LINE_GAP
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG", optimize=True)
    return output_path


def create_channel_panel(channel_name: str, template_id: TemplateId, output_path: Path) -> Path:
    style = TEMPLATE_STYLES[template_id]
    image = Image.new("RGB", (PANEL_WIDTH, PANEL_HEIGHT), style.background)
    draw = ImageDraw.Draw(image)
    font = load_font(48, "bold")
    name = " ".join(channel_name.split()).strip() or "YouTube 채널"
    while _text_width(draw, name, font) > 800 and len(name) > 2:
        name = name[:-2].rstrip() + "…"
    icon_size = 64
    gap = 26
    text_width = _text_width(draw, name, font)
    group_width = icon_size + gap + text_width
    x = (PANEL_WIDTH - group_width) // 2
    text_box = draw.textbbox((0, 0), name, font=font)
    text_height = text_box[3] - text_box[1]
    group_height = max(icon_size, text_height)
    y = CHANNEL_TOP_MARGIN + (group_height - icon_size) // 2
    draw.ellipse((x, y, x + icon_size, y + icon_size), fill=style.channel)
    inner = style.background
    draw.ellipse((x + 20, y + 13, x + 44, y + 37), fill=inner)
    draw.arc((x + 13, y + 31, x + 51, y + 65), 180, 360, fill=inner, width=8)
    draw.text(
        (
            x + icon_size + gap - text_box[0],
            CHANNEL_TOP_MARGIN + (group_height - text_height) // 2 - text_box[1],
        ),
        name,
        font=font,
        fill=style.channel,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG", optimize=True)
    return output_path


def create_panel_overlays(
    *,
    title: str,
    channel_name: str,
    template_id: TemplateId,
    directory: Path,
    prefix: str,
    title_color: str | None = None,
    title_font_size: int | None = None,
    title_font_scale: float = 1.0,
) -> tuple[Path, Path]:
    top = create_title_panel(
        title,
        template_id,
        directory / f"{prefix}_top.png",
        text_color=title_color,
        font_size=title_font_size,
        font_scale=title_font_scale,
    )
    bottom = create_channel_panel(channel_name, template_id, directory / f"{prefix}_bottom.png")
    return top, bottom


def _ass_timestamp(seconds: float) -> str:
    centiseconds = max(0, round(seconds * 100))
    hours, remainder = divmod(centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    whole_seconds, centiseconds = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{whole_seconds:02d}.{centiseconds:02d}"


def create_ass_subtitles(
    segments: list[SubtitleSegment],
    *,
    clip_start: float,
    clip_end: float,
    output_path: Path,
) -> Path | None:
    dialogues: list[str] = []
    for segment in segments:
        start = max(segment.start, clip_start)
        end = min(segment.end, clip_end)
        if end <= start:
            continue
        lines = wrap_caption(segment.text)
        if not lines:
            continue
        escaped_lines = [
            line.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")
            for line in lines
        ]
        text = r"\N".join(escaped_lines)
        dialogues.append(
            "Dialogue: 0,"
            f"{_ass_timestamp(start - clip_start)},{_ass_timestamp(end - clip_start)},"
            f"Default,,0,0,0,,{text}"
        )
    if not dialogues:
        return None
    font_name = "Noto Sans CJK KR"
    content = "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            "PlayResX: 1080",
            "PlayResY: 1920",
            "WrapStyle: 2",
            "ScaledBorderAndShadow: yes",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
            "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
            "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            f"Style: Default,{font_name},48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,"
            "-1,0,0,0,100,100,0,0,3,3,0,2,60,60,445,1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *dialogues,
            "",
        ]
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    return output_path
