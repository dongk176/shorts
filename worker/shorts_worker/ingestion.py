from __future__ import annotations

import json
import random
import subprocess
import sys
import time
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .errors import (
    BotCheckError,
    IngestionError,
    RetryableIngestionError,
    RetryExhaustedIngestionError,
)
from .schemas import MAX_CHANNEL_NAME_CHARS
from .url_validation import validate_youtube_url

MAX_ACQUISITION_ATTEMPTS = 10
MAX_RECORDED_FAILURE_REASONS = 10
RETRY_DELAY_BASE_SECONDS = (5.0, 10.0, 15.0, 20.0, 30.0, 40.0, 50.0, 60.0, 60.0)
RETRY_DELAY_JITTER_RATIO = 0.2


def _log_ingestion_event(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, separators=(",", ":"), default=str), flush=True)


def _failure_reason(error: Exception) -> str:
    message = " ".join(str(error).split())[:240]
    return f"{type(error).__name__}: {message}"


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
    subtitle_source: str = "none"
    subtitle_language: str | None = None
    subtitle_fetch_status: str = "unknown"
    subtitle_matching_track_count: int = 0
    subtitle_failed_attempt_count: int = 0
    subtitle_empty_attempt_count: int = 0
    video_attempt_count: int = 1
    video_failed_attempt_count: int = 0
    video_failure_reasons: tuple[str, ...] = ()
    subtitle_attempt_count: int = 1
    subtitle_work_failed_attempt_count: int = 0
    subtitle_failure_reasons: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class VideoDownloadResult:
    metadata: VideoMetadata
    path: Path
    attempt_count: int
    failed_attempt_count: int
    failure_reasons: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SubtitleDownloadResult:
    path: Path | None
    source: str
    language: str | None
    status: str
    matching_track_count: int = 0
    failed_attempt_count: int = 0
    empty_attempt_count: int = 0
    work_attempt_count: int = 1
    work_failed_attempt_count: int = 0
    failure_reasons: tuple[str, ...] = ()
    retryable: bool = False


class IngestionProvider(ABC):
    @abstractmethod
    def download_bundle(
        self, youtube_url: str, destination: Path, *, job_id: str | None = None
    ) -> DownloadedAssetBundle:
        raise NotImplementedError


