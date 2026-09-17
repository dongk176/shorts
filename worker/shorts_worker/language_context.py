"""Separate the source transcription language from the requested writing language."""

from __future__ import annotations

import json
import re
from pathlib import Path

CATALOG = json.loads(Path(__file__).with_name("language_context.json").read_text())
SOURCE_LANGUAGE_HINTS = {"auto", "ko", "en", "ja"}


def normalize_source_language(value: object) -> str:
    code = str(value or "").strip().lower()
    code = CATALOG["aliases"].get(code, code)
    return code if re.fullmatch(r"[a-z]{2,3}(?:-[a-z]{2,4})?", code) and code != "auto" else "und"


def resolve_source_language(hint: object, detected: object = None) -> str | None:
    # Missing is an old project: keep its original prompt behavior.
    if hint is None:
        return None
    if hint not in SOURCE_LANGUAGE_HINTS:
        raise ValueError("Unsupported source language hint")
    return normalize_source_language(detected if hint == "auto" else hint)


def language_context(
    source_language: str | None, output_language: str, *, instruction: str | None = None,
) -> str:
    if source_language is None:
        return ""
    source = normalize_source_language(source_language)
    locale = output_language if output_language in {"ko", "en", "ja"} else "en"
    names = CATALOG["names"][locale]
    return (instruction or CATALOG["instructions"][locale]).format(
        source=names.get(source, source), source_code=source,
        target=names.get(output_language, output_language), target_code=output_language,
    )
