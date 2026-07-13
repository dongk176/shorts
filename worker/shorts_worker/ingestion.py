from __future__ import annotations

import json
import subprocess
import sys
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import BotCheckError, IngestionError, RetryableIngestionError
from .schemas import MAX_CHANNEL_NAME_CHARS
from .url_validation import validate_youtube_url


@dataclass(frozen=True, slots=True)
class VideoMetadata:
    video_id: str
    title: str
    channel_name: str
    thumbnail_url: str
    duration_seconds: float


@dataclass(frozen=True, slots=True)
class DownloadedAssetBundle:
    metadata: VideoMetadata
    video_path: Path
    subtitle_path: Path | None


class IngestionProvider(ABC):
    @abstractmethod
    def download_bundle(
        self, youtube_url: str, destination: Path
    ) -> DownloadedAssetBundle:
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
        import os

        proxies: list[str | None] = []
        if warp_proxy := os.environ.get("WARP_PROXY_URL"):
            proxies.append(warp_proxy)
        proxies.append(None)
        if fallback_proxy := os.environ.get("FALLBACK_PROXY_URL"):
            if fallback_proxy not in proxies:
                proxies.append(fallback_proxy)

        last_error: IngestionError | None = None
        direct_error: IngestionError | None = None
        for proxy in proxies:
            current_args = list(args)
            if proxy:
                current_args.extend(["--proxy", proxy])

            try:
                result = subprocess.run(
                    current_args,
                    capture_output=True,
                    text=True,
                    timeout=timeout or self.timeout_seconds,
                    check=False,
                    shell=False,
                )
            except subprocess.TimeoutExpired:
                last_error = RetryableIngestionError(
                    "YouTube 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
                )
                if proxy is None:
                    direct_error = last_error
                continue
            except OSError as exc:
                raise IngestionError(
                    "yt-dlp를 실행할 수 없습니다. 설치 상태를 확인해 주세요."
                ) from exc
            
            if result.returncode == 0:
                return result
                
            output = result.stderr or result.stdout
            lowered_output = output.lower()
            bot_challenges = (
                "sign in to confirm you’re not a bot",
                "sign in to confirm you're not a bot",
            )
            
            if any(message in lowered_output for message in bot_challenges):
                last_error = BotCheckError(
                    "YouTube가 현재 서버의 자동 요청을 제한했습니다. 로그인 정보나 쿠키를 "
                    "이용한 우회는 지원하지 않습니다. 잠시 후 다시 시도하거나 다른 사용 "
                    "허가된 공개 영상을 이용해 주세요."
                )
                if proxy is None:
                    direct_error = last_error
                continue

            if "http error 429" in lowered_output or "too many requests" in lowered_output:
                last_error = BotCheckError(
                    "YouTube가 현재 서버의 요청 빈도를 제한했습니다. 같은 서버에서 즉시 "
                    "재시도하지 않고 잠시 대기합니다."
                )
                if proxy is None:
                    direct_error = last_error
                continue

            if (
                "connection refused" in lowered_output
                or "proxy" in lowered_output
                or "socks" in lowered_output
            ):
                last_error = RetryableIngestionError(
                    "프록시 연결 오류로 다운로드할 수 없습니다."
                )
                if proxy is None:
                    direct_error = last_error
                continue

            if any(message in lowered_output for message in (
                "connection reset",
                "connection timed out",
                "network is unreachable",
                "name or service not known",
                "remote end closed connection",
                "remote disconnected",
                "temporary failure in name resolution",
                "tlsv1 alert",
            )):
                last_error = RetryableIngestionError(
                    "YouTube와의 임시 네트워크 연결 오류로 영상을 가져오지 못했습니다."
                )
                if proxy is None:
                    direct_error = last_error
                continue

            detail = output.strip().splitlines()
            last_line = detail[-1] if detail else "알 수 없는 오류"
            last_error = IngestionError(
                "영상을 가져오지 못했습니다. 공개 영상인지, 로그인이 필요하지 않은지 "
                "확인해 주세요. "
                f"({last_line[:300]})"
            )
            if proxy is None:
                direct_error = last_error

        if direct_error:
            raise direct_error
        if last_error:
            raise last_error

        raise IngestionError("알 수 없는 내부 오류가 발생했습니다.")

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

    @staticmethod
    def _metadata_from_info(info: dict[str, Any]) -> VideoMetadata:
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
            channel_name=str(
                info.get("channel") or info.get("uploader") or "YouTube 채널"
            )[:MAX_CHANNEL_NAME_CHARS],
            thumbnail_url=thumbnail,
            duration_seconds=duration_seconds,
        )

    def analyze_url(self, youtube_url: str) -> VideoMetadata:
        return self._metadata_from_info(self._extract_info(youtube_url))

    def download_bundle(self, youtube_url: str, destination: Path) -> DownloadedAssetBundle:
        """Download a video, then prefer official captions over automatic captions."""
        normalized, expected_id = validate_youtube_url(youtube_url)
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
                "--write-info-json",
                "--output",
                str(output_template),
                normalized,
            ]
        )

        info_path = destination / "source.info.json"
        try:
            info = json.loads(info_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise IngestionError("YouTube 영상 정보를 해석하지 못했습니다.") from exc
        if str(info.get("id", "")) != expected_id:
            raise IngestionError("요청한 영상과 다른 영상이 반환되어 처리를 중단했습니다.")

        video_candidates = [
            path
            for path in destination.glob("source.*")
            if path.is_file() and path.suffix.lower() in {".m4v", ".mkv", ".mov", ".mp4", ".webm"}
        ]
        if not video_candidates:
            raise IngestionError("다운로드된 영상 파일을 찾지 못했습니다.")
        video_path = max(video_candidates, key=lambda path: path.stat().st_size)
        subtitle_path = self._download_best_subtitles(normalized, info, destination)

        return DownloadedAssetBundle(
            metadata=self._metadata_from_info(info),
            video_path=video_path,
            subtitle_path=subtitle_path,
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
        return self._download_best_subtitles(normalized, info, destination)

    def _download_best_subtitles(
        self, normalized_url: str, info: dict[str, Any], destination: Path
    ) -> Path | None:
        destination.mkdir(parents=True, exist_ok=True)
        tracks = (
            (info.get("subtitles") or {}, "--write-subs"),
            (info.get("automatic_captions") or {}, "--write-auto-subs"),
        )
        for languages, mode in tracks:
            language = self._pick_language(languages, "ko")
            if not language:
                continue
            for old_caption in destination.glob("captions*"):
                if old_caption.is_file():
                    old_caption.unlink(missing_ok=True)
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
                        str(destination / "captions.%(ext)s"),
                        normalized_url,
                    ],
                    timeout=min(self.timeout_seconds, 180),
                )
            except IngestionError:
                continue
            candidates = [
                path
                for path in destination.glob("captions*")
                if path.is_file() and path.suffix.lower() in {".vtt", ".srt"}
            ]
            if candidates:
                return max(candidates, key=lambda path: path.stat().st_size)
        return None