class YtDlpIngestionProvider(IngestionProvider):
    def __init__(
        self,
        *,
        timeout_seconds: float = 600,
        max_attempts: int = MAX_ACQUISITION_ATTEMPTS,
        retry_backoff_seconds: float = 1.0,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_attempts = max(1, min(MAX_ACQUISITION_ATTEMPTS, int(max_attempts)))
        self.retry_backoff_seconds = max(0.0, float(retry_backoff_seconds))

    def _retry_delay_seconds(self, failed_attempt: int) -> float:
        if self.retry_backoff_seconds <= 0:
            return 0.0
        index = max(0, min(failed_attempt - 1, len(RETRY_DELAY_BASE_SECONDS) - 1))
        base_delay = RETRY_DELAY_BASE_SECONDS[index] * self.retry_backoff_seconds
        jitter = base_delay * RETRY_DELAY_JITTER_RATIO
        return random.uniform(base_delay - jitter, base_delay + jitter)

    @staticmethod
    def _wait_before_retry(delay_seconds: float) -> None:
        if delay_seconds > 0:
            time.sleep(delay_seconds)

    def _log_failed_work_attempt(
        self,
        *,
        asset: str,
        attempt: int,
        error: Exception,
        job_id: str | None,
        next_retry_delay_seconds: float | None,
    ) -> str:
        reason = _failure_reason(error)
        _log_ingestion_event(
            "ingestion_work_attempt_failed",
            job_id=job_id,
            asset=asset,
            attempt=attempt,
            max_attempts=self.max_attempts,
            retrying=attempt < self.max_attempts,
            next_retry_delay_seconds=(
                round(next_retry_delay_seconds, 3)
                if next_retry_delay_seconds is not None
                else None
            ),
            error_type=type(error).__name__,
            failure_reason=reason,
        )
        return reason

    def _log_terminal_work_failure(
        self,
        *,
        asset: str,
        attempt: int,
        error: Exception,
        job_id: str | None,
    ) -> None:
        _log_ingestion_event(
            "ingestion_work_failed",
            job_id=job_id,
            asset=asset,
            attempt_count=attempt,
            retryable=False,
            error_type=type(error).__name__,
            failure_reason=_failure_reason(error),
        )

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

        last_error: RetryableIngestionError | None = None
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
                raise BotCheckError(
                    "YouTube가 현재 서버의 자동 요청을 제한했습니다. 로그인 정보나 쿠키를 "
                    "이용한 우회는 지원하지 않습니다. 잠시 후 다시 시도하거나 다른 사용 "
                    "허가된 공개 영상을 이용해 주세요."
                )

            if "http error 429" in lowered_output or "too many requests" in lowered_output:
                raise BotCheckError(
                    "YouTube가 현재 서버의 요청 빈도를 제한했습니다. 같은 서버에서 즉시 "
                    "재시도하지 않고 잠시 대기합니다."
                )

            if (
                "connection refused" in lowered_output
                or "proxy" in lowered_output
                or "socks" in lowered_output
            ):
                last_error = RetryableIngestionError(
                    "프록시 연결 오류로 다운로드할 수 없습니다."
                )
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
                continue

            detail = output.strip().splitlines()
            last_line = detail[-1] if detail else "알 수 없는 오류"
            raise IngestionError(
                "영상을 가져오지 못했습니다. 공개 영상인지, 로그인이 필요하지 않은지 "
                "확인해 주세요. "
                f"({last_line[:300]})"
            )
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

    def _download_video_once(
        self, normalized: str, expected_id: str, destination: Path
    ) -> tuple[VideoMetadata, Path]:
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
            if path.is_file()
            and path.suffix.lower() in {".m4v", ".mkv", ".mov", ".mp4", ".webm"}
        ]
        if not video_candidates:
            raise IngestionError("다운로드된 영상 파일을 찾지 못했습니다.")
        return (
            self._metadata_from_info(info),
            max(video_candidates, key=lambda path: path.stat().st_size),
        )

    def _download_video_work(
        self,
        normalized: str,
        expected_id: str,
        destination: Path,
        *,
        job_id: str | None,
    ) -> VideoDownloadResult:
        failure_reasons: list[str] = []
        for attempt in range(1, self.max_attempts + 1):
            try:
                metadata, path = self._download_video_once(
                    normalized, expected_id, destination
                )
                result = VideoDownloadResult(
                    metadata=metadata,
                    path=path,
                    attempt_count=attempt,
                    failed_attempt_count=len(failure_reasons),
                    failure_reasons=tuple(failure_reasons),
                )
                _log_ingestion_event(
                    "ingestion_work_completed",
                    job_id=job_id,
                    asset="video",
                    attempt_count=result.attempt_count,
                    failed_attempt_count=result.failed_attempt_count,
                    failure_reasons=result.failure_reasons,
                )
                return result
            except (RetryableIngestionError, BotCheckError) as exc:
                next_retry_delay = (
                    self._retry_delay_seconds(attempt)
                    if attempt < self.max_attempts
                    else None
                )
                failure_reasons.append(
                    self._log_failed_work_attempt(
                        asset="video",
                        attempt=attempt,
                        error=exc,
                        job_id=job_id,
                        next_retry_delay_seconds=next_retry_delay,
                    )
                )
                failure_reasons = failure_reasons[-MAX_RECORDED_FAILURE_REASONS:]
                if attempt >= self.max_attempts:
                    _log_ingestion_event(
                        "ingestion_work_exhausted",
                        job_id=job_id,
                        asset="video",
                        attempt_count=attempt,
                        failed_attempt_count=attempt,
                        error_type=type(exc).__name__,
                        failure_reasons=tuple(failure_reasons),
                    )
                    if isinstance(exc, BotCheckError):
                        raise
                    raise RetryExhaustedIngestionError(
                        "원본 영상 다운로드가 임시 네트워크 오류로 "
                        f"{self.max_attempts}회 실패했습니다."
                    ) from exc
                if next_retry_delay is None:
                    raise AssertionError(
                        "retry delay is required before the last attempt"
                    ) from exc
                self._wait_before_retry(next_retry_delay)
            except IngestionError as exc:
                self._log_terminal_work_failure(
                    asset="video", attempt=attempt, error=exc, job_id=job_id
                )
                raise
        raise AssertionError("unreachable")

    def _download_subtitle_work(
        self,
        normalized: str,
        destination: Path,
        *,
        job_id: str | None,
    ) -> SubtitleDownloadResult:
        work_failure_reasons: list[str] = []
        track_failed_attempt_count = 0
        track_empty_attempt_count = 0
        matching_track_count = 0
        for attempt in range(1, self.max_attempts + 1):
            retry_error: RetryableIngestionError | BotCheckError | None = None
            try:
                info = self._extract_info(normalized)
                result = self._download_best_subtitles_result(
                    normalized, info, destination
                )
                track_failed_attempt_count += result.failed_attempt_count
                track_empty_attempt_count += result.empty_attempt_count
                matching_track_count = max(
                    matching_track_count, result.matching_track_count
                )
                if not result.retryable:
                    combined_reasons = [
                        *work_failure_reasons,
                        *result.failure_reasons,
                    ][-MAX_RECORDED_FAILURE_REASONS:]
                    completed = replace(
                        result,
                        matching_track_count=matching_track_count,
                        failed_attempt_count=track_failed_attempt_count,
                        empty_attempt_count=track_empty_attempt_count,
                        work_attempt_count=attempt,
                        work_failed_attempt_count=len(work_failure_reasons),
                        failure_reasons=tuple(combined_reasons),
                    )
                    _log_ingestion_event(
                        "ingestion_work_completed",
                        job_id=job_id,
                        asset="subtitle",
                        attempt_count=completed.work_attempt_count,
                        failed_attempt_count=completed.work_failed_attempt_count,
                        track_failed_attempt_count=completed.failed_attempt_count,
                        status=completed.status,
                        failure_reasons=completed.failure_reasons,
                    )
                    return completed
                retry_message = "자막 다운로드 중 임시 네트워크 오류가 발생했습니다."
                if result.failure_reasons:
                    _, separator, detail = result.failure_reasons[-1].partition(": ")
                    retry_message = detail if separator else result.failure_reasons[-1]
                retry_error = RetryableIngestionError(retry_message)
            except (RetryableIngestionError, BotCheckError) as exc:
                retry_error = exc
            except IngestionError as exc:
                self._log_terminal_work_failure(
                    asset="subtitle", attempt=attempt, error=exc, job_id=job_id
                )
                raise

            if retry_error is None:
                raise AssertionError("retryable subtitle result requires an error")
            next_retry_delay = (
                self._retry_delay_seconds(attempt)
                if attempt < self.max_attempts
                else None
            )
            work_failure_reasons.append(
                self._log_failed_work_attempt(
                    asset="subtitle",
                    attempt=attempt,
                    error=retry_error,
                    job_id=job_id,
                    next_retry_delay_seconds=next_retry_delay,
                )
            )
            work_failure_reasons = work_failure_reasons[-MAX_RECORDED_FAILURE_REASONS:]
            if attempt >= self.max_attempts:
                exhausted = SubtitleDownloadResult(
                    path=None,
                    source="none",
                    language=None,
                    status="download_failed",
                    matching_track_count=matching_track_count,
                    failed_attempt_count=track_failed_attempt_count,
                    empty_attempt_count=track_empty_attempt_count,
                    work_attempt_count=attempt,
                    work_failed_attempt_count=attempt,
                    failure_reasons=tuple(work_failure_reasons),
                )
                _log_ingestion_event(
                    "ingestion_work_completed",
                    job_id=job_id,
                    asset="subtitle",
                    attempt_count=exhausted.work_attempt_count,
                    failed_attempt_count=exhausted.work_failed_attempt_count,
                    track_failed_attempt_count=exhausted.failed_attempt_count,
                    status=exhausted.status,
                    failure_reasons=exhausted.failure_reasons,
                )
                return exhausted
            if next_retry_delay is None:
                raise AssertionError("retry delay is required before the last attempt")
            self._wait_before_retry(next_retry_delay)
        raise AssertionError("unreachable")

    def download_bundle(
        self, youtube_url: str, destination: Path, *, job_id: str | None = None
    ) -> DownloadedAssetBundle:
        """Download video and captions concurrently with independent bounded retries."""
        normalized, expected_id = validate_youtube_url(youtube_url)
        destination.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="youtube-acquisition"
        ) as executor:
            video_future = executor.submit(
                self._download_video_work,
                normalized,
                expected_id,
                destination / "video",
                job_id=job_id,
            )
            subtitle_future = executor.submit(
                self._download_subtitle_work,
                normalized,
                destination / "subtitles",
                job_id=job_id,
            )
            video = video_future.result()
            subtitle = subtitle_future.result()

        return DownloadedAssetBundle(
            metadata=video.metadata,
            video_path=video.path,
            subtitle_path=subtitle.path,
            subtitle_source=subtitle.source,
            subtitle_language=subtitle.language,
            subtitle_fetch_status=subtitle.status,
            subtitle_matching_track_count=subtitle.matching_track_count,
            subtitle_failed_attempt_count=subtitle.failed_attempt_count,
            subtitle_empty_attempt_count=subtitle.empty_attempt_count,
            video_attempt_count=video.attempt_count,
            video_failed_attempt_count=video.failed_attempt_count,
            video_failure_reasons=video.failure_reasons,
            subtitle_attempt_count=subtitle.work_attempt_count,
            subtitle_work_failed_attempt_count=subtitle.work_failed_attempt_count,
            subtitle_failure_reasons=subtitle.failure_reasons,
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
        return self._download_best_subtitles_result(
            normalized_url, info, destination
        ).path

    def _download_best_subtitles_result(
        self, normalized_url: str, info: dict[str, Any], destination: Path
    ) -> SubtitleDownloadResult:
        destination.mkdir(parents=True, exist_ok=True)
        tracks = (
            ("official", info.get("subtitles") or {}, "--write-subs"),
            ("automatic", info.get("automatic_captions") or {}, "--write-auto-subs"),
        )
        has_any_tracks = any(languages for _, languages, _ in tracks)
        matching_track_count = 0
        failed_attempt_count = 0
        empty_attempt_count = 0
        retryable_failure_count = 0
        failure_reasons: list[str] = []
        for source, languages, mode in tracks:
            language = self._pick_language(languages, "ko")
            if not language:
                continue
            matching_track_count += 1
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
            except BotCheckError:
                raise
            except RetryableIngestionError as exc:
                failed_attempt_count += 1
                retryable_failure_count += 1
                failure_reasons.append(_failure_reason(exc))
                failure_reasons = failure_reasons[-MAX_RECORDED_FAILURE_REASONS:]
                continue
            except IngestionError as exc:
                failed_attempt_count += 1
                failure_reasons.append(_failure_reason(exc))
                failure_reasons = failure_reasons[-MAX_RECORDED_FAILURE_REASONS:]
                continue
            candidates = [
                path
                for path in destination.glob("captions*")
                if path.is_file() and path.suffix.lower() in {".vtt", ".srt"}
            ]
            if candidates:
                return SubtitleDownloadResult(
                    path=max(candidates, key=lambda path: path.stat().st_size),
                    source=source,
                    language=language,
                    status="downloaded",
                    matching_track_count=matching_track_count,
                    failed_attempt_count=failed_attempt_count,
                    empty_attempt_count=empty_attempt_count,
                    failure_reasons=tuple(failure_reasons),
                )
            empty_attempt_count += 1

        if not has_any_tracks:
            status = "no_tracks"
        elif matching_track_count == 0:
            status = "no_matching_language"
        elif failed_attempt_count:
            status = "download_failed"
        else:
            status = "download_empty"
        return SubtitleDownloadResult(
            path=None,
            source="none",
            language=None,
            status=status,
            matching_track_count=matching_track_count,
            failed_attempt_count=failed_attempt_count,
            empty_attempt_count=empty_attempt_count,
            failure_reasons=tuple(failure_reasons),
            retryable=retryable_failure_count > 0,
        )
