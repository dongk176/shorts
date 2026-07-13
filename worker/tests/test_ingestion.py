from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from shorts_worker.errors import BotCheckError, IngestionError, RetryableIngestionError
from shorts_worker.ingestion import YtDlpIngestionProvider


def test_youtube_bot_challenge_does_not_recommend_cookie_bypass(monkeypatch) -> None:
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="ERROR: Sign in to confirm you're not a bot. Use --cookies-from-browser.",
        ),
    )

    with pytest.raises(BotCheckError) as caught:
        YtDlpIngestionProvider()._run(["yt-dlp", "https://www.youtube.com/watch?v=test"])

    message = str(caught.value)
    assert "자동 요청을 제한" in message
    assert "우회는 지원하지 않습니다" in message
    assert "cookies" not in message.lower()


def test_download_bundle_skips_caption_fetch_when_no_tracks_exist(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []

    def fake_run(args: list[str], *, timeout: float | None = None):
        calls.append(args)
        (tmp_path / "source.info.json").write_text(
            json.dumps(
                {
                    "id": "dQw4w9WgXcQ",
                    "title": "테스트 영상",
                    "channel": "테스트 채널",
                    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
                    "duration": 120,
                }
            ),
            encoding="utf-8",
        )
        (tmp_path / "source.mp4").write_bytes(b"video")
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    provider = YtDlpIngestionProvider()
    monkeypatch.setattr(provider, "_run", fake_run)

    bundle = provider.download_bundle(
        "https://youtu.be/dQw4w9WgXcQ",
        tmp_path,
    )

    assert len(calls) == 1
    assert "--write-info-json" in calls[0]
    assert "--write-subs" not in calls[0]
    assert "--write-auto-subs" not in calls[0]
    assert bundle.metadata.video_id == "dQw4w9WgXcQ"
    assert bundle.video_path == tmp_path / "source.mp4"
    assert bundle.subtitle_path is None


def test_download_bundle_prefers_official_subtitles(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []

    def fake_run(args: list[str], *, timeout: float | None = None):
        calls.append(args)
        if "--write-info-json" in args:
            (tmp_path / "source.info.json").write_text(
                json.dumps({
                    "id": "dQw4w9WgXcQ", "title": "테스트", "duration": 120,
                    "language": "ko", "subtitles": {"ko": [{}]},
                    "automatic_captions": {"ko-orig": [{}]},
                }), encoding="utf-8"
            )
            (tmp_path / "source.mp4").write_bytes(b"video")
        else:
            (tmp_path / "captions.ko.vtt").write_text("WEBVTT\n", encoding="utf-8")
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    provider = YtDlpIngestionProvider()
    monkeypatch.setattr(provider, "_run", fake_run)
    bundle = provider.download_bundle("https://youtu.be/dQw4w9WgXcQ", tmp_path)

    assert len(calls) == 2
    assert "--write-subs" in calls[1]
    assert "--write-auto-subs" not in calls[1]
    assert bundle.subtitle_path == tmp_path / "captions.ko.vtt"


def test_download_bundle_falls_back_to_automatic_subtitles(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []

    def fake_run(args: list[str], *, timeout: float | None = None):
        calls.append(args)
        if "--write-info-json" in args:
            (tmp_path / "source.info.json").write_text(
                json.dumps({
                    "id": "dQw4w9WgXcQ", "title": "테스트", "duration": 120,
                    "subtitles": {"en": [{}]}, "automatic_captions": {"ko": [{}]},
                }), encoding="utf-8"
            )
            (tmp_path / "source.mp4").write_bytes(b"video")
        else:
            (tmp_path / "captions.ko.vtt").write_text("WEBVTT\n", encoding="utf-8")
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    provider = YtDlpIngestionProvider()
    monkeypatch.setattr(provider, "_run", fake_run)
    bundle = provider.download_bundle("https://youtu.be/dQw4w9WgXcQ", tmp_path)

    assert len(calls) == 2
    assert "--write-subs" not in calls[1]
    assert "--write-auto-subs" in calls[1]
    assert bundle.subtitle_path == tmp_path / "captions.ko.vtt"


def test_download_bundle_does_not_use_foreign_subtitle_tracks(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []

    def fake_run(args: list[str], *, timeout: float | None = None):
        calls.append(args)
        (tmp_path / "source.info.json").write_text(
            json.dumps({
                "id": "dQw4w9WgXcQ", "title": "테스트", "duration": 120,
                "subtitles": {"ja": [{}]}, "automatic_captions": {"en": [{}]},
            }), encoding="utf-8"
        )
        (tmp_path / "source.mp4").write_bytes(b"video")
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    provider = YtDlpIngestionProvider()
    monkeypatch.setattr(provider, "_run", fake_run)
    bundle = provider.download_bundle("https://youtu.be/dQw4w9WgXcQ", tmp_path)

    assert len(calls) == 1
    assert bundle.subtitle_path is None


def test_rate_limit_uses_bot_check_circuit_error(monkeypatch) -> None:
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="ERROR: HTTP Error 429: Too Many Requests",
        ),
    )

    with pytest.raises(BotCheckError) as caught:
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert "요청 빈도를 제한" in str(caught.value)


def test_missing_warp_does_not_try_dead_local_proxy(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.delenv("WARP_PROXY_URL", raising=False)
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)

    def fake_run(args: list[str], **_kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(
            args=args,
            returncode=1,
            stdout="",
            stderr="ERROR: video unavailable",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(IngestionError):
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert len(calls) == 1
    assert "--proxy" not in calls[0]


def test_proxy_failure_does_not_hide_direct_bot_check(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setenv("WARP_PROXY_URL", "socks5://127.0.0.1:1080")
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)

    def fake_run(args: list[str], **_kwargs):
        calls.append(args)
        error = (
            "ERROR: proxy connection refused"
            if "--proxy" in args
            else "ERROR: Sign in to confirm you're not a bot"
        )
        return subprocess.CompletedProcess(args=args, returncode=1, stdout="", stderr=error)

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(BotCheckError):
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert len(calls) == 2
    assert calls[0][-2:] == ["--proxy", "socks5://127.0.0.1:1080"]
    assert "--proxy" not in calls[1]


def test_ready_warp_proxy_is_used_first(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setenv("WARP_PROXY_URL", "socks5://127.0.0.1:1080")
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)

    def fake_run(args: list[str], **_kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = YtDlpIngestionProvider()._run(
        ["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"]
    )

    assert result.returncode == 0
    assert len(calls) == 1
    assert calls[0][-2:] == ["--proxy", "socks5://127.0.0.1:1080"]


def test_bot_check_stops_the_current_attempt_without_switching_networks(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setenv("WARP_PROXY_URL", "socks5://127.0.0.1:1080")
    monkeypatch.setenv("FALLBACK_PROXY_URL", "socks5://127.0.0.1:2080")

    def fake_run(args: list[str], **_kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(
            args=args,
            returncode=1,
            stdout="",
            stderr="ERROR: Sign in to confirm you're not a bot",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(BotCheckError):
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert len(calls) == 1
    assert calls[0][-2:] == ["--proxy", "socks5://127.0.0.1:1080"]


def test_temporary_network_failure_is_retryable(monkeypatch) -> None:
    monkeypatch.delenv("WARP_PROXY_URL", raising=False)
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="ERROR: connection reset by peer",
        ),
    )

    with pytest.raises(RetryableIngestionError):
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])
