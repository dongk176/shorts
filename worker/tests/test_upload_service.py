from __future__ import annotations

import hashlib
import inspect
import json
import os
import shutil
import socket
import threading
import time
from contextlib import contextmanager
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from botocore.exceptions import ClientError

from shorts_worker.repository import WorkerRepository
from shorts_worker.upload_service import (
    ActiveUpload,
    TaskScaleInProtection,
    UploadHttpServer,
    UploadReceiverConfig,
    UploadReceiverService,
    UploadRequestError,
    UploadRequestHandler,
)
from shorts_worker.worker_pipeline import (
    UploadSourceCleanupError,
    cleanup_uploaded_project_workspace,
)

ORIGIN = "https://www.easycut.co.kr"
TOKEN = "easycut-upload-v1.test-token-material"


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def upload(self, path: Path, key: str, _content_type: str) -> int:
        self.objects[key] = path.read_bytes()
        return len(self.objects[key])

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)


class FakeRepository:
    def __init__(self, payload_bytes: int) -> None:
        self.payload_bytes = payload_bytes
        self.expected_hash = hashlib.sha256(TOKEN.encode()).hexdigest()
        self.claim_mode = "claimed"
        self.claim_calls: list[tuple[str, str, int]] = []
        self.heartbeat_calls: list[int] = []
        self.intake_calls: list[dict[str, object]] = []
        self.intake_result = True
        self.failure_calls: list[dict[str, object]] = []
        self.completed_calls: list[tuple[str, str]] = []
        self.job_status = "completed"
        self.session_status = "claimed"
        self.source_deleted = False
        self.job_error_code: str | None = None
        self.job_error_message: str | None = None
        self.complete_result: bool | None = None
        self.abandoned_sessions: list[dict[str, object]] = []
        self.abandoned_list_calls: list[dict[str, object]] = []
        self.abandoned_claim_calls: list[dict[str, object]] = []
        self.abandoned_cleanup_calls: list[dict[str, object]] = []
        self.abandoned_final_status = "failed"
        self.claim_overrides: dict[str, object] = {}
        self.expired_capacity_requests: list[dict[str, object]] = []
        self.expired_capacity_calls = 0

    def claim_upload_session(
        self,
        session_id: str,
        token_hash: str,
        content_length: int,
    ) -> dict[str, object]:
        self.claim_calls.append((session_id, token_hash, content_length))
        if token_hash != self.expected_hash:
            return {"claim_result": "not_found"}
        mode = self.claim_mode
        if content_length != self.payload_bytes and mode == "claimed":
            mode = "size_mismatch"
        base: dict[str, object] = {
            "claim_result": mode,
            "id": session_id,
            "mvp_session_id": "mvp-session-a",
            "user_id": "user-a",
            "job_id": "job-upload-a",
            "expected_bytes": self.payload_bytes,
            "declared_content_type": "video/mp4",
            "declared_duration_seconds": 300,
            "declared_width": 1920,
            "declared_height": 1080,
            "declared_has_audio": True,
            "range_start_seconds": 0,
            "range_end_seconds": 300,
            "source_range_selection_enabled": True,
        }
        base.update(self.claim_overrides)
        return base

    def heartbeat_upload_session(self, _session_id: str, received_bytes: int) -> bool:
        self.heartbeat_calls.append(received_bytes)
        return True

    def record_upload_intake(self, *_args, **kwargs) -> bool:
        self.intake_calls.append(dict(kwargs))
        return self.intake_result

    def get_job(self, _job_id: str) -> dict[str, object]:
        return {
            "status": self.job_status,
            "error_code": self.job_error_code,
            "error_message": self.job_error_message,
        }

    def fail_upload_session(self, session_id: str, job_id: str, **kwargs) -> bool:
        self.failure_calls.append({
            "session_id": session_id,
            "job_id": job_id,
            **kwargs,
        })
        # Match finalize_project_job: an already-completed project is never
        # downgraded by a later receiver cleanup/persistence error.
        if self.job_status not in {"completed", "failed", "expired", "deleted"}:
            self.job_status = "failed"
        self.session_status = (
            "completed" if self.job_status == "completed"
            else "expired" if kwargs.get("expired") else "failed"
        )
        self.source_deleted = bool(kwargs.get("source_deleted"))
        return True

    def complete_upload_session(self, session_id: str, job_id: str) -> bool:
        self.completed_calls.append((session_id, job_id))
        result = (
            self.complete_result if self.complete_result is not None
            else self.job_status == "completed"
        )
        if result:
            self.session_status = "completed"
            self.source_deleted = True
        return result

    def list_abandoned_upload_sessions(self, **kwargs) -> list[dict[str, object]]:
        self.abandoned_list_calls.append(dict(kwargs))
        return list(self.abandoned_sessions)

    def claim_abandoned_upload_sessions(self, **kwargs) -> list[dict[str, object]]:
        self.abandoned_claim_calls.append(dict(kwargs))
        verified = kwargs.get("verified_upload_session_ids") or []
        expired = kwargs.get("expired_awaiting_upload_session_ids") or []
        sessions = [
            item for item in self.abandoned_sessions
            if (
                item["id"] in expired if item.get("previous_status") == "awaiting_upload"
                else item["id"] in verified
            )
        ]
        self.abandoned_sessions = [
            item for item in self.abandoned_sessions if item not in sessions
        ]
        return sessions

    def expire_waiting_upload_capacity_requests(self) -> list[dict[str, object]]:
        self.expired_capacity_calls += 1
        rows = self.expired_capacity_requests
        self.expired_capacity_requests = []
        return rows

    def finalize_abandoned_upload_source_cleanup(
        self,
        session_id: str,
        job_id: str,
        *,
        previous_status: str,
    ) -> dict[str, object]:
        self.abandoned_cleanup_calls.append({
            "session_id": session_id,
            "job_id": job_id,
            "previous_status": previous_status,
        })
        return {"final_status": self.abandoned_final_status}


class FakeWorker:
    def __init__(self, temp_root: Path, repository: FakeRepository) -> None:
        self.settings = SimpleNamespace(temp_dir=temp_root)
        self.repository = repository
        self.storage = FakeStorage()
        self.project_calls: list[tuple[str, Path]] = []
        self.project_started = threading.Event()
        self.project_release = threading.Event()
        self.block_project = False

    def _thumbnail(self, _source: Path, output: Path, _work_dir: Path) -> Path:
        output.write_bytes(b"derived-thumbnail")
        return output

    def project(self, job_id: str, *, prepared_source: Path) -> None:
        assert prepared_source.is_file()
        self.project_calls.append((job_id, prepared_source))
        self.project_started.set()
        if self.block_project:
            assert self.project_release.wait(timeout=3)


def _config() -> UploadReceiverConfig:
    return UploadReceiverConfig(
        enabled=True,
        port=8080,
        max_bytes=5 * 1024 * 1024 * 1024,
        chunk_bytes=4,
        heartbeat_bytes=4,
        heartbeat_seconds=60,
        sweep_interval_seconds=60,
        stale_after_seconds=120,
        socket_idle_timeout_seconds=120,
        allowed_origins=frozenset({ORIGIN}),
    )


def _service(
    tmp_path: Path,
    payload: bytes,
) -> tuple[UploadReceiverService, FakeWorker, FakeRepository]:
    temp_root = tmp_path / "temp-root"
    temp_root.mkdir()
    repository = FakeRepository(len(payload))
    worker = FakeWorker(temp_root, repository)
    return UploadReceiverService(worker, _config()), worker, repository


def _valid_probe(duration: float = 300) -> dict[str, object]:
    return {
        "format": {"duration": str(duration)},
        "streams": [
            {
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
            },
            {"codec_type": "audio", "codec_name": "aac"},
        ],
    }


def test_receiver_config_allows_only_exact_origins_and_bounds_idle_timeout() -> None:
    exact_preview = "https://easycut-git-canary-owner.vercel.app"
    config = UploadReceiverConfig.from_environment({
        "FILE_UPLOAD_RECEIVER_ENABLED": "true",
        "FILE_UPLOAD_CORS_ALLOWED_ORIGINS": f"{ORIGIN},{exact_preview}",
        "FILE_UPLOAD_SOCKET_IDLE_TIMEOUT_SECONDS": "1",
    })
    assert config.allows_origin(ORIGIN)
    assert config.allows_origin(exact_preview)
    assert not config.allows_origin("https://other-owner.vercel.app")
    assert not config.allows_origin("https://www.easycut.co.kr:invalid")
    assert config.socket_idle_timeout_seconds == 30

    maximum = UploadReceiverConfig.from_environment({
        "FILE_UPLOAD_SOCKET_IDLE_TIMEOUT_SECONDS": "9999",
    })
    assert maximum.socket_idle_timeout_seconds == 600


@pytest.mark.parametrize(
    "name",
    [
        "INGESTION_PROXY_ROUTES_JSON",
        "WARP_CONF_B64",
        "YOUTUBE_POT_TOKEN",
        "Webshare_proxy_url",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ],
)
def test_receiver_config_fails_closed_on_ingestion_or_proxy_environment(
    name: str,
) -> None:
    with pytest.raises(RuntimeError, match="forbids ingestion/proxy environment"):
        UploadReceiverConfig.from_environment({name: "configured"})


def _receive(
    service: UploadReceiverService,
    payload: bytes,
    *,
    token: str = TOKEN,
    declared_length: int | None = None,
    background: bool = False,
) -> dict[str, object]:
    return service.receive(
        upload_session_id=str(uuid4()),
        authorization=f"Bearer {token}",
        content_length_value=str(
            len(payload) if declared_length is None else declared_length
        ),
        content_type="video/mp4",
        origin=ORIGIN,
        body=BytesIO(payload),
        background=background,
    )


