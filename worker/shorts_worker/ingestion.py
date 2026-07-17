from __future__ import annotations

import json
import math
import os
import random
import re
import subprocess
import sys
import threading
import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .errors import (
    BotCheckError,
    IngestionError,
    RetryableIngestionError,
    RetryExhaustedIngestionError,
)
from .schemas import MAX_CHANNEL_NAME_CHARS
from .url_validation import validate_youtube_url

MAX_ACQUISITION_ATTEMPTS = 10
MAX_SOURCE_DURATION_SECONDS = 60 * 60
MAX_RECORDED_FAILURE_REASONS = 10
RETRY_DELAY_BASE_SECONDS = (5.0, 10.0, 15.0, 20.0, 30.0, 40.0, 50.0, 60.0, 60.0)
RETRY_DELAY_JITTER_RATIO = 0.2
MAX_CONFIGURED_EGRESS_ROUTES = 32
MAX_WARP_EGRESS_ROUTES = 4
DEFAULT_BOT_CHECK_ROUTE_COOLDOWN_SECONDS = 15.0
_ROUTE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
_SUPPORTED_PROXY_SCHEMES = frozenset({"http", "https", "socks5", "socks5h"})
_SUPPORTED_EGRESS_MODES = frozenset({"auto", "webshare_isp", "warp"})
_SUPPORTED_EGRESS_CLASSES = frozenset({"webshare_isp", "warp", "contracted_proxy"})
_TERMINAL_RESTRICTIONS = (
    (
        ("private video", "video is private"),
        "youtube_private_video",
        "비공개 영상은 지원하지 않습니다.",
    ),
    (
        ("not available in your country", "not available in your region"),
        "youtube_region_restricted",
        "지역 제한이 있는 영상은 지원하지 않습니다.",
    ),
    (
        ("members-only", "members only", "join this channel"),
        "youtube_members_only",
        "채널 멤버십 전용 영상은 지원하지 않습니다.",
    ),
    (
        ("paid content", "purchase this content"),
        "youtube_paid_content",
        "유료 영상은 지원하지 않습니다.",
    ),
    (
        ("drm protected", "drm-protected"),
        "youtube_drm_restricted",
        "DRM으로 보호된 영상은 지원하지 않습니다.",
    ),
)
_RETRYABLE_CONTENT_UNAVAILABLE_MARKERS = (
    "video unavailable. this content isn't available.",
    "video unavailable. this content isn’t available.",
)
_URL_PATTERN = re.compile(r"(?i)\b(?:https?|socks5h?)://\S+")
_SENSITIVE_VALUE_PATTERN = re.compile(
    r"(?i)\b(authorization|cookie|password|proxy|token)\s*[:=]\s*(?:bearer\s+)?\S+"
)


def _log_ingestion_event(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, separators=(",", ":"), default=str), flush=True)


def _failure_reason(error: Exception) -> str:
    message = " ".join(str(error).split())[:240]
    return f"{type(error).__name__}: {message}"


def _safe_upstream_reason(output: str) -> str:
    lines = [" ".join(line.split()) for line in output.splitlines() if line.strip()]
    reason = lines[-1] if lines else "yt-dlp returned no error detail"
    reason = _URL_PATTERN.sub("[url]", reason)
    reason = _SENSITIVE_VALUE_PATTERN.sub(lambda match: f"{match.group(1)}=[redacted]", reason)
    return reason[:500]


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
    video_attempt_count: int = 1
    video_failed_attempt_count: int = 0
    video_failure_reasons: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class VideoDownloadResult:
    metadata: VideoMetadata
    path: Path
    attempt_count: int
    failed_attempt_count: int
    failure_reasons: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EgressRoute:
    route_id: str
    proxy_url: str
    egress_class: str


