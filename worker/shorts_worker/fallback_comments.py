from __future__ import annotations

import re
from pathlib import Path

MAX_FALLBACK_COMMENTS_PER_CLIP = 15


def _comment_key(text: str) -> str:
    return re.sub(r"[^0-9a-zA-Z가-힣]+", "", text).casefold()


def _load_fallback_comments() -> tuple[str, ...]:
    path = Path(__file__).with_name("fallback_comments.txt")
    comments = tuple(
        normalized
        for line in path.read_text(encoding="utf-8").splitlines()
        if (normalized := " ".join(line.split()))
    )
    if not comments:
        raise RuntimeError("fallback comment catalog is empty")
    return comments


FALLBACK_COMMENT_TEXTS = _load_fallback_comments()


def select_fallback_comment_texts(
    count: int,
    *,
    clip_index: int,
    excluded_keys: set[str] | None = None,
) -> list[str]:
    """Select stable, non-duplicated fallback copy for one numbered short."""
    requested = max(0, int(count))
    if requested == 0:
        return []
    excluded = excluded_keys if excluded_keys is not None else set()
    start = (
        max(0, int(clip_index) - 1) * MAX_FALLBACK_COMMENTS_PER_CLIP
    ) % len(FALLBACK_COMMENT_TEXTS)
    selected: list[str] = []
    for offset in range(len(FALLBACK_COMMENT_TEXTS)):
        text = FALLBACK_COMMENT_TEXTS[(start + offset) % len(FALLBACK_COMMENT_TEXTS)]
        key = _comment_key(text)
        if not key or key in excluded:
            continue
        excluded.add(key)
        selected.append(text)
        if len(selected) >= requested:
            break
    return selected
