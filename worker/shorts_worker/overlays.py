from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, UnidentifiedImageError

from .schemas import (
    CommentOverlay,
    CustomTemplateConfig,
    SubtitleSegment,
    TemplateId,
    TemplateTextLayer,
    TitleTextStyle,
)

PANEL_WIDTH = 1080
PANEL_HEIGHT = 420
TITLE_BOTTOM_MARGIN = 44
TITLE_LINE_GAP = 18
TITLE_ACCENT_PADDING_X = 24
TITLE_ACCENT_PADDING_Y = 10
CHANNEL_TOP_MARGIN = 48
COMMENT_BODY_FONT_SIZE = 35
COMMENT_SIZE_SCALES = {"small": 0.82, "medium": 1.0, "large": 1.16}
COMMENT_DARK_BACKGROUND = "#040404"


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
    TemplateId.COMMENT_CAPTURE: TemplateStyle(
        COMMENT_DARK_BACKGROUND, "#FFFFFF", "#35E6E3", None, "#FFFFFF"
    ),
}

CUSTOM_BACKGROUND_ASSETS = {
    name: Path(__file__).parent / "assets" / "template_backgrounds" / f"{name}.png"
    for name in (
        "news-blue-geometric",
        "news-blue-diagonal",
        "news-red-globe",
        "trust-network",
        "trust-circuit",
        "white-vinyl",
        "white-grid",
        "white-hanji",
    )
}


