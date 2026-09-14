"""Pretranslated instructions; source content and existing generation rules stay intact."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

from .content_language import CONTENT_LANGUAGES
from .language_context import language_context

if TYPE_CHECKING:
    from .comment_generator import CommentClipInput

PROMPT_TRANSLATIONS = json.loads(
    Path(__file__).with_name("prompt_translations.json").read_text(encoding="utf-8")
)

CULTURE_COMMENT_PROFILE = "culture-flash-v1"
CULTURE_COMMENT_MODEL = "gemini-3.5-flash"
CULTURE_COMMENT_PROMPTS = json.loads(
    Path(__file__).with_name("comment_culture_prompts.json").read_text(encoding="utf-8")
)

LOCALIZED_SELECTION_PROMPTS = json.loads(
    Path(__file__).with_name("localized_selection_prompts.json").read_text(encoding="utf-8")
)


def translated_selection_messages(
    *, video_title: str, duration_seconds: float, transcript: str, transcript_source: str,
    minimum_count: int, required_count: int, min_seconds: float, max_seconds: float,
    output_language: str, source_language: str | None,
) -> list[dict[str, str]] | None:
    # Only language-test projects carry a source language. Legacy requests keep
    # their original instructions, including the Korean-output test path.
    if source_language is None or output_language not in LOCALIZED_SELECTION_PROMPTS:
        return None
    templates = LOCALIZED_SELECTION_PROMPTS[output_language]
    values = dict(
        video_title=video_title, duration_seconds=f"{duration_seconds:.3f}",
        transcript=transcript, minimum_count=minimum_count, required_count=required_count,
        min_seconds=f"{min_seconds:.3f}", max_seconds=f"{max_seconds:.3f}",
    )
    user = templates["user"].format(**values)
    return [
        {"role": "system", "content": language_context(source_language, output_language)
         + "\n\n" + templates["system"].format(**values)},
        {"role": "user", "content": user},
    ]


def translated_comment_messages(
    clips: list[CommentClipInput], *, min_chars: int, max_chars: int, culture: bool = False,
) -> list[dict[str, str]] | None:
    languages = {clip.output_language for clip in clips}
    if not (len(languages) == 1 and languages <= {"en", "ja"} if culture
            else languages == {"en"}):
        return None
    language = next(iter(languages))
    templates = (CULTURE_COMMENT_PROMPTS if culture else PROMPT_TRANSLATIONS)[language]
    profile = CONTENT_LANGUAGES[language]
    language_rules = "\n".join(templates["comment_language_rule"].format(
        clip_index=clip.clip_index, output_language=language.value,
        language_name=profile["name"], style=profile["style"],
    ) for clip in clips)
    sections = [templates["comment_user"].format(
        clip_index=clip.clip_index, target_count=clip.target_count,
        title=clip.hook_title, reason=clip.reason or templates["no_reason"],
        transcript="\n".join(segment.text for segment in clip.transcript)
        or templates["no_transcript"],
    ) for clip in clips]
    return [
        {"role": "system", "content": templates["comment_system"].format(
            language_rules=language_rules, min_chars=min_chars, max_chars=max_chars,
        )},
        {"role": "user", "content": "\n\n".join(sections)},
    ]