def test_token_mismatch_is_hidden_and_does_not_touch_job(tmp_path: Path) -> None:
    payload = b"video"
    service, _worker, repository = _service(tmp_path, payload)

    with pytest.raises(UploadRequestError) as caught:
        _receive(service, payload, token="different-secure-token-material")

    assert caught.value.status == 404
    assert repository.failure_calls == []
    assert list(service.upload_root.iterdir()) == []


def test_disabled_receiver_is_hidden_before_token_or_database_access(tmp_path: Path) -> None:
    payload = b"video"
    service, _worker, repository = _service(tmp_path, payload)
    service.config = replace(service.config, enabled=False)

    with pytest.raises(UploadRequestError) as caught:
        _receive(service, payload)

    assert caught.value.status == 404
    assert repository.claim_calls == []


@pytest.mark.parametrize(
    ("value", "expected_status"),
    [
        (None, 411),
        ("-1", 400),
        (str(5 * 1024 * 1024 * 1024 + 1), 413),
    ],
)
def test_content_length_is_required_numeric_and_bounded(
    value: str | None,
    expected_status: int,
    tmp_path: Path,
) -> None:
    service, _worker, repository = _service(tmp_path, b"video")

    with pytest.raises(UploadRequestError) as caught:
        service.content_length(value)

    assert caught.value.status == expected_status
    assert repository.claim_calls == []


def test_receiver_claims_the_granted_capacity_on_its_own_ecs_task(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"valid-video-payload"
    service, worker, repository = _service(tmp_path, payload)
    worker.settings.aws_region = "ap-northeast-2"
    session_id = str(uuid4())
    task_arn = (
        "arn:aws:ecs:ap-northeast-2:123456789012:"
        "task/test-cluster/0123456789abcdef"
    )
    monkeypatch.setenv(
        "FILE_UPLOAD_CAPACITY_FUNCTION_ARN",
        "arn:aws:lambda:ap-northeast-2:123456789012:function:test-capacity",
    )
    monkeypatch.setenv(
        "ECS_CONTAINER_METADATA_URI_V4",
        "http://169.254.170.2/v4/test-container",
    )
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media",
        lambda *_args, **_kwargs: _valid_probe(),
    )

    class MetadataResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit: int) -> bytes:
            return json.dumps({"TaskARN": task_arn}).encode()

    monkeypatch.setattr(
        "shorts_worker.upload_service.urllib.request.urlopen",
        lambda *_args, **_kwargs: MetadataResponse(),
    )
    invocations: list[dict[str, object]] = []

    class LambdaClient:
        def invoke(self, **kwargs):
            invocations.append(kwargs)
            request = json.loads(kwargs["Payload"])
            if request["action"] == "claim":
                return {"Payload": BytesIO(b'{"leaseState":"claimed"}')}
            return {"Payload": BytesIO(b"{}")}

    monkeypatch.setattr(
        "shorts_worker.upload_service.boto3.client",
        lambda *_args, **_kwargs: LambdaClient(),
    )

    result = service.receive(
        upload_session_id=session_id,
        authorization=f"Bearer {TOKEN}",
        content_length_value=str(len(payload)),
        content_type="video/mp4",
        origin=ORIGIN,
        body=BytesIO(payload),
        background=False,
    )

    assert result["status"] == "accepted"
    claim = json.loads(invocations[0]["Payload"])
    assert claim == {
        "action": "claim",
        "uploadSessionId": session_id,
        "tokenHash": repository.expected_hash,
        "taskArn": task_arn,
    }
    release = json.loads(invocations[-1]["Payload"])
    assert release == {"action": "release", "uploadSessionId": session_id}


