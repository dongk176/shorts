"""Small, provider-independent text policy shared with the web catalog."""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

CONTENT_LANGUAGES = json.loads(
    Path(__file__).with_name("content_languages.json").read_text(encoding="utf-8")
)


def comment_key(text: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFKC", text).lower() if char.isalnum())


def text_matches_language(text: str, language: str) -> bool:
    """Reject obvious foreign scripts; this is not full language detection."""
    text = unicodedata.normalize("NFKC", text)
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    hangul = bool(re.search(r"[가-힣ㄱ-ㅎㅏ-ㅣ\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]", text))
    kana = bool(re.search(r"[\u3040-\u30ff]", text))
    han = bool(re.search(r"[\u3400-\u9fff]", text))
    if language == "ko":
        return hangul and not kana
    if language == "ja":
        return (kana or han) and not hangul
    if language == "zh-CN":
        return han and not hangul and not kana
    return all(unicodedata.name(c, "").startswith("LATIN ") for c in letters)


def comment_age_label(months: int, language: str = "ko") -> str:
    template = CONTENT_LANGUAGES[language]["age"][0 if months == 1 else 1]
    return template.replace("{count}", str(months))


def content_title_font(text: str, font_id: str, japanese_enabled: bool = False) -> str:
    """CJK titles use bundled fonts with Han/kana coverage, also in the editor."""
    if japanese_enabled:
        return "noto-sans-jp"
    if re.search(r"[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]", text):
        return font_id if font_id in {"noto-sans-kr", "noto-serif-kr"} else "noto-sans-kr"
    return font_id


def japanese_comment_font(text: str) -> bool:
    """Japanese body text gets the same bundled face on every worker OS."""
    return bool(re.search(r"[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]", text))


def comment_action_labels(like_count: int, language: str = "ko") -> tuple[str, str]:
    """Stable browser/renderer formatting; language comes from the saved project."""
    language = language if language in CONTENT_LANGUAGES else "ko"
    if language == "ko" and like_count >= 10_000:
        likes = f"{(like_count // 1_000) / 10:g}만"
    elif language == "ko" and like_count >= 1_000:
        likes = f"{(like_count // 100) / 10:g}천"
    elif language in {"ja", "zh-CN"} and like_count >= 10_000:
        likes = f"{(like_count // 1_000) / 10:g}万"
    elif language not in {"ko", "ja", "zh-CN"} and like_count >= 1_000:
        likes = f"{(like_count // 100) / 10:g}K"
    else:
        likes = f"{like_count:,}"
    return likes, CONTENT_LANGUAGES[language]["reply"]
