from __future__ import annotations

import hashlib
import json
import math
import os
import random
import re
import shutil
import signal
import socket
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BufferedIOBase
from pathlib import Path
from types import FrameType
from urllib.parse import urlsplit
from uuid import UUID

import boto3
from botocore.config import Config
from botocore.exceptions import (
    ClientError,
    ConnectionClosedError,
    ConnectTimeoutError,
    EndpointConnectionError,
    ReadTimeoutError,
)

from .config import Settings
from .media import media_duration, probe_media
from .worker_pipeline import (
    UPLOAD_SOURCE_MAX_BYTES,
    BatchWorker,
    UploadSourceCleanupError,
    classify_full_source_download,
    cleanup_uploaded_project_workspace,
    uploaded_project_source_window,
)

_CANONICAL_UPLOAD_PATH = re.compile(
    r"^/v1/upload-sessions/([0-9a-fA-F-]{36})/source$"
)
_COMPATIBLE_UPLOAD_PATH = re.compile(r"^/v1/uploads/([0-9a-fA-F-]{36})$")
_BEARER_TOKEN = re.compile(r"^Bearer ([A-Za-z0-9._~-]{16,512})$")
_DEFAULT_CHUNK_BYTES = 1024 * 1024
_DEFAULT_HEARTBEAT_BYTES = 8 * 1024 * 1024
_DEFAULT_HEARTBEAT_SECONDS = 5.0
_DEFAULT_SWEEP_INTERVAL_SECONDS = 30.0
_DEFAULT_STALE_AFTER_SECONDS = 120
_DEFAULT_SOCKET_IDLE_TIMEOUT_SECONDS = 120.0
_FINALIZATION_RETRY_DELAYS_SECONDS = (0.05, 0.1)
_MAX_UPLOAD_DIMENSION = 8_192
_MAX_UPLOAD_PIXELS = 33_554_432
_ECS_AGENT_URI = re.compile(
    r"^http://169\.254\.170\.2/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$"
)
_CAPACITY_RETRY_DELAYS_SECONDS = (0.1, 0.25, 0.5, 1.0, 2.0)
_CAPACITY_RETRYABLE_CODES = {
    "TooManyRequestsException",
    "ThrottlingException",
    "ServiceUnavailableException",
    "InternalServerError",
}


def _forbidden_upload_environment(environment: dict[str, str] | os._Environ[str]) -> list[str]:
    exact = {
        "INGESTION_PROXY_ROUTES_JSON",
        "INGESTION_EGRESS_MODE",
        "WARP_CONF",
        "WARP_CONF_B64",
        "YOUTUBE_API_KEY",
        "YOUTUBE_COOKIES",
        "YOUTUBE_VISITOR_DATA",
        "YOUTUBE_POT_TOKEN",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
    }
    return sorted(
        name
        for name, value in environment.items()
        if value
        and (
            name.upper() in exact
            or "WEBSHARE" in name.upper()
            or name.upper().startswith("YOUTUBE_COOKIE")
            or name.upper().startswith("YOUTUBE_POT")
        )
    )


def _event(event: str, **fields: object) -> None:
    """Emit only bounded operational fields; never pass token, path, or filename."""
    print(
        json.dumps({"event": event, **fields}, separators=(",", ":"), default=str),
        flush=True,
    )


def _capacity_retryable(error: Exception) -> bool:
    if isinstance(error, ClientError):
        response = error.response if isinstance(error.response, dict) else {}
        code = str(response.get("Error", {}).get("Code") or "")
        status = int(response.get("ResponseMetadata", {}).get("HTTPStatusCode") or 0)
        return code in _CAPACITY_RETRYABLE_CODES or status in {429, 500, 502, 503, 504}
    return isinstance(
        error,
        ConnectTimeoutError
        | ConnectionClosedError
        | EndpointConnectionError
        | ReadTimeoutError,
    )


def _enabled(value: str | None) -> bool:
    return bool(value and value.strip().lower() in {"1", "true", "yes", "on"})


def _positive_int(value: str | None, default: int) -> int:
    try:
        return max(1, int(value or default))
    except ValueError:
        return default


def _positive_float(value: str | None, default: float) -> float:
    try:
        return max(0.1, float(value or default))
    except ValueError:
        return default