def test_receiver_does_not_touch_database_when_capacity_is_not_granted(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"video"
    service, worker, repository = _service(tmp_path, payload)
    worker.settings.aws_region = "ap-northeast-2"
    monkeypatch.setenv("FILE_UPLOAD_CAPACITY_FUNCTION_ARN", "test-capacity")
    monkeypatch.setattr(service, "_ecs_task_arn", lambda: "task-test")

    class LambdaClient:
        def invoke(self, **_kwargs):
            return {"Payload": BytesIO(b'{"leaseState":"not_granted"}')}

    monkeypatch.setattr(
        "shorts_worker.upload_service.boto3.client",
        lambda *_args, **_kwargs: LambdaClient(),
    )

    with pytest.raises(UploadRequestError) as caught:
        _receive(service, payload)

    assert caught.value.status == 425
    assert caught.value.code == "upload_capacity_not_ready"
    assert repository.claim_calls == []


def test_capacity_client_retries_throttle_with_the_same_idempotent_payload(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _worker, _repository = _service(tmp_path, b"video")
    monkeypatch.setenv("FILE_UPLOAD_CAPACITY_FUNCTION_ARN", "test-capacity")
    attempts: list[dict[str, object]] = []
    waits: list[float] = []

    class LambdaClient:
        def invoke(self, **kwargs):
            attempts.append(kwargs)
            if len(attempts) < 3:
                raise ClientError({
                    "Error": {"Code": "TooManyRequestsException"},
                    "ResponseMetadata": {"HTTPStatusCode": 429},
                }, "Invoke")
            return {"Payload": BytesIO(b'{"leaseState":"claimed"}')}

    monkeypatch.setattr(
        "shorts_worker.upload_service.boto3.client",
        lambda *_args, **_kwargs: LambdaClient(),
    )
    monkeypatch.setattr(
        "shorts_worker.upload_service.time.sleep",
        lambda seconds: waits.append(seconds),
    )
    monkeypatch.setattr(
        "shorts_worker.upload_service.random.uniform",
        lambda _minimum, _maximum: 1.0,
    )

    result = service._invoke_capacity(
        invocation_type="RequestResponse",
        payload={"action": "claim", "uploadSessionId": str(uuid4())},
    )

    assert json.loads(attempts[0]["Payload"]) == json.loads(attempts[1]["Payload"])
    assert result["Payload"].read() == b'{"leaseState":"claimed"}'
    assert waits == [0.1, 0.25]


def test_capacity_client_does_not_retry_permission_errors(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _worker, _repository = _service(tmp_path, b"video")
    monkeypatch.setenv("FILE_UPLOAD_CAPACITY_FUNCTION_ARN", "test-capacity")
    attempts = 0

    class LambdaClient:
        def invoke(self, **_kwargs):
            nonlocal attempts
            attempts += 1
            raise ClientError({
                "Error": {"Code": "AccessDeniedException"},
                "ResponseMetadata": {"HTTPStatusCode": 403},
            }, "Invoke")

    monkeypatch.setattr(
        "shorts_worker.upload_service.boto3.client",
        lambda *_args, **_kwargs: LambdaClient(),
    )

    with pytest.raises(ClientError):
        service._invoke_capacity(
            invocation_type="Event",
            payload={"action": "release", "uploadSessionId": str(uuid4())},
        )
    assert attempts == 1


def test_sweeper_does_not_finalize_when_physical_cleanup_is_unconfirmed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _worker, repository = _service(tmp_path, b"video")
    session_id = str(uuid4())
    repository.abandoned_sessions = [{
        "id": session_id,
        "job_id": "job-upload-a",
        "mvp_session_id": "mvp-session-a",
        "previous_status": "claimed",
        "source_thumbnail_s3_key": None,
    }]
    monkeypatch.setattr(service, "_cleanup_context", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(service, "_cleanup_owner_stopped", lambda _session_id: True)

    assert service.sweep_abandoned_uploads() == 0
    assert repository.abandoned_cleanup_calls == []


def test_sweeper_expires_capacity_waiters_that_never_sent_file_bytes(
    tmp_path: Path,
) -> None:
    service, _worker, repository = _service(tmp_path, b"video")
    repository.expired_capacity_requests = [{
        "id": str(uuid4()),
        "job_id": "job-upload-a",
    }]

    assert service.sweep_abandoned_uploads() == 1
    assert repository.expired_capacity_calls == 1
    assert repository.claim_calls == []


@pytest.mark.parametrize(
    "guard_result",
    ["stopped", "live", "missing_task", "wrong_session", "wrong_action", "not_boolean",
     "function_error", "invalid_json", "unavailable"],
)
def test_sweeper_requires_exact_stopped_owner_evidence_before_any_database_transition(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, guard_result: str,
) -> None:
    service, _worker, repository = _service(tmp_path, b"video")
    session_id = str(uuid4())
    repository.abandoned_sessions = [{
        "id": session_id, "job_id": "job-upload-a", "previous_status": "claimed",
    }]
    payload = {
        "action": "cleanup_ownership", "uploadSessionId": session_id,
        "ownerStopped": True,
        "taskArn": "arn:aws:ecs:ap-northeast-2:000000000000:task/test-cluster/stopped-owner",
    }
    if guard_result == "live":
        payload["ownerStopped"] = False
    elif guard_result == "missing_task":
        payload.pop("taskArn")
    elif guard_result == "wrong_session":
        payload["uploadSessionId"] = str(uuid4())
    elif guard_result == "wrong_action":
        payload["action"] = "status"
    elif guard_result == "not_boolean":
        payload["ownerStopped"] = "true"
    response = {"Payload": BytesIO(json.dumps(payload).encode())}
    if guard_result == "function_error":
        response["FunctionError"] = "Unhandled"
    elif guard_result == "invalid_json":
        response["Payload"] = BytesIO(b"{")
    invoke = MagicMock(return_value=response)
    if guard_result == "unavailable":
        invoke.side_effect = RuntimeError("capacity ownership unavailable")
    monkeypatch.setattr(service, "_invoke_capacity", invoke)

    cleaned = service.sweep_abandoned_uploads()

    invoke.assert_called_once_with(
        invocation_type="RequestResponse",
        payload={"action": "cleanup_ownership", "uploadSessionId": session_id},
    )
    assert repository.abandoned_list_calls
    if guard_result == "stopped":
        assert cleaned == 1
        assert repository.abandoned_claim_calls[0]["verified_upload_session_ids"] == [session_id]
        assert repository.abandoned_cleanup_calls[0]["session_id"] == session_id
    else:
        assert cleaned == 0
        assert repository.abandoned_claim_calls == repository.abandoned_cleanup_calls == []
        assert len(repository.abandoned_sessions) == 1


def test_sweeper_without_an_existing_capacity_function_never_claims_peer_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _worker, repository = _service(tmp_path, b"video")
    monkeypatch.delenv("FILE_UPLOAD_CAPACITY_FUNCTION_ARN", raising=False)
    repository.abandoned_sessions = [{
        "id": str(uuid4()), "job_id": "job-upload-a", "previous_status": "claimed",
    }]
    monkeypatch.setattr(service, "_capacity_lambda", MagicMock())

    assert service.sweep_abandoned_uploads() == 0

    service._capacity_lambda.assert_not_called()
    assert repository.abandoned_claim_calls == repository.abandoned_cleanup_calls == []


def test_sweeper_expires_unconsumed_awaiting_sessions_without_an_owner_guard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _worker, repository = _service(tmp_path, b"video")
    session_id = str(uuid4())
    repository.abandoned_sessions = [{
        "id": session_id, "job_id": "job-upload-a", "previous_status": "awaiting_upload",
    }]
    monkeypatch.setattr(service, "_cleanup_owner_stopped", MagicMock())

    assert service.sweep_abandoned_uploads() == 1

    service._cleanup_owner_stopped.assert_not_called()
    assert repository.abandoned_claim_calls[0]["verified_upload_session_ids"] == []
    assert repository.abandoned_claim_calls[0]["expired_awaiting_upload_session_ids"] == [
        session_id,
    ]
    assert repository.abandoned_cleanup_calls[0]["session_id"] == session_id


def test_receiver_cleanup_stat_error_never_reports_source_deleted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _worker, _repository = _service(tmp_path, b"video")
    context = ActiveUpload(upload_session_id=str(uuid4()))
    context.workspace = service.upload_root / context.upload_session_id
    context.workspace.mkdir()
    original_lstat = Path.lstat

    def unconfirmed(path, *args, **kwargs):
        if path == context.workspace:
            raise PermissionError("unconfirmed receiver source cleanup")
        return original_lstat(path, *args, **kwargs)

    monkeypatch.setattr(Path, "lstat", unconfirmed)
    assert service._cleanup_context(context, delete_thumbnail=False) is False


@pytest.mark.parametrize(
    ("claim_mode", "expected_status", "terminal", "expired"),
    [
        ("reused", 409, False, False),
        ("expired", 410, True, True),
        ("forbidden", 404, True, False),
        ("invalid_job", 409, True, False),
    ],
)
def test_claim_state_reuse_expiry_cross_user_and_flag_off_are_fail_closed(
    claim_mode: str,
    expected_status: int,
    terminal: bool,
    expired: bool,
    tmp_path: Path,
) -> None:
    payload = b"video"
    service, _worker, repository = _service(tmp_path, payload)
    repository.claim_mode = claim_mode

    with pytest.raises(UploadRequestError) as caught:
        _receive(service, payload)

    assert caught.value.status == expected_status
    assert bool(repository.failure_calls) is terminal
    if terminal:
        assert repository.failure_calls[0]["expired"] is expired
        assert repository.failure_calls[0]["source_deleted"] is True


def test_content_length_mismatch_consumes_and_fails_the_claim(tmp_path: Path) -> None:
    payload = b"video"
    service, _worker, repository = _service(tmp_path, payload)

    with pytest.raises(UploadRequestError) as caught:
        _receive(service, payload, declared_length=len(payload) + 1)

    assert caught.value.code == "upload_size_mismatch"
    assert repository.failure_calls[0]["error_code"] == "upload_size_mismatch"
    assert list(service.upload_root.iterdir()) == []


def test_aborted_body_fails_job_and_removes_partial_source(tmp_path: Path) -> None:
    payload = b"partial"
    service, _worker, repository = _service(tmp_path, b"x" * 20)

    with pytest.raises(UploadRequestError) as caught:
        _receive(service, payload, declared_length=20)

    assert caught.value.code == "upload_body_incomplete"
    assert repository.failure_calls[0]["source_deleted"] is True
    assert list(service.upload_root.iterdir()) == []


def test_stream_uses_available_socket_chunks_so_slow_upload_heartbeats_continue(
    tmp_path: Path,
) -> None:
    payload = b"slow-video"
    service, _worker, repository = _service(tmp_path, payload)
    session_id = str(uuid4())
    context = ActiveUpload(upload_session_id=session_id, job_id="job-upload-a")
    context.workspace = service._workspace(session_id)
    context.source_path = context.workspace / "source.media"

    class SlowBufferedBody:
        def __init__(self, content: bytes) -> None:
            self.content = content
            self.offset = 0

        def read1(self, _size: int) -> bytes:
            if self.offset >= len(self.content):
                return b""
            chunk = self.content[self.offset : self.offset + 1]
            self.offset += 1
            return chunk

        def read(self, _size: int) -> bytes:
            raise AssertionError("streaming must not wait for a full buffered read")

    service._stream_body(
        context,
        body=SlowBufferedBody(payload),  # type: ignore[arg-type]
        expected_bytes=len(payload),
    )

    assert context.source_path.read_bytes() == payload
    assert repository.heartbeat_calls[-1] == len(payload)
    assert context.source_handle_closed.is_set()
    assert service._cleanup_context(context, delete_thumbnail=False)


def test_corrupt_media_is_rejected_and_cleaned(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"corrupt"
    service, _worker, repository = _service(tmp_path, payload)
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media",
        MagicMock(side_effect=RuntimeError("ffprobe rejected input")),
    )

    with pytest.raises(UploadRequestError) as caught:
        _receive(service, payload)

    assert caught.value.code == "upload_media_corrupt"
    assert repository.failure_calls
    assert list(service.upload_root.iterdir()) == []


def test_media_without_audio_is_rejected(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"silent-video"
    service, _worker, repository = _service(tmp_path, payload)
    probe = _valid_probe()
    probe["streams"] = [probe["streams"][0]]
    monkeypatch.setattr("shorts_worker.upload_service.probe_media", lambda *_args, **_kwargs: probe)

    with pytest.raises(UploadRequestError) as caught:
        _receive(service, payload)

    assert caught.value.code == "upload_audio_missing"
    assert repository.failure_calls


def test_authoritative_probe_rejects_invalid_selected_range(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"range-video"
    service, _worker, repository = _service(tmp_path, payload)
    repository.claim_overrides["range_end_seconds"] = 200
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media",
        lambda *_args, **_kwargs: _valid_probe(),
    )

    with pytest.raises(UploadRequestError) as caught:
        _receive(service, payload)

    assert caught.value.code == "upload_range_invalid"
    assert repository.failure_calls


@pytest.mark.parametrize(
    ("declared", "observed", "range_enabled", "range_start", "range_end"),
    [
        (240.0, 239.967, True, 0.0, 240.0),
        (239.967, 240.033, False, 0.0, 239.967),
        (240.0, 240.0, True, 0.0, 240.0),
        (7_200.0, 7_200.0, True, 0.0, 3_600.0),
        (10_800.0, 10_800.0, True, 7_200.0, 10_800.0),
    ],
)
def test_receiver_accepts_bounded_drift_and_exact_duration_boundaries(
    declared: float,
    observed: float,
    range_enabled: bool,
    range_start: float,
    range_end: float,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"boundary-video"
    service, _worker, repository = _service(tmp_path, payload)
    repository.claim_overrides.update({
        "declared_duration_seconds": declared,
        "range_start_seconds": range_start,
        "range_end_seconds": range_end,
        "source_range_selection_enabled": range_enabled,
    })
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media",
        lambda *_args, **_kwargs: _valid_probe(observed),
    )

    assert _receive(service, payload)["status"] == "accepted"
    assert repository.failure_calls == []


def test_blank_browser_mime_accepts_only_client_octet_stream_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"valid-video-payload"
    service, _worker, repository = _service(tmp_path, payload)
    repository.claim_overrides["declared_content_type"] = ""
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media",
        lambda *_args, **_kwargs: _valid_probe(),
    )

    accepted = service.receive(
        upload_session_id=str(uuid4()),
        authorization=f"Bearer {TOKEN}",
        content_length_value=str(len(payload)),
        content_type="application/octet-stream",
        origin=ORIGIN,
        body=BytesIO(payload),
        background=False,
    )
    assert accepted["status"] == "accepted"

    second_root = tmp_path / "second"
    second_root.mkdir()
    service, _worker, repository = _service(second_root, payload)
    repository.claim_overrides["declared_content_type"] = ""
    with pytest.raises(UploadRequestError) as caught:
        service.receive(
            upload_session_id=str(uuid4()),
            authorization=f"Bearer {TOKEN}",
            content_length_value=str(len(payload)),
            content_type="application/pdf",
            origin=ORIGIN,
            body=BytesIO(payload),
            background=False,
        )
    assert caught.value.code == "upload_content_type_mismatch"


def test_success_dispatches_common_project_pipeline_and_cleans_raw_source(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"valid-video-payload"
    service, worker, repository = _service(tmp_path, payload)
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media",
        lambda *_args, **_kwargs: _valid_probe(),
    )

    result = _receive(service, payload)

    assert result["status"] == "accepted"
    assert len(worker.project_calls) == 1
    assert not worker.project_calls[0][1].exists()
    assert repository.intake_calls[0]["received_bytes"] == len(payload)
    assert repository.completed_calls
    assert repository.failure_calls == []
    assert list(service.upload_root.iterdir()) == []
    assert list(worker.storage.objects) == [
        "thumbnails/mvp-session-a/job-upload-a/source.jpg"
    ]


def test_completion_commit_failure_retains_source_thumbnail_and_finalizes_once(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"valid-video-payload"
    service, worker, repository = _service(tmp_path, payload)
    repository.complete_result = False
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media",
        lambda *_args, **_kwargs: _valid_probe(),
    )

    result = _receive(service, payload)

    assert result["status"] == "accepted"
    assert len(repository.completed_calls) == 1
    assert repository.completed_calls[0][1] == "job-upload-a"
    assert len(repository.failure_calls) == 1
    assert repository.failure_calls[0]["error_code"] == "upload_completion_commit_failed"
    assert repository.failure_calls[0]["source_deleted"] is True
    assert list(worker.storage.objects) == [
        "thumbnails/mvp-session-a/job-upload-a/source.jpg"
    ]
    assert list(service.upload_root.iterdir()) == []


def test_pipeline_failure_retains_committed_source_thumbnail_for_project_card(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"valid-video-payload"
    service, worker, repository = _service(tmp_path, payload)
    repository.job_status = "failed"
    repository.job_error_code = "transcription_failed"
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media",
        lambda *_args, **_kwargs: _valid_probe(),
    )

    assert _receive(service, payload)["status"] == "accepted"

    assert len(repository.failure_calls) == 1
    assert repository.failure_calls[0]["error_code"] == "transcription_failed"
    assert list(worker.storage.objects) == [
        "thumbnails/mvp-session-a/job-upload-a/source.jpg"
    ]
    assert list(service.upload_root.iterdir()) == []


def test_uncommitted_thumbnail_is_removed_when_intake_transition_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"valid-video-payload"
    service, worker, repository = _service(tmp_path, payload)
    repository.intake_result = False
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media",
        lambda *_args, **_kwargs: _valid_probe(),
    )

    with pytest.raises(UploadRequestError) as caught:
        _receive(service, payload)

    assert caught.value.code == "upload_intake_commit_failed"
    assert worker.storage.objects == {}
    assert len(repository.failure_calls) == 1
    assert list(service.upload_root.iterdir()) == []


def test_one_task_concurrency_returns_busy_until_background_pipeline_finishes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"valid-video-payload"
    service, worker, repository = _service(tmp_path, payload)
    worker.block_project = True
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media",
        lambda *_args, **_kwargs: _valid_probe(),
    )

    _receive(service, payload, background=True)
    assert worker.project_started.wait(timeout=1)
    assert service.busy
    with pytest.raises(UploadRequestError) as caught:
        _receive(service, payload)
    assert caught.value.code == "upload_receiver_busy"
    assert len(repository.claim_calls) == 1

    worker.project_release.set()
    deadline = time.monotonic() + 2
    while service.busy and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not service.busy
    assert list(service.upload_root.iterdir()) == []


def test_long_active_pipeline_keeps_session_fresh_and_is_excluded_from_sweeper(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"valid-video-payload"
    service, worker, repository = _service(tmp_path, payload)
    service.config = replace(service.config, heartbeat_seconds=0.02)
    worker.block_project = True
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media",
        lambda *_args, **_kwargs: _valid_probe(),
    )

    result = _receive(service, payload, background=True)
    assert worker.project_started.wait(timeout=1)
    heartbeat_count = len(repository.heartbeat_calls)
    deadline = time.monotonic() + 1
    while len(repository.heartbeat_calls) == heartbeat_count and time.monotonic() < deadline:
        time.sleep(0.01)
    assert len(repository.heartbeat_calls) > heartbeat_count

    service.sweep_abandoned_uploads()
    assert repository.abandoned_list_calls[-1]["active_upload_session_id"] == (
        result["uploadSessionId"]
    )
    assert repository.abandoned_claim_calls == []

    worker.project_release.set()
    deadline = time.monotonic() + 2
    while service.busy and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not service.busy


def test_shutdown_cancels_active_upload_and_deletes_source_before_recording(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"video"
    service, _worker, repository = _service(tmp_path, payload)
    session_id = str(uuid4())
    context = ActiveUpload(upload_session_id=session_id, job_id="job-upload-a")
    context.workspace = service.upload_root / session_id
    context.workspace.mkdir()
    context.source_path = context.workspace / "source.media"
    context.source_path.write_bytes(payload)
    context.abort_stream = context.source_handle_closed.set
    context.processing_done.set()
    context.failure_code = "upload_receiver_shutdown"
    context.failure_message = "업로드 수신기가 종료되어 작업을 취소했습니다."
    context.capacity_claimed = True
    released_capacity: list[str] = []
    monkeypatch.setattr(
        service,
        "_notify_capacity_release",
        released_capacity.append,
    )
    assert service._capacity.acquire(blocking=False)
    with service._active_guard:
        service._active = context

    service.shutdown()

    assert context.cancel_event.is_set()
    assert not context.workspace.exists()
    assert repository.failure_calls[0]["error_code"] == "upload_receiver_shutdown"
    assert repository.failure_calls[0]["source_deleted"] is True
    assert context.released is True
    assert service.busy is False
    assert released_capacity == [session_id]


def test_shutdown_never_marks_source_deleted_while_stream_handle_is_open(
    tmp_path: Path,
) -> None:
    payload = b"video"
    service, _worker, repository = _service(tmp_path, payload)
    session_id = str(uuid4())
    context = ActiveUpload(upload_session_id=session_id, job_id="job-upload-a")
    context.workspace = service.upload_root / session_id
    context.workspace.mkdir()
    context.source_path = context.workspace / "source.media"
    context.source_path.write_bytes(payload)
    service.config = replace(service.config, shutdown_drain_seconds=0)
    assert service._capacity.acquire(blocking=False)
    with service._active_guard:
        service._active = context

    service.shutdown()

    assert context.workspace.exists()
    assert repository.failure_calls == []
    assert service.busy
    assert not context.released
    context.source_handle_closed.set()
    context.processing_done.set()
    context.failure_code = "upload_receiver_shutdown"
    service._finalize_context(context)
    assert repository.failure_calls[0]["source_deleted"] is True
    service._release(context)


def test_receiver_supports_canonical_and_compatibility_paths() -> None:
    session_id = str(uuid4())
    assert UploadReceiverService.parse_session_id(
        f"/v1/upload-sessions/{session_id}/source"
    ) == session_id
    assert UploadReceiverService.parse_session_id(f"/v1/uploads/{session_id}") == session_id
    assert UploadReceiverService.parse_session_id(f"/v1/uploads/{session_id}?token=secret") is None


@pytest.mark.parametrize(
    ("previous_status", "final_status", "has_workspace", "keeps_thumbnail"),
    [
        ("awaiting_upload", "failed", False, True),
        ("claimed", "failed", True, True),
        ("claimed", "completed", True, True),
    ],
)
def test_sweeper_releases_abandoned_jobs_and_marks_only_confirmed_cleanup(
    previous_status: str,
    final_status: str,
    has_workspace: bool,
    keeps_thumbnail: bool,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = b"video"
    service, worker, repository = _service(tmp_path, payload)
    monkeypatch.setattr(service, "_cleanup_owner_stopped", lambda _session_id: True)
    session_id = str(uuid4())
    job_id = "job-upload-a"
    thumbnail_key = f"thumbnails/mvp-session-a/{job_id}/source.jpg"
    worker.storage.objects[thumbnail_key] = b"thumbnail"
    repository.abandoned_final_status = final_status
    repository.abandoned_sessions = [{
        "id": session_id,
        "job_id": job_id,
        "mvp_session_id": "mvp-session-a",
        "previous_status": previous_status,
        "source_thumbnail_s3_key": thumbnail_key,
    }]
    workspace = service.upload_root / session_id
    if has_workspace:
        workspace.mkdir()
        (workspace / "source.media").write_bytes(payload)

    assert service.sweep_abandoned_uploads() == 1

    assert not workspace.exists()
    assert (thumbnail_key in worker.storage.objects) is keeps_thumbnail
    assert repository.abandoned_cleanup_calls == [{
        "session_id": session_id,
        "job_id": job_id,
        "previous_status": previous_status,
    }]


def test_web_intake_and_receiver_pipeline_state_contract_stays_aligned() -> None:
    web_route = (
        Path(__file__).resolve().parents[2]
        / "web/app/api/file-upload/sessions/route.ts"
    ).read_text(encoding="utf-8")
    claim_implementation = inspect.getsource(WorkerRepository.claim_upload_session)
    intake_implementation = inspect.getsource(WorkerRepository.record_upload_intake)

    assert "'upload_service','uploading','uploading',0" in web_route
    assert 'str(row.get("job_status")) != "uploading"' in claim_implementation
    assert "set status='queued',stage='queued'" in intake_implementation
    assert "and execution_backend='upload_service' and status='uploading'" in (
        intake_implementation
    )


def test_repository_claim_is_atomic_and_revalidates_release_identity() -> None:
    implementation = inspect.getsource(WorkerRepository.claim_upload_session)

    assert "for update of us" in implementation
    assert "hmac.compare_digest" in implementation
    assert "'file_upload','file_upload_public','file_upload_emergency_stop'" in implementation
    assert 'flags.get("file_upload_public"' in implementation
    assert 'flags.get("file_upload_emergency_stop"' in implementation
    assert "u.is_admin" in implementation
    assert "us.expires_at<=clock_timestamp()" in implementation
    assert "j.user_id=us.user_id" in implementation
    assert "j.mvp_session_id=us.mvp_session_id" in implementation
    assert "j.execution_backend" in implementation
    assert "status='claimed'" in implementation
    assert "consumed_at=clock_timestamp()" in implementation


def test_repository_token_mismatch_never_reaches_flag_or_claim_queries() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    selected = MagicMock()
    selected.fetchone.return_value = {
        "id": "session-a",
        "token_hash": "a" * 64,
    }
    connection.execute.return_value = selected

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    result = repository.claim_upload_session("session-a", "b" * 64, 10)

    assert result == {"claim_result": "not_found"}
    assert connection.execute.call_count == 1


def test_repository_failure_uses_idempotent_project_finalizer() -> None:
    implementation = inspect.getsource(WorkerRepository.fail_upload_session)

    assert "source_deleted_at=case" in implementation
    assert "shorts_mvp.finalize_project_job" in implementation
    assert implementation.index("finalize_project_job") < implementation.rindex(
        "source_deleted_at=case"
    )
    assert "when %s then clock_timestamp() else null" in implementation
    assert "source_type='upload'" in implementation
    assert "usage_reservations" not in implementation


def test_repository_completion_corrects_upload_source_marker_after_cleanup() -> None:
    implementation = inspect.getsource(WorkerRepository.complete_upload_session)

    assert "source_deleted_at=coalesce" in implementation
    assert "set source_deleted_at=clock_timestamp()" in implementation
    assert "source_type='upload' and status='completed'" in implementation


def test_repository_sweeper_locks_rows_and_finalizes_each_job_idempotently() -> None:
    claim_implementation = inspect.getsource(
        WorkerRepository.claim_abandoned_upload_sessions
    )
    finalize_implementation = inspect.getsource(
        WorkerRepository.finalize_abandoned_upload_source_cleanup
    )

    assert "for update skip locked" in claim_implementation
    assert "source_deleted_at is null" in claim_implementation
    assert "shorts_mvp.finalize_project_job" not in claim_implementation
    assert "source_deleted_at=" not in claim_implementation
    assert "shorts_mvp.finalize_project_job" in finalize_implementation
    assert finalize_implementation.index("finalize_project_job") < (
        finalize_implementation.index("source_deleted_at=")
    )


def _database_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "id": "session-a",
        "mvp_session_id": "mvp-a",
        "user_id": "user-a",
        "job_id": "job-a",
        "status": "awaiting_upload",
        "token_hash": "a" * 64,
        "expected_bytes": 10,
        "declared_content_type": "video/mp4",
        "declared_duration_seconds": 300,
        "declared_width": 1920,
        "declared_height": 1080,
        "declared_has_audio": True,
        "range_start_seconds": 0,
        "range_end_seconds": 300,
        "is_expired": False,
        "is_admin": True,
        "job_status": "uploading",
        "source_type": "upload",
        "execution_backend": "upload_service",
        "pipeline_version": 2,
        "source_range_selection_enabled": True,
    }
    row.update(overrides)
    return row


def _result(*, one=None, all_rows=None):
    result = MagicMock()
    result.fetchone.return_value = one
    result.fetchall.return_value = all_rows or []
    return result


@pytest.mark.parametrize(
    ("row_overrides", "flags", "length", "expected", "execute_count"),
    [
        ({"status": "claimed"}, {"file_upload": True}, 10, "reused", 2),
        ({"is_expired": True}, {"file_upload": True}, 10, "expired", 3),
        ({"is_admin": False}, {"file_upload": True}, 10, "forbidden", 2),
        (
            {"is_admin": False},
            {"file_upload": True, "file_upload_public": True},
            10,
            "claimed",
            3,
        ),
        ({}, {"file_upload": False}, 10, "forbidden", 2),
        ({}, {"file_upload": True}, 11, "size_mismatch", 3),
    ],
)
def test_repository_claim_state_matrix(
    row_overrides: dict[str, object],
    flags: dict[str, bool],
    length: int,
    expected: str,
    execute_count: int,
) -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    flag_rows = [
        {"flag_key": key, "enabled": enabled}
        for key, enabled in flags.items()
    ]
    side_effect = [
        _result(one=_database_row(**row_overrides)),
        _result(all_rows=flag_rows),
    ]
    if execute_count == 3:
        side_effect.append(_result(one={"id": "session-a"}))
    connection.execute.side_effect = side_effect

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    result = repository.claim_upload_session("session-a", "a" * 64, length)

    assert result["claim_result"] == expected
    assert connection.execute.call_count == execute_count


def test_repository_valid_claim_consumes_token_once() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    connection.execute.side_effect = [
        _result(one=_database_row()),
        _result(all_rows=[
            {"flag_key": "file_upload", "enabled": True},
            {"flag_key": "file_upload_public", "enabled": False},
        ]),
        _result(one={"claimed_at": "now", "consumed_at": "now"}),
    ]

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    result = repository.claim_upload_session("session-a", "a" * 64, 10)

    assert result["claim_result"] == "claimed"
    claim_sql = connection.execute.call_args_list[2].args[0]
    assert "where id=%s and status='awaiting_upload'" in claim_sql
    assert "consumed_at=clock_timestamp()" in claim_sql


def test_repository_abandoned_cleanup_finalizes_only_after_receiver_confirmation() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    session_id = str(uuid4())
    abandoned = {
        "id": session_id,
        "job_id": "job-a",
        "mvp_session_id": "mvp-a",
        "previous_status": "claimed",
        "source_thumbnail_s3_key": None,
    }
    connection.execute.side_effect = [
        _result(all_rows=[abandoned]),
        _result(one={"id": session_id}),
        _result(one={"final_status": "failed"}),
        _result(one={"id": "job-a"}),
        _result(one={"id": "session-a"}),
    ]

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    claimed = repository.claim_abandoned_upload_sessions(
        stale_after_seconds=120,
        active_upload_session_id=None,
        verified_upload_session_ids=[session_id],
    )
    assert claimed == [abandoned]
    assert connection.execute.call_count == 1

    finalized = repository.finalize_abandoned_upload_source_cleanup(
        session_id,
        "job-a",
        previous_status="claimed",
    )
    assert finalized and finalized["final_status"] == "failed"
    assert connection.execute.call_count == 5
    assert "for update of us" in connection.execute.call_args_list[1].args[0]
    assert "finalize_project_job" in connection.execute.call_args_list[2].args[0]
    assert "shorts_mvp.video_jobs" in connection.execute.call_args_list[3].args[0]
    assert "source_deleted_at=" in connection.execute.call_args_list[4].args[0]


def test_health_and_preflight_are_no_store_and_origin_scoped(tmp_path: Path) -> None:
    payload = b"video"
    service, _worker, _repository = _service(tmp_path, payload)
    server = UploadHttpServer.__new__(UploadHttpServer)
    server.service = service
    server.server_name = "localhost"
    server.server_port = 8080
    session_id = str(uuid4())

    def exchange(request: bytes) -> bytes:
        handler_socket, client_socket = socket.socketpair()
        try:
            client_socket.sendall(request)
            client_socket.shutdown(socket.SHUT_WR)
            UploadRequestHandler(handler_socket, ("local", 0), server)
            handler_socket.shutdown(socket.SHUT_WR)
            response = bytearray()
            while chunk := client_socket.recv(64 * 1024):
                response.extend(chunk)
            return bytes(response)
        finally:
            handler_socket.close()
            client_socket.close()

    health = exchange(
        b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
    )
    assert health.startswith(b"HTTP/1.1 200 OK\r\n")
    assert b"Cache-Control: private, no-store\r\n" in health

    preflight = exchange(
        (
            f"OPTIONS /v1/upload-sessions/{session_id}/source HTTP/1.1\r\n"
            f"Host: localhost\r\nOrigin: {ORIGIN}\r\nConnection: close\r\n\r\n"
        ).encode()
    )
    assert preflight.startswith(b"HTTP/1.1 204 No Content\r\n")
    assert f"Access-Control-Allow-Origin: {ORIGIN}\r\n".encode() in preflight
    assert b"Access-Control-Allow-Methods: PUT,OPTIONS\r\n" in preflight
    service.shutdown()


def test_expect_100_continue_is_compatible_but_auth_precedes_body_read(
    tmp_path: Path,
) -> None:
    payload = b"video"
    service, _worker, repository = _service(tmp_path, payload)
    server = UploadHttpServer.__new__(UploadHttpServer)
    server.service = service
    server.server_name = "localhost"
    server.server_port = 8080
    session_id = str(uuid4())
    handler_socket, client_socket = socket.socketpair()

    def serve_once() -> None:
        UploadRequestHandler(handler_socket, ("local", 0), server)
        handler_socket.shutdown(socket.SHUT_WR)

    handler = threading.Thread(
        target=serve_once,
    )
    handler.start()
    try:
        request = (
            f"PUT /v1/upload-sessions/{session_id}/source HTTP/1.1\r\n"
            f"Host: localhost\r\nOrigin: {ORIGIN}\r\n"
            "Authorization: Bearer invalid\r\n"
            "Content-Type: video/mp4\r\nContent-Length: 5\r\n"
            "Expect: 100-continue\r\nConnection: close\r\n\r\n"
        ).encode()
        client_socket.sendall(request)
        client_socket.shutdown(socket.SHUT_WR)
        response = bytearray()
        while chunk := client_socket.recv(64 * 1024):
            response.extend(chunk)
    finally:
        handler.join(timeout=2)
        handler_socket.close()
        client_socket.close()

    assert not handler.is_alive()
    assert response.startswith(b"HTTP/1.1 100 Continue\r\n")
    assert b"HTTP/1.1 401 Unauthorized\r\n" in response
    assert repository.claim_calls == []


def test_http_logging_never_echoes_request_text_or_credentials(capsys) -> None:
    handler = UploadRequestHandler.__new__(UploadRequestHandler)
    handler.command = "PUT"
    secret_text = "Authorization: Bearer should-never-be-logged"

    handler.log_message("ignored", secret_text, "400", "-")

    output = capsys.readouterr().out
    assert secret_text not in output
    assert '"method":"PUT"' in output
    assert '"status":400' in output


def _lifecycle_service(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    service, worker, repository = _service(tmp_path, b"video")
    service.config = replace(service.config, heartbeat_seconds=0.01, shutdown_drain_seconds=2)
    service.task_protection = MagicMock()
    service._claim_capacity = MagicMock()
    service._notify_capacity_release = MagicMock()
    monkeypatch.setattr(
        "shorts_worker.upload_service.probe_media", lambda *_a, **_k: _valid_probe(),
    )
    return service, worker, repository


def _http_exchange(service: UploadReceiverService, path: str, *, upload: bool = False):
    """Exercise the real HTTP handler and receive path without an external socket."""
    server = UploadHttpServer.__new__(UploadHttpServer)
    server.service, server.server_name, server.server_port = service, "localhost", 8080
    headers = (
        f"{'PUT' if upload else 'GET'} {path} HTTP/1.1\r\n"
        "Host: localhost\r\nConnection: close\r\n"
    )
    if upload:
        headers += (
            f"Origin: {ORIGIN}\r\nAuthorization: Bearer {TOKEN}\r\n"
            "Content-Type: video/mp4\r\nContent-Length: 5\r\n"
        )
    request = (headers + "\r\n").encode() + (b"video" if upload else b"")
    handler_socket, client_socket = socket.socketpair()
    try:
        client_socket.settimeout(3)
        client_socket.sendall(request)
        client_socket.shutdown(socket.SHUT_WR)
        UploadRequestHandler(handler_socket, ("local", 0), server)
        handler_socket.shutdown(socket.SHUT_WR)
        response = bytearray()
        while chunk := client_socket.recv(65536):
            response.extend(chunk)
        head, body = bytes(response).split(b"\r\n\r\n", 1)
        return int(head.split()[1]), json.loads(body)
    finally:
        handler_socket.close()
        client_socket.close()


@pytest.mark.parametrize("snapshot_kind", ["hardlink", "copy"])
def test_shutdown_waits_for_postprocessing_and_every_raw_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, snapshot_kind: str,
) -> None:
    service, worker, repository = _lifecycle_service(tmp_path, monkeypatch)
    processing, finish_processing = threading.Event(), threading.Event()
    project_workspace = worker.settings.temp_dir / "project-job-upload-a-barrier"
    snapshot = project_workspace / "uploaded-source.media"

    def project(job_id, *, prepared_source):
        worker.project_calls.append((job_id, prepared_source))
        project_workspace.mkdir()
        if snapshot_kind == "hardlink":
            os.link(prepared_source, snapshot)
        else:
            shutil.copyfile(prepared_source, snapshot)
        # Outputs can already be completed while timeline/source work remains.
        repository.job_status = "completed"
        processing.set()
        assert finish_processing.wait(3)
        cleanup_uploaded_project_workspace(project_workspace)

    worker.project = project
    result = _receive(service, b"video", background=True)
    assert processing.wait(1)
    context = service._active
    assert context is not None
    shutdown = threading.Thread(target=service.shutdown, daemon=True)
    shutdown.start()
    try:
        assert service.shutdown_event.wait(1)
        assert shutdown.is_alive()
        assert not context.processing_done.is_set()
        assert context.source_path.is_file() and snapshot.is_file()
        assert service.busy and not context.released
        assert repository.failure_calls == repository.completed_calls == []
        service.task_protection.disable.assert_not_called()
        service._notify_capacity_release.assert_not_called()
    finally:
        finish_processing.set()
        shutdown.join(timeout=3)
    assert not shutdown.is_alive()
    assert context.finished.wait(1)
    assert not context.source_path.exists() and not snapshot.exists()
    assert not service.busy
    assert repository.job_status == repository.session_status == "completed"
    assert repository.completed_calls == [(result["uploadSessionId"], result["jobId"])]
    service.task_protection.disable.assert_called_once()
    service._notify_capacity_release.assert_called_once_with(result["uploadSessionId"])


@pytest.mark.parametrize("phase", ["cleanup", "completion", "failure"])
def test_heartbeat_and_protection_continue_through_cleanup_and_terminal_persistence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, phase: str,
) -> None:
    service, _worker, repository = _lifecycle_service(tmp_path, monkeypatch)
    entered, proceed = threading.Event(), threading.Event()
    heartbeat_seen, protection_seen = threading.Event(), threading.Event()
    if phase == "failure":
        repository.job_status = "failed"
    owner, method = (
        (service, "_cleanup_context") if phase == "cleanup"
        else (repository, "complete_upload_session" if phase == "completion"
              else "fail_upload_session")
    )
    original = getattr(owner, method)

    def blocked(*args, **kwargs):
        entered.set()
        assert proceed.wait(3)
        return original(*args, **kwargs)

    monkeypatch.setattr(owner, method, blocked)
    original_heartbeat = repository.heartbeat_upload_session

    def heartbeat(*args):
        if entered.is_set() and not proceed.is_set():
            heartbeat_seen.set()
        return original_heartbeat(*args)

    repository.heartbeat_upload_session = heartbeat
    service.task_protection.refresh_if_needed.side_effect = lambda: (
        protection_seen.set() if entered.is_set() and not proceed.is_set() else None
    )
    _receive(service, b"video", background=True)
    assert entered.wait(1)
    context = service._active
    try:
        assert heartbeat_seen.wait(1) and protection_seen.wait(1)
        assert service.busy and context.processing_done.is_set()
        assert not context.finished.is_set()
        service.task_protection.disable.assert_not_called()
        service._notify_capacity_release.assert_not_called()
    finally:
        proceed.set()
    assert context.finished.wait(3)
    assert not service.busy and not context.source_path.exists()
    service.task_protection.disable.assert_called_once()


@pytest.mark.parametrize("outcome", ["completion", "failure"])
def test_terminal_db_exception_retries_without_rerunning_the_pipeline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, outcome: str,
) -> None:
    service, worker, repository = _lifecycle_service(tmp_path, monkeypatch)
    method = "complete_upload_session" if outcome == "completion" else "fail_upload_session"
    if outcome == "failure":
        repository.job_status = "failed"
    original = getattr(repository, method)
    attempts = []

    def flaky(*args, **kwargs):
        attempts.append(args)
        if len(attempts) == 1:
            raise RuntimeError("simulated lost database response")
        return original(*args, **kwargs)

    monkeypatch.setattr(repository, method, flaky)
    result = _receive(service, b"video")
    assert result["status"] == "accepted"
    assert len(attempts) == 2 and attempts[0] == attempts[1]
    assert len(worker.project_calls) == 1
    assert not worker.project_calls[0][1].exists()
    assert not service.busy and service._active is None
    service._notify_capacity_release.assert_called_once_with(result["uploadSessionId"])


@pytest.mark.parametrize("outcome", ["completion", "failure"])
def test_persistent_db_errors_retain_protection_until_terminal_write_recovers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys, outcome: str,
) -> None:
    service, worker, repository = _lifecycle_service(tmp_path, monkeypatch)
    allow_terminal_write, heartbeat_seen = threading.Event(), threading.Event()
    original_complete = repository.complete_upload_session
    original_fail = repository.fail_upload_session
    original_heartbeat = repository.heartbeat_upload_session
    if outcome == "failure":
        repository.job_status = "failed"

    def terminal_write(method, *args, **kwargs):
        if not allow_terminal_write.is_set():
            raise RuntimeError("database unavailable")
        return method(*args, **kwargs)

    def heartbeat(*args):
        if service.quarantined:
            heartbeat_seen.set()
        return original_heartbeat(*args)

    repository.complete_upload_session = MagicMock(
        side_effect=lambda *a, **kw: terminal_write(original_complete, *a, **kw),
    )
    repository.fail_upload_session = MagicMock(
        side_effect=lambda *a, **kw: terminal_write(original_fail, *a, **kw),
    )
    repository.heartbeat_upload_session = heartbeat
    service._cleanup_context = MagicMock(wraps=service._cleanup_context)
    result = _receive(service, b"video")
    context = service._active
    try:
        assert repository.complete_upload_session.call_count == (
            3 if outcome == "completion" else 0
        )
        assert repository.fail_upload_session.call_count == 3
        assert len(worker.project_calls) == 1 and not worker.project_calls[0][1].exists()
        assert context.processing_done.is_set() and context.source_cleanup_complete
        assert not context.terminal_persisted and not context.finished.is_set()
        assert service.busy and service.quarantined and heartbeat_seen.wait(1)
        assert _http_exchange(service, "/healthz")[0] == 200
        assert _http_exchange(service, "/readyz")[0] == 503
        service._release(context)
        service.task_protection.disable.assert_not_called()
        service._notify_capacity_release.assert_not_called()
        assert "upload_terminal_persistence_quarantined" in capsys.readouterr().out
    finally:
        allow_terminal_write.set()
        context.next_cleanup_retry_at = 0
        service.sweep_abandoned_uploads()
    assert context.finished.wait(2) and context.terminal_persisted
    assert len(worker.project_calls) == 1 and service._cleanup_context.call_count == 1
    assert not service.busy and not service.quarantined
    service.task_protection.disable.assert_called_once()
    service._notify_capacity_release.assert_called_once_with(result["uploadSessionId"])


