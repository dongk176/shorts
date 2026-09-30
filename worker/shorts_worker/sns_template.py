"""SNS layout shared by isolated administrator generation and editor releases."""

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
BUDGETS = {"ko": (16, 18, 6), "en": (26, 28, 12), "ja": (13, 14, 6)}


def copy_budgets(ratio: str, language: str) -> tuple[int, int, int]:
    title, body, tag = BUDGETS[language]
    if ratio == "9:16":
        body = {"ko": 13, "en": 22, "ja": 11}[language]
    return title, body, tag


@dataclass(frozen=True)
class SnsLayout:
    ratio: str
    video: tuple[int, int, int, int]
    card: tuple[int, int, int, int]
    text_x: int
    body_width: int
    body_lines: int
    hashtags: bool
    offset_y: int


def sns_layout(ratio: str) -> SnsLayout:
    width, height = SIZES[ratio]
    tall = ratio == "9:16"
    lines = 1 if ratio in {"4:5", "9:16"} else 2
    tags = ratio in {"16:9", "5:4"}
    y = 582 if lines == 1 else 774 if tags else 690
    offset_y = 150 if ratio in {"16:9", "5:4", "1:1"} else 0
    y += offset_y
    x = (1080 - width) // 2
    return SnsLayout(
        ratio,
        (x, y, width, height),
        (60 if tall else 30, 342 + offset_y, 960 if tall else 1020,
         y + height + 30 - 342 - offset_y),
        x if tall else 60,
        810 if tall else 960,
        lines,
        tags,
        offset_y,
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
    title_max, body_max, tag_max = copy_budgets(ratio, language)
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
    title_width = text_width(title, font(80, language), -3)
    if title_width > 900:
        target = max(1, int(len(title) * 900 / title_width * 0.85))
        raise ValueError(f"Rewrite title as a complete phrase of up to {target} characters.")
    for index, line in enumerate(body):
        measured = text_width(line, font(72, language, 600), -1.7)
        if measured > layout.body_width:
            target = max(1, int(len(line) * layout.body_width / measured * 0.85))
            raise ValueError(
                f"Rewrite body line {index + 1} as a complete phrase of up to {target} characters."
            )
    if not isinstance(tags, list) or len(tags) != (3 if layout.hashtags else 0):
        raise ValueError(f"Return {3 if layout.hashtags else 0} hashtags.")
    for index, tag in enumerate(tags):
        if not isinstance(tag, str) or not re.fullmatch(r"#[\w]+", tag):
            raise ValueError(
                f"hashtags[{index}] must begin with # and contain only letters, digits "
                "or underscores after #."
            )
        if len(tag) - 1 > tag_max:
            raise ValueError(
                f"hashtags[{index}] has {len(tag) - 1} characters after #; "
                f"rewrite it using at most {tag_max}."
            )
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
    title_max, body_max, tag_max = copy_budgets(ratio, language)
    tag_count = 3 if layout.hashtags else 0
    prompts = {
        "ko": (
            "너는 대한민국 상위 0.1% 조회수를 만들어내는 탑티어 숏폼 기획자이자 편집자야.\n\n"
            "아래 제공되는 유튜브 롱폼 대본에서 이미 발췌된 쇼츠용 킬러 구간을 분석해서, "
            "대중의 시선을 사로잡을 해당 구간에 최적화된 1줄 후킹 제목, "
            "본문과 해시태그를 만들어줘.\n\n"
            "기존 후킹 제목과 선정 이유를 참고하고, 구간 대본의 구체적인 장면이나 발언을 "
            "근거로 작성할 것.\n\n"
            "[후킹 제목]\n"
            "- 형식: 반드시 1행으로 작성할 것.\n"
            f"- 글자 수: 공백 포함 {title_max}자 이내로 작성할 것.\n"
            "- 톤앤매너: 군더더기 없이 직관적이고 타격감 있는 구어체 단어를 사용할 것.\n"
            "- 원본 언어와 관계없이 제목은 반드시 자연스러운 한국어 구어체로 작성할 것.\n"
            "- title에 줄바꿈 없는 문자열로 반환할 것.\n\n"
            "[본문]\n"
            f"- 형식: 반드시 {layout.body_lines}행으로 작성할 것.\n"
            f"- 글자 수: 각 행을 공백 포함 {body_max}자 이내로 작성할 것.\n"
            "- 톤앤매너: 군더더기 없이 직관적이고 타격감 있는 한국어 구어체를 사용할 것.\n"
            "- 제목과 함께 해당 구간의 매력이 드러나도록, 구체적인 장면이나 발언을 "
            "활용해 대중의 시선을 사로잡는 본문을 작성할 것.\n"
            "- body 배열에 각 행을 줄바꿈 없는 문자열로 반환할 것.\n\n"
            "[해시태그]\n"
            f"- 개수: 서로 다른 해시태그 {tag_count}개를 작성할 것.\n"
            f"- 글자 수: #을 제외하고 각 {tag_max}자 이내로 작성할 것.\n"
            "- 해당 구간의 핵심 소재나 인물, 상황을 직관적으로 나타내는 한국어 태그를 "
            "선택할 것. 각 태그는 반드시 #으로 시작하고, 그 뒤에는 문자·숫자·밑줄만 사용할 것.\n"
            "- hashtags 배열로 반환할 것. 개수가 0이면 빈 배열을 반환할 것."
        ),
        "en": (
            "You are a top-tier short-form producer and editor for English-speaking audiences, "
            "aiming for the top 0.1% in views.\n\n"
            "Analyze the supplied passage already selected from a long-form video transcript, "
            "and write a one-line hook title, post body and hashtags that capture attention "
            "and bring out this passage’s appeal.\n\n"
            "Use the existing hook title and selection reason as context. Ground your writing "
            "in concrete actions or statements from the passage.\n\n"
            "[Hook title]\n"
            "- Write exactly one line.\n"
            f"- Use up to {title_max} characters including spaces.\n"
            "- Write natural, direct, conversational English for English-speaking viewers. "
            "Use compact phrasing, a clear subject, and a strong spoken rhythm. Match the "
            "directness, wit, and emotional emphasis to the genre and the people in the scene.\n"
            "- Write the title, every body line and hashtags in English, regardless of the "
            "source language. Translate the meaning of source quotes instead of copying them.\n"
            "- Return title as a single-line string.\n\n"
            "[Post body]\n"
            f"- Write exactly {layout.body_lines} lines, each containing up to {body_max} "
            "characters including spaces.\n"
            "- Use the same natural, direct, punchy conversational English. Together with "
            "the title, capture attention and convey the passage’s appeal using concrete "
            "actions or statements from it.\n"
            "- Return body as an array of single-line strings.\n\n"
            "[Hashtags]\n"
            f"- Return {tag_count} distinct hashtags, each with up to {tag_max} characters "
            "after #.\n"
            "- Choose English tags that directly identify the passage’s key topic, people "
            "or situation. Each tag must begin with #, followed only by letters, digits "
            "or underscores.\n"
            "- Return the hashtags array; return an empty array when the count is zero."
        ),
        "ja": (
            "あなたは、日本語圏の視聴者に向けて再生数上位0.1%を目指す、"
            "ショート動画の企画・編集者です。\n\n"
            "提供された長尺動画の文字起こしから既に選ばれた区間を分析し、"
            "視聴者の目を引く、その区間に最適な1行のフックタイトル、本文、"
            "ハッシュタグを作成してください。\n\n"
            "既存のフックタイトルと選定理由を参考にし、区間内の具体的な行動や"
            "発言に基づいて作成してください。\n\n"
            "[フックタイトル]\n"
            "- 必ず1行で書いてください。\n"
            f"- 空白込みで{title_max}文字以内にしてください。\n"
            "- 日本語圏の視聴者に自然に伝わる、端的で力のある話し言葉を使ってください。"
            "日本語らしい省略、短い語のまとまり、間と余韻を活用し、驚きや共感、"
            "ツッコミの強さをジャンルと登場人物の関係に合わせてください。\n"
            "- 原文の言語にかかわらず、タイトル・本文・タグを自然な日本語で書いてください。"
            "同音異義語や省略された表現は、区間の文脈から意味を判断し、"
            "単語の直訳ではなく場面の意味を伝えてください。\n"
            "- titleに改行のない文字列を返してください。\n\n"
            "[本文]\n"
            f"- 必ず{layout.body_lines}行、各行を空白込みで{body_max}文字以内にしてください。\n"
            "- タイトルと同じ、端的で力のある自然な日本語の話し言葉を使ってください。"
            "タイトルとともに区間の魅力を伝え、具体的な行動や発言を活用して"
            "視聴者の目を引く本文を書いてください。\n"
            "- body配列に、各行を改行のない文字列として返してください。\n\n"
            "[ハッシュタグ]\n"
            f"- 異なるタグを{tag_count}個、#を除いて各{tag_max}文字以内で作成してください。\n"
            "- 区間の主な題材、人物、状況が端的に伝わる日本語のタグを選び、"
            "各タグは必ず#で始め、その後には文字・数字・アンダースコアのみを使ってください。\n"
            "- hashtags配列で返し、指定数が0の場合は空配列を返してください。"
        ),
    }
    return [
        {
            "role": "system",
            "content": prompts[language] + '\n\n'
            'Return JSON with exactly {"title": "...", "body": ["..."], "hashtags": []}.',
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "outputLanguage": {"ko": "한국어", "en": "English", "ja": "日本語"}[language],
                    "existingHook": title,
                    "sceneReason": reason,
                    "transcript": transcript[:12000],
                },
                ensure_ascii=False,
            ),
        },
    ]


