from __future__ import annotations

import json
import subprocess
import sys
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import IngestionError
from .url_validation import validate_youtube_url


@dataclass(frozen=True, slots=True)
class VideoMetadata:
    video_id: str
    title: str
    channel_name: str
    thumbnail_url: str
    duration_seconds: float


class IngestionProvider(ABC):
    @abstractmethod
    def analyze_url(self, youtube_url: str) -> VideoMetadata:
        raise NotImplementedError

    @abstractmethod
    def download_video(self, youtube_url: str, destination: Path) -> Path:
        raise NotImplementedError

    @abstractmethod
    def download_subtitles(self, youtube_url: str, destination: Path) -> Path | None:
        raise NotImplementedError


class YtDlpIngestionProvider(IngestionProvider):
    def __init__(self, *, timeout_seconds: float = 600) -> None:
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def _base_args() -> list[str]:
        return [
            sys.executable,
            "-m",
            "yt_dlp",
            "--no-playlist",
            "--no-warnings",
            "--socket-timeout",
            "20",
            "--retries",
            "2",
        ]

    def _run(
        self,
        args: list[str],
        *,
        timeout: float | None = None,
    ) -> subprocess.CompletedProcess[str]:
        try:
            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=timeout or self.timeout_seconds,
                check=False,
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise IngestionError(
                "YouTube 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
            ) from exc
        except OSError as exc:
            raise IngestionError("yt-dlp를 실행할 수 없습니다. 설치 상태를 확인해 주세요.") from exc
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip().splitlines()
            last_line = detail[-1] if detail else "알 수 없는 오류"
            raise IngestionError(
                "영상을 가져오지 못했습니다. 공개 영상인지, 로그인이 필요하지 않은지 "
                "확인해 주세요. "
                f"({last_line[:300]})"
            )
        return result

    def _extract_info(self, youtube_url: str) -> dict[str, Any]:
        normalized, expected_id = validate_youtube_url(youtube_url)
        result = self._run(
            [
                *self._base_args(),
                "--dump-single-json",
                "--skip-download",
                normalized,
            ],
            timeout=min(self.timeout_seconds, 120),
        )
        try:
            info = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise IngestionError("YouTube 영상 정보를 해석하지 못했습니다.") from exc
        if str(info.get("id", "")) != expected_id:
            raise IngestionError("요청한 영상과 다른 영상 정보가 반환되어 처리를 중단했습니다.")
        return info

    def analyze_url(self, youtube_url: str) -> VideoMetadata:
        info = self._extract_info(youtube_url)
        duration = info.get("duration")
        try:
            duration_seconds = float(duration)
        except (TypeError, ValueError) as exc:
            raise IngestionError("영상 길이를 확인할 수 없는 영상은 지원하지 않습니다.") from exc
        if duration_seconds <= 0:
            raise IngestionError("영상 길이를 확인할 수 없는 영상은 지원하지 않습니다.")
        thumbnails = info.get("thumbnails") or []
        thumbnail = str(info.get("thumbnail") or "")
        if not thumbnail and thumbnails:
            thumbnail = str(thumbnails[-1].get("url") or "")
        return VideoMetadata(
            video_id=str(info.get("id", "")),
            title=str(info.get("title") or "제목 없는 영상")[:500],
            channel_name=str(info.get("channel") or info.get("uploader") or "YouTube 채널")[:200],
            thumbnail_url=thumbnail,
            duration_seconds=duration_seconds,
        )

    def download_video(self, youtube_url: str, destination: Path) -> Path:
        normalized, _ = validate_youtube_url(youtube_url)
        destination.mkdir(parents=True, exist_ok=True)
        output_template = destination / "source.%(ext)s"
        self._run(
            [
                *self._base_args(),
                "--format",
                (
                    "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/"
                    "b[height<=1080][ext=mp4]/"
                    "bv*[height<=1080]+ba/b[height<=1080]"
                ),
                "--merge-output-format",
                "mp4",
                "--output",
                str(output_template),
                normalized,
            ]
        )
        candidates = sorted(
            path
            for path in destination.glob("source.*")
            if path.is_file() and path.suffix.lower() not in {".part", ".ytdl", ".json"}
        )
        if not candidates:
            raise IngestionError("다운로드된 영상 파일을 찾지 못했습니다.")
        return max(candidates, key=lambda path: path.stat().st_size)

    @staticmethod
    def _pick_language(languages: dict[str, Any], prefix: str) -> str | None:
        if prefix in languages:
            return prefix
        prefix_lower = prefix.lower()
        matches = sorted(
            key
            for key in languages
            if key.lower().startswith(prefix_lower + "-")
            or key.lower().startswith(prefix_lower + "_")
            or key.lower().startswith(prefix_lower + ".")
        )
        return matches[0] if matches else None

    def download_subtitles(self, youtube_url: str, destination: Path) -> Path | None:
        normalized, _ = validate_youtube_url(youtube_url)
        info = self._extract_info(normalized)
        manual = info.get("subtitles") or {}
        automatic = info.get("automatic_captions") or {}

        track: tuple[str, bool] | None = None
        # Required priority: Korean manual, Korean automatic, English manual, English automatic.
        for languages, prefix, is_auto in (
            (manual, "ko", False),
            (automatic, "ko", True),
            (manual, "en", False),
            (automatic, "en", True),
        ):
            language = self._pick_language(languages, prefix)
            if language:
                track = (language, is_auto)
                break
        if track is None:
            return None

        language, is_auto = track
        destination.mkdir(parents=True, exist_ok=True)
        output_template = destination / "captions.%(ext)s"
        mode = "--write-auto-subs" if is_auto else "--write-subs"
        try:
            self._run(
                [
                    *self._base_args(),
                    "--skip-download",
                    mode,
                    "--sub-langs",
                    language,
                    "--sub-format",
                    "vtt/srt/best",
                    "--output",
                    str(output_template),
                    normalized,
                ],
                timeout=min(self.timeout_seconds, 180),
            )
        except IngestionError:
            return None
        candidates = [
            path
            for path in destination.glob("captions*")
            if path.is_file() and path.suffix.lower() in {".vtt", ".srt"}
        ]
        return max(candidates, key=lambda path: path.stat().st_size) if candidates else None