def _parse_configured_routes(
    environment_name: str,
    *,
    default_egress_class: str,
    max_routes: int,
) -> tuple[EgressRoute, ...]:
    raw_routes = os.environ.get(environment_name, "").strip()
    if not raw_routes:
        return ()
    try:
        payload = json.loads(raw_routes)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{environment_name} must contain valid JSON") from exc
    if not isinstance(payload, list) or not payload:
        raise ValueError(f"{environment_name} must be a non-empty JSON array")
    if len(payload) > max_routes:
        raise ValueError(f"{environment_name} supports at most {max_routes} routes")

    routes: list[EgressRoute] = []
    route_ids: set[str] = set()
    proxy_urls: set[str] = set()
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError(f"each {environment_name} route must be a JSON object")
        route_id = str(item.get("id") or "").strip().lower()
        proxy_url = str(item.get("proxy_url") or "").strip()
        egress_class = str(item.get("egress_class") or default_egress_class).strip().lower()
        parsed_proxy = urlsplit(proxy_url)
        if not _ROUTE_ID_PATTERN.fullmatch(route_id):
            raise ValueError("route ids must use lowercase letters, digits, _ or -")
        if (
            parsed_proxy.scheme.lower() not in _SUPPORTED_PROXY_SCHEMES
            or not parsed_proxy.hostname
            or parsed_proxy.port is None
        ):
            raise ValueError("route proxy URLs must be valid HTTP or SOCKS URLs")
        if egress_class not in _SUPPORTED_EGRESS_CLASSES:
            raise ValueError(f"unsupported egress class: {egress_class}")
        if route_id in route_ids:
            raise ValueError(f"duplicate route id: {route_id}")
        if proxy_url in proxy_urls:
            raise ValueError("duplicate route proxy URL")
        route_ids.add(route_id)
        proxy_urls.add(proxy_url)
        routes.append(
            EgressRoute(
                route_id=route_id,
                proxy_url=proxy_url,
                egress_class=egress_class,
            )
        )
    return tuple(routes)


def _configured_warp_routes() -> tuple[EgressRoute, ...]:
    return _parse_configured_routes(
        "WARP_PROXY_ROUTES_JSON",
        default_egress_class="warp",
        max_routes=MAX_WARP_EGRESS_ROUTES,
    )


def _configured_routes() -> tuple[EgressRoute, ...]:
    mode = os.environ.get("INGESTION_EGRESS_MODE", "auto").strip().lower() or "auto"
    if mode not in _SUPPORTED_EGRESS_MODES:
        raise ValueError(f"unsupported INGESTION_EGRESS_MODE: {mode}")

    configured = _parse_configured_routes(
        "INGESTION_PROXY_ROUTES_JSON",
        default_egress_class="contracted_proxy",
        max_routes=MAX_CONFIGURED_EGRESS_ROUTES,
    )
    if mode == "webshare_isp":
        if not configured:
            raise ValueError("webshare_isp mode requires INGESTION_PROXY_ROUTES_JSON")
        if any(route.egress_class != "webshare_isp" for route in configured):
            raise ValueError("webshare_isp mode only accepts webshare_isp routes")
        return configured
    if mode == "warp":
        routes = _configured_warp_routes()
        if not routes:
            raise ValueError("warp mode requires WARP_PROXY_ROUTES_JSON")
        return routes
    if configured:
        return configured
    return _configured_warp_routes()


