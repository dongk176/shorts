"""Compare explicit calendar dates independently of localized month spelling."""

import re
from collections import Counter
from datetime import date

_MONTHS = {
    name: index
    for index, names in enumerate((
        ("january", "jan"), ("february", "feb"), ("march", "mar"),
        ("april", "apr"), ("may",), ("june", "jun"), ("july", "jul"),
        ("august", "aug"), ("september", "sept", "sep"),
        ("october", "oct"), ("november", "nov"), ("december", "dec"),
    ), start=1)
    for name in names
}
_MONTH = "(?:" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + r")\.?"
_DAY = r"\d{1,2}(?:st|nd|rd|th)?"
_DAYS = _DAY + r"(?:\s*(?:and|to|through|[–—-])\s*" + _DAY + r")?"
_CJK_NUMBER = r"[0-9〇零一二三四五六七八九十일이삼사오육칠팔구십유시]+"
_PATTERNS = (
    re.compile(r"\b(?P<month>" + _MONTH + r")\s+(?P<days>" + _DAYS + r")\b", re.I),
    re.compile(r"\b(?P<days>" + _DAYS + r")\s+(?:of\s+)?(?P<month>" + _MONTH + r")\b", re.I),
    re.compile(r"(?<!\d)(?P<month>" + _CJK_NUMBER + r")\s*[월月]\s*"
               r"(?P<days>" + _CJK_NUMBER + r")\s*[일日]"),
)
_DIGITS = dict(zip("〇零一二三四五六七八九일이삼사오육칠팔구", "00123456789123456789", strict=True))


def _number(value: str) -> int:
    if value in {"유", "시"}:
        return {"유": 6, "시": 10}[value]
    normalized = "".join(_DIGITS.get(c, c) for c in value).replace("十", "십")
    if "십" in normalized:
        tens, ones = normalized.split("십")
        return int(tens or "1") * 10 + int(ones or "0")
    return int(normalized)


def extract_calendar_dates(text: str) -> tuple[str, Counter[str]]:
    """Remove recognized month/day spans and retain paired date facts.

    Years and other quantities stay in the text for the existing numeric check.
    Ambiguous numeric-only dates are left untouched.
    """
    facts: Counter[str] = Counter()

    def replace(match: re.Match[str]) -> str:
        raw_month = match["month"].lower().rstrip(".")
        try:
            month = _MONTHS[raw_month] if raw_month in _MONTHS else _number(raw_month)
            days = ([_number(match["days"])] if raw_month not in _MONTHS else
                    [int(v) for v in re.findall(r"\d+", match["days"])])
            # A leap year admits February 29 when no year was explicitly supplied.
            for day in days:
                date(2000, month, day)
        except ValueError:
            return match[0]
        facts.update(f"DATE:{month}:{day}" for day in days)
        return " CALENDAR "

    for pattern in _PATTERNS:
        text = pattern.sub(replace, text)
    return text, facts