def test_raw_snapshot_cleanup_failure_quarantines_and_retries_only_its_owned_workspace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, worker, repository = _lifecycle_service(tmp_path, monkeypatch)
    project_workspace = worker.settings.temp_dir / "project-job-upload-a-cleanup"
    snapshot = project_workspace / "uploaded-source.media"
    allow_cleanup, quarantined, heartbeat_seen = (threading.Event() for _ in range(3))
    other_workspace = worker.settings.temp_dir / "project-unrelated-other"
    other_workspace.mkdir()
    other_source = other_workspace / "uploaded-source.media"
    other_source.write_bytes(b"must remain untouched")

    def project(job_id, *, prepared_source):
        worker.project_calls.append((job_id, prepared_source))
        project_workspace.mkdir()
        os.link(prepared_source, snapshot)
        raise UploadSourceCleanupError(project_workspace)

    def cleanup(workspace, **kwargs):
        if not allow_cleanup.is_set():
            raise UploadSourceCleanupError(workspace)
        return cleanup_uploaded_project_workspace(workspace, **kwargs)

    worker.project = project
    monkeypatch.setattr("shorts_worker.upload_service.cleanup_uploaded_project_workspace", cleanup)
    monkeypatch.setattr("shorts_worker.upload_service._event", lambda event, **_fields: (
        quarantined.set() if event == "upload_source_cleanup_quarantined" else None
    ))
    original_heartbeat = repository.heartbeat_upload_session

    def heartbeat(*args):
        if quarantined.is_set():
            heartbeat_seen.set()
        return original_heartbeat(*args)

    repository.heartbeat_upload_session = heartbeat
    result = _receive(service, b"video", background=True)
    assert quarantined.wait(2)
    context = service._active
    try:
        assert heartbeat_seen.wait(1)
        assert context.processing_done.is_set() and not context.finished.is_set()
        assert service.busy and service.quarantined and snapshot.exists()
        assert not repository.source_deleted
        assert repository.job_status == repository.session_status == "completed"
        assert all(call["source_deleted"] is False for call in repository.failure_calls)
        assert _http_exchange(service, "/livez")[0] == 200
        ready_status, ready = _http_exchange(service, "/readyz")
        assert ready_status == 503 and ready["quarantined"] is True
        service.task_protection.disable.assert_not_called()
        service._notify_capacity_release.assert_not_called()
        with pytest.raises(UploadRequestError, match="다른 업로드"):
            _receive(service, b"video")
    finally:
        allow_cleanup.set()
        context.next_cleanup_retry_at = 0
        service.sweep_abandoned_uploads()
    assert context.finished.wait(1)
    assert not snapshot.exists() and not context.source_path.exists()
    assert other_source.read_bytes() == b"must remain untouched"
    assert not service.busy and not service.quarantined
    assert repository.source_deleted
    assert len(worker.project_calls) == 1
    service._notify_capacity_release.assert_called_once_with(result["uploadSessionId"])


