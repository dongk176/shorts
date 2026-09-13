"""Separate the source transcription language from the requested writing language."""

from __future__ import annotations

import json
import re
import unicodedata
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


def mentioned_currencies(text: str) -> set[str]:
    """Explicit currency labels only; this does not validate every numerical claim."""
    return {
        currency for currency, pattern in CATALOG["currencyPatterns"].items()
        if re.search(pattern, text, re.I)
    }


def has_unlabeled_amount(text: str, source: str) -> bool:
    """Reject unlabeled money expressions; this is not a general factual validator."""
    source_has_currency = bool(mentioned_currencies(source))
    if not source_has_currency and not re.search(
        CATALOG["monetaryContextPattern"], source + "\n" + text, re.I,
    ):
        return False
    normalized = unicodedata.normalize("NFKC", text)
    label = CATALOG["amountCurrencyLabelPattern"]
    pattern = (
        f'({CATALOG["scaledNumberPattern"]})|({CATALOG["vagueScaledNumberPattern"]})'
        f'|({CATALOG["bareLargeNumberPattern"]})'
    )
    for amount in re.finditer(pattern, normalized, re.I):
        before, after = normalized[:amount.start()].rstrip(), normalized[amount.end():].lstrip()
        if amount.group(2) is not None:
            after = re.sub(r"^of\s+", "", after, flags=re.I)
        if re.search(label + r"$", before, re.I) or re.match(label, after, re.I):
            continue
        # A range can share its final scale and currency label.
        range_end = f'(?:{CATALOG["scaledNumberPattern"]}|{CATALOG["bareLargeNumberPattern"]})'
        if re.match(CATALOG["amountRangeSeparatorPattern"] + range_end
                    + r"\s*" + label, after, re.I):
            continue
        if re.match(CATALOG["amountCountUnitPattern"], after, re.I):
            continue
        if amount.group(3) is not None:
            # A bare number needs monetary wording in the output itself.
            # A currency elsewhere in the source does not make every year or model money.
            if not re.search(CATALOG["monetaryContextPattern"], normalized, re.I):
                continue
            if re.search(CATALOG["nonAmountNumberPrefixPattern"], before, re.I):
                continue
        return True
    return False
