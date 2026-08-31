from __future__ import annotations

import json
import threading
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from test_file_upload_capacity_lambda import OWNER_SESSION, OWNER_TASK, cleanup_owner_fixture
from test_upload_service import FakeRepository, _http_exchange, _lifecycle_service


def _coordinator(monkeypatch, *, status="STOPPED"):
    # The shared fixture loads this checkout's actual Lambda by repo-relative
    # Path and injects in-memory DynamoDB/ECS clients; no AWS request is possible.
    module, table, ecs, response, describe_calls = cleanup_owner_fixture(monkeypatch)
    response["tasks"][0]["lastStatus"] = status
    writes = []
    for target, method in ((table, "put_item"), (table, "delete_item"), (ecs, "update_service")):
        forbidden = MagicMock(side_effect=AssertionError("ownership guard attempted a cloud write"))
        monkeypatch.setattr(target, method, forbidden)
        writes.append(forbidden)
    requests = []

    class LocalLambdaClient:
        def invoke(self, **kwargs):
            assert kwargs["InvocationType"] == "RequestResponse"
            payload = json.loads(kwargs["Payload"])
            assert payload == {"action": "cleanup_ownership", "uploadSessionId": OWNER_SESSION}
            requests.append(payload)
            result = module.handler(payload, None)
            return {"StatusCode": 200, "Payload": BytesIO(json.dumps(result).encode())}

    monkeypatch.setenv("FILE_UPLOAD_CAPACITY_FUNCTION_ARN", "isolated-test-capacity")
    return SimpleNamespace(
        module=module, table=table, ecs=ecs, response=response, describe_calls=describe_calls,
        writes=writes, requests=requests, client=LocalLambdaClient(),
    )


def _receiver(directory, monkeypatch, coordinator, repository=None):
    directory.mkdir()
    service, worker, default_repository = _lifecycle_service(directory, monkeypatch)
    repository = repository or default_repository
    service.repository = worker.repository = repository
    # Exercise the real receiver's invocation/serialization/response checks,
    # bypassing only the AWS transport. Admission/release stay fixture-local.
    service._capacity_lambda_client = coordinator.client
    return service, worker, repository


def _stale_candidate(repository):
    repository.abandoned_sessions = [{
        "id": OWNER_SESSION, "job_id": "job-upload-a", "previous_status": "claimed",
    }]


def _assert_read_only(coordinator):
    assert coordinator.table.scan_requests == []
    assert coordinator.requests
    for write in coordinator.writes:
        write.assert_not_called()


def test_live_owner_stale_heartbeat_cannot_be_claimed_by_a_peer(
    tmp_path: Path, monkeypatch,
) -> None:
    coordinator = _coordinator(monkeypatch, status="RUNNING")
    repository = FakeRepository(5)
    owner, worker, _ = _receiver(tmp_path / "owner", monkeypatch, coordinator, repository)
    peer, _peer_worker, _ = _receiver(tmp_path / "peer", monkeypatch, coordinator, repository)
    worker.block_project = True
    status, _ = _http_exchange(owner, f"/v1/upload-sessions/{OWNER_SESSION}/source", upload=True)
    assert status == 202 and worker.project_started.wait(1)
    context = owner._active
    heartbeat_failed = threading.Event()

    def unavailable(*_args):
        heartbeat_failed.set()
        raise RuntimeError("isolated stale database heartbeat")

    repository.heartbeat_upload_session = unavailable
    _stale_candidate(repository)
    before = deepcopy(coordinator.table.items)
    try:
        assert heartbeat_failed.wait(1)
        assert peer.sweep_abandoned_uploads() == 0
        assert repository.abandoned_claim_calls == repository.abandoned_cleanup_calls == []
        assert context.source_path.is_file() and not context.processing_done.is_set()
        assert not (peer.upload_root / OWNER_SESSION).exists()
        owner.task_protection.disable.assert_not_called()
        owner._notify_capacity_release.assert_not_called()
        assert coordinator.describe_calls == [{"cluster": "test-cluster", "tasks": [OWNER_TASK]}]
        assert coordinator.table.items == before
        _assert_read_only(coordinator)
    finally:
        worker.project_release.set()
        assert context.finished.wait(2)


def test_exact_stopped_owner_evidence_allows_only_its_claim_and_finalization(
    tmp_path: Path, monkeypatch,
) -> None:
    coordinator = _coordinator(monkeypatch)
    peer, _worker, repository = _receiver(tmp_path / "peer", monkeypatch, coordinator)
    _stale_candidate(repository)
    before = deepcopy(coordinator.table.items)

    assert peer.sweep_abandoned_uploads() == 1

    assert repository.abandoned_claim_calls[0]["verified_upload_session_ids"] == [OWNER_SESSION]
    assert repository.abandoned_claim_calls[0]["expired_awaiting_upload_session_ids"] == []
    assert repository.abandoned_cleanup_calls == [{
        "session_id": OWNER_SESSION, "job_id": "job-upload-a", "previous_status": "claimed",
    }]
    assert len(coordinator.table.get_requests) == 2
    assert all(request["ConsistentRead"] for request in coordinator.table.get_requests)
    assert coordinator.table.items == before
    _assert_read_only(coordinator)