@pytest.mark.parametrize("first_outcome", ["success", "failure", "shutdown"])
def test_two_http_receivers_keep_processing_sources_records_and_leases_independent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, first_outcome: str,
) -> None:
    states, contexts, results = [], [], []
    gates = [threading.Event(), threading.Event()]
    entered = [threading.Event(), threading.Event()]
    snapshots = []
    for index in range(2):
        directory = tmp_path / f"receiver-{index}"
        directory.mkdir()
        service, worker, repository = _lifecycle_service(directory, monkeypatch)
        repository.claim_overrides["job_id"] = f"job-{index}"
        states.append((service, worker, repository))
        snapshots.append(worker.settings.temp_dir / f"project-job-{index}-running" / "source.media")

        def project(job_id, *, prepared_source, task=index):
            _service, owner, repo = states[task]
            owner.project_calls.append((job_id, prepared_source))
            snapshots[task].parent.mkdir()
            os.link(prepared_source, snapshots[task])
            repo.job_status = "failed" if task == 0 and first_outcome == "failure" else "completed"
            entered[task].set()
            assert gates[task].wait(3)
            cleanup_uploaded_project_workspace(snapshots[task].parent)

        worker.project = project
    shutdown = None
    try:
        for index, (service, _worker, _repo) in enumerate(states):
            session_id = str(uuid4())
            status, result = _http_exchange(
                service, f"/v1/upload-sessions/{session_id}/source", upload=True,
            )
            assert status == 202 and result["status"] == "accepted"
            assert entered[index].wait(1)
            contexts.append(service._active)
            results.append(result)
        first, second = states[0][0], states[1][0]
        if first_outcome == "shutdown":
            shutdown = threading.Thread(target=first.shutdown, daemon=True)
            shutdown.start()
            assert first.shutdown_event.wait(1)
            assert first.busy and snapshots[0].exists()
        else:
            assert _http_exchange(first, "/healthz")[0] == 200
            assert _http_exchange(first, "/readyz")[0] == 503
        gates[0].set()
        assert contexts[0].finished.wait(2)
        assert not first.busy
        assert second.busy and not contexts[1].processing_done.is_set()
        assert snapshots[1].exists() and contexts[1].source_path.exists()
        assert not contexts[1].heartbeat_stop.is_set()
        assert states[1][2].completed_calls == states[1][2].failure_calls == []
        second.task_protection.disable.assert_not_called()
        second._notify_capacity_release.assert_not_called()
        first._notify_capacity_release.assert_called_once_with(results[0]["uploadSessionId"])
        if first_outcome == "failure":
            assert states[0][2].failure_calls[0]["session_id"] == results[0]["uploadSessionId"]
            assert states[0][2].session_status == "failed"
        else:
            assert states[0][2].completed_calls == [(results[0]["uploadSessionId"], "job-0")]
    finally:
        for gate in gates:
            gate.set()
        for context in contexts:
            assert context.finished.wait(3)
        if shutdown is not None:
            shutdown.join(timeout=3)
    assert states[1][2].completed_calls == [(results[1]["uploadSessionId"], "job-1")]
    states[1][0]._notify_capacity_release.assert_called_once_with(results[1]["uploadSessionId"])
    assert all(len(worker.project_calls) == 1 for _service, worker, _repo in states)
    assert all(not snapshot.exists() for snapshot in snapshots)