FONT_CANDIDATES = {
    "bold": (
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Bold.otf",
        "/usr/share/fonts/noto/NotoSansCJK-Bold.ttc",
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ),
    "regular": (
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf",
        "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
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
        lines[-1] = last[: max(1, max_chars - 1)].rstrip() + "…"
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


def _title_line_character_indices(title: str, lines: list[str]) -> list[list[int | None]]:
    normalized: list[tuple[str, int]] = []
    for index, character in enumerate(title):
        if character.isspace():
            if normalized and normalized[-1][0] != " ":
                normalized.append((" ", index))
            continue
        normalized.append((character, index))
    while normalized and normalized[0][0] == " ":
        normalized.pop(0)
    while normalized and normalized[-1][0] == " ":
        normalized.pop()

    search_from = 0
    result: list[list[int | None]] = []
    for line in lines:
        searchable = line
        synthetic_ellipsis = False

        def find_start(search_from_value: int, searchable_value: str) -> int:
            for candidate in range(
                search_from_value,
                len(normalized) - len(searchable_value) + 1,
            ):
                if all(
                    normalized[candidate + offset][0] == character
                    for offset, character in enumerate(searchable_value)
                ):
                    return candidate
            return -1

        start = find_start(search_from, searchable)
        if start < 0 and line.endswith("…"):
            searchable = line[:-1]
            synthetic_ellipsis = True
            start = find_start(search_from, searchable)
        if start < 0:
            result.append([None] * len(line))
            continue
        search_from = start + len(searchable)
        indices: list[int | None] = [index for _, index in normalized[start:search_from]]
        if synthetic_ellipsis:
            indices.append(None)
        result.append(indices)
    return result


def _title_style_runs(
    line: str,
    indices: list[int | None],
    styles: list[TitleTextStyle],
) -> list[tuple[int, int, str | None, str | None]]:
    runs: list[tuple[int, int, str | None, str | None]] = []
    for character_index, _ in enumerate(line):
        title_index = indices[character_index] if character_index < len(indices) else None
        style = next(
            (
                item
                for item in styles
                if title_index is not None and item.start <= title_index < item.end
            ),
            None,
        )
        color = style.color if style else None
        background_color = style.background_color if style else None
        if runs and runs[-1][1] == character_index and runs[-1][2:] == (color, background_color):
            start, _, run_color, run_background = runs[-1]
            runs[-1] = (start, character_index + 1, run_color, run_background)
        else:
            runs.append((character_index, character_index + 1, color, background_color))
    return runs


def default_title_text_styles(
    title: str,
    template_id: TemplateId,
    *,
    overlay_mode: bool = False,
) -> list[TitleTextStyle]:
    style = TEMPLATE_STYLES[template_id]
    selected_background = (
        style.accent_background or style.background if overlay_mode else style.accent_background
    )
    if not selected_background:
        return []
    lines = wrap_korean_title(title)
    indices = _title_line_character_indices(title, lines)
    selected_indices = [
        index
        for line_indices in (indices if overlay_mode else indices[1:2])
        for index in line_indices
        if index is not None
    ]
    if not selected_indices:
        return []
    return [
        TitleTextStyle(
            start=min(selected_indices),
            end=max(selected_indices) + 1,
            backgroundColor=selected_background,
        )
    ]


def create_title_panel(
    title: str,
    template_id: TemplateId,
    output_path: Path,
    *,
    text_color: str | None = None,
    font_size: int | None = None,
    font_scale: float = 1.0,
    panel_height: int = PANEL_HEIGHT,
    overlay_mode: bool = False,
    title_text_styles: list[TitleTextStyle] | None = None,
) -> Path:
    style = TEMPLATE_STYLES[template_id]
    image = Image.new(
        "RGBA" if overlay_mode else "RGB",
        (PANEL_WIDTH, panel_height),
        (0, 0, 0, 0) if overlay_mode else style.background,
    )
    draw = ImageDraw.Draw(image)
    lines = wrap_korean_title(title)
    line_character_indices = _title_line_character_indices(title, lines)
    if title_text_styles is None:
        title_text_styles = default_title_text_styles(
            title,
            template_id,
            overlay_mode=overlay_mode,
        )
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
        has_line_background = any(
            run_background
            for _, _, _, run_background in _title_style_runs(
                line,
                line_character_indices[index],
                title_text_styles,
            )
        )
        accent_padding_y = TITLE_ACCENT_PADDING_Y if has_line_background else 0
        line_metrics.append((line, box, width, height, accent_padding_y))

    total_height = sum(height + padding_y * 2 for _, _, _, height, padding_y in line_metrics)
    total_height += TITLE_LINE_GAP * max(0, len(line_metrics) - 1)
    bottom_margin = (
        12
        if panel_height == 285 and not overlay_mode
        else min(TITLE_BOTTOM_MARGIN, max(24, round(panel_height * 0.105)))
    )
    row_y = max(12, panel_height - bottom_margin - total_height)

    for index, (line, box, width, height, accent_padding_y) in enumerate(line_metrics):
        color = text_color or (
            style.accent
            if (overlay_mode and template_id != TemplateId.PAPER) or index == 1
            else style.primary
        )
        visible_x = (PANEL_WIDTH - width) // 2
        visible_y = row_y + accent_padding_y
        draw_x = visible_x - box[0]
        draw_y = visible_y - box[1]
        runs = _title_style_runs(line, line_character_indices[index], title_text_styles)
        for run_start, run_end, _, run_background in runs:
            if not run_background:
                continue
            run_x = _text_width(draw, line[:run_start], font)
            run_right = _text_width(draw, line[:run_end], font)
            draw.rounded_rectangle(
                (
                    visible_x + run_x - TITLE_ACCENT_PADDING_X,
                    row_y,
                    visible_x + run_right + TITLE_ACCENT_PADDING_X,
                    row_y + height + TITLE_ACCENT_PADDING_Y * 2,
                ),
                radius=10,
                fill=run_background,
            )
        for run_start, run_end, run_color, _ in runs:
            run_x = _text_width(draw, line[:run_start], font)
            draw.text(
                (draw_x + run_x, draw_y),
                line[run_start:run_end],
                font=font,
                fill=run_color or color,
                stroke_width=0,
            )
        row_y += height + accent_padding_y * 2 + TITLE_LINE_GAP
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG", optimize=True)
    return output_path


def create_channel_panel(
    channel_name: str,
    template_id: TemplateId,
    output_path: Path,
    *,
    channel_thumbnail_path: Path | None = None,
    panel_height: int = PANEL_HEIGHT,
    overlay_mode: bool = False,
) -> Path:
    style = TEMPLATE_STYLES[template_id]
    if template_id is TemplateId.COMMENT_CAPTURE:
        image = Image.new(
            "RGBA" if overlay_mode else "RGB",
            (PANEL_WIDTH, panel_height),
            (4, 4, 4, 244) if overlay_mode else "#040404",
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(output_path, format="PNG", optimize=True)
        return output_path
    image = Image.new(
        "RGBA" if overlay_mode else "RGB",
        (PANEL_WIDTH, panel_height),
        (0, 0, 0, 0) if overlay_mode else style.background,
    )
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
    top_margin = (
        max(12, (panel_height - group_height) // 2)
        if overlay_mode
        else min(CHANNEL_TOP_MARGIN, max(24, round(panel_height * 0.114)))
    )
    y = top_margin + (group_height - icon_size) // 2
    avatar_rendered = False
    if channel_thumbnail_path and channel_thumbnail_path.is_file():
        try:
            with Image.open(channel_thumbnail_path) as source:
                avatar = ImageOps.fit(
                    source.convert("RGB"),
                    (icon_size, icon_size),
                    method=Image.Resampling.LANCZOS,
                )
            mask = Image.new("L", (icon_size, icon_size), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, icon_size - 1, icon_size - 1), fill=255)
            image.paste(avatar, (x, y), mask)
            avatar_rendered = True
        except (OSError, ValueError, UnidentifiedImageError):
            avatar_rendered = False
    if not avatar_rendered:
        draw.ellipse((x, y, x + icon_size, y + icon_size), fill=style.channel)
        inner = style.background
        draw.ellipse((x + 20, y + 13, x + 44, y + 37), fill=inner)
        draw.arc((x + 13, y + 31, x + 51, y + 65), 180, 360, fill=inner, width=8)
    draw.text(
        (
            x + icon_size + gap - text_box[0],
            top_margin + (group_height - text_height) // 2 - text_box[1],
        ),
        name,
        font=font,
        fill=style.channel,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG", optimize=True)
    return output_path


def _wrap_comment_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
) -> list[str]:
    clean = " ".join(text.split()) or "아 진짜 ㅋㅋㅋㅋㅋㅋㅋㅋ"
    lines: list[str] = []
    remaining = clean
    while remaining and len(lines) < 2:
        if _text_width(draw, remaining, font) <= max_width:
            lines.append(remaining)
            remaining = ""
            break
        split_at = 1
        for index in range(1, len(remaining) + 1):
            if _text_width(draw, remaining[:index], font) > max_width:
                break
            split_at = index
        preferred = remaining.rfind(" ", max(1, split_at // 2), split_at + 1)
        if preferred > 0:
            split_at = preferred
        lines.append(remaining[:split_at].strip())
        remaining = remaining[split_at:].strip()
    if remaining and lines:
        while lines[-1] and _text_width(draw, lines[-1] + "…", font) > max_width:
            lines[-1] = lines[-1][:-1].rstrip()
        lines[-1] += "…"
    return lines


def _draw_reaction_icon(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    size: int,
    *,
    down: bool = False,
    color: str = "#F1F1F1",
) -> None:
    # Rounded, continuous YouTube-style hand outline. The dislike icon is the
    # same silhouette rotated 180 degrees, including its wrist.
    outline = (
        (0.08, 0.53),
        (0.25, 0.51),
        (0.31, 0.45),
        (0.43, 0.11),
        (0.47, 0.06),
        (0.55, 0.07),
        (0.61, 0.12),
        (0.63, 0.20),
        (0.58, 0.42),
        (0.81, 0.42),
        (0.91, 0.45),
        (0.97, 0.51),
        (0.98, 0.59),
        (0.94, 0.68),
        (0.92, 0.77),
        (0.86, 0.87),
        (0.78, 0.92),
        (0.36, 0.92),
        (0.25, 0.86),
        (0.13, 0.85),
        (0.07, 0.80),
        (0.07, 0.58),
    )
    if down:
        outline = tuple((1 - px, 1 - py) for px, py in outline)
    points = [(x + size * px, y + size * py) for px, py in outline]
    points.append(points[0])
    stroke = max(3, round(size * 0.09))
    draw.line(points, fill=color, width=stroke, joint="curve")


def _create_custom_comment_panel(
    comment: CommentOverlay,
    output_path: Path,
    *,
    theme: str,
    size: str,
    overlay_mode: bool,
) -> Path:
    """Mirror the browser comment card's 1080px canvas measurements."""
    scale = COMMENT_SIZE_SCALES[size]
    foreground = "#F7F7F8" if theme == "dark" else "#161619"
    muted = "#A5A5AA" if theme == "dark" else "#6B6B73"
    background = COMMENT_DARK_BACKGROUND if theme == "dark" else "#FFFFFF"
    left = round(47.52 * scale)
    top = round(34.56 * scale)
    bottom = round(36.72 * scale)
    avatar_size = round(101.52 * scale)
    content_x = left + avatar_size + round(27 * scale)
    meta_font = load_font(max(20, round(34.02 * scale)), "bold")
    body_font = load_font(max(22, round(39.10 * scale)), "regular")
    action_font = load_font(max(18, round(33.48 * scale)), "regular")
    scratch = Image.new("RGBA", (PANEL_WIDTH, 1), (0, 0, 0, 0))
    scratch_draw = ImageDraw.Draw(scratch)
    lines = _wrap_comment_text(
        scratch_draw,
        comment.text,
        body_font,
        PANEL_WIDTH - content_x - left,
    )
    meta_box = scratch_draw.textbbox(
        (0, 0), f"{comment.nickname} · {comment.age_label}", font=meta_font
    )
    meta_height = meta_box[3] - meta_box[1]
    meta_gap = round(12.96 * scale)
    line_height = round(55.50 * scale)
    actions_gap = round(22.68 * scale)
    icon_size = round(44.28 * scale)
    content_height = meta_height + meta_gap + len(lines) * line_height + actions_gap + icon_size
    panel_height = top + max(avatar_size, content_height) + bottom
    base = Image.new("RGBA", (PANEL_WIDTH, panel_height), background)

    identity = Image.new("RGBA", base.size, (0, 0, 0, 0))
    identity_draw = ImageDraw.Draw(identity)
    identity_draw.ellipse(
        (left, top, left + avatar_size, top + avatar_size),
        fill=comment.avatar_color,
    )
    initial_font = load_font(max(20, round(38.88 * scale)), "bold")
    initial_box = identity_draw.textbbox((0, 0), comment.initial, font=initial_font)
    identity_draw.text(
        (
            left + (avatar_size - (initial_box[2] - initial_box[0])) / 2 - initial_box[0],
            top + (avatar_size - (initial_box[3] - initial_box[1])) / 2 - initial_box[1],
        ),
        comment.initial,
        font=initial_font,
        fill="#FFFFFF",
    )
    identity_draw.text(
        (content_x, top - meta_box[1]),
        f"{comment.nickname} · {comment.age_label}",
        font=meta_font,
        fill=foreground,
    )
    base.alpha_composite(
        identity.filter(ImageFilter.GaussianBlur(radius=max(3, round(7.56 * scale))))
    )

    draw = ImageDraw.Draw(base)
    text_top = top + meta_height + meta_gap
    for index, line in enumerate(lines):
        draw.text(
            (content_x, text_top + index * line_height),
            line,
            font=body_font,
            fill=foreground,
        )
    actions_y = text_top + len(lines) * line_height + actions_gap
    _draw_reaction_icon(draw, content_x, actions_y, icon_size, color=foreground)
    if comment.like_count >= 10_000:
        amount = (comment.like_count // 1_000) / 10
        likes = f"{amount:g}만"
    elif comment.like_count >= 1_000:
        amount = (comment.like_count // 100) / 10
        likes = f"{amount:g}천"
    else:
        likes = f"{comment.like_count:,}"
    likes_x = content_x + icon_size + round(14.58 * scale)
    likes_box = action_font.getbbox(likes)
    likes_y = (
        actions_y
        + (icon_size - (likes_box[3] - likes_box[1])) / 2
        - likes_box[1]
    )
    draw.text((likes_x, likes_y), likes, font=action_font, fill=muted)
    dislike_x = likes_x + _text_width(draw, likes, action_font) + round(45.36 * scale)
    _draw_reaction_icon(draw, dislike_x, actions_y, icon_size, down=True, color=foreground)
    reply_x = dislike_x + icon_size + round(45.36 * scale)
    reply_box = action_font.getbbox("답글")
    reply_y = (
        actions_y
        + (icon_size - (reply_box[3] - reply_box[1])) / 2
        - reply_box[1]
    )
    draw.text((reply_x, reply_y), "답글", font=action_font, fill=muted)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output = base if overlay_mode else base.convert("RGB")
    output.save(output_path, format="PNG", optimize=True)
    return output_path


def create_comment_panel(
    comment: CommentOverlay,
    output_path: Path,
    *,
    panel_height: int = PANEL_HEIGHT,
    overlay_mode: bool = False,
    theme: str | None = None,
    size: str | None = None,
) -> Path:
    """Render a deliberately plain, screenshot-like comment strip."""
    if theme is not None and size is not None:
        return _create_custom_comment_panel(
            comment,
            output_path,
            theme=theme,
            size=size,
            overlay_mode=overlay_mode,
        )
    scale = max(0.58, min(1.0, panel_height / 285))
    base = Image.new(
        "RGBA",
        (PANEL_WIDTH, panel_height),
        (4, 4, 4, 244) if overlay_mode else (4, 4, 4, 255),
    )
    avatar_size = round(72 * scale)
    left = round(44 * scale)
    top = round(48 * scale)
    content_x = left + avatar_size + round(29 * scale)
    meta_font = load_font(max(18, round(30 * scale)), "bold")
    body_font = load_font(max(22, round(COMMENT_BODY_FONT_SIZE * scale)), "regular")
    action_font = load_font(max(17, round(28 * scale)), "regular")

    # Only the identity-like metadata is blurred; the comment and reactions remain crisp.
    metadata = Image.new("RGBA", base.size, (0, 0, 0, 0))
    metadata_draw = ImageDraw.Draw(metadata)
    metadata_draw.ellipse(
        (left, top, left + avatar_size, top + avatar_size),
        fill=comment.avatar_color,
    )
    initial_font = load_font(max(20, round(34 * scale)), "bold")
    initial_box = metadata_draw.textbbox((0, 0), comment.initial, font=initial_font)
    metadata_draw.text(
        (
            left + (avatar_size - (initial_box[2] - initial_box[0])) / 2 - initial_box[0],
            top + (avatar_size - (initial_box[3] - initial_box[1])) / 2 - initial_box[1],
        ),
        comment.initial,
        font=initial_font,
        fill="#FFFFFF",
    )
    metadata_draw.text(
        (content_x, top),
        f"@{comment.nickname}  {comment.age_label}",
        font=meta_font,
        fill="#F0F0F0",
    )
    base.alpha_composite(
        metadata.filter(ImageFilter.GaussianBlur(radius=max(2, round(4.5 * scale))))
    )

    # A subtle whole-detail blur keeps the strip feeling like a captured social
    # screenshot instead of freshly typeset overlay text.
    details = Image.new("RGBA", base.size, (0, 0, 0, 0))
    details_draw = ImageDraw.Draw(details)
    text_top = top + round(53 * scale)
    lines = _wrap_comment_text(
        details_draw,
        comment.text,
        body_font,
        PANEL_WIDTH - content_x - left,
    )
    line_height = round(47 * scale)
    for index, line in enumerate(lines):
        details_draw.text(
            (content_x, text_top + index * line_height),
            line,
            font=body_font,
            fill="#E8E8E8",
        )

    actions_y = text_top + len(lines) * line_height + round(17 * scale)
    icon_size = round(34 * scale)
    _draw_reaction_icon(details_draw, content_x, actions_y, icon_size)
    if comment.like_count >= 10_000:
        amount = (comment.like_count // 1_000) / 10
        likes = f"{amount:g}만"
    elif comment.like_count >= 1_000:
        amount = (comment.like_count // 100) / 10
        likes = f"{amount:g}천"
    else:
        likes = f"{comment.like_count:,}"
    details_draw.text(
        (content_x + icon_size + round(12 * scale), actions_y - round(2 * scale)),
        likes,
        font=action_font,
        fill="#BEBEBE",
    )
    likes_width = _text_width(details_draw, likes, action_font)
    dislike_x = content_x + icon_size + round(30 * scale) + likes_width
    _draw_reaction_icon(details_draw, dislike_x, actions_y, icon_size, down=True)
    details_draw.text(
        (dislike_x + icon_size + round(36 * scale), actions_y - round(2 * scale)),
        "답글",
        font=action_font,
        fill="#C4C4C4",
    )
    base.alpha_composite(details.filter(ImageFilter.GaussianBlur(radius=max(0.25, 0.4 * scale))))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output = base if overlay_mode else base.convert("RGB")
    output.save(output_path, format="PNG", optimize=True)
    return output_path


def create_landscape_comment_overlay(
    comment: CommentOverlay,
    output_path: Path,
    *,
    panel_height: int,
    channel_name: str,
    channel_thumbnail_path: Path | None = None,
    overlay_mode: bool = False,
) -> Path:
    """Render the 16:9 comment preset with its channel row near the lower edge."""
    comment_height = min(330, max(285, panel_height - 128))
    create_comment_panel(
        comment,
        output_path,
        panel_height=comment_height,
        overlay_mode=overlay_mode,
    )
    with Image.open(output_path) as source:
        comment_panel = source.convert("RGBA")
    combined = Image.new(
        "RGBA",
        (PANEL_WIDTH, panel_height),
        (4, 4, 4, 244) if overlay_mode else (4, 4, 4, 255),
    )
    combined.alpha_composite(comment_panel, (0, 0))
    channel_layer = TemplateTextLayer.model_validate(
        {
            "visible": True,
            "x": PANEL_WIDTH // 2,
            "y": 0,
            "maxWidth": 800,
            "fontSize": 42,
            "color": "#FFFFFF",
            "backgroundColor": None,
        }
    )
    _draw_custom_channel(
        combined,
        channel_name=channel_name,
        layer=channel_layer,
        center_y=panel_height - 180,
        center_x=PANEL_WIDTH / 2,
        channel_thumbnail_path=channel_thumbnail_path,
    )
    output = combined if overlay_mode else combined.convert("RGB")
    output.save(output_path, format="PNG", optimize=True)
    return output_path


def create_fixed_comment_channel_overlay(
    comment: CommentOverlay,
    output_path: Path,
    *,
    panel_height: int,
    channel_name: str,
    channel_thumbnail_path: Path | None = None,
    overlay_mode: bool = False,
    channel_center_y: float | None = None,
) -> Path:
    """Render a comment card with a separately positioned channel row."""
    comment_height = min(330, max(285, panel_height - 128))
    create_comment_panel(
        comment,
        output_path,
        panel_height=comment_height,
        overlay_mode=overlay_mode,
    )
    with Image.open(output_path) as source:
        comment_panel = source.convert("RGBA")
    combined = Image.new(
        "RGBA",
        (PANEL_WIDTH, panel_height),
        (4, 4, 4, 244) if overlay_mode else (4, 4, 4, 255),
    )
    combined.alpha_composite(comment_panel, (0, 0))
    channel_layer = TemplateTextLayer.model_validate(
        {
            "visible": True,
            "x": PANEL_WIDTH // 2,
            "y": 0,
            "maxWidth": 800,
            "fontSize": 42,
            "color": "#FFFFFF",
            "backgroundColor": None,
        }
    )
    channel_height = max(36, round(channel_layer.font_size * 1.25))
    resolved_channel_center_y = (
        channel_center_y
        if channel_center_y is not None
        else comment_height + 22 + channel_height / 2
    )
    _draw_custom_channel(
        combined,
        channel_name=channel_name,
        layer=channel_layer,
        center_y=resolved_channel_center_y,
        center_x=PANEL_WIDTH / 2,
        channel_thumbnail_path=channel_thumbnail_path,
    )
    output = combined if overlay_mode else combined.convert("RGB")
    output.save(output_path, format="PNG", optimize=True)
    return output_path


def _draw_custom_channel(
    image: Image.Image,
    *,
    channel_name: str,
    layer: TemplateTextLayer,
    center_y: float,
    channel_thumbnail_path: Path | None,
    center_x: float | None = None,
) -> int:
    draw = ImageDraw.Draw(image)
    font_size = layer.font_size
    font = load_font(font_size, "bold")
    name = " ".join(channel_name.split())[:50] or "YouTube 채널"
    while font_size > 20 and _text_width(draw, name, font) > layer.max_width - 84:
        font_size -= 2
        font = load_font(font_size, "bold")
    text_box = draw.textbbox((0, 0), name, font=font)
    text_width = text_box[2] - text_box[0]
    text_height = text_box[3] - text_box[1]
    icon_size = max(36, round(font_size * 1.25))
    gap = max(12, round(font_size * 0.36))
    group_width = icon_size + gap + text_width
    group_height = max(icon_size, text_height)
    resolved_x = layer.x if center_x is None else center_x
    left = resolved_x - group_width / 2
    top = center_y - group_height / 2
    pad = max(8, round(font_size * 0.24)) if layer.background_color else 0
    if layer.background_color:
        draw.rounded_rectangle(
            (
                left - pad,
                top - pad,
                left + group_width + pad,
                top + group_height + pad,
            ),
            radius=max(6, round(font_size * 0.18)),
            fill=layer.background_color,
        )
    avatar_rendered = False
    if channel_thumbnail_path and channel_thumbnail_path.is_file():
        try:
            with Image.open(channel_thumbnail_path) as source:
                avatar = ImageOps.fit(
                    source.convert("RGB"),
                    (icon_size, icon_size),
                    method=Image.Resampling.LANCZOS,
                )
            mask = Image.new("L", (icon_size, icon_size), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, icon_size - 1, icon_size - 1), fill=255)
            image.paste(avatar, (round(left), round(top)), mask)
            avatar_rendered = True
        except (OSError, ValueError, UnidentifiedImageError):
            avatar_rendered = False
    if not avatar_rendered:
        draw.ellipse((left, top, left + icon_size, top + icon_size), fill=layer.color)
    draw.text(
        (
            left + icon_size + gap - text_box[0],
            center_y - text_height / 2 - text_box[1],
        ),
        name,
        font=font,
        fill=layer.color,
    )
    return group_height + pad * 2


def add_comment_channel_to_panel(
    panel_path: Path,
    *,
    channel_name: str,
    channel_center_y: float,
    channel_thumbnail_path: Path | None = None,
    overlay_mode: bool = False,
) -> Path:
    """Add the persistent comment-template channel row to a static panel."""
    with Image.open(panel_path) as source:
        panel = source.convert("RGBA")
    channel_layer = TemplateTextLayer.model_validate(
        {
            "visible": True,
            "x": PANEL_WIDTH // 2,
            "y": 0,
            "maxWidth": 800,
            "fontSize": 42,
            "color": "#FFFFFF",
            "backgroundColor": None,
        }
    )
    _draw_custom_channel(
        panel,
        channel_name=channel_name,
        layer=channel_layer,
        center_y=channel_center_y,
        center_x=PANEL_WIDTH / 2,
        channel_thumbnail_path=channel_thumbnail_path,
    )
    output = panel if overlay_mode else panel.convert("RGB")
    output.save(panel_path, format="PNG", optimize=True)
    return panel_path


def create_custom_comment_overlay(
    comment: CommentOverlay,
    output_path: Path,
    *,
    config: CustomTemplateConfig,
    channel_name: str,
    comment_y: int | None = None,
    channel_thumbnail_path: Path | None = None,
    include_channel: bool = True,
) -> Path:
    """Create one opaque full-width card with an optional channel row below it."""
    create_comment_panel(
        comment,
        output_path,
        overlay_mode=True,
        theme=config.comment.theme,
        size=config.comment.size,
    )
    if not include_channel or not config.channel.visible:
        return output_path
    with Image.open(output_path) as source:
        panel = source.convert("RGBA")
    channel_height = max(36, round(config.channel.font_size * 1.25))
    if config.channel.background_color:
        channel_height += max(8, round(config.channel.font_size * 0.24)) * 2
    gap = round(21.6 * COMMENT_SIZE_SCALES[config.comment.size])
    channel_center_y = panel.height + gap + channel_height / 2
    if config.schema_version >= 4 and comment_y is not None:
        channel_center_y = max(channel_center_y, config.channel.y - comment_y)
    combined_height = round(channel_center_y + channel_height / 2)
    if comment_y is not None:
        combined_height = min(1920 - comment_y, combined_height)
    combined = Image.new(
        "RGBA",
        (PANEL_WIDTH, combined_height),
        (0, 0, 0, 0),
    )
    combined.alpha_composite(panel, (0, 0))
    _draw_custom_channel(
        combined,
        channel_name=channel_name,
        layer=config.channel,
        center_y=channel_center_y,
        center_x=PANEL_WIDTH / 2,
        channel_thumbnail_path=channel_thumbnail_path,
    )
    combined.save(output_path, format="PNG", optimize=True)
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
    channel_thumbnail_path: Path | None = None,
    top_height: int = PANEL_HEIGHT,
    bottom_height: int = PANEL_HEIGHT,
    overlay_mode: bool = False,
    title_text_styles: list[TitleTextStyle] | None = None,
) -> tuple[Path, Path]:
    top = create_title_panel(
        title,
        template_id,
        directory / f"{prefix}_top.png",
        text_color=title_color,
        font_size=title_font_size,
        font_scale=title_font_scale,
        panel_height=top_height,
        overlay_mode=overlay_mode,
        title_text_styles=title_text_styles,
    )
    bottom = create_channel_panel(
        channel_name,
        template_id,
        directory / f"{prefix}_bottom.png",
        channel_thumbnail_path=channel_thumbnail_path,
        panel_height=bottom_height,
        overlay_mode=overlay_mode,
    )
    return top, bottom


def _draw_centered_custom_text(
    image: Image.Image,
    *,
    text: str,
    x: int,
    y: int,
    max_width: int,
    font_size: int,
    color: str,
    primary_background_color: str | None,
    accent_background_color: str | None,
    accent_color: str | None = None,
) -> None:
    draw = ImageDraw.Draw(image)
    lines = wrap_korean_title(text, max_chars=20, max_lines=2)
    font = load_font(font_size, "bold")
    while font_size > 20 and max(_text_width(draw, line, font) for line in lines) > max_width:
        font_size -= 2
        font = load_font(font_size, "bold")
    boxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
    heights = [box[3] - box[1] for box in boxes]
    gap = max(6, round(font_size * 0.18))
    total_height = sum(heights) + gap * max(0, len(lines) - 1)
    cursor_y = y - total_height / 2
    for index, (line, box, height) in enumerate(zip(lines, boxes, heights, strict=True)):
        width = box[2] - box[0]
        left = x - width / 2
        is_accent_line = index > 0
        line_background_color = (
            accent_background_color if is_accent_line else primary_background_color
        )
        if line_background_color:
            padding_x = max(10, round(font_size * 0.28))
            padding_y = max(6, round(font_size * 0.14))
            draw.rounded_rectangle(
                (
                    left - padding_x,
                    cursor_y - padding_y,
                    left + width + padding_x,
                    cursor_y + height + padding_y,
                ),
                radius=max(6, round(font_size * 0.14)),
                fill=line_background_color,
            )
        draw.text(
            (left - box[0], cursor_y - box[1]),
            line,
            font=font,
            fill=accent_color if accent_color and is_accent_line else color,
        )
        cursor_y += height + gap


def create_custom_canvas_overlays(
    *,
    title: str,
    channel_name: str,
    config: CustomTemplateConfig,
    directory: Path,
    prefix: str,
    channel_thumbnail_path: Path | None = None,
    include_channel: bool = True,
    channel_y_override: float | None = None,
) -> tuple[Path, Path, Path]:
    """Create trusted full-canvas assets for a validated personal template."""
    directory.mkdir(parents=True, exist_ok=True)
    background_path = directory / f"{prefix}_custom_background.png"
    title_path = directory / f"{prefix}_custom_title.png"
    channel_path = directory / f"{prefix}_custom_channel.png"

    if config.background.kind == "image":
        asset = CUSTOM_BACKGROUND_ASSETS.get(config.background.asset_id or "")
        if not asset or not asset.is_file():
            raise ValueError("지원하지 않는 템플릿 배경입니다.")
        with Image.open(asset) as source:
            background = ImageOps.fit(
                source.convert("RGB"), (PANEL_WIDTH, 1920), method=Image.Resampling.LANCZOS
            )
    else:
        background = Image.new("RGB", (PANEL_WIDTH, 1920), config.background.color or "#111111")
    background.save(background_path, format="PNG", optimize=True)

    title_image = Image.new("RGBA", (PANEL_WIDTH, 1920), (0, 0, 0, 0))
    if config.title.visible:
        _draw_centered_custom_text(
            title_image,
            text=title,
            x=config.title.x,
            y=config.title.y,
            max_width=config.title.max_width,
            font_size=config.title.font_size,
            color=config.title.primary_color,
            accent_color=config.title.accent_color,
            primary_background_color=config.title.primary_background_color,
            accent_background_color=config.title.accent_background_color,
        )
    title_image.save(title_path, format="PNG", optimize=True)

    channel_image = Image.new("RGBA", (PANEL_WIDTH, 1920), (0, 0, 0, 0))
    if include_channel and config.channel.visible:
        _draw_custom_channel(
            channel_image,
            channel_name=channel_name,
            layer=config.channel,
            center_y=config.channel.y if channel_y_override is None else channel_y_override,
            channel_thumbnail_path=channel_thumbnail_path,
        )
    channel_image.save(channel_path, format="PNG", optimize=True)
    return background_path, title_path, channel_path


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
    margin_v: int = 445,
    font_size: int = 48,
    text_color: str = "#FFFFFF",
    background_color: str | None = "#000000",
    margin_l: int = 60,
    margin_r: int = 60,
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
            line.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}") for line in lines
        ]
        text = r"\N".join(escaped_lines)
        dialogues.append(
            "Dialogue: 0,"
            f"{_ass_timestamp(start - clip_start)},{_ass_timestamp(end - clip_start)},"
            f"Default,,0,0,0,,{text}"
        )
    if not dialogues:
        return None

    def ass_color(color: str, alpha: str = "00") -> str:
        value = color.lstrip("#")
        return f"&H{alpha}{value[4:6]}{value[2:4]}{value[0:2]}"

    font_name = "Noto Sans CJK KR"
    back_color = ass_color(background_color or "#000000", "80" if background_color else "FF")
    border_style = 3 if background_color else 1
    style_line = (
        f"Style: Default,{font_name},{font_size},{ass_color(text_color)},"
        f"{ass_color(text_color)},&H00000000,{back_color},"
        f"-1,0,0,0,100,100,0,0,{border_style},3,0,2,"
        f"{margin_l},{margin_r},{margin_v},1"
    )
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
            style_line,
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
