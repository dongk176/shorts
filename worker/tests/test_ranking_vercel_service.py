import base64
import hmac
import json
from uuid import uuid4

import pytest

from shorts_worker.ranking_pipeline import RankingFailure
from shorts_worker.ranking_vercel_service import Service, byte_range, verify_token


def test_health_advertises_framing_support_without_changing_operations():
    from shorts_worker.ranking_vercel_service import Handler

    handler = Handler.__new__(Handler)
    handler.path = "/health"
    replies = []
    handler.reply = lambda status, body: replies.append((status, body))
    handler.do_GET()
    assert replies == [(200, {"ok": True, "capabilities": ["source-framing-v1"]})]


def token(secret, method, project, source, owner, expires):
    body = (
        base64.urlsafe_b64encode(
            json.dumps(
                dict(v=1, method=method, project=project, source=source, owner=owner, exp=expires)
            ).encode()
        )
        .decode()
        .rstrip("=")
    )
    signature = (
        base64.urlsafe_b64encode(
            hmac.digest(secret.encode(), f"ranking-v1.{body}".encode(), "sha256")
        )
        .decode()
        .rstrip("=")
    )
    return f"{body}.{signature}"


def test_capabilities_bind_every_resource_and_expire():
    secret = "a" * 64
    project, source, owner = [str(uuid4()) for _ in range(3)]
    cap = token(secret, "GET", project, source, owner, 200)
    assert verify_token(secret, cap, "GET", project, source, owner, now=100)
    for method, p, s, u in [
        ("PUT", project, source, owner),
        ("GET", str(uuid4()), source, owner),
        ("GET", project, str(uuid4()), owner),
        ("GET", project, source, str(uuid4())),
    ]:
        assert not verify_token(secret, cap, method, p, s, u, now=100)
    assert not verify_token(secret, cap, "GET", project, source, owner, now=201)
    assert not verify_token("b" * 64, cap, "GET", project, source, owner, now=100)
    assert not verify_token(secret, "invalid", "GET", project, source, owner, now=100)


def test_browser_ranges_are_bounded():
    assert byte_range("bytes=20-30", 100) == (20, 30, True)
    assert byte_range("bytes=90-", 100) == (90, 99, True)
    assert byte_range("bytes=-10", 100) == (90, 99, True)
    for value in ["bytes=100-", "bytes=9-2", "bytes=1-3,6-8", "bytes=-0"]:
        with pytest.raises(ValueError):
            byte_range(value, 100)


def test_upload_admission_is_idempotent_and_bounded_parallel(tmp_path, monkeypatch):
    monkeypatch.setenv("RANKING_STORAGE_ROOT", str(tmp_path))
    service = Service(dict(project=str(uuid4()), owner=str(uuid4()), secret="a" * 64, origins=[]))
    operation, source = str(uuid4()), str(uuid4())
    data = dict(action="import", sourceId=source, size=100)
    assert service.submit(operation, data)["status"] == "uploading"
    assert service.submit(operation, data)["status"] == "uploading"
    service.operations[operation]["status"] = "receiving"
    for _ in range(2):
        assert (
            service.submit(str(uuid4()), dict(action="import", sourceId=str(uuid4()), size=100))[
                "status"
            ]
            == "uploading"
        )
    with pytest.raises(RankingFailure):
        service.submit(str(uuid4()), dict(action="import", sourceId=str(uuid4()), size=100))
    with pytest.raises(RankingFailure):
        service.submit(str(uuid4()), dict(action="render"))


def test_retry_only_recovers_transient_failure_and_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setenv("RANKING_STORAGE_ROOT", str(tmp_path))
    monkeypatch.setattr("threading.Thread.start", lambda self: None)
    service = Service(dict(project=str(uuid4()), owner=str(uuid4()), secret="a" * 64, origins=[]))
    operation, source = str(uuid4()), str(uuid4())
    data = dict(
        action="preview", sourceId=source, url="https://www.youtube.com/watch?v=abcdefghijk"
    )
    service.submit(operation, data)
    service.operations[operation].update(status="failed", failureCategory="bot_check")
    assert service.submit(operation, {**data, "attempt": 1})["status"] == "running"
    assert service.submit(operation, {**data, "attempt": 0})["attempt"] == 1
    service.operations[operation].update(status="failed", failureCategory="terminal")
    assert service.submit(operation, {**data, "attempt": 2})["status"] == "failed"
    with pytest.raises(RankingFailure):
        service.submit(operation, {**data, "attempt": 3})


def test_bot_challenge_returns_for_route_failover_without_repeating_same_ip():
    import time

    from shorts_worker.ranking_pipeline import RankingDownloadFailure
    from shorts_worker.ranking_vercel_service import Egress

    calls = []

    def action(proxy):
        calls.append(proxy)
        raise RankingDownloadFailure("bot_check")

    with pytest.raises(RankingDownloadFailure):
        Egress("test-route").run(action, time.monotonic() + 30)
    assert calls == ["test-route"]


def test_parallel_sources_execute_before_any_one_finishes(tmp_path, monkeypatch):
    import threading

    from shorts_worker.ranking_vercel_service import VercelPipeline

    monkeypatch.setenv("RANKING_STORAGE_ROOT", str(tmp_path))
    gate = threading.Barrier(4)
    release = threading.Event()

    def imported(self, source, url):
        gate.wait(timeout=3)
        release.wait(timeout=3)
        return {"id": source}

    monkeypatch.setattr(VercelPipeline, "import_source", imported)
    service = Service(dict(project=str(uuid4()), owner=str(uuid4()), secret="a" * 64, origins=[]))
    ids = [str(uuid4()) for _ in range(3)]
    try:
        for op in ids:
            service.submit(
                op,
                dict(
                    action="preview",
                    sourceId=str(uuid4()),
                    url="https://www.instagram.com/reel/abcde/",
                ),
            )
        gate.wait(timeout=3)
        assert all(service.operations[op]["status"] == "running" for op in ids)
    finally:
        release.set()


def test_safe_failure_reasons_never_contain_credentials():
    from shorts_worker.ranking_pipeline import download_failure_category, download_failure_reason

    for message, expected in [
        (
            "Sign in to confirm you're not a bot https://user:password@proxy.invalid",
            "bot_challenge",
        ),
        ("HTTP Error 429: Too Many Requests", "rate_limited"),
        ("not available in your country; HTTP Error 429", "restricted_or_unavailable"),
    ]:
        assert download_failure_reason(message, download_failure_category(message)) == expected


def test_render_source_budget_allows_ten_attempts_but_never_eleven(tmp_path, monkeypatch):
    monkeypatch.setenv("RANKING_STORAGE_ROOT", str(tmp_path))
    monkeypatch.setattr("threading.Thread.start", lambda self: None)
    service = Service(dict(project=str(uuid4()), owner=str(uuid4()), secret="a" * 64, origins=[]))
    operation = str(uuid4())
    data = dict(
        action="preview",
        sourceId=str(uuid4()),
        url="https://www.youtube.com/watch?v=abcdefghijk",
        maxAttempts=10,
    )
    for attempt in range(10):
        assert service.submit(operation, {**data, "attempt": attempt})["attempt"] == attempt
        service.operations[operation].update(status="failed", failureCategory="bot_check")
    with pytest.raises(RankingFailure):
        service.submit(operation, {**data, "attempt": 10})
    with pytest.raises(RankingFailure):
        service.submit(operation, {**data, "attempt": 9, "sourceId": str(uuid4())})