@pytest.mark.parametrize("owner_status", ["claimed", "completed", "failed"])
def test_peer_sweeper_never_retires_a_live_owner_with_a_stale_database_heartbeat(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, owner_status: str,
) -> None:
    """Two real receivers share stale DB rows, but not their ephemeral files."""
    owner_session_id, peer_session_id = str(uuid4()), str(uuid4())
    stale, heartbeat_failed = threading.Event(), threading.Event()

    class SharedRepository(FakeRepository):
        def __init__(self):
            super().__init__(5)
            self.sessions = {}

        def claim_upload_session(self, session_id, token_hash, content_length):
            row = super().claim_upload_session(session_id, token_hash, content_length)
            row["job_id"] = f"job-{session_id}"
            self.sessions[session_id] = {**row, "status": "claimed", "source_deleted": False}
            return row

        def heartbeat_upload_session(self, session_id, received_bytes):
            if session_id == owner_session_id and stale.is_set():
                heartbeat_failed.set()
                raise RuntimeError("isolated delayed database heartbeat")
            return super().heartbeat_upload_session(session_id, received_bytes)

        def claim_abandoned_upload_sessions(self, **kwargs):
            self.abandoned_claim_calls.append(dict(kwargs))
            row = self.sessions[owner_session_id]
            if (
                not stale.is_set() or kwargs["active_upload_session_id"] == owner_session_id
                or owner_session_id not in (kwargs.get("verified_upload_session_ids") or [])
            ):
                return []
            previous_status = row["status"]
            if previous_status == "claimed":
                row["status"] = "failed"
            return [{**row, "previous_status": previous_status}]

        def list_abandoned_upload_sessions(self, **kwargs):
            self.abandoned_list_calls.append(dict(kwargs))
            row = self.sessions[owner_session_id]
            if not stale.is_set() or kwargs["active_upload_session_id"] == owner_session_id:
                return []
            return [{**row, "previous_status": row["status"]}]

        def finalize_abandoned_upload_source_cleanup(self, session_id, job_id, **kwargs):
            result = super().finalize_abandoned_upload_source_cleanup(session_id, job_id, **kwargs)
            self.sessions[session_id]["source_deleted"] = True
            return result

    repository = SharedRepository()
    gates, entered = [threading.Event(), threading.Event()], [threading.Event(), threading.Event()]
    states, contexts, snapshots = [], [], []
    for index in range(2):
        directory = tmp_path / f"receiver-{index}"
        directory.mkdir()
        service, worker, _unused = _lifecycle_service(directory, monkeypatch)
        service.repository = worker.repository = repository
        service._invoke_capacity = MagicMock(return_value={"Payload": BytesIO(json.dumps({
            "action": "cleanup_ownership", "uploadSessionId": owner_session_id,
            "ownerStopped": False,
        }).encode())})
        states.append(service)
        snapshots.append(worker.settings.temp_dir / f"project-owner-{index}" / "source.media")

        def project(_job_id, *, prepared_source, task=index):
            snapshots[task].parent.mkdir()
            os.link(prepared_source, snapshots[task])
            entered[task].set()
            assert gates[task].wait(3)
            cleanup_uploaded_project_workspace(snapshots[task].parent)

        worker.project = project
    try:
        for index, session_id in enumerate((owner_session_id, peer_session_id)):
            status, _result = _http_exchange(
                states[index], f"/v1/upload-sessions/{session_id}/source", upload=True,
            )
            assert status == 202 and entered[index].wait(1)
            contexts.append(states[index]._active)
        repository.sessions[owner_session_id]["status"] = owner_status
        stale.set()
        assert heartbeat_failed.wait(1)
        assert not (states[1].upload_root / owner_session_id).exists()
        states[1].sweep_abandoned_uploads()
        assert repository.sessions[owner_session_id]["status"] == owner_status
        assert repository.sessions[owner_session_id]["source_deleted"] is False
        assert repository.abandoned_claim_calls == []
        assert repository.abandoned_cleanup_calls == []
        states[1]._invoke_capacity.assert_called_once_with(
            invocation_type="RequestResponse",
            payload={"action": "cleanup_ownership", "uploadSessionId": owner_session_id},
        )
        assert all(service.busy for service in states)
        assert all(snapshot.exists() for snapshot in snapshots)
        for service in states:
            service.task_protection.disable.assert_not_called()
            service._notify_capacity_release.assert_not_called()
    finally:
        for gate in gates:
            gate.set()
        for context in contexts:
            assert context.finished.wait(3)