def validate_generated_language(content: dict[str, Any], language: str) -> None:
    # Catch an untranslated response, while allowing names and borrowed words.
    text = content["title"] + " ".join(content["body"])
    letters = [char for char in text if char.isalpha()]
    if len(letters) < 4 or language == "ko":
        return
    pattern = r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]"
    if language == "en":
        pattern = r"[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u9fff\uac00-\ud7af]"
    if sum(bool(re.fullmatch(pattern, char)) for char in letters) / len(letters) > 0.35:
        target = {"en": "English", "ja": "Japanese"}[language]
        raise ValueError(
            f"The title and body were not translated to {target}. "
            f"Write the title, every body line and hashtags in {target}, "
            "preserving the scene meaning."
        )


def copy_response_format(ratio: str, language: str) -> dict[str, Any]:
    layout = sns_layout(ratio)
    title_max, body_max, tag_max = copy_budgets(ratio, language)
    target = {"ko": "Korean", "en": "English", "ja": "Japanese"}[language]
    tags = 3 if layout.hashtags else 0
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "SnsCopy", "strict": True,
            "schema": {
                "type": "object", "additionalProperties": False,
                "required": ["title", "body", "hashtags"],
                "properties": {
                    "title": {
                        "type": "string",
                        "description": f"One punchy {target} hook, up to {title_max} "
                        "characters including spaces; no newline.",
                    },
                    "body": {
                        "type": "array", "minItems": layout.body_lines,
                        "maxItems": layout.body_lines,
                        "items": {"type": "string", "description": f"One {target} body line, "
                                  f"up to {body_max} characters including spaces; no newline."},
                    },
                    "hashtags": {
                        "type": "array", "minItems": tags, "maxItems": tags,
                        "description": f"Exactly {tags} distinct {target} scene-related tags.",
                        "items": {"type": "string", "description": "Must begin with #, "
                                  f"then at most {tag_max} letters, digits or underscores."},
                    },
                },
            },
        },
    }


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
                raw = ""
                try:
                    response = client.chat.completions.create(
                        model=model, messages=messages,
                        response_format=copy_response_format(ratio, language),
                    )
                    raw = response.choices[0].message.content or ""
                    content = validate_copy(json.loads(raw), ratio, language)
                    validate_generated_language(content, language)
                    return {**content, "source": "ai"}
                except (ValueError, TypeError) as error:
                    print(
                        json.dumps(
                            {
                                "event": "sns_copy_repair",
                                "ratio": ratio,
                                "language": language,
                                "reason": str(error),
                            }
                        ),
                        flush=True,
                    )
                    if raw:
                        messages.append({"role": "assistant", "content": raw})
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
    if not text:
        return
    x, y = xy
    # Keep the existing line-top position, but share one baseline across all glyphs.
    # Anchoring each glyph to its own ink top lifts digits and drops descenders.
    baseline = y - face.getbbox(text, anchor="ls")[1]
    for char in text:
        draw.text((x, baseline), char, font=face, fill=fill, anchor="ls")
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
    offset_y = layout.offset_y
    color = brand_color if re.fullmatch(r"#[a-fA-F0-9]{6}", brand_color) else "#000000"
    draw.rounded_rectangle((60, 150 + offset_y, 1020, 282 + offset_y), radius=26, fill=color)
    title = fit_text(content["title"], font(80, language), 900, -3)
    draw_text(
        draw,
        ((1080 - text_width(title, font(80, language), -3)) / 2, 176 + offset_y),
        title,
        font(80, language),
        contrasting_title_text_color(color),
        -3,
    )
    cx, cy, cw, ch = layout.card
    draw.rectangle((cx, cy, cx + cw, cy + ch), outline="#e2e2e2", width=2)
    tx = layout.text_x
    draw.ellipse(
        (tx, 372 + offset_y, tx + 88, 460 + offset_y),
        fill="#f3f3f3", outline="#222222", width=2,
    )
    if avatar and avatar.is_file():
        with Image.open(avatar) as original:
            thumb = ImageOps.fit(original.convert("RGBA"), (80, 80))
        mask = Image.new("L", (80, 80))
        ImageDraw.Draw(mask).ellipse((0, 0, 79, 79), fill=255)
        image.paste(thumb, (tx + 4, 376 + offset_y), mask)
    else:
        draw_text(
            draw, (tx + 26, 392 + offset_y), (channel or "C")[0], font(42, language), "#222222"
        )
    name = fit_text(channel, font(52, language), layout.body_width - 110)
    draw_text(draw, (tx + 110, 387 + offset_y), name, font(52, language), "#111111")
    for i, line in enumerate(content["body"][: layout.body_lines]):
        draw_text(
            draw,
            (tx, 480 + offset_y + 90 * i),
            fit_text(line, font(72, language, 600), layout.body_width, -1.7),
            font(72, language, 600),
            "#111111",
            -1.7,
        )
    if layout.hashtags:
        draw_text(
            draw,
            (60, 688 + offset_y),
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
    # Fill the selected frame; a portrait source retains its full height in 9:16.
    resize = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
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
