from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

from .errors import InvalidYouTubeUrl

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}


def validate_youtube_url(value: str) -> tuple[str, str]:
    """Return a normalized URL and video id after a strict YouTube allowlist check."""
    if not isinstance(value, str) or not value.strip():
        raise InvalidYouTubeUrl("유튜브 링크를 입력해 주세요.")
    raw = value.strip()
    try:
        parsed = urlsplit(raw)
    except ValueError as exc:
        raise InvalidYouTubeUrl("올바른 유튜브 링크를 입력해 주세요.") from exc

    if parsed.scheme.lower() not in {"http", "https"}:
        raise InvalidYouTubeUrl("http 또는 https 유튜브 링크만 사용할 수 있습니다.")
    try:
        port = parsed.port
    except ValueError as exc:
        raise InvalidYouTubeUrl("올바른 유튜브 링크를 입력해 주세요.") from exc
    if parsed.username or parsed.password or port not in {None, 80, 443}:
        raise InvalidYouTubeUrl("올바른 유튜브 링크를 입력해 주세요.")
    host = (parsed.hostname or "").lower().rstrip(".")
    if host not in YOUTUBE_HOSTS:
        raise InvalidYouTubeUrl("YouTube 링크만 사용할 수 있습니다.")

    path_parts = [part for part in parsed.path.split("/") if part]
    video_id: str | None = None
    if host in {"youtu.be", "www.youtu.be"}:
        if len(path_parts) == 1:
            video_id = path_parts[0]
    elif parsed.path.rstrip("/") == "/watch":
        values = parse_qs(parsed.query, keep_blank_values=True).get("v", [])
        if len(values) == 1:
            video_id = values[0]
    elif len(path_parts) == 2 and path_parts[0] == "shorts":
        video_id = path_parts[1]

    if not video_id or not VIDEO_ID_RE.fullmatch(video_id):
        raise InvalidYouTubeUrl(
            "지원하는 YouTube 영상 링크 형식이 아닙니다. "
            "watch, youtu.be, shorts 링크를 사용해 주세요."
        )
    return f"https://www.youtube.com/watch?v={video_id}", video_id