def test_peer_expiry_before_database_claim_never_creates_or_reads_a_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_id = str(uuid4())
    claim_entered, resume_claim = threading.Event(), threading.Event()
    repository = FakeRepository(5)
    repository.job_status = "uploading"
    repository.abandoned_sessions = [{
        "id": session_id, "job_id": "job-upload-a", "previous_status": "awaiting_upload",
    }]
    original_claim = repository.claim_upload_session
    original_abandoned = repository.claim_abandoned_upload_sessions

    def blocked_claim(*args):
        claim_entered.set()
        assert resume_claim.wait(3)
        return original_claim(*args)

    def expire_before_claim(**kwargs):
        rows = original_abandoned(**kwargs)
        if rows:
            repository.claim_mode = "expired"
        return rows

    repository.claim_upload_session = blocked_claim
    repository.claim_abandoned_upload_sessions = expire_before_claim
    services, workers = [], []
    for index in range(2):
        directory = tmp_path / f"receiver-{index}"
        directory.mkdir()
        service, worker, _unused = _lifecycle_service(directory, monkeypatch)
        service.repository = worker.repository = repository
        service._workspace = MagicMock(wraps=service._workspace)
        service._stream_body = MagicMock(wraps=service._stream_body)
        service._cleanup_owner_stopped = MagicMock()
        services.append(service)
        workers.append(worker)
    responses = []
    receiving = threading.Thread(target=lambda: responses.append(_http_exchange(
        services[0], f"/v1/upload-sessions/{session_id}/source", upload=True,
    )), daemon=True)
    receiving.start()
    assert claim_entered.wait(1)
    try:
        assert services[0].busy and services[0]._active.source_path is None
        assert services[1].sweep_abandoned_uploads() == 1
        assert repository.abandoned_claim_calls[0]["verified_upload_session_ids"] == []
        assert repository.abandoned_claim_calls[0]["expired_awaiting_upload_session_ids"] == [
            session_id,
        ]
        services[1]._cleanup_owner_stopped.assert_not_called()
    finally:
        resume_claim.set()
        receiving.join(timeout=3)
    assert not receiving.is_alive() and responses[0][0] == 410
    for service, worker in zip(services, workers, strict=True):
        service._workspace.assert_not_called()
        service._stream_body.assert_not_called()
        assert not service.busy and list(service.upload_root.iterdir()) == []
        assert worker.project_calls == []