def test_owner_binding_changed_during_observation_never_reaches_database_claim(
    tmp_path: Path, monkeypatch,
) -> None:
    coordinator = _coordinator(monkeypatch)
    peer, _worker, repository = _receiver(tmp_path / "peer", monkeypatch, coordinator)
    _stale_candidate(repository)
    describe = coordinator.ecs.describe_tasks

    def changed(**kwargs):
        result = describe(**kwargs)
        coordinator.table.items[f"lease#{OWNER_SESSION}"]["taskArn"] = OWNER_TASK + "-new"
        return result

    monkeypatch.setattr(coordinator.ecs, "describe_tasks", changed)

    assert peer.sweep_abandoned_uploads() == 0

    assert len(coordinator.table.get_requests) == 2
    assert repository.abandoned_claim_calls == repository.abandoned_cleanup_calls == []
    assert len(repository.abandoned_sessions) == 1
    _assert_read_only(coordinator)


def test_unknown_owner_from_failed_ecs_read_cannot_change_database_or_capacity(
    tmp_path: Path, monkeypatch,
) -> None:
    coordinator = _coordinator(monkeypatch)
    peer, _worker, repository = _receiver(tmp_path / "peer", monkeypatch, coordinator)
    _stale_candidate(repository)
    before = deepcopy(coordinator.table.items)
    monkeypatch.setattr(
        coordinator.ecs, "describe_tasks", MagicMock(side_effect=RuntimeError("ECS unavailable")),
    )

    assert peer.sweep_abandoned_uploads() == 0

    assert repository.abandoned_claim_calls == repository.abandoned_cleanup_calls == []
    assert coordinator.table.items == before
    _assert_read_only(coordinator)


def test_terminal_persistence_retry_keeps_its_owner_protected_from_peer_cleanup(
    tmp_path: Path, monkeypatch,
) -> None:
    coordinator = _coordinator(monkeypatch, status="RUNNING")
    repository = FakeRepository(5)
    owner, worker, _ = _receiver(tmp_path / "owner", monkeypatch, coordinator, repository)
    peer, _peer_worker, _ = _receiver(tmp_path / "peer", monkeypatch, coordinator, repository)
    allow_write, quarantined, heartbeat_seen = (threading.Event() for _ in range(3))
    complete, fail, heartbeat = (
        repository.complete_upload_session, repository.fail_upload_session,
        repository.heartbeat_upload_session,
    )

    def persist(method, *args, **kwargs):
        if not allow_write.is_set():
            raise RuntimeError("isolated terminal persistence outage")
        return method(*args, **kwargs)

    def maintained(*args):
        if quarantined.is_set():
            heartbeat_seen.set()
        return heartbeat(*args)

    repository.complete_upload_session = lambda *a, **kw: persist(complete, *a, **kw)
    repository.fail_upload_session = lambda *a, **kw: persist(fail, *a, **kw)
    repository.heartbeat_upload_session = maintained
    monkeypatch.setattr(
        "shorts_worker.upload_service._event",
        lambda event, **_fields: (
            quarantined.set() if event == "upload_terminal_persistence_quarantined" else None
        ),
    )
    status, _ = _http_exchange(owner, f"/v1/upload-sessions/{OWNER_SESSION}/source", upload=True)
    assert status == 202
    context = owner._active
    try:
        assert quarantined.wait(2) and heartbeat_seen.wait(1)
        _stale_candidate(repository)
        assert peer.sweep_abandoned_uploads() == 0
        assert repository.abandoned_claim_calls == repository.abandoned_cleanup_calls == []
        assert context.processing_done.is_set() and context.source_cleanup_complete
        assert not context.source_path.exists() and not context.terminal_persisted
        assert owner.busy and owner.quarantined and not context.finished.is_set()
        owner.task_protection.disable.assert_not_called()
        owner._notify_capacity_release.assert_not_called()
        _assert_read_only(coordinator)
    finally:
        allow_write.set()
        repository.abandoned_sessions = []
        context.next_cleanup_retry_at = 0
        owner.sweep_abandoned_uploads()
        assert context.finished.wait(2)
    assert context.terminal_persisted and not owner.busy
    assert len(worker.project_calls) == 1
    owner.task_protection.disable.assert_called_once()
    owner._notify_capacity_release.assert_called_once_with(OWNER_SESSION)
