from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


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


@dataclass(slots=True)
class Settings:
    storage_dir: Path = field(
        default_factory=lambda: Path(os.getenv("STORAGE_DIR", PROJECT_ROOT / "storage"))
    )
    database_path: Path = field(
        default_factory=lambda: Path(
            os.getenv("DATABASE_PATH", PROJECT_ROOT / "storage" / "jobs.sqlite3")
        )
    )
    temp_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("TEMP_DIR") or os.getenv("TEMP_ROOT") or "/tmp/shorts-maker"
        )
    )
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            origin.strip()
            for origin in (
                os.getenv("CORS_ORIGINS")
                or os.getenv("WEB_ORIGIN")
                or "http://localhost:3000"
            ).split(",")
            if origin.strip()
        )
    )
    openai_api_key: str | None = field(default_factory=lambda: os.getenv("OPENAI_API_KEY"))
    openai_transcribe_model: str = field(
        default_factory=lambda: os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-transcribe")
    )
    gemini_api_key: str | None = field(default_factory=lambda: os.getenv("GEMINI_API_KEY"))
    gemini_text_model: str = field(
        default_factory=lambda: os.getenv("GEMINI_TEXT_MODEL")
        or "gemini-2.5-flash-lite"
    )
    gemini_openai_base_url: str = field(
        default_factory=lambda: os.getenv("GEMINI_OPENAI_BASE_URL")
        or "https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    max_concurrent_jobs: int = field(
        default_factory=lambda: _positive_int("MAX_CONCURRENT_JOBS", 1)
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
    keep_temp_files: bool = field(
        default_factory=lambda: _as_bool(os.getenv("KEEP_TEMP_FILES"), False)
    )

    def ensure_directories(self) -> None:
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.temp_dir.mkdir(parents=True, exist_ok=True)
