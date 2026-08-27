from __future__ import annotations

import re

_MANUAL_LINE_BREAKS = re.compile(r"\r\n|[\n\r\u2028\u2029]")
_COLLAPSIBLE_TITLE_WHITESPACE = re.compile(
    "[\\u0009-\\u000D\\u001C-\\u0020\\u0085\\u00A0\\u1680"
    "\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+"
)


def _normalize_title_whitespace(value: str) -> str:
    return _COLLAPSIBLE_TITLE_WHITESPACE.sub(" ", value).strip(" ")


def manual_title_lines(title: str) -> list[str]:
    """Return normalized, non-empty lines using the browser break contract."""
    return [
        normalized
        for line in _MANUAL_LINE_BREAKS.split(title)
        if (normalized := _normalize_title_whitespace(line))
    ]


def wrap_korean_title(
    title: str,
    max_chars: int = 20,
    max_lines: int = 2,
) -> list[str]:
    """Greedy Korean-safe wrapping shared by schemas and renderers."""
    # Keep this exact set aligned with the browser.  ``str.splitlines()`` also
    # treats NEL, vertical-tab and several record separators as authored line
    # breaks, while JavaScript does not.  That made the stored v4 boxes differ
    # from the editor for otherwise identical text.
    manual_lines = manual_title_lines(title)
    if len(manual_lines) > 1:
        return manual_lines[:max_lines]
    clean = _normalize_title_whitespace(title)[:40]
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
