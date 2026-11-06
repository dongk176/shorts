from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest

from shorts_worker.repository import WorkerRepository
from shorts_worker.upload_candidate import upload_candidate_accepting, upload_candidate_scope

RELEASE = "d201e5fe-5b29-4ad8-8817-9d584ac902dd"
ADMIN = "e86821c9-2eb2-4c04-b748-fd269fc46f20"


@pytest.fixture
def candidate(monkeypatch):
    monkeypatch.setenv("FILE_UPLOAD_CANDIDATE_RELEASE_ID", RELEASE)
    monkeypatch.setenv("FILE_UPLOAD_CANDIDATE_ADMIN_ID", ADMIN)
    monkeypatch.setenv("FILE_UPLOAD_CANDIDATE_EXPIRES_AT",
                       (datetime.now(UTC) + timedelta(hours=1)).isoformat())


def repository(row=None):
    repo = WorkerRepository("postgresql://unused", "ap-northeast-2")
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = row
    conn.execute.return_value.fetchall.return_value = []

    @contextmanager
    def connect():
        yield conn

    repo.connect = connect
    return repo, conn


def test_legacy_receiver_does_not_add_preclaim_query(monkeypatch):
    monkeypatch.delenv("FILE_UPLOAD_CANDIDATE_RELEASE_ID", raising=False)
    monkeypatch.delenv("FILE_UPLOAD_CANDIDATE_ADMIN_ID", raising=False)
    repo, conn = repository()
    assert repo.candidate_upload_session_allowed("session", "token")
    conn.execute.assert_not_called()


def test_candidate_preclaim_checks_owner_release_token_and_expiry(candidate, monkeypatch):
    repo, conn = repository({"token_hash": "a" * 64})
    assert repo.candidate_upload_session_allowed("session", "a" * 64)
    query, params = conn.execute.call_args.args
    assert params == ("session", ADMIN, RELEASE)
    assert "u.is_admin" in query and "j.initial_editor_release_id=%s" in query
    assert not repo.candidate_upload_session_allowed("session", "b" * 64)
    monkeypatch.setenv("FILE_UPLOAD_CANDIDATE_EXPIRES_AT", "2000-01-01T00:00:00Z")
    conn.reset_mock()
    assert not repo.candidate_upload_session_allowed("session", "a" * 64)
    conn.execute.assert_not_called()


@pytest.mark.parametrize("change", [
    {"is_admin": False}, {"user_id": RELEASE}, {"initial_editor_release_id": ADMIN},
])
def test_atomic_claim_rejects_foreign_scope_before_any_writes(candidate, change):
    row = {"user_id": ADMIN, "initial_editor_release_id": RELEASE, "is_admin": True}
    repo, conn = repository({**row, **change})
    assert repo.claim_upload_session("session", "a" * 64, 1) == {"claim_result": "not_found"}
    assert conn.execute.call_count == 1


def test_expired_candidate_can_cleanup_only_its_own_scope(candidate, monkeypatch):
    monkeypatch.setenv("FILE_UPLOAD_CANDIDATE_EXPIRES_AT", "2000-01-01T00:00:00Z")
    assert not upload_candidate_accepting()
    assert upload_candidate_scope() == (RELEASE, ADMIN)
    repo, conn = repository()
    repo.list_abandoned_upload_sessions(stale_after_seconds=60, active_upload_session_id=None)
    repo.claim_abandoned_upload_sessions(stale_after_seconds=60, active_upload_session_id=None,
                                        expired_awaiting_upload_session_ids=[ADMIN])
    repo.expire_waiting_upload_capacity_requests()
    for call in conn.execute.call_args_list:
        query, params = call.args
        assert "scope_job.initial_editor_release_id=%s::uuid" in query
        assert "scope_user.is_admin" in query
        assert params.count(RELEASE) == 2 and params.count(ADMIN) == 2


def test_incomplete_scope_fails_closed(candidate, monkeypatch):
    monkeypatch.delenv("FILE_UPLOAD_CANDIDATE_ADMIN_ID")
    with pytest.raises(RuntimeError):
        upload_candidate_scope()


def test_private_receiver_rejects_public_or_other_candidate_paths(candidate):
    from shorts_worker.upload_service import UploadReceiverService
    session = "10000000-0000-4000-8000-000000000001"
    suffix = f"/v1/upload-sessions/{session}/source"
    assert UploadReceiverService.parse_session_id(f"/admin-upload/{RELEASE}{suffix}") == session
    assert UploadReceiverService.parse_session_id(suffix) is None
    assert UploadReceiverService.parse_session_id(f"/admin-upload/{ADMIN}{suffix}") is None
    assert UploadReceiverService.parse_session_id(f"/admin-upload/{RELEASE}{suffix}?x=1") is None


@pytest.fixture
def parallel(monkeypatch):
    for key in ("FILE_UPLOAD_CANDIDATE_RELEASE_ID", "FILE_UPLOAD_CANDIDATE_ADMIN_ID",
                "FILE_UPLOAD_CANDIDATE_EXPIRES_AT"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("FILE_UPLOAD_PARALLEL_RELEASE_ID", RELEASE)


def test_parallel_scope_requires_exact_separate_path(parallel):
    from shorts_worker.upload_service import UploadReceiverService
    session = "10000000-0000-4000-8000-000000000001"
    suffix = f"/v1/upload-sessions/{session}/source"
    assert upload_candidate_scope() == (RELEASE, None)
    assert upload_candidate_accepting()
    assert UploadReceiverService.parse_session_id(f"/silence-upload/{RELEASE}{suffix}") == session
    for prefix in ("", f"/admin-upload/{RELEASE}", f"/silence-upload/{ADMIN}"):
        assert UploadReceiverService.parse_session_id(prefix + suffix) is None


def test_parallel_preclaim_keeps_token_owner_and_immutable_marker_checks(parallel):
    repo, conn = repository({"token_hash": "a" * 64})
    assert repo.candidate_upload_session_allowed("session", "a" * 64)
    query, params = conn.execute.call_args.args
    assert params == ("session", RELEASE, RELEASE)
    assert "j.user_id=us.user_id" in query
    assert "silence_inline_release_id" in query
    assert "j.initial_editor_release_id=%s::uuid" in query
    assert not repo.candidate_upload_session_allowed("session", "b" * 64)


@pytest.mark.parametrize("marker", [None, ADMIN])
def test_parallel_receiver_rejects_old_or_foreign_session_before_writes(parallel, marker):
    repo, conn = repository({"user_id": ADMIN, "is_admin": False,
                             "initial_editor_release_id": RELEASE,
                             "silence_inline_release_id": marker})
    assert repo.claim_upload_session("session", "a" * 64, 1) == {"claim_result": "not_found"}
    assert conn.execute.call_count == 1


def test_parallel_cannot_mix_private_admin_scope(parallel, monkeypatch):
    monkeypatch.setenv("FILE_UPLOAD_CANDIDATE_ADMIN_ID", ADMIN)
    with pytest.raises(RuntimeError):
        upload_candidate_scope()