class EgressRoutePool:
    def __init__(
        self,
        routes: tuple[EgressRoute, ...],
        *,
        bot_check_cooldown_seconds: float,
        clock: Callable[[], float] | None = None,
        waiter: Callable[[float], None] | None = None,
    ) -> None:
        if not routes:
            raise ValueError("an egress route pool requires at least one route")
        self.routes = routes
        self.bot_check_cooldown_seconds = max(0.0, min(300.0, float(bot_check_cooldown_seconds)))
        self._clock = clock or time.monotonic
        self._waiter = waiter or time.sleep
        self._lock = threading.Lock()
        self._next_index = 0
        self._cooldown_until = {route.route_id: 0.0 for route in routes}

    def required(self, route_id: str) -> EgressRoute:
        normalized = str(route_id).strip().lower()
        for route in self.routes:
            if route.route_id == normalized:
                return route
        raise IngestionError(
            "작업에 배정된 수집 경로를 현재 설정에서 찾을 수 없습니다.",
            code="ingestion_route_not_configured",
            details={"route_id": normalized},
        )

    def acquire(
        self,
        *,
        job_id: str | None,
        asset: str,
        attempt: int,
    ) -> EgressRoute:
        while True:
            with self._lock:
                now = self._clock()
                for offset in range(len(self.routes)):
                    index = (self._next_index + offset) % len(self.routes)
                    route = self.routes[index]
                    if self._cooldown_until[route.route_id] <= now:
                        self._next_index = (index + 1) % len(self.routes)
                        break
                else:
                    route = None
                    wait_seconds = max(0.0, min(self._cooldown_until.values()) - now)

            if route is not None:
                _log_ingestion_event(
                    "ingestion_route_selected",
                    job_id=job_id,
                    asset=asset,
                    attempt=attempt,
                    route_id=route.route_id,
                    egress_class=route.egress_class,
                )
                return route

            _log_ingestion_event(
                "ingestion_routes_waiting",
                job_id=job_id,
                asset=asset,
                attempt=attempt,
                wait_seconds=round(wait_seconds, 3),
                reason="all_routes_cooling_down",
            )
            self._waiter(wait_seconds)

    def mark_bot_check(
        self,
        route: EgressRoute,
        *,
        job_id: str | None,
        asset: str,
        attempt: int,
    ) -> None:
        with self._lock:
            cooldown_until = self._clock() + self.bot_check_cooldown_seconds
            self._cooldown_until[route.route_id] = max(
                self._cooldown_until[route.route_id], cooldown_until
            )
        _log_ingestion_event(
            "ingestion_route_cooldown_started",
            job_id=job_id,
            asset=asset,
            attempt=attempt,
            route_id=route.route_id,
            egress_class=route.egress_class,
            cooldown_seconds=round(self.bot_check_cooldown_seconds, 3),
        )


class IngestionProvider(ABC):
    @abstractmethod
    def download_bundle(
        self,
        youtube_url: str,
        destination: Path,
        *,
        range_start_seconds: float | None = None,
        range_end_seconds: float | None = None,
        job_id: str | None = None,
        route_id: str | None = None,
    ) -> DownloadedAssetBundle:
        raise NotImplementedError