def test_shutdown_rechecks_admission_before_claiming_capacity_or_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _worker, repository = _lifecycle_service(tmp_path, monkeypatch)
    validation_entered, resume_validation = threading.Event(), threading.Event()
    original_hash = service.bearer_token_hash
    errors = []

    def delayed_hash(value):
        validation_entered.set()
        assert resume_validation.wait(3)
        return original_hash(value)

    def receive():
        try:
            _receive(service, b"video")
        except UploadRequestError as error:
            errors.append(error.code)

    service.bearer_token_hash = delayed_hash
    receiver = threading.Thread(target=receive, daemon=True)
    receiver.start()
    assert validation_entered.wait(1)
    service.shutdown()
    resume_validation.set()
    receiver.join(timeout=2)
    assert not receiver.is_alive() and errors == ["not_found"]
    assert repository.claim_calls == []
    service._claim_capacity.assert_not_called()
    service.task_protection.enable.assert_not_called()


def test_non_owner_context_cannot_release_another_active_receiver_slot(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, worker, _repository = _lifecycle_service(tmp_path, monkeypatch)
    worker.block_project = True
    _receive(service, b"video", background=True)
    assert worker.project_started.wait(1)
    owner = service._active
    stale = ActiveUpload(
        upload_session_id=str(uuid4()), source_cleanup_complete=True, terminal_persisted=True,
    )
    stale.processing_done.set()
    try:
        service._release(stale)
        assert service._active is owner and service.busy
        service.task_protection.disable.assert_not_called()
        service._notify_capacity_release.assert_not_called()
    finally:
        worker.project_release.set()
    assert owner.finished.wait(2)
    service._release(owner)
    service.task_protection.disable.assert_called_once()


def test_shutdown_deadline_never_releases_a_still_running_pipeline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, worker, repository = _lifecycle_service(tmp_path, monkeypatch)
    service.config = replace(service.config, shutdown_drain_seconds=0)
    worker.block_project = True
    _receive(service, b"video", background=True)
    assert worker.project_started.wait(1)
    context = service._active
    try:
        service.shutdown()
        service.shutdown()
        assert service.busy and context.source_path.is_file()
        assert not context.processing_done.is_set() and not context.released
        assert repository.failure_calls == repository.completed_calls == []
        service.task_protection.disable.assert_not_called()
        service._notify_capacity_release.assert_not_called()
    finally:
        worker.project_release.set()
    assert context.finished.wait(2)
    assert not context.source_path.exists()
    service._notify_capacity_release.assert_called_once()


def test_database_heartbeat_error_does_not_stop_task_protection_refresh(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, worker, repository = _lifecycle_service(tmp_path, monkeypatch)
    worker.block_project = True
    _receive(service, b"video", background=True)
    assert worker.project_started.wait(1)
    context = service._active
    failed_heartbeat, refreshed = threading.Event(), threading.Event()

    def database_unavailable(*_args):
        failed_heartbeat.set()
        raise RuntimeError("database unavailable")

    repository.heartbeat_upload_session = database_unavailable
    service.task_protection.refresh_if_needed.side_effect = lambda: (
        refreshed.set() if failed_heartbeat.is_set() else None
    )
    try:
        assert failed_heartbeat.wait(1) and refreshed.wait(1)
        assert service.busy and not context.finished.is_set()
        service.task_protection.disable.assert_not_called()
    finally:
        worker.project_release.set()
    assert context.finished.wait(2)


def test_protection_refresh_and_disable_are_serialized_with_event_barriers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    protection = TaskScaleInProtection(_config())
    entered, proceed, disabled = (threading.Event() for _ in range(3))
    updates = []

    def update(enabled):
        updates.append(enabled)
        if len(updates) == 2:
            entered.set()
            assert proceed.wait(3)
        protection._enabled = enabled
        protection._last_refresh = 0

    monkeypatch.setattr(protection, "_update", update)
    protection.enable()
    refresh = threading.Thread(target=protection.refresh_if_needed, daemon=True)

    def disable():
        protection.disable()
        disabled.set()

    release = threading.Thread(target=disable, daemon=True)
    refresh.start()
    # A saturated shared CI runner can take longer than one second to schedule
    # the refresh thread even though the lock ordering is correct. The events
    # remain deterministic; allow scheduling headroom without adding sleeps.
    assert entered.wait(5)
    release.start()
    try:
        assert not disabled.wait(0.03)
    finally:
        proceed.set()
        refresh.join(timeout=2)
        release.join(timeout=2)
    assert not refresh.is_alive() and not release.is_alive()
    assert updates == [True, True, False]
    assert not protection._enabled


def test_maintenance_thread_start_failure_cleans_intake_without_starting_pipeline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, worker, repository = _lifecycle_service(tmp_path, monkeypatch)
    monkeypatch.setattr(
        "shorts_worker.upload_service.threading.Thread.start",
        MagicMock(side_effect=RuntimeError("thread unavailable")),
    )
    with pytest.raises(UploadRequestError) as caught:
        _receive(service, b"video")
    assert caught.value.code == "upload_maintenance_unavailable"
    assert worker.project_calls == []
    assert list(service.upload_root.iterdir()) == []
    assert repository.failure_calls[0]["source_deleted"] is True
    assert not service.busy and service._active is None
    service.task_protection.disable.assert_called_once()
    service._notify_capacity_release.assert_called_once()
