from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def _positive_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _positive_float(name: str, default: float) -> float:
    try:
        return max(0.1, float(os.getenv(name, str(default))))
    except ValueError:
        return default


def normalize_database_url(value: str | None) -> str | None:
    if not value:
        return value
    parsed = urlsplit(value)
    unsupported = {"pgbouncer", "connection_limit", "schema"}
    query = urlencode(
        [(key, item) for key, item in parse_qsl(parsed.query) if key not in unsupported]
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))


@dataclass(slots=True)
class Settings:
    database_url: str | None = field(
        default_factory=lambda: normalize_database_url(os.getenv("DATABASE_URL"))
    )
    s3_bucket: str | None = field(default_factory=lambda: os.getenv("AWS_S3_OUTPUT_BUCKET"))
    aws_region: str = field(default_factory=lambda: os.getenv("AWS_REGION", "ap-northeast-2"))
    temp_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("TEMP_DIR") or os.getenv("TEMP_ROOT") or "/tmp/shorts-maker"
        )
    )
    openai_api_key: str | None = field(default_factory=lambda: os.getenv("OPENAI_API_KEY"))
    openai_transcribe_model: str = field(
        default_factory=lambda: os.getenv(
            "OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe"
        )
    )
    openai_highlight_fallback_model: str = field(
        default_factory=lambda: os.getenv(
            "OPENAI_HIGHLIGHT_FALLBACK_MODEL", "gpt-5-nano"
        )
    )
    openai_comment_fallback_model: str = field(
        default_factory=lambda: os.getenv(
            "OPENAI_COMMENT_FALLBACK_MODEL", "gpt-5-nano"
        )
    )
    openai_transcribe_chunk_seconds: int = field(
        default_factory=lambda: _positive_int("OPENAI_TRANSCRIBE_CHUNK_SECONDS", 30)
    )
    openai_transcribe_max_workers: int = field(
        default_factory=lambda: _positive_int("OPENAI_TRANSCRIBE_MAX_WORKERS", 4)
    )
    gemini_api_key: str | None = field(default_factory=lambda: os.getenv("GEMINI_API_KEY"))
    gemini_text_model: str = field(
        default_factory=lambda: os.getenv("GEMINI_TEXT_MODEL")
        or "gemini-2.5-flash-lite"
    )
    gemini_comment_model: str = field(
        default_factory=lambda: os.getenv("GEMINI_COMMENT_MODEL")
        or os.getenv("GEMINI_TEXT_MODEL")
        or "gemini-2.5-flash-lite"
    )
    gemini_openai_base_url: str = field(
        default_factory=lambda: os.getenv("GEMINI_OPENAI_BASE_URL")
        or "https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    download_timeout_seconds: float = field(
        default_factory=lambda: _positive_float(
            "DOWNLOAD_TIMEOUT_SECONDS",
            _positive_float("YTDLP_TIMEOUT_SECONDS", 300),
        )
    )
    ai_timeout_seconds: float = field(
        default_factory=lambda: _positive_float(
            "AI_TIMEOUT_SECONDS",
            _positive_float("OPENAI_TIMEOUT_SECONDS", 120),
        )
    )
    ffmpeg_timeout_seconds: float = field(
        default_factory=lambda: _positive_float("FFMPEG_TIMEOUT_SECONDS", 300)
    )
    max_video_duration_seconds: int = field(
        default_factory=lambda: _positive_int("MAX_VIDEO_DURATION_SECONDS", 3600)
    )
    def ensure_directories(self) -> None:
        self.temp_dir.mkdir(parents=True, exist_ok=True)

    def validate_runtime(self) -> None:
        missing = [
            name
            for name, value in (
                ("DATABASE_URL", self.database_url),
                ("AWS_S3_OUTPUT_BUCKET", self.s3_bucket),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"필수 환경변수가 없습니다: {', '.join(missing)}")
