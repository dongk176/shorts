from unittest.mock import Mock

import pytest

from shorts_worker.ranking_egress import RankingEgress
from shorts_worker.ranking_pipeline import (
    RankingDownloadFailure,
    RankingFailure,
    download_failure_category,
)


@pytest.mark.parametrize(
    "message",
    [
        "HTTP Error 429. Paid content",
        "Sign in not a bot: DRM protected",
        "not available in your country connection reset",
        "members-only proxy error",
        "confirm your age",
        "private video",
    ],
)
def test_content_restrictions_never_retry(message):
    assert download_failure_category(message, media=True) == "terminal"


@pytest.mark.parametrize(
    "message,expected",
    [
        ("Sign in to confirm you're not a bot", "bot_check"),
        ("HTTP Error 429", "bot_check"),
        ("connection reset", "network_error"),
        ("HTTP Error 403", "terminal"),
        ("unable to download video data: HTTP Error 403", "network_error"),
    ],
)
def test_only_known_transient_errors_retry(message, expected):
    assert download_failure_category(message, media=True) == expected


def egress(monkeypatch):
    obj = RankingEgress.__new__(RankingEgress)
    obj.operation = "test-operation"
    obj.routes = {"route-a": "http://first.test:80", "route-b": "http://second.test:80"}
    obj.claim = Mock(side_effect=["route-a", "route-b"])
    obj.release = Mock()
    monkeypatch.setattr("shorts_worker.ranking_egress.time.sleep", lambda _: None)
    return obj


def test_retry_releases_first_route_before_claiming_next(monkeypatch):
    obj = egress(monkeypatch)
    calls = []

    def acquire(proxy):
        calls.append(proxy)
        if len(calls) == 1:
            raise RankingDownloadFailure("bot_check")
        assert obj.release.call_args.args == ("route-a", "bot_check")
        return "video"

    assert obj.run(acquire, float("inf")) == "video"
    assert calls == list(obj.routes.values())
    assert obj.release.call_args.args == ("route-b", "success")


def test_terminal_or_unexpected_error_releases_without_rotation(monkeypatch):
    for error in [
        RankingDownloadFailure("terminal"),
        RankingFailure("restricted"),
        RuntimeError("bug"),
    ]:
        obj = egress(monkeypatch)
        with pytest.raises(type(error)):
            obj.run(Mock(side_effect=error), float("inf"))
        assert obj.claim.call_count == 1
        obj.release.assert_called_once_with("route-a", "terminal")


def test_no_direct_fallback_when_proxy_pool_is_missing(monkeypatch):
    monkeypatch.delenv("INGESTION_PROXY_ROUTES_JSON", raising=False)
    with pytest.raises(RankingFailure):
        RankingEgress(Mock(), {"id": "operation"})