def _normalized_origin(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return None
    if (
        parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or not parsed.hostname
    ):
        return None
    hostname = parsed.hostname.lower().rstrip(".")
    if parsed.scheme == "https":
        pass
    elif parsed.scheme == "http" and hostname in {"localhost", "127.0.0.1", "::1"}:
        pass
    else:
        return None
    default_port = 443 if parsed.scheme == "https" else 80
    try:
        port = parsed.port
    except ValueError:
        return None
    authority = hostname if port in {None, default_port} else f"{hostname}:{port}"
    return f"{parsed.scheme}://{authority}"


@dataclass(frozen=True)
class UploadReceiverConfig:
    enabled: bool
    port: int
    max_bytes: int
    chunk_bytes: int
    heartbeat_bytes: int
    heartbeat_seconds: float
    sweep_interval_seconds: float
    stale_after_seconds: int
    socket_idle_timeout_seconds: float
    allowed_origins: frozenset[str]
    scale_in_protection_required: bool = False
    scale_in_protection_minutes: int = 30
    shutdown_drain_seconds: float = 110.0

    @classmethod
    def from_environment(
        cls,
        environment: dict[str, str] | os._Environ[str] = os.environ,
    ) -> UploadReceiverConfig:
        forbidden = _forbidden_upload_environment(environment)
        if forbidden:
            raise RuntimeError(
                "file upload receiver forbids ingestion/proxy environment: "
                + ",".join(forbidden)
            )
        configured_max_bytes = _positive_int(
            environment.get("FILE_UPLOAD_MAX_BYTES"),
            UPLOAD_SOURCE_MAX_BYTES,
        )
        if configured_max_bytes > UPLOAD_SOURCE_MAX_BYTES:
            raise RuntimeError("FILE_UPLOAD_MAX_BYTES cannot exceed 5 GiB")
        origins = frozenset(
            normalized
            for item in environment.get("FILE_UPLOAD_CORS_ALLOWED_ORIGINS", "").split(",")
            if (normalized := _normalized_origin(item.strip()))
        )
        return cls(
            enabled=_enabled(environment.get("FILE_UPLOAD_RECEIVER_ENABLED")),
            port=min(65_535, _positive_int(environment.get("PORT"), 8080)),
            max_bytes=configured_max_bytes,
            chunk_bytes=min(
                8 * 1024 * 1024,
                _positive_int(environment.get("FILE_UPLOAD_CHUNK_BYTES"), _DEFAULT_CHUNK_BYTES),
            ),
            heartbeat_bytes=_positive_int(
                environment.get("FILE_UPLOAD_HEARTBEAT_BYTES"),
                _DEFAULT_HEARTBEAT_BYTES,
            ),
            heartbeat_seconds=_positive_float(
                environment.get("FILE_UPLOAD_HEARTBEAT_SECONDS"),
                _DEFAULT_HEARTBEAT_SECONDS,
            ),
            sweep_interval_seconds=_positive_float(
                environment.get("FILE_UPLOAD_SWEEP_INTERVAL_SECONDS"),
                _DEFAULT_SWEEP_INTERVAL_SECONDS,
            ),
            stale_after_seconds=max(
                30,
                _positive_int(
                    environment.get("FILE_UPLOAD_STALE_AFTER_SECONDS"),
                    _DEFAULT_STALE_AFTER_SECONDS,
                ),
            ),
            socket_idle_timeout_seconds=min(
                600.0,
                max(
                    30.0,
                    _positive_float(
                        environment.get("FILE_UPLOAD_SOCKET_IDLE_TIMEOUT_SECONDS"),
                        _DEFAULT_SOCKET_IDLE_TIMEOUT_SECONDS,
                    ),
                ),
            ),
            allowed_origins=origins,
            scale_in_protection_required=_enabled(
                environment.get("FILE_UPLOAD_SCALE_IN_PROTECTION_REQUIRED")
            ),
            scale_in_protection_minutes=min(
                120,
                _positive_int(
                    environment.get("FILE_UPLOAD_SCALE_IN_PROTECTION_MINUTES"),
                    30,
                ),
            ),
        )

    def allows_origin(self, value: str | None) -> bool:
        if not value:
            return False
        normalized = _normalized_origin(value)
        if not normalized:
            return False
        return normalized in self.allowed_origins


class UploadRequestError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        terminal: bool = False,
        expired: bool = False,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code[:100]
        self.message = message[:1000]
        self.terminal = terminal
        self.expired = expired


class TaskScaleInProtection:
    def __init__(self, config: UploadReceiverConfig) -> None:
        self.required = config.scale_in_protection_required
        self.expires_in_minutes = config.scale_in_protection_minutes
        self.agent_uri = os.environ.get("ECS_AGENT_URI", "").strip().rstrip("/")
        self._enabled = False
        self._last_refresh = 0.0
        self._lock = threading.Lock()
        if self.required and not _ECS_AGENT_URI.fullmatch(self.agent_uri):
            raise RuntimeError("ECS_AGENT_URI is required for upload task protection")

    def _update(self, enabled: bool) -> None:
        if not self.agent_uri:
            if self.required:
                raise RuntimeError("ECS task protection endpoint is unavailable")
            return
        body = json.dumps({
            "ProtectionEnabled": enabled,
            "ExpiresInMinutes": self.expires_in_minutes,
        }, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            f"{self.agent_uri}/task-protection/v1/state",
            data=body,
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:  # noqa: S310
                if response.status < 200 or response.status >= 300:
                    raise RuntimeError("ECS task protection update failed")
                response.read(65_537)
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            raise RuntimeError("ECS task protection update failed") from exc
        self._enabled = enabled
        self._last_refresh = time.monotonic() if enabled else 0.0

    def enable(self) -> None:
        with self._lock:
            self._update(True)

    def refresh_if_needed(self) -> None:
        with self._lock:
            if not self._enabled:
                return
            refresh_seconds = max(60.0, self.expires_in_minutes * 60.0 / 3.0)
            if time.monotonic() - self._last_refresh >= refresh_seconds:
                self._update(True)

    def disable(self) -> None:
        with self._lock:
            if self._enabled:
                self._update(False)


@dataclass
class ActiveUpload:
    upload_session_id: str
    cancel_event: threading.Event = field(default_factory=threading.Event)
    source_handle_closed: threading.Event = field(default_factory=threading.Event)
    processing_done: threading.Event = field(default_factory=threading.Event)
    finished: threading.Event = field(default_factory=threading.Event)
    heartbeat_stop: threading.Event = field(default_factory=threading.Event)
    state_lock: threading.Lock = field(default_factory=threading.Lock)
    finalization_lock: threading.Lock = field(default_factory=threading.Lock)
    heartbeat_thread: threading.Thread | None = None
    job_id: str | None = None
    workspace: Path | None = None
    source_path: Path | None = None
    project_workspace: Path | None = None
    abort_stream: Callable[[], None] | None = None
    thumbnail_key: str | None = None
    intake_recorded: bool = False
    received_bytes: int = 0
    failure_recorded: bool = False
    failure_source_deleted: bool = False
    success: bool = False
    failure_code: str | None = None
    failure_message: str = "업로드를 처리하지 못했습니다."
    failure_expired: bool = False
    source_cleanup_complete: bool = False
    terminal_persisted: bool = False
    quarantined: bool = False
    next_cleanup_retry_at: float = 0.0
    capacity_claimed: bool = False
    released: bool = False


class UploadReceiverService:
    def __init__(
        self,
        worker: BatchWorker,
        config: UploadReceiverConfig,
    ) -> None:
        self.worker = worker
        self.repository = worker.repository
        self.storage = worker.storage
        self.settings = worker.settings
        self.config = config
        self.shutdown_event = threading.Event()
        self._shutdown_deadline: float | None = None
        self._capacity = threading.Lock()
        self._active_guard = threading.Lock()
        self._active: ActiveUpload | None = None
        self.task_protection = TaskScaleInProtection(config)
        self._task_arn: str | None = None
        self._capacity_lambda_client = None
        self._sweeper_thread: threading.Thread | None = None
        temp_root = Path(self.settings.temp_dir).resolve(strict=True)
        self.upload_root = temp_root / "receiver-uploads"
        # This directory is exclusively owned by this one-concurrency service.
        # Removing it on process start prevents raw data surviving a container
        # restart in the same ECS task; project workdirs are siblings and untouched.
        if self.upload_root.is_symlink():
            self.upload_root.unlink()
        else:
            shutil.rmtree(self.upload_root, ignore_errors=True)
        self.upload_root.mkdir(mode=0o700, parents=False, exist_ok=False)
        if self.upload_root.resolve(strict=True).parent != temp_root:
            raise RuntimeError("receiver upload root escaped TEMP_ROOT")

    @property
    def busy(self) -> bool:
        return self._capacity.locked()

    @property
    def quarantined(self) -> bool:
        with self._active_guard:
            return bool(self._active and self._active.quarantined)

    @staticmethod
    def parse_session_id(path: str) -> str | None:
        split = urlsplit(path)
        if split.query or split.fragment:
            return None
        match = _CANONICAL_UPLOAD_PATH.fullmatch(split.path)
        if not match:
            match = _COMPATIBLE_UPLOAD_PATH.fullmatch(split.path)
        if not match:
            return None
        try:
            return str(UUID(match.group(1)))
        except ValueError:
            return None

    @staticmethod
    def bearer_token_hash(authorization: str | None) -> str:
        match = _BEARER_TOKEN.fullmatch(authorization or "")
        if not match:
            raise UploadRequestError(
                HTTPStatus.UNAUTHORIZED,
                "upload_authorization_invalid",
                "업로드 인증 정보를 확인해 주세요.",
            )
        return hashlib.sha256(match.group(1).encode("utf-8")).hexdigest()

    def content_length(self, value: str | None) -> int:
        if value is None:
            raise UploadRequestError(
                HTTPStatus.LENGTH_REQUIRED,
                "upload_content_length_required",
                "Content-Length가 필요합니다.",
            )
        if not re.fullmatch(r"[0-9]{1,20}", value):
            raise UploadRequestError(
                HTTPStatus.BAD_REQUEST,
                "upload_content_length_invalid",
                "Content-Length를 확인해 주세요.",
            )
        length = int(value)
        if length <= 0 or length > self.config.max_bytes:
            raise UploadRequestError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "upload_size_invalid",
                "업로드 파일은 5GB 이하여야 합니다.",
            )
        return length

    def receive(
        self,
        *,
        upload_session_id: str,
        authorization: str | None,
        content_length_value: str | None,
        content_type: str | None,
        origin: str | None,
        body: BufferedIOBase,
        abort_stream: Callable[[], None] | None = None,
        background: bool = True,
    ) -> dict[str, object]:
        if not self.config.enabled or self.shutdown_event.is_set():
            raise UploadRequestError(
                HTTPStatus.NOT_FOUND,
                "not_found",
                "찾을 수 없습니다.",
            )
        if not self.config.allows_origin(origin):
            raise UploadRequestError(
                HTTPStatus.FORBIDDEN,
                "upload_origin_forbidden",
                "허용되지 않은 요청 출처입니다.",
            )
        token_hash = self.bearer_token_hash(authorization)
        content_length = self.content_length(content_length_value)
        context = ActiveUpload(upload_session_id=upload_session_id)
        context.abort_stream = abort_stream
        with self._active_guard:
            # Admission and shutdown share one lock; validation can race a
            # signal, but no new capacity/DB claim may start after draining.
            if self.shutdown_event.is_set():
                raise UploadRequestError(HTTPStatus.NOT_FOUND, "not_found", "찾을 수 없습니다.")
            if not self._capacity.acquire(blocking=False):
                raise UploadRequestError(
                    HTTPStatus.CONFLICT,
                    "upload_receiver_busy",
                    "다른 업로드를 처리하고 있습니다. 잠시 후 다시 시도해 주세요.",
                )
            self._active = context
        handed_to_pipeline = False
        try:
            try:
                self.task_protection.enable()
            except RuntimeError:
                raise UploadRequestError(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    "upload_capacity_protection_unavailable",
                    "업로드 작업 서버를 안전하게 보호하지 못했습니다.",
                ) from None
            self._claim_capacity(upload_session_id, token_hash)
            context.capacity_claimed = True
            claim = self.repository.claim_upload_session(
                upload_session_id,
                token_hash,
                content_length,
            )
            claim_result = str(claim.get("claim_result") or "not_found")
            if claim.get("job_id"):
                context.job_id = str(claim["job_id"])
            self._assert_claim_result(claim_result)
            if not context.job_id:
                raise UploadRequestError(
                    HTTPStatus.CONFLICT,
                    "upload_job_missing",
                    "업로드 프로젝트를 확인하지 못했습니다.",
                    terminal=True,
                )

            expected_content_type = str(claim.get("declared_content_type") or "")
            request_content_type = (content_type or "").split(";", 1)[0].strip().lower()
            content_type_matches = (
                request_content_type == expected_content_type.lower()
                if expected_content_type
                else request_content_type in {"", "application/octet-stream"}
            )
            if not content_type_matches:
                raise UploadRequestError(
                    HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                    "upload_content_type_mismatch",
                    "선택한 영상 형식과 요청 형식이 일치하지 않습니다.",
                    terminal=True,
                )

            context.workspace = self._workspace(upload_session_id)
            context.source_path = context.workspace / "source.media"
            self._stream_body(
                context,
                body=body,
                expected_bytes=content_length,
            )
            context.received_bytes = content_length
            if not self._start_maintenance(context):
                raise UploadRequestError(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    "upload_maintenance_unavailable",
                    "업로드 작업 상태를 안전하게 유지하지 못했습니다.",
                    terminal=True,
                )
            metadata = self._probe_and_validate(context, claim)
            context.thumbnail_key = self._upload_source_thumbnail(context, claim)
            if not self.repository.record_upload_intake(
                upload_session_id,
                context.job_id,
                received_bytes=content_length,
                duration_seconds=float(metadata["durationSeconds"]),
                probe_metadata=metadata,
                thumbnail_key=context.thumbnail_key,
            ):
                raise UploadRequestError(
                    HTTPStatus.CONFLICT,
                    "upload_intake_commit_failed",
                    "업로드 정보를 저장하지 못했습니다.",
                    terminal=True,
                )
            context.intake_recorded = True

            if background:
                pipeline = threading.Thread(
                    target=self._run_pipeline,
                    args=(context,),
                    name=f"upload-project-{upload_session_id[:8]}",
                    daemon=True,
                )
                pipeline.start()
                handed_to_pipeline = True
            else:
                handed_to_pipeline = True
                self._run_pipeline(context)
            return {
                "uploadSessionId": upload_session_id,
                "jobId": context.job_id,
                "status": "accepted",
                "receivedBytes": content_length,
            }
        except UploadRequestError as exc:
            if exc.terminal and context.job_id:
                context.failure_code = exc.code
                context.failure_message = exc.message
                context.failure_expired = exc.expired
            raise
        except Exception as exc:
            if context.job_id:
                context.failure_code = "upload_receiver_error"
                context.failure_message = "업로드를 처리하지 못했습니다."
            _event(
                "upload_receiver_unexpected_error",
                session_id=upload_session_id,
                error_type=type(exc).__name__,
            )
            raise UploadRequestError(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "upload_receiver_error",
                "업로드를 처리하지 못했습니다.",
            ) from None
        finally:
            if not handed_to_pipeline:
                context.processing_done.set()
                self._finalize_context(context)

    def _ecs_task_arn(self) -> str:
        if self._task_arn:
            return self._task_arn
        metadata_uri = os.environ.get("ECS_CONTAINER_METADATA_URI_V4", "").strip()
        if not _ECS_AGENT_URI.fullmatch(metadata_uri):
            raise RuntimeError("ECS task metadata endpoint is unavailable")
        request = urllib.request.Request(f"{metadata_uri}/task", method="GET")
        try:
            with urllib.request.urlopen(request, timeout=3) as response:  # noqa: S310
                if response.status < 200 or response.status >= 300:
                    raise RuntimeError("ECS task metadata request failed")
                payload = json.loads(response.read(65_537))
        except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError) as exc:
            raise RuntimeError("ECS task metadata request failed") from exc
        task_arn = str(payload.get("TaskARN") or "") if isinstance(payload, dict) else ""
        if not task_arn.startswith("arn:aws:ecs:") or ":task/" not in task_arn:
            raise RuntimeError("ECS task metadata did not contain a task ARN")
        self._task_arn = task_arn
        return task_arn

    def _claim_capacity(self, upload_session_id: str, token_hash: str) -> None:
        capacity_function_arn = os.environ.get(
            "FILE_UPLOAD_CAPACITY_FUNCTION_ARN", ""
        ).strip()
        if not capacity_function_arn:
            return
        try:
            response = self._invoke_capacity(
                invocation_type="RequestResponse",
                payload={
                    "action": "claim",
                    "uploadSessionId": upload_session_id,
                    "tokenHash": token_hash,
                    "taskArn": self._ecs_task_arn(),
                },
            )
            if response.get("FunctionError"):
                raise RuntimeError("capacity claim lambda failed")
            body = response.get("Payload")
            raw = body.read(65_537) if hasattr(body, "read") else body
            payload = json.loads(raw or b"{}")
        except Exception as exc:
            _event(
                "upload_capacity_claim_error",
                session_id=upload_session_id,
                error_type=type(exc).__name__,
            )
            raise UploadRequestError(
                HTTPStatus.TOO_EARLY,
                "upload_capacity_not_ready",
                "업로드 준비가 아직 완료되지 않았습니다.",
            ) from None
        if not isinstance(payload, dict) or payload.get("leaseState") != "claimed":
            raise UploadRequestError(
                HTTPStatus.TOO_EARLY,
                "upload_capacity_not_ready",
                "업로드 준비가 아직 완료되지 않았습니다.",
            )

    def _capacity_lambda(self):
        if self._capacity_lambda_client is None:
            self._capacity_lambda_client = boto3.client(
                "lambda",
                region_name=getattr(
                    self.settings,
                    "aws_region",
                    os.environ.get("AWS_REGION", "ap-northeast-2"),
                ),
                config=Config(
                    connect_timeout=3,
                    read_timeout=10,
                    retries={"max_attempts": 1, "mode": "standard"},
                ),
            )
        return self._capacity_lambda_client

    def _invoke_capacity(
        self,
        *,
        invocation_type: str,
        payload: dict[str, object],
    ) -> dict[str, object]:
        capacity_function_arn = os.environ.get(
            "FILE_UPLOAD_CAPACITY_FUNCTION_ARN", ""
        ).strip()
        if not capacity_function_arn:
            raise RuntimeError("file upload capacity function is unavailable")
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        for attempt in range(len(_CAPACITY_RETRY_DELAYS_SECONDS) + 1):
            try:
                return self._capacity_lambda().invoke(
                    FunctionName=capacity_function_arn,
                    InvocationType=invocation_type,
                    Payload=encoded,
                )
            except Exception as exc:
                if (
                    not _capacity_retryable(exc)
                    or attempt >= len(_CAPACITY_RETRY_DELAYS_SECONDS)
                ):
                    raise
                delay = _CAPACITY_RETRY_DELAYS_SECONDS[attempt]
                time.sleep(delay * random.uniform(0.75, 1.25))
        raise RuntimeError("file upload capacity retry exhausted")

    def _assert_claim_result(self, result: str) -> None:
        if result == "claimed":
            return
        if result in {"not_found", "forbidden"}:
            raise UploadRequestError(
                HTTPStatus.NOT_FOUND,
                "not_found",
                "찾을 수 없습니다.",
                terminal=result == "forbidden",
            )
        if result == "expired":
            raise UploadRequestError(
                HTTPStatus.GONE,
                "upload_session_expired",
                "업로드 세션이 만료되었습니다.",
                terminal=True,
                expired=True,
            )
        if result == "size_mismatch":
            raise UploadRequestError(
                HTTPStatus.BAD_REQUEST,
                "upload_size_mismatch",
                "선언한 파일 크기와 요청 크기가 일치하지 않습니다.",
                terminal=True,
            )
        if result == "invalid_job":
            raise UploadRequestError(
                HTTPStatus.CONFLICT,
                "upload_job_invalid",
                "업로드 프로젝트 상태를 확인해 주세요.",
                terminal=True,
            )
        raise UploadRequestError(
            HTTPStatus.CONFLICT,
            "upload_session_reused",
            "이미 사용했거나 처리 중인 업로드 세션입니다.",
        )

    def _workspace(self, upload_session_id: str) -> Path:
        workspace = self.upload_root / upload_session_id
        resolved = workspace.resolve(strict=False)
        if resolved.parent != self.upload_root.resolve(strict=True):
            raise UploadRequestError(
                HTTPStatus.BAD_REQUEST,
                "upload_session_invalid",
                "업로드 세션을 확인해 주세요.",
                terminal=True,
            )
        try:
            workspace.mkdir(mode=0o700, exist_ok=False)
        except FileExistsError:
            raise UploadRequestError(
                HTTPStatus.CONFLICT,
                "upload_workspace_exists",
                "업로드 작업 공간이 이미 사용 중입니다.",
                terminal=True,
            ) from None
        return workspace

    def _stream_body(
        self,
        context: ActiveUpload,
        *,
        body: BufferedIOBase,
        expected_bytes: int,
    ) -> None:
        if not context.source_path:
            raise RuntimeError("source path is not initialized")
        received = 0
        heartbeat_at = time.monotonic()
        heartbeat_bytes = 0
        read_available = getattr(body, "read1", body.read)
        try:
            with context.source_path.open("xb", buffering=0) as output:
                while received < expected_bytes:
                    if context.cancel_event.is_set() or self.shutdown_event.is_set():
                        raise UploadRequestError(
                            HTTPStatus.SERVICE_UNAVAILABLE,
                            "upload_cancelled",
                            "업로드가 취소되었습니다.",
                            terminal=True,
                        )
                    remaining = expected_bytes - received
                    # ``BufferedReader.read(n)`` may wait for all n bytes and
                    # hide a very slow but live connection from the DB
                    # heartbeat. ``read1`` returns after one underlying socket
                    # read, keeping the distributed stale-session guard fresh.
                    chunk = read_available(
                        min(self.config.chunk_bytes, remaining)
                    )
                    if not chunk:
                        raise UploadRequestError(
                            HTTPStatus.BAD_REQUEST,
                            "upload_body_incomplete",
                            "업로드가 완료되기 전에 연결이 종료되었습니다.",
                            terminal=True,
                        )
                    if len(chunk) > remaining:
                        raise UploadRequestError(
                            HTTPStatus.BAD_REQUEST,
                            "upload_body_too_large",
                            "요청 본문이 선언한 파일 크기를 초과했습니다.",
                            terminal=True,
                        )
                    output.write(chunk)
                    received += len(chunk)
                    now = time.monotonic()
                    if (
                        received - heartbeat_bytes >= self.config.heartbeat_bytes
                        or now - heartbeat_at >= self.config.heartbeat_seconds
                    ):
                        if not self.repository.heartbeat_upload_session(
                            context.upload_session_id,
                            received,
                        ):
                            raise UploadRequestError(
                                HTTPStatus.CONFLICT,
                                "upload_session_lost",
                                "업로드 세션이 더 이상 유효하지 않습니다.",
                                terminal=True,
                            )
                        heartbeat_at = now
                        heartbeat_bytes = received
                    try:
                        self.task_protection.refresh_if_needed()
                    except RuntimeError:
                        raise UploadRequestError(
                            HTTPStatus.SERVICE_UNAVAILABLE,
                            "upload_capacity_protection_lost",
                            "업로드 작업 서버 보호가 중단되었습니다.",
                            terminal=True,
                        ) from None
                output.flush()
                os.fsync(output.fileno())
            if not self.repository.heartbeat_upload_session(
                context.upload_session_id,
                received,
            ):
                raise UploadRequestError(
                    HTTPStatus.CONFLICT,
                    "upload_session_lost",
                    "업로드 세션이 더 이상 유효하지 않습니다.",
                    terminal=True,
                )
        finally:
            context.source_handle_closed.set()

    def _probe_and_validate(
        self,
        context: ActiveUpload,
        claim: dict[str, object],
    ) -> dict[str, object]:
        if not context.source_path:
            raise RuntimeError("source path is not initialized")
        try:
            probe = probe_media(context.source_path, timeout=120)
        except Exception:
            raise UploadRequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "upload_media_corrupt",
                "영상 파일 정보를 읽지 못했습니다.",
                terminal=True,
            ) from None
        streams = probe.get("streams")
        if not isinstance(streams, list):
            streams = []
        video = next(
            (
                item
                for item in streams
                if isinstance(item, dict) and item.get("codec_type") == "video"
            ),
            None,
        )
        audio = next(
            (
                item
                for item in streams
                if isinstance(item, dict) and item.get("codec_type") == "audio"
            ),
            None,
        )
        if not video:
            raise UploadRequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "upload_video_missing",
                "영상 트랙을 찾지 못했습니다.",
                terminal=True,
            )
        if not audio:
            raise UploadRequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "upload_audio_missing",
                "음성 트랙이 포함된 영상을 업로드해 주세요.",
                terminal=True,
            )
        duration_seconds = media_duration(probe)
        declared_duration = float(claim["declared_duration_seconds"])
        if classify_full_source_download(
            source_duration_seconds=declared_duration,
            downloaded_duration_seconds=duration_seconds,
        ) != "full_source_expected":
            raise UploadRequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "upload_duration_mismatch",
                "확인된 영상 길이가 선택 당시 정보와 일치하지 않습니다.",
                terminal=True,
            )
        range_start_seconds = float(claim["range_start_seconds"])
        range_end_seconds = float(claim["range_end_seconds"])
        try:
            uploaded_project_source_window(
                source_duration_seconds=duration_seconds,
                declared_source_duration_seconds=declared_duration,
                source_range_enabled=bool(claim.get("source_range_selection_enabled")),
                range_start_seconds=range_start_seconds,
                range_end_seconds=range_end_seconds,
            )
        except Exception:
            raise UploadRequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "upload_range_invalid",
                "사용할 영상 구간을 확인해 주세요.",
                terminal=True,
            ) from None
        try:
            width = int(video.get("width") or 0)
            height = int(video.get("height") or 0)
        except (TypeError, ValueError):
            width = 0
            height = 0
        if (
            not math.isfinite(duration_seconds)
            or width <= 0
            or height <= 0
            or width > _MAX_UPLOAD_DIMENSION
            or height > _MAX_UPLOAD_DIMENSION
            or width * height > _MAX_UPLOAD_PIXELS
        ):
            raise UploadRequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "upload_probe_invalid",
                "영상 해상도와 재생시간을 확인하지 못했습니다.",
                terminal=True,
            )
        declared_width = int(claim.get("declared_width") or 0)
        declared_height = int(claim.get("declared_height") or 0)
        declared_dimensions_match = (
            not declared_width
            or not declared_height
            or (declared_width == width and declared_height == height)
            or (declared_width == height and declared_height == width)
        )
        if not declared_dimensions_match or not bool(claim.get("declared_has_audio")):
            raise UploadRequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "upload_media_declaration_mismatch",
                "선택 당시 영상 정보와 실제 파일 정보가 일치하지 않습니다.",
                terminal=True,
            )
        return {
            "durationSeconds": round(duration_seconds, 3),
            "width": width,
            "height": height,
            "hasAudio": True,
            "videoCodec": str(video.get("codec_name") or "unknown")[:80],
            "audioCodec": str(audio.get("codec_name") or "unknown")[:80],
            "fileBytes": int(claim["expected_bytes"]),
        }

    def _upload_source_thumbnail(
        self,
        context: ActiveUpload,
        claim: dict[str, object],
    ) -> str:
        if not context.workspace or not context.source_path or not context.job_id:
            raise RuntimeError("upload context is incomplete")
        thumbnail = context.workspace / "source-thumbnail.jpg"
        thumbnail_work = context.workspace / "thumbnail-work"
        thumbnail_work.mkdir(mode=0o700)
        key = (
            f"thumbnails/{claim['mvp_session_id']}/{context.job_id}/source.jpg"
        )
        try:
            self.worker._thumbnail(
                context.source_path,
                thumbnail,
                thumbnail_work,
            )
            self.storage.upload(thumbnail, key, "image/jpeg")
        except Exception:
            try:
                self.storage.delete(key)
            except Exception:
                pass
            raise UploadRequestError(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "upload_thumbnail_failed",
                "영상 미리보기를 만들지 못했습니다.",
                terminal=True,
            ) from None
        finally:
            thumbnail.unlink(missing_ok=True)
            shutil.rmtree(thumbnail_work, ignore_errors=True)
        return key

    def _run_pipeline(self, context: ActiveUpload) -> None:
        context.failure_code = "upload_pipeline_failed"
        context.failure_message = "쇼츠를 만들지 못했습니다. 사용량은 다시 복구되었습니다."
        try:
            if not self._start_maintenance(context):
                raise RuntimeError("upload maintenance is unavailable")
            if context.cancel_event.is_set() or not context.job_id or not context.source_path:
                raise RuntimeError("upload pipeline was cancelled")
            self.worker.project(
                context.job_id,
                prepared_source=context.source_path,
            )
        except UploadSourceCleanupError as exc:
            # project() has returned through its finally, but its private raw
            # hard link/copy is still present. Never confuse receiver cleanup
            # with deletion of that separately-owned source snapshot.
            context.project_workspace = exc.workspace
        except Exception as exc:
            _event(
                "upload_pipeline_unexpected_error",
                session_id=context.upload_session_id,
                error_type=type(exc).__name__,
            )
        finally:
            try:
                job = self.repository.get_job(context.job_id or "")
                context.success = bool(job and str(job.get("status")) == "completed")
                if job and not context.success:
                    context.failure_code = str(job.get("error_code") or context.failure_code)[:100]
                    context.failure_message = str(
                        job.get("error_message") or context.failure_message
                    )[:1000]
            except Exception as exc:
                _event("upload_pipeline_status_error", session_id=context.upload_session_id,
                       error_type=type(exc).__name__)
            # This is deliberately later than video_jobs.completed: project()
            # still owns timeline postprocessing and its raw snapshot until it
            # returns. Only a processing-done context may enter finalization.
            context.processing_done.set()
            self._finalize_context(context)

    def _start_maintenance(self, context: ActiveUpload) -> bool:
        if not context.job_id:
            return True
        with context.state_lock:
            if context.heartbeat_thread is not None or context.released:
                return True
            context.heartbeat_thread = threading.Thread(
                target=self._maintain_pipeline_heartbeat,
                args=(context, context.heartbeat_stop),
                name=f"upload-heartbeat-{context.upload_session_id[:8]}",
                daemon=True,
            )
            try:
                context.heartbeat_thread.start()
            except RuntimeError as exc:
                context.heartbeat_thread = None
                context.cancel_event.set()
                _event("upload_maintenance_start_error", session_id=context.upload_session_id,
                       error_type=type(exc).__name__)
                return False
            return True

    def _complete_session(self, context: ActiveUpload) -> bool:
        for delay in (0.0, *_FINALIZATION_RETRY_DELAYS_SECONDS):
            if delay:
                time.sleep(delay)
            try:
                return bool(self.repository.complete_upload_session(
                    context.upload_session_id, context.job_id or "",
                ))
            except Exception as exc:
                _event("upload_completion_commit_error", session_id=context.upload_session_id,
                       error_type=type(exc).__name__)
        return False

    def _finalize_context(self, context: ActiveUpload) -> None:
        if not context.processing_done.is_set():
            return
        if context.source_path is not None and not context.source_handle_closed.is_set():
            return
        if not context.finalization_lock.acquire(blocking=False):
            return
        try:
            if context.released or (
                context.quarantined and time.monotonic() < context.next_cleanup_retry_at
            ):
                return
            if context.failure_code or context.intake_recorded:
                self._start_maintenance(context)
            cleaned = context.source_cleanup_complete
            if not cleaned:
                for delay in (0.0, *_FINALIZATION_RETRY_DELAYS_SECONDS):
                    if delay:
                        time.sleep(delay)
                    try:
                        cleaned = self._cleanup_context(
                            context, delete_thumbnail=not context.intake_recorded,
                        )
                    except Exception as exc:
                        _event("upload_source_cleanup_error", session_id=context.upload_session_id,
                               error_type=type(exc).__name__)
                    if cleaned:
                        break
            context.source_cleanup_complete = cleaned
            if not cleaned:
                context.quarantined = True
                context.next_cleanup_retry_at = (
                    time.monotonic() + self.config.sweep_interval_seconds
                )
                self._record_failure(
                    context, code="upload_source_cleanup_failed",
                    message="업로드 원본 파일을 안전하게 삭제하지 못했습니다.",
                    source_deleted=False,
                )
                _event("upload_source_cleanup_quarantined", session_id=context.upload_session_id,
                       source_deleted=False)
                # Keep the active slot, heartbeat and scale-in protection. The
                # sweeper retries only this owned context, never the pipeline.
                return
            context.quarantined = False
            persisted = True
            if context.success:
                persisted = self._complete_session(context)
                if not persisted:
                    context.failure_code = "upload_completion_commit_failed"
                    context.failure_message = "업로드 프로젝트 완료 상태를 저장하지 못했습니다."
            if not context.success or not persisted:
                if context.failure_code:
                    persisted = self._record_failure(
                        context, code=context.failure_code, message=context.failure_message,
                        expired=context.failure_expired, source_deleted=True,
                    )
            context.terminal_persisted = persisted
            _event("upload_pipeline_finished", session_id=context.upload_session_id,
                   success=context.success, source_deleted=True, terminal_persisted=persisted)
            if not persisted:
                # Releasing the lease would discard the only remaining
                # ownership evidence. Keep this context until its terminal
                # write is acknowledged; never rerun the pipeline or cleanup.
                context.quarantined = True
                context.next_cleanup_retry_at = (
                    time.monotonic() + self.config.sweep_interval_seconds
                )
                _event("upload_terminal_persistence_quarantined",
                       session_id=context.upload_session_id, source_deleted=True)
                return
            self._release(context)
        finally:
            context.finalization_lock.release()

    def _maintain_pipeline_heartbeat(
        self,
        context: ActiveUpload,
        stop: threading.Event,
    ) -> None:
        session_lost_logged = False
        while not stop.wait(self.config.heartbeat_seconds):
            retained = None
            try:
                retained = self.repository.heartbeat_upload_session(
                    context.upload_session_id,
                    context.received_bytes,
                )
            except Exception as exc:
                _event(
                    "upload_pipeline_heartbeat_error",
                    session_id=context.upload_session_id,
                    error_type=type(exc).__name__,
                )
            if stop.is_set():
                return
            try:
                self.task_protection.refresh_if_needed()
            except RuntimeError as exc:
                context.cancel_event.set()
                _event(
                    "upload_task_protection_refresh_error",
                    session_id=context.upload_session_id,
                    error_type=type(exc).__name__,
                )
            if retained is False:
                context.cancel_event.set()
                if not session_lost_logged:
                    _event("upload_pipeline_session_lost", session_id=context.upload_session_id)
                    session_lost_logged = True
                # A terminal session can still own raw bytes or a blocked
                # postprocessing thread. DB availability/state never disables
                # the task's independent protection refresh.

    def start_sweeper(self) -> None:
        if self._sweeper_thread and self._sweeper_thread.is_alive():
            return
        self.sweep_abandoned_uploads()
        self._sweeper_thread = threading.Thread(
            target=self._sweep_loop,
            name="upload-session-sweeper",
            daemon=True,
        )
        self._sweeper_thread.start()

    def _sweep_loop(self) -> None:
        while not self.shutdown_event.wait(self.config.sweep_interval_seconds):
            self.sweep_abandoned_uploads()

    def _cleanup_owner_stopped(self, upload_session_id: str) -> bool:
        """A peer's missing local directory is never proof of source deletion."""
        try:
            response = self._invoke_capacity(
                invocation_type="RequestResponse",
                payload={
                    "action": "cleanup_ownership",
                    "uploadSessionId": upload_session_id,
                },
            )
            if response.get("FunctionError"):
                raise RuntimeError("capacity ownership query failed")
            body = response.get("Payload")
            raw = body.read(65_537) if hasattr(body, "read") else body
            payload = json.loads(raw or b"{}")
            owner_task_arn = payload.get("taskArn") if isinstance(payload, dict) else None
            verified = (
                isinstance(payload, dict)
                and payload.get("action") == "cleanup_ownership"
                and payload.get("uploadSessionId") == upload_session_id
                and payload.get("ownerStopped") is True
                and isinstance(owner_task_arn, str)
                and owner_task_arn.startswith("arn:aws:ecs:")
                and ":task/" in owner_task_arn
            )
        except Exception as exc:
            _event("upload_sweeper_owner_unverified", session_id=upload_session_id,
                   error_type=type(exc).__name__)
            return False
        if not verified:
            _event("upload_sweeper_owner_unverified", session_id=upload_session_id)
        return verified

    def sweep_abandoned_uploads(self) -> int:
        with self._active_guard:
            context = self._active
        if context and context.quarantined:
            self._finalize_context(context)
        with self._active_guard:
            active_session_id = (
                self._active.upload_session_id if self._active else None
            )
        expired_capacity: list[dict[str, object]] = []
        try:
            expired_capacity = self.repository.expire_waiting_upload_capacity_requests()
        except Exception as exc:
            _event(
                "upload_capacity_sweeper_query_error",
                error_type=type(exc).__name__,
            )
        for item in expired_capacity:
            upload_session_id = str(item.get("id") or "")
            self._notify_capacity_release(upload_session_id)

        try:
            pending = self.repository.list_abandoned_upload_sessions(
                stale_after_seconds=self.config.stale_after_seconds,
                active_upload_session_id=active_session_id,
            )
            verified_ids = []
            expired_awaiting_ids = []
            for item in pending:
                try:
                    session_id = str(UUID(str(item.get("id") or "")))
                except ValueError:
                    continue
                if session_id == active_session_id:
                    continue
                if item.get("previous_status") == "awaiting_upload":
                    # The DB separately rechecks expired, never-consumed,
                    # zero-byte intake under a row lock. receive() cannot
                    # create a source before its DB claim succeeds.
                    expired_awaiting_ids.append(session_id)
                elif self._cleanup_owner_stopped(session_id):
                    verified_ids.append(session_id)
            # The ownership query must precede the SQL transition: claim
            # already marks a stale claimed session failed. Recheck the
            # active owner and all stale predicates under DB row locks.
            with self._active_guard:
                active_session_id = self._active.upload_session_id if self._active else None
            candidates = (
                self.repository.claim_abandoned_upload_sessions(
                    stale_after_seconds=self.config.stale_after_seconds,
                    active_upload_session_id=active_session_id,
                    verified_upload_session_ids=verified_ids,
                    expired_awaiting_upload_session_ids=expired_awaiting_ids,
                )
                if verified_ids or expired_awaiting_ids else []
            )
        except Exception as exc:
            _event(
                "upload_sweeper_query_error",
                error_type=type(exc).__name__,
            )
            return len(expired_capacity)

        cleaned_count = len(expired_capacity)
        for item in candidates:
            upload_session_id = str(item.get("id") or "")
            job_id = str(item.get("job_id") or "")
            try:
                normalized_session_id = str(UUID(upload_session_id))
            except ValueError:
                continue
            context = ActiveUpload(
                upload_session_id=normalized_session_id,
                job_id=job_id or None,
            )
            context.workspace = self.upload_root / normalized_session_id
            cleaned = self._cleanup_context(
                context,
                delete_thumbnail=False,
            )
            if not cleaned or not context.job_id:
                continue
            try:
                finalized = self.repository.finalize_abandoned_upload_source_cleanup(
                    normalized_session_id,
                    context.job_id,
                    previous_status=str(item.get("previous_status") or "failed"),
                )
            except Exception as exc:
                _event(
                    "upload_sweeper_cleanup_commit_error",
                    session_id=normalized_session_id,
                    error_type=type(exc).__name__,
                )
                continue
            if finalized:
                cleaned_count += 1
        if candidates or expired_capacity:
            _event(
                "upload_sweeper_finished",
                candidate_count=len(candidates) + len(expired_capacity),
                cleaned_count=cleaned_count,
            )
        return cleaned_count

    def _cleanup_context(
        self,
        context: ActiveUpload,
        *,
        delete_thumbnail: bool,
    ) -> bool:
        with context.state_lock:
            if delete_thumbnail and context.thumbnail_key:
                try:
                    self.storage.delete(context.thumbnail_key)
                except Exception:
                    pass
                context.thumbnail_key = None
            project_cleaned = True
            if context.project_workspace is not None:
                project_workspace = context.project_workspace
                expected_root = Path(self.settings.temp_dir).resolve(strict=True)
                if (
                    project_workspace.is_symlink()
                    or project_workspace.resolve(strict=False).parent != expected_root
                    or not context.job_id
                    or not project_workspace.name.startswith(f"project-{context.job_id}-")
                ):
                    project_cleaned = False
                else:
                    try:
                        cleanup_uploaded_project_workspace(project_workspace, attempts=1)
                        context.project_workspace = None
                    except UploadSourceCleanupError:
                        project_cleaned = False
            workspace = context.workspace
            if workspace is None:
                return project_cleaned
            expected_parent = self.upload_root.resolve(strict=True)
            resolved = workspace.resolve(strict=False)
            if resolved.parent != expected_parent:
                return False
            try:
                shutil.rmtree(workspace)
            except FileNotFoundError:
                pass
            except OSError:
                return False
            try:
                workspace.lstat()
            except FileNotFoundError:
                return project_cleaned
            except OSError:
                pass
            return False

    def _record_failure(
        self,
        context: ActiveUpload,
        *,
        code: str,
        message: str,
        source_deleted: bool,
        expired: bool = False,
    ) -> bool:
        if not context.job_id:
            return True
        with context.state_lock:
            if context.failure_recorded and (context.failure_source_deleted or not source_deleted):
                return True
        for delay in (0.0, *_FINALIZATION_RETRY_DELAYS_SECONDS):
            if delay:
                time.sleep(delay)
            try:
                recorded = self.repository.fail_upload_session(
                    context.upload_session_id,
                    context.job_id,
                    error_code=code,
                    message=message,
                    expired=expired,
                    source_deleted=source_deleted,
                )
            except Exception as exc:
                _event(
                    "upload_failure_commit_error",
                    session_id=context.upload_session_id,
                    error_type=type(exc).__name__,
                )
                continue
            if recorded:
                with context.state_lock:
                    context.failure_recorded = True
                    context.failure_source_deleted = source_deleted
            return bool(recorded)
        return False

    def _release(self, context: ActiveUpload) -> None:
        if (
            not context.processing_done.is_set() or not context.source_cleanup_complete
            or not context.terminal_persisted
        ):
            return
        with self._active_guard:
            if self._active is not context:
                return
        with context.state_lock:
            if context.released:
                return
            context.released = True
        context.heartbeat_stop.set()
        heartbeat = context.heartbeat_thread
        if heartbeat is not None and heartbeat is not threading.current_thread():
            heartbeat.join(timeout=1.0)
        try:
            self.task_protection.disable()
        except RuntimeError as exc:
            _event(
                "upload_task_protection_release_error",
                session_id=context.upload_session_id,
                error_type=type(exc).__name__,
            )
        if context.capacity_claimed:
            self._notify_capacity_release(context.upload_session_id)
        with self._active_guard:
            if self._active is context:
                self._active = None
                self._capacity.release()
        context.finished.set()

    def _notify_capacity_release(self, upload_session_id: str) -> None:
        capacity_function_arn = os.environ.get(
            "FILE_UPLOAD_CAPACITY_FUNCTION_ARN", ""
        ).strip()
        if capacity_function_arn and upload_session_id:
            try:
                self._invoke_capacity(
                    invocation_type="Event",
                    payload={
                        "action": "release",
                        "uploadSessionId": upload_session_id,
                    },
                )
            except Exception as exc:
                _event(
                    "upload_capacity_release_notify_error",
                    session_id=upload_session_id,
                    error_type=type(exc).__name__,
                )

    def shutdown(self) -> None:
        with self._active_guard:
            if self._shutdown_deadline is None:
                self._shutdown_deadline = time.monotonic() + max(
                    0.0, min(110.0, self.config.shutdown_drain_seconds),
                )
            self.shutdown_event.set()
            context = self._active
        if not context:
            return
        context.cancel_event.set()
        if context.abort_stream and not context.source_handle_closed.is_set():
            try:
                context.abort_stream()
            except OSError:
                pass
        # The upload writer being closed is not a pipeline-completion barrier:
        # FFmpeg/timeline work may still own a hard link or copy of the source.
        # The processing owner sets processing_done only after that work exits.
        while not context.finished.is_set():
            if context.processing_done.is_set():
                self._finalize_context(context)
            remaining = self._shutdown_deadline - time.monotonic()
            if remaining <= 0:
                _event("upload_shutdown_drain_incomplete", session_id=context.upload_session_id,
                       processing_done=context.processing_done.is_set(),
                       source_deleted=context.source_cleanup_complete,
                       quarantined=context.quarantined)
                # ECS may force-kill after its stop timeout. Do not invent a
                # cleanup/terminal result or expose this still-owned capacity.
                return
            context.finished.wait(timeout=min(0.1, remaining))


class UploadHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        service: UploadReceiverService,
    ) -> None:
        self.service = service
        super().__init__(address, UploadRequestHandler)


class UploadRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "EasyCutUploadReceiver"
    sys_version = ""

    @property
    def service(self) -> UploadReceiverService:
        server = self.server
        if not isinstance(server, UploadHttpServer):
            raise RuntimeError("upload service is unavailable")
        return server.service

    def handle_expect_100(self) -> bool:
        # Large HTTP clients and reverse proxies may add Expect: 100-continue.
        # Accept the standard handshake; do_PUT still validates origin, bearer,
        # exact length and atomically claims the session before reading a byte.
        return super().handle_expect_100()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path not in {"/healthz", "/livez", "/readyz"}:
            self._json_response(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        live = self.service.config.enabled and not self.service.shutdown_event.is_set()
        ready = live and not self.service.busy
        status = (
            HTTPStatus.OK
            if live and (path != "/readyz" or ready)
            else HTTPStatus.SERVICE_UNAVAILABLE
        )
        self._json_response(
            status,
            {
                "ok": status == HTTPStatus.OK,
                "live": live,
                "ready": ready,
                "busy": self.service.busy,
                "draining": self.service.shutdown_event.is_set(),
                "quarantined": self.service.quarantined,
            },
        )

    def do_OPTIONS(self) -> None:
        session_id = self.service.parse_session_id(self.path)
        if not session_id:
            self._json_response(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        if not self.service.config.allows_origin(self.headers.get("Origin")):
            self._json_response(
                HTTPStatus.FORBIDDEN,
                {"error": "upload_origin_forbidden"},
            )
            return
        self._empty_response(HTTPStatus.NO_CONTENT)

    def do_PUT(self) -> None:
        self.close_connection = True
        self.connection.settimeout(self.service.config.socket_idle_timeout_seconds)
        session_id = self.service.parse_session_id(self.path)
        if not session_id:
            self._json_response(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        try:
            result = self.service.receive(
                upload_session_id=session_id,
                authorization=self.headers.get("Authorization"),
                content_length_value=self.headers.get("Content-Length"),
                content_type=self.headers.get("Content-Type"),
                origin=self.headers.get("Origin"),
                body=self.rfile,
                abort_stream=self._abort_request_stream,
            )
            self._json_response(HTTPStatus.ACCEPTED, result)
        except UploadRequestError as exc:
            headers = (
                {"WWW-Authenticate": "Bearer"}
                if exc.status == HTTPStatus.UNAUTHORIZED
                else None
            )
            self._json_response(
                exc.status,
                {"error": exc.code, "message": exc.message, "detail": exc.message},
                extra_headers=headers,
            )

    def _abort_request_stream(self) -> None:
        """Wake a blocked body read before signal-time source cleanup."""
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def _cors_headers(self) -> dict[str, str]:
        origin = self.headers.get("Origin")
        if not self.service.config.allows_origin(origin):
            return {}
        return {
            "Access-Control-Allow-Origin": origin or "",
            "Access-Control-Allow-Methods": "PUT,OPTIONS",
            "Access-Control-Allow-Headers": "authorization,content-type",
            "Access-Control-Max-Age": "600",
            "Vary": "Origin",
        }

    def _empty_response(self, status: int) -> None:
        self.send_response(status)
        headers = self._cors_headers()
        headers.update({
            "Cache-Control": "private, no-store",
            "Content-Length": "0",
            "X-Content-Type-Options": "nosniff",
        })
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()

    def _json_response(
        self,
        status: int,
        payload: dict[str, object],
        *,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        headers = self._cors_headers()
        headers.update({
            "Cache-Control": "private, no-store",
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": str(len(encoded)),
            "X-Content-Type-Options": "nosniff",
        })
        headers.update(extra_headers or {})
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, _format: str, *args: object) -> None:
        numeric_status = next(
            (
                int(value)
                for item in args
                if (value := str(item)).isdigit()
                and 100 <= int(value) <= 599
            ),
            None,
        )
        method = (
            self.command
            if re.fullmatch(r"[A-Z]{1,16}", self.command or "")
            else "INVALID"
        )
        _event("upload_http_response", method=method, status=numeric_status)


def main() -> None:
    settings = Settings()
    settings.ensure_directories()
    config = UploadReceiverConfig.from_environment()
    worker = BatchWorker(settings)
    service = UploadReceiverService(worker, config)
    server = UploadHttpServer(("0.0.0.0", config.port), service)
    service.start_sweeper()

    def stop(_signal_number: int, _frame: FrameType | None) -> None:
        service.shutdown()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    _event("upload_receiver_started", port=config.port, enabled=config.enabled)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        service.shutdown()
        server.server_close()
        _event("upload_receiver_stopped")


if __name__ == "__main__":
    main()
