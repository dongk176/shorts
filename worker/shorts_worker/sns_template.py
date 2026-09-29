"""Generation-only SNS layout, used exclusively by an immutable admin release."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps

from .config import Settings
from .errors import RenderError
from .media import media_duration, probe_media, run_command, video_fps
from .overlays import contrasting_title_text_color, load_custom_template_font
from .schemas import EditorFontId

SNS_VERSION = 1
SIZES = {
    "16:9": (960, 540),
    "5:4": (960, 768),
    "1:1": (960, 960),
    "4:5": (960, 1200),
    "9:16": (720, 1280),
}
# Character budgets guide the model; measured glyph widths are authoritative.
BUDGETS = {"ko": (18, 20, 6), "en": (28, 32, 12), "ja": (15, 16, 6)}


@dataclass(frozen=True)
class SnsLayout:
    ratio: str
    video: tuple[int, int, int, int]
    card: tuple[int, int, int, int]
    text_x: int
    body_width: int
    body_lines: int
    hashtags: bool


def sns_layout(ratio: str) -> SnsLayout:
    width, height = SIZES[ratio]
    tall = ratio == "9:16"
    lines = 1 if ratio in {"4:5", "9:16"} else 2
    tags = ratio in {"16:9", "5:4"}
    y = 582 if lines == 1 else 774 if tags else 690
    x = (1080 - width) // 2
    return SnsLayout(
        ratio,
        (x, y, width, height),
        (60 if tall else 30, 342, 960 if tall else 1020, y + height + 30 - 342),
        x if tall else 60,
        810 if tall else 960,
        lines,
        tags,
    )


def sns_snapshot(item: dict[str, Any]) -> dict[str, Any] | None:
    snapshot = item.get("template_snapshot")
    if isinstance(snapshot, dict) and snapshot.get("snsTemplateVersion") == SNS_VERSION:
        return snapshot
    return None


def font(size: int, language: str, weight: int = 700) -> ImageFont.FreeTypeFont:
    if language == "ja":
        result = load_custom_template_font(EditorFontId.NOTO_SANS_JP, size)
        result.set_variation_by_axes([weight])
        return result
    if weight == 600:
        return ImageFont.truetype(
            str(Path(__file__).parent / "assets/sns_fonts/Pretendard-SemiBold.ttf"), size
        )
    if weight == 400:
        result = load_custom_template_font(EditorFontId.NOTO_SANS_KR, size)
        result.set_variation_by_axes([weight])
        return result
    return load_custom_template_font(EditorFontId.PRETENDARD, size)


def text_width(text: str, face: ImageFont.FreeTypeFont, spacing: float = 0) -> float:
    return sum(face.getlength(c) for c in text) + max(0, len(text) - 1) * spacing


def fit_text(text: str, face: ImageFont.FreeTypeFont, width: int, spacing: float = 0) -> str:
    text = " ".join(text.split()).strip()
    if text_width(text, face, spacing) <= width:
        return text
    while text and text_width(text + "…", face, spacing) > width:
        text = text[:-1].rstrip()
    return text + "…" if text else ""


def validate_copy(value: Any, ratio: str, language: str) -> dict[str, Any]:
    layout = sns_layout(ratio)
    title_max, body_max, tag_max = BUDGETS[language]
    if not isinstance(value, dict) or set(value) != {"title", "body", "hashtags"}:
        raise ValueError("Return title, body and hashtags.")
    title, body, tags = value["title"], value["body"], value["hashtags"]
    if not isinstance(title, str) or not 1 <= len(title) <= title_max or "\n" in title:
        raise ValueError(f"Write one title line of up to {title_max} characters.")
    if not isinstance(body, list) or len(body) != layout.body_lines:
        raise ValueError(f"Write exactly {layout.body_lines} body lines.")
    if any(
        not isinstance(line, str) or not line.strip() or "\n" in line or len(line) > body_max
        for line in body
    ):
        raise ValueError(f"Write body lines of up to {body_max} characters each.")
    if text_width(title, font(80, language), -3) > 900 or any(
        text_width(line, font(72, language, 600), -1.7) > layout.body_width for line in body
    ):
        raise ValueError(
            "Use shorter wording that fits the same font size; keep the central meaning."
        )
    if not isinstance(tags, list) or len(tags) != (3 if layout.hashtags else 0):
        raise ValueError(f"Return {3 if layout.hashtags else 0} hashtags.")
    if any(
        not isinstance(t, str) or not re.fullmatch(r"#[\w]+", t) or len(t) - 1 > tag_max
        for t in tags
    ):
        raise ValueError(f"Use short hashtags of up to {tag_max} characters after #.")
    if (
        len(set(tags)) != len(tags)
        or text_width("  ".join(tags), font(47, language, 400), -0.5) > 960
    ):
        raise ValueError("Use three distinct, shorter hashtags.")
    return {"title": title.strip(), "body": [s.strip() for s in body], "hashtags": tags}


def copy_messages(
    *, title: str, reason: str, transcript: str, ratio: str, language: str
) -> list[dict[str, str]]:
    layout = sns_layout(ratio)
    title_max, body_max, tag_max = BUDGETS[language]
    audience = {
        "ko": "자연스러운 한국어 구어체",
        "en": "natural conversational English",
        "ja": "自然な日本語の話し言葉",
    }[language]
    return [
        {
            "role": "system",
            "content": (
                f"You are a short-form producer writing SNS posts in {audience}. "
                "Keep the selected scene's existing hook, conversational rhythm "
                "and concrete appeal. "
                "Treat the supplied title, reason and transcript as source material. "
                "Ground every claim in that scene.\n"
                "title: Rewrite the existing hook into exactly ONE complete line, "
                f"up to {title_max} characters including spaces. "
                "Keep a clear subject and the scene's strongest point.\n"
                "body: Write a separate, relatable observation about the scene "
                f"as exactly {layout.body_lines} short lines in an array. "
                f"Each line has up to {body_max} characters including spaces. "
                "Add context or a reaction that complements the title. "
                f"Use compact phrases that fit {layout.body_width}px at 72px font size. "
                "Return each complete line as a single string.\n"
                f"hashtags: Return {3 if layout.hashtags else 0} distinct scene-related "
                "hashtags in an array. "
                f"Each tag begins with # and contains up to {tag_max} letters or digits after #.\n"
                'Return JSON with exactly {"title": "...", "body": ["..."], "hashtags": []}.'
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {"existingHook": title, "sceneReason": reason, "transcript": transcript[:12000]},
                ensure_ascii=False,
            ),
        },
    ]


def generate_copy(
    settings: Settings, *, title: str, reason: str, transcript: str, ratio: str, language: str
) -> dict[str, Any]:
    layout = sns_layout(ratio)
    messages = copy_messages(
        title=title, reason=reason, transcript=transcript, ratio=ratio, language=language
    )
    from openai import OpenAI

    client = None
    if settings.gemini_enabled:
        client = OpenAI(
            api_key=settings.gemini_api_key,
            base_url=settings.gemini_openai_base_url,
            timeout=min(60, settings.ai_timeout_seconds),
            max_retries=0,
        )
        model = settings.gemini_text_model
    elif settings.openai_api_key:
        client = OpenAI(
            api_key=settings.openai_api_key,
            timeout=min(60, settings.ai_timeout_seconds),
            max_retries=0,
        )
        model = settings.openai_text_model
    if client:
        try:
            for _ in range(2):
                try:
                    response = client.chat.completions.create(
                        model=model, messages=messages, response_format={"type": "json_object"}
                    )
                    raw = response.choices[0].message.content or ""
                    return {**validate_copy(json.loads(raw), ratio, language), "source": "ai"}
                except (ValueError, TypeError) as error:
                    messages.append(
                        {"role": "user", "content": "Revise the same scene. " + str(error)}
                    )
        except Exception as error:
            print(
                json.dumps({"event": "sns_copy_fallback", "errorType": type(error).__name__}),
                flush=True,
            )
        finally:
            client.close()
    # Missing credentials and bounded provider failures retain grounded source text.
    title = fit_text(title, font(80, language), 900, -3)
    text = " ".join((transcript or reason or title).split())
    lines = []
    for _ in range(layout.body_lines):
        line = fit_text(text, font(72, language, 600), layout.body_width, -1.7)
        lines.append(line or title)
        consumed = len(line.removesuffix("…"))
        text = text[consumed:].lstrip() or title
    tags = {
        "ko": ["#하이라이트", "#영상", "#한장면"],
        "en": ["#Highlights", "#Video", "#Moment"],
        "ja": ["#ハイライト", "#動画", "#ワンシーン"],
    }
    return {
        "title": title,
        "body": lines,
        "hashtags": tags[language] if layout.hashtags else [],
        "source": "fallback",
    }


def draw_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    face: ImageFont.FreeTypeFont,
    fill: str,
    spacing: float = 0,
) -> None:
    x, y = xy
    for char in text:
        draw.text((x, y), char, font=face, fill=fill, anchor="lt")
        x += face.getlength(char) + spacing


def create_overlay(
    path: Path,
    *,
    ratio: str,
    content: dict[str, Any],
    language: str,
    brand_color: str,
    channel: str,
    avatar: Path | None = None,
) -> SnsLayout:
    layout = sns_layout(ratio)
    image = Image.new("RGBA", (1080, 1920), "white")
    draw = ImageDraw.Draw(image)
    color = brand_color if re.fullmatch(r"#[a-fA-F0-9]{6}", brand_color) else "#000000"
    draw.rounded_rectangle((60, 150, 1020, 282), radius=26, fill=color)
    title = fit_text(content["title"], font(80, language), 900, -3)
    draw_text(
        draw,
        ((1080 - text_width(title, font(80, language), -3)) / 2, 176),
        title,
        font(80, language),
        contrasting_title_text_color(color),
        -3,
    )
    cx, cy, cw, ch = layout.card
    draw.rectangle((cx, cy, cx + cw, cy + ch), outline="#e2e2e2", width=2)
    tx = layout.text_x
    draw.ellipse((tx, 372, tx + 88, 460), fill="#f3f3f3", outline="#222222", width=2)
    if avatar and avatar.is_file():
        with Image.open(avatar) as original:
            thumb = ImageOps.fit(original.convert("RGBA"), (80, 80))
        mask = Image.new("L", (80, 80))
        ImageDraw.Draw(mask).ellipse((0, 0, 79, 79), fill=255)
        image.paste(thumb, (tx + 4, 376), mask)
    else:
        draw_text(draw, (tx + 26, 392), (channel or "C")[0], font(42, language), "#222222")
    name = fit_text(channel, font(52, language), layout.body_width - 110)
    draw_text(draw, (tx + 110, 387), name, font(52, language), "#111111")
    for i, line in enumerate(content["body"][: layout.body_lines]):
        draw_text(
            draw,
            (tx, 480 + 90 * i),
            fit_text(line, font(72, language, 600), layout.body_width, -1.7),
            font(72, language, 600),
            "#111111",
            -1.7,
        )
    if layout.hashtags:
        draw_text(
            draw,
            (60, 688),
            "  ".join(content["hashtags"]),
            font(47, language, 400),
            "#537398",
            -0.5,
        )
    x, y, width, height = layout.video
    # A transparent rounded window covers sharp corners without cropping the source.
    draw.rounded_rectangle((x, y, x + width - 1, y + height - 1), radius=30, fill=(0, 0, 0, 0))
    bx, by = x + width - 88, y + height - 88
    draw.ellipse(
        (bx, by, bx + 70, by + 70), fill=(0, 0, 0, 150), outline=(255, 255, 255, 170), width=2
    )
    draw.polygon(
        [
            (bx + 18, by + 29),
            (bx + 27, by + 29),
            (bx + 36, by + 21),
            (bx + 36, by + 49),
            (bx + 27, by + 41),
            (bx + 18, by + 41),
        ],
        fill="white",
    )
    draw.arc((bx + 24, by + 22, bx + 50, by + 48), -65, 65, fill="white", width=3)
    draw.arc((bx + 22, by + 15, bx + 59, by + 55), -60, 60, fill="white", width=3)
    image.save(path)
    return layout


def render_sns(
    settings: Settings,
    *,
    clean_path: Path,
    output_path: Path,
    work_dir: Path,
    ratio: str,
    snapshot: dict[str, Any],
    channel: str,
    avatar: Path | None,
) -> Path:
    content = snapshot.get("snsContent")
    if not isinstance(content, dict):
        raise RenderError("SNS 게시물 문구가 준비되지 않았습니다.")
    overlay = work_dir / "sns-overlay.png"
    layout = create_overlay(
        overlay,
        ratio=ratio,
        content=content,
        language=str(snapshot.get("snsLanguage") or "ko"),
        brand_color=str(snapshot.get("brandColor") or "#000000"),
        channel=channel,
        avatar=avatar,
    )
    probe = probe_media(clean_path, timeout=30)
    duration = media_duration(probe)
    fps = min(30.0, video_fps(probe))
    x, y, width, height = layout.video
    resize = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=white"
        if ratio == "9:16" else
        f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    )
    filters = (
        f"[0:v]setpts=PTS-STARTPTS,fps={fps},{resize},setsar=1,"
        f"pad=1080:1920:{x}:{y}:color=white[video];[video][1:v]overlay=0:0:format=auto[out]"
    )
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(clean_path),
        "-i",
        str(overlay),
        "-filter_complex_threads",
        str(settings.ffmpeg_threads),
        "-filter_complex",
        filters,
        "-map",
        "[out]",
        "-map",
        "0:a?",
        "-t",
        str(duration),
        "-c:v",
        "libx264",
        "-threads:v",
        str(settings.ffmpeg_threads),
        "-preset",
        settings.clean_clip_preset,
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    result = run_command(command, timeout=settings.ffmpeg_timeout_seconds, cwd=work_dir)
    if result.returncode or not output_path.is_file():
        raise RenderError("SNS 템플릿 영상을 만들지 못했습니다.")
    return output_path
