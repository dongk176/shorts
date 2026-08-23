from __future__ import annotations

import hashlib
import inspect
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

from shorts_worker.repository import WorkerRepository
from shorts_worker.upload_service import (
    ActiveUpload,
    UploadHttpServer,
    UploadReceiverConfig,
    UploadReceiverService,
    UploadRequestError,
    UploadRequestHandler,
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
        self.job_error_code: str | None = None
        self.job_error_message: str | None = None
        self.complete_result: bool | None = None
        self.abandoned_sessions: list[dict[str, object]] = []
        self.abandoned_claim_calls: list[dict[str, object]] = []
        self.abandoned_cleanup_calls: list[dict[str, object]] = []
        self.abandoned_final_status = "failed"
        self.claim_overrides: dict[str, object] = {}

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
        self.job_status = "failed"
        return True

    def complete_upload_session(self, session_id: str, job_id: str) -> bool:
        self.completed_calls.append((session_id, job_id))
        if self.complete_result is not None:
            return self.complete_result
        return self.job_status == "completed"

    def claim_abandoned_upload_sessions(self, **kwargs) -> list[dict[str, object]]:
        self.abandoned_claim_calls.append(dict(kwargs))
        sessions = self.abandoned_sessions
        self.abandoned_sessions = []
        return sessions

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

    assert service.sweep_abandoned_uploads() == 0
    assert repository.abandoned_cleanup_calls == []


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
    assert repository.abandoned_claim_calls[-1]["active_upload_session_id"] == (
        result["uploadSessionId"]
    )

    worker.project_release.set()
    deadline = time.monotonic() + 2
    while service.busy and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not service.busy


def test_shutdown_cancels_active_upload_and_deletes_source_before_recording(
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
    context.abort_stream = context.source_handle_closed.set
    assert service._capacity.acquire(blocking=False)
    with service._active_guard:
        service._active = context

    service.shutdown()

    assert context.cancel_event.is_set()
    assert not context.workspace.exists()
    assert repository.failure_calls[0]["error_code"] == "upload_receiver_shutdown"
    assert repository.failure_calls[0]["source_deleted"] is True
    service._release(context)


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
    context.source_handle_closed = MagicMock()
    context.source_handle_closed.wait.return_value = False
    assert service._capacity.acquire(blocking=False)
    with service._active_guard:
        service._active = context

    service.shutdown()

    assert context.workspace.exists()
    assert repository.failure_calls[0]["source_deleted"] is False
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
) -> None:
    payload = b"video"
    service, worker, repository = _service(tmp_path, payload)
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
    assert "where flag_key='file_upload'" in implementation
    assert 'flags.get("file_upload_public"' not in implementation
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
            "forbidden",
            2,
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
    abandoned = {
        "id": "session-a",
        "job_id": "job-a",
        "mvp_session_id": "mvp-a",
        "previous_status": "claimed",
        "source_thumbnail_s3_key": None,
    }
    connection.execute.side_effect = [
        _result(all_rows=[abandoned]),
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
    )
    assert claimed == [abandoned]
    assert connection.execute.call_count == 1

    finalized = repository.finalize_abandoned_upload_source_cleanup(
        "session-a",
        "job-a",
        previous_status="claimed",
    )
    assert finalized and finalized["final_status"] == "failed"
    assert connection.execute.call_count == 4
    assert "finalize_project_job" in connection.execute.call_args_list[1].args[0]
    assert "shorts_mvp.video_jobs" in connection.execute.call_args_list[2].args[0]
    assert "source_deleted_at=" in connection.execute.call_args_list[3].args[0]


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
