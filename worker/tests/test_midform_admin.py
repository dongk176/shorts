from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from shorts_worker.midform_project import require_midform_worker_access


@pytest.mark.parametrize("admin,enabled,release,allowed", [
    (True, "true", "release", True),
    (False, "true", "release", False),
    (True, "false", "release", False),
    (True, "true", "other-release", False),
])
def test_live_admin_and_exact_release_required(monkeypatch, admin, enabled, release, allowed):
    monkeypatch.setenv("MIDFORM_ENABLED", enabled)
    monkeypatch.setenv("MIDFORM_RELEASE_ID", "release")
    connection = Mock()
    connection.execute.return_value.fetchone.return_value = {
        "is_admin": admin, "midform_request": {"version": 1, "targetSeconds": 0},
        "midform_release_id": release, "initial_editor_release_id": release,
    }

    @contextmanager
    def connect():
        yield connection

    worker = SimpleNamespace(repository=SimpleNamespace(connect=connect))
    if allowed:
        require_midform_worker_access(worker, "job")
    else:
        with pytest.raises(ValueError, match="권한"):
            require_midform_worker_access(worker, "job")