class YtDlpIngestionProvider(IngestionProvider):
    def __init__(
        self,
        *,
        timeout_seconds: float = 600,
        max_attempts: int = MAX_ACQUISITION_ATTEMPTS,
        retry_backoff_seconds: float = 1.0,
        bot_check_cooldown_seconds: float | None = None,
        route_clock: Callable[[], float] | None = None,
        route_waiter: Callable[[float], None] | None = None,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_attempts = max(1, min(MAX_ACQUISITION_ATTEMPTS, int(max_attempts)))
        self.retry_backoff_seconds = max(0.0, float(retry_backoff_seconds))
        if bot_check_cooldown_seconds is None:
            raw_cooldown = os.environ.get("INGESTION_BOT_CHECK_COOLDOWN_SECONDS") or os.environ.get(
                "WARP_BOT_CHECK_COOLDOWN_SECONDS", str(DEFAULT_BOT_CHECK_ROUTE_COOLDOWN_SECONDS)
            )
            try:
                bot_check_cooldown_seconds = float(raw_cooldown)
            except ValueError as exc:
                raise ValueError("INGESTION_BOT_CHECK_COOLDOWN_SECONDS must be a number") from exc
        routes = _configured_routes()
        self._route_pool = (
            EgressRoutePool(
                routes,
                bot_check_cooldown_seconds=bot_check_cooldown_seconds,
                clock=route_clock,
                waiter=route_waiter,
            )
            if routes
            else None
        )

    def _acquire_route(
        self,
        *,
        job_id: str | None,
        asset: str,
        attempt: int,
        required_route_id: str | None = None,
    ) -> EgressRoute | None:
        if self._route_pool is None:
            if required_route_id:
                raise IngestionError(
                    "작업에 수집 경로가 배정되었지만 프록시 풀이 비어 있습니다.",
                    code="ingestion_route_pool_empty",
                    details={"route_id": required_route_id},
                )
            return None
        if required_route_id:
            route = self._route_pool.required(required_route_id)
            _log_ingestion_event(
                "ingestion_route_selected",
                job_id=job_id,
                asset=asset,
                attempt=attempt,
                route_id=route.route_id,
                egress_class=route.egress_class,
                centrally_assigned=True,
            )
            return route
        return self._route_pool.acquire(job_id=job_id, asset=asset, attempt=attempt)

    def egress_class_for(self, route_id: str | None) -> str | None:
        if not route_id or self._route_pool is None:
            return None
        return self._route_pool.required(route_id).egress_class

    @property
    def configured_route_count(self) -> int:
        return len(self._route_pool.routes) if self._route_pool is not None else 0

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
        route: EgressRoute | None,
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
                round(next_retry_delay_seconds, 3) if next_retry_delay_seconds is not None else None
            ),
            error_type=type(error).__name__,
            failure_reason=reason,
            route_id=route.route_id if route else None,
            egress_class=route.egress_class if route else None,
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
            "15",
            "--retries",
            "1",
            "--fragment-retries",
            "1",
            "--extractor-retries",
            "1",
            "--file-access-retries",
            "1",
        ]

    def _run(
        self,
        args: list[str],
        *,
        timeout: float | None = None,
        route: EgressRoute | None = None,
        job_id: str | None = None,
        asset: str = "standalone",
        attempt: int = 1,
    ) -> subprocess.CompletedProcess[str]:
        selected_route = route
        if selected_route is None:
            selected_route = self._acquire_route(job_id=job_id, asset=asset, attempt=attempt)

        failure_context: dict[str, object] = {
            "asset": asset,
            "work_attempt": attempt,
        }
        if selected_route is not None:
            failure_context.update(
                {
                    "route_id": selected_route.route_id,
                    "egress_class": selected_route.egress_class,
                }
            )

        if selected_route is not None:
            proxies: list[str | None] = [selected_route.proxy_url]
        else:
            proxies = []
            if warp_proxy := os.environ.get("WARP_PROXY_URL"):
                proxies.append(warp_proxy)
            proxies.append(None)
            if fallback_proxy := os.environ.get("FALLBACK_PROXY_URL"):
                if fallback_proxy not in proxies:
                    proxies.append(fallback_proxy)

        last_error: IngestionError | None = None
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
                    "YouTube 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
                    code="youtube_timeout",
                    details=failure_context,
                )
                continue
            except OSError as exc:
                raise IngestionError(
                    "yt-dlp를 실행할 수 없습니다. 설치 상태를 확인해 주세요.",
                    code="yt_dlp_unavailable",
                    details=failure_context,
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
                if selected_route is not None and self._route_pool is not None:
                    self._route_pool.mark_bot_check(
                        selected_route,
                        job_id=job_id,
                        asset=asset,
                        attempt=attempt,
                    )
                last_error = BotCheckError(
                    "YouTube가 현재 서버의 자동 요청을 제한했습니다. 로그인 정보나 쿠키를 "
                    "이용한 우회는 지원하지 않습니다. 잠시 후 다시 시도하거나 다른 사용 "
                    "허가된 공개 영상을 이용해 주세요.",
                    code="youtube_bot_challenge",
                    details=failure_context,
                )
                continue

            if "http error 429" in lowered_output or "too many requests" in lowered_output:
                if selected_route is not None and self._route_pool is not None:
                    self._route_pool.mark_bot_check(
                        selected_route,
                        job_id=job_id,
                        asset=asset,
                        attempt=attempt,
                    )
                last_error = BotCheckError(
                    "YouTube가 현재 서버의 요청 빈도를 제한했습니다. 같은 서버에서 즉시 "
                    "재시도하지 않고 잠시 대기합니다.",
                    code="youtube_rate_limited",
                    details=failure_context,
                )
                continue

            for markers, code, message in _TERMINAL_RESTRICTIONS:
                if any(marker in lowered_output for marker in markers):
                    raise IngestionError(message, code=code, details=failure_context)

            if any(
                marker in lowered_output
                for marker in _RETRYABLE_CONTENT_UNAVAILABLE_MARKERS
            ):
                last_error = RetryableIngestionError(
                    "YouTube가 일시적으로 영상 재생 정보를 반환하지 않았습니다. "
                    "다른 허용된 수집 경로에서 다시 시도합니다.",
                    code="youtube_extractor_failed",
                    details={
                        **failure_context,
                        "upstream_reason": _safe_upstream_reason(output),
                    },
                )
                continue

            if (
                "unable to download video data" in lowered_output
                and "http error 403" in lowered_output
            ):
                last_error = RetryableIngestionError(
                    "YouTube 영상 데이터 요청이 일시적으로 거부되었습니다.",
                    code="youtube_media_forbidden",
                    details=failure_context,
                )
                continue

            if (
                "connection refused" in lowered_output
                or "proxy" in lowered_output
                or "socks" in lowered_output
            ):
                last_error = RetryableIngestionError(
                    "프록시 연결 오류로 다운로드할 수 없습니다.",
                    code="ingestion_proxy_connection_failed",
                    details=failure_context,
                )
                continue

            if any(
                message in lowered_output
                for message in (
                    "connection reset",
                    "connection timed out",
                    "network is unreachable",
                    "name or service not known",
                    "remote end closed connection",
                    "remote disconnected",
                    "temporary failure in name resolution",
                    "tlsv1 alert",
                )
            ):
                last_error = RetryableIngestionError(
                    "YouTube와의 임시 네트워크 연결 오류로 영상을 가져오지 못했습니다.",
                    code="youtube_network_error",
                    details=failure_context,
                )
                continue

            raise IngestionError(
                "영상을 가져오지 못했습니다. 공개 영상인지, 로그인이 필요하지 않은지 "
                "확인해 주세요.",
                code="youtube_extractor_failed",
                details={
                    **failure_context,
                    "upstream_reason": _safe_upstream_reason(output),
                },
            )
        if last_error:
            raise last_error

        raise IngestionError(
            "알 수 없는 내부 오류가 발생했습니다.",
            code="ingestion_no_egress_attempt",
            details=failure_context,
        )

    def _run_for_route(
        self,
        args: list[str],
        *,
        timeout: float | None,
        route: EgressRoute | None,
        job_id: str | None,
        asset: str,
        attempt: int,
    ) -> subprocess.CompletedProcess[str]:
        if route is None:
            return self._run(args, timeout=timeout)
        return self._run(
            args,
            timeout=timeout,
            route=route,
            job_id=job_id,
            asset=asset,
            attempt=attempt,
        )

    def _extract_info(
        self,
        youtube_url: str,
        *,
        route: EgressRoute | None = None,
        job_id: str | None = None,
        asset: str = "metadata",
        attempt: int = 1,
    ) -> dict[str, Any]:
        normalized, expected_id = validate_youtube_url(youtube_url)
        result = self._run_for_route(
            [
                *self._base_args(),
                "--dump-single-json",
                "--skip-download",
                normalized,
            ],
            timeout=min(self.timeout_seconds, 120),
            route=route,
            job_id=job_id,
            asset=asset,
            attempt=attempt,
        )
        try:
            info = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise IngestionError(
                "YouTube 영상 정보를 해석하지 못했습니다.",
                code="youtube_metadata_invalid",
                details={"asset": asset, "work_attempt": attempt},
            ) from exc
        if str(info.get("id", "")) != expected_id:
            raise IngestionError(
                "요청한 영상과 다른 영상 정보가 반환되어 처리를 중단했습니다.",
                code="youtube_video_id_mismatch",
                details={"asset": asset, "work_attempt": attempt},
            )
        return info

    @staticmethod
    def _metadata_from_info(info: dict[str, Any]) -> VideoMetadata:
        duration = info.get("duration")
        try:
            duration_seconds = float(duration)
        except (TypeError, ValueError) as exc:
            raise IngestionError(
                "영상 길이를 확인할 수 없는 영상은 지원하지 않습니다.",
                code="youtube_duration_missing",
            ) from exc
        if duration_seconds <= 0:
            raise IngestionError(
                "영상 길이를 확인할 수 없는 영상은 지원하지 않습니다.",
                code="youtube_duration_invalid",
            )
        thumbnails = info.get("thumbnails") or []
        thumbnail = str(info.get("thumbnail") or "")
        if not thumbnail and thumbnails:
            thumbnail = str(thumbnails[-1].get("url") or "")
        return VideoMetadata(
            video_id=str(info.get("id", "")),
            title=str(info.get("title") or "제목 없는 영상")[:500],
            channel_name=str(info.get("channel") or info.get("uploader") or "YouTube 채널")[
                :MAX_CHANNEL_NAME_CHARS
            ],
            thumbnail_url=thumbnail,
            duration_seconds=duration_seconds,
        )

    def analyze_url(self, youtube_url: str) -> VideoMetadata:
        return self._metadata_from_info(self._extract_info(youtube_url, asset="metadata"))

    @staticmethod
    def _download_section_args(
        range_start_seconds: float | None,
        range_end_seconds: float | None,
    ) -> list[str]:
        if range_start_seconds is None and range_end_seconds is None:
            return []
        if range_start_seconds is None or range_end_seconds is None:
            raise IngestionError(
                "다운로드 구간의 시작과 끝이 모두 필요합니다.",
                code="ingestion_range_incomplete",
            )

        start = float(range_start_seconds)
        end = float(range_end_seconds)
        if (
            not math.isfinite(start)
            or not math.isfinite(end)
            or start < 0
            or end <= start
            or end > MAX_SOURCE_DURATION_SECONDS
        ):
            raise IngestionError(
                "유효하지 않은 영상 다운로드 구간입니다.",
                code="ingestion_range_invalid",
                details={
                    "range_start_seconds": start if math.isfinite(start) else str(start),
                    "range_end_seconds": end if math.isfinite(end) else str(end),
                },
            )

        return [
            "--download-sections",
            f"*{start:.3f}-{end:.3f}",
            "--no-force-keyframes-at-cuts",
        ]

    def _download_video_once(
        self,
        normalized: str,
        expected_id: str,
        destination: Path,
        *,
        route: EgressRoute | None,
        job_id: str | None,
        attempt: int,
        range_start_seconds: float | None = None,
        range_end_seconds: float | None = None,
    ) -> tuple[VideoMetadata, Path]:
        destination.mkdir(parents=True, exist_ok=True)
        output_template = destination / "source.%(ext)s"
        self._run_for_route(
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
                *self._download_section_args(range_start_seconds, range_end_seconds),
                "--write-info-json",
                "--output",
                str(output_template),
                normalized,
            ],
            timeout=None,
            route=route,
            job_id=job_id,
            asset="video",
            attempt=attempt,
        )

        info_path = destination / "source.info.json"
        try:
            info = json.loads(info_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise IngestionError(
                "YouTube 영상 정보를 해석하지 못했습니다.",
                code="youtube_download_metadata_invalid",
                details={"asset": "video", "work_attempt": attempt},
            ) from exc
        if str(info.get("id", "")) != expected_id:
            raise IngestionError(
                "요청한 영상과 다른 영상이 반환되어 처리를 중단했습니다.",
                code="youtube_video_id_mismatch",
                details={"asset": "video", "work_attempt": attempt},
            )

        video_candidates = [
            path
            for path in destination.glob("source.*")
            if path.is_file() and path.suffix.lower() in {".m4v", ".mkv", ".mov", ".mp4", ".webm"}
        ]
        if not video_candidates:
            raise IngestionError(
                "다운로드된 영상 파일을 찾지 못했습니다.",
                code="ingestion_downloaded_file_missing",
                details={"asset": "video", "work_attempt": attempt},
            )
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
        range_start_seconds: float | None = None,
        range_end_seconds: float | None = None,
        route_id: str | None = None,
    ) -> VideoDownloadResult:
        failure_reasons: list[str] = []
        attempt_limit = 1 if route_id else self.max_attempts
        for attempt in range(1, attempt_limit + 1):
            route = self._acquire_route(
                job_id=job_id,
                asset="video",
                attempt=attempt,
                required_route_id=route_id,
            )
            try:
                metadata, path = self._download_video_once(
                    normalized,
                    expected_id,
                    destination,
                    route=route,
                    job_id=job_id,
                    attempt=attempt,
                    range_start_seconds=range_start_seconds,
                    range_end_seconds=range_end_seconds,
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
                    route_id=route.route_id if route else None,
                    egress_class=route.egress_class if route else None,
                )
                return result
            except (RetryableIngestionError, BotCheckError) as exc:
                next_retry_delay = (
                    self._retry_delay_seconds(attempt) if attempt < attempt_limit else None
                )
                failure_reasons.append(
                    self._log_failed_work_attempt(
                        asset="video",
                        attempt=attempt,
                        error=exc,
                        job_id=job_id,
                        next_retry_delay_seconds=next_retry_delay,
                        route=route,
                    )
                )
                failure_reasons = failure_reasons[-MAX_RECORDED_FAILURE_REASONS:]
                if attempt >= attempt_limit:
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
                    if route_id:
                        raise
                    raise RetryExhaustedIngestionError(
                        "원본 영상 다운로드가 임시 네트워크 오류로 "
                        f"{attempt_limit}회 실패했습니다.",
                        details={
                            "asset": "video",
                            "attempt_count": attempt_limit,
                            "failure_reasons": tuple(failure_reasons),
                        },
                    ) from exc
                if next_retry_delay is None:
                    raise AssertionError("retry delay is required before the last attempt") from exc
                self._wait_before_retry(next_retry_delay)
            except IngestionError as exc:
                self._log_terminal_work_failure(
                    asset="video", attempt=attempt, error=exc, job_id=job_id
                )
                raise
        raise AssertionError("unreachable")

    def download_bundle(
        self,
        youtube_url: str,
        destination: Path,
        *,
        range_start_seconds: float | None = None,
        range_end_seconds: float | None = None,
        job_id: str | None = None,
        route_id: str | None = None,
    ) -> DownloadedAssetBundle:
        """Download the source video with bounded retries and managed egress routing."""
        if (
            (os.environ.get("INGESTION_EGRESS_MODE", "auto").strip().lower() or "auto")
            == "webshare_isp"
            and not route_id
        ):
            raise IngestionError(
                "ISP 수집 모드에서 작업에 전용 경로가 배정되지 않았습니다.",
                code="ingestion_route_assignment_missing",
                details={"egress_class": "webshare_isp"},
            )
        normalized, expected_id = validate_youtube_url(youtube_url)
        destination.mkdir(parents=True, exist_ok=True)
        video = self._download_video_work(
            normalized,
            expected_id,
            destination / "video",
            job_id=job_id,
            range_start_seconds=range_start_seconds,
            range_end_seconds=range_end_seconds,
            route_id=route_id,
        )

        return DownloadedAssetBundle(
            metadata=video.metadata,
            video_path=video.path,
            video_attempt_count=video.attempt_count,
            video_failed_attempt_count=video.failed_attempt_count,
            video_failure_reasons=video.failure_reasons,
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
            raise IngestionError(
                "다운로드된 영상 파일을 찾지 못했습니다.",
                code="ingestion_downloaded_file_missing",
                details={"asset": "video"},
            )
        return max(candidates, key=lambda path: path.stat().st_size)
