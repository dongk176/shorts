from __future__ import annotations

import json
import subprocess
import threading
from pathlib import Path

import pytest

from shorts_worker.errors import (
    BotCheckError,
    IngestionError,
    RetryableIngestionError,
    RetryExhaustedIngestionError,
)
from shorts_worker.ingestion import (
    SubtitleDownloadResult,
    VideoDownloadResult,
    VideoMetadata,
    YtDlpIngestionProvider,
)


def _fake_success(
    args: list[str], info: dict[str, object], *, write_caption: bool = True
) -> subprocess.CompletedProcess[str]:
    stdout = ""
    if "--dump-single-json" in args:
        stdout = json.dumps(info)
    elif "--write-info-json" in args:
        output = Path(args[args.index("--output") + 1])
        output.parent.mkdir(parents=True, exist_ok=True)
        (output.parent / "source.info.json").write_text(
            json.dumps(info), encoding="utf-8"
        )
        (output.parent / "source.mp4").write_bytes(b"video")
    elif write_caption and (
        "--write-subs" in args or "--write-auto-subs" in args
    ):
        output = Path(args[args.index("--output") + 1])
        output.parent.mkdir(parents=True, exist_ok=True)
        (output.parent / "captions.ko.vtt").write_text("WEBVTT\n", encoding="utf-8")
    return subprocess.CompletedProcess(args=args, returncode=0, stdout=stdout, stderr="")


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
    info: dict[str, object] = {
        "id": "dQw4w9WgXcQ",
        "title": "테스트 영상",
        "channel": "테스트 채널",
        "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
        "duration": 120,
    }

    def fake_run(args: list[str], *, timeout: float | None = None):
        calls.append(args)
        return _fake_success(args, info)

    provider = YtDlpIngestionProvider()
    monkeypatch.setattr(provider, "_run", fake_run)

    bundle = provider.download_bundle(
        "https://youtu.be/dQw4w9WgXcQ",
        tmp_path,
    )

    assert len(calls) == 2
    assert any("--write-info-json" in call for call in calls)
    assert any("--dump-single-json" in call for call in calls)
    assert not any("--write-subs" in call for call in calls)
    assert not any("--write-auto-subs" in call for call in calls)
    assert bundle.metadata.video_id == "dQw4w9WgXcQ"
    assert bundle.video_path == tmp_path / "video" / "source.mp4"
    assert bundle.subtitle_path is None
    assert bundle.subtitle_source == "none"
    assert bundle.subtitle_fetch_status == "no_tracks"


def test_download_bundle_prefers_official_subtitles(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    info: dict[str, object] = {
        "id": "dQw4w9WgXcQ",
        "title": "테스트",
        "duration": 120,
        "language": "ko",
        "subtitles": {"ko": [{}]},
        "automatic_captions": {"ko-orig": [{}]},
    }

    def fake_run(args: list[str], *, timeout: float | None = None):
        calls.append(args)
        return _fake_success(args, info)

    provider = YtDlpIngestionProvider()
    monkeypatch.setattr(provider, "_run", fake_run)
    bundle = provider.download_bundle("https://youtu.be/dQw4w9WgXcQ", tmp_path)

    assert len(calls) == 3
    assert any("--write-subs" in call for call in calls)
    assert not any("--write-auto-subs" in call for call in calls)
    assert bundle.subtitle_path == tmp_path / "subtitles" / "captions.ko.vtt"
    assert bundle.subtitle_source == "official"
    assert bundle.subtitle_language == "ko"
    assert bundle.subtitle_fetch_status == "downloaded"


def test_download_bundle_falls_back_to_automatic_subtitles(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    info: dict[str, object] = {
        "id": "dQw4w9WgXcQ",
        "title": "테스트",
        "duration": 120,
        "subtitles": {"en": [{}]},
        "automatic_captions": {"ko": [{}]},
    }

    def fake_run(args: list[str], *, timeout: float | None = None):
        calls.append(args)
        return _fake_success(args, info)

    provider = YtDlpIngestionProvider()
    monkeypatch.setattr(provider, "_run", fake_run)
    bundle = provider.download_bundle("https://youtu.be/dQw4w9WgXcQ", tmp_path)

    assert len(calls) == 3
    assert not any("--write-subs" in call for call in calls)
    assert any("--write-auto-subs" in call for call in calls)
    assert bundle.subtitle_path == tmp_path / "subtitles" / "captions.ko.vtt"
    assert bundle.subtitle_source == "automatic"
    assert bundle.subtitle_language == "ko"
    assert bundle.subtitle_fetch_status == "downloaded"


def test_download_bundle_records_failed_official_attempt_before_automatic_success(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    info: dict[str, object] = {
        "id": "dQw4w9WgXcQ",
        "title": "테스트",
        "duration": 120,
        "subtitles": {"ko": [{}]},
        "automatic_captions": {"ko": [{}]},
    }

    def fake_run(args: list[str], *, timeout: float | None = None):
        if "--write-subs" in args:
            raise IngestionError("official subtitle download failed")
        return _fake_success(args, info)

    provider = YtDlpIngestionProvider()
    monkeypatch.setattr(provider, "_run", fake_run)

    bundle = provider.download_bundle("https://youtu.be/dQw4w9WgXcQ", tmp_path)

    assert bundle.subtitle_source == "automatic"
    assert bundle.subtitle_fetch_status == "downloaded"
    assert bundle.subtitle_matching_track_count == 2
    assert bundle.subtitle_failed_attempt_count == 1


def test_download_bundle_does_not_use_foreign_subtitle_tracks(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    info: dict[str, object] = {
        "id": "dQw4w9WgXcQ",
        "title": "테스트",
        "duration": 120,
        "subtitles": {"ja": [{}]},
        "automatic_captions": {"en": [{}]},
    }

    def fake_run(args: list[str], *, timeout: float | None = None):
        calls.append(args)
        return _fake_success(args, info)

    provider = YtDlpIngestionProvider()
    monkeypatch.setattr(provider, "_run", fake_run)
    bundle = provider.download_bundle("https://youtu.be/dQw4w9WgXcQ", tmp_path)

    assert len(calls) == 2
    assert bundle.subtitle_path is None
    assert bundle.subtitle_fetch_status == "no_matching_language"


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


def test_rate_limit_fails_closed_without_network_rotation(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setenv("WARP_PROXY_URL", "socks5://127.0.0.1:1080")
    monkeypatch.setenv("FALLBACK_PROXY_URL", "socks5://127.0.0.1:2080")

    def fake_run(args: list[str], **_kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(
            args=args,
            returncode=1,
            stdout="",
            stderr="ERROR: HTTP Error 429: Too Many Requests",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(BotCheckError):
        YtDlpIngestionProvider()._run(
            ["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"]
        )

    assert len(calls) == 1


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


def test_bot_check_fails_closed_without_network_rotation(monkeypatch) -> None:
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


def test_warp_bot_check_does_not_fall_back_to_direct_connection(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setenv("WARP_PROXY_URL", "socks5://127.0.0.1:1080")
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)

    def fake_run(args: list[str], **_kwargs):
        calls.append(args)
        if "--proxy" in args:
            return subprocess.CompletedProcess(
                args=args,
                returncode=1,
                stdout="",
                stderr="ERROR: Sign in to confirm you're not a bot",
            )
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(BotCheckError):
        YtDlpIngestionProvider()._run(
            ["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"]
        )

    assert len(calls) == 1


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


def test_download_bundle_runs_video_and_subtitle_work_concurrently(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    provider = YtDlpIngestionProvider(retry_backoff_seconds=0)
    barrier = threading.Barrier(2, timeout=2)
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"video")

    def video_work(*_args, **_kwargs) -> VideoDownloadResult:
        barrier.wait()
        return VideoDownloadResult(
            metadata=VideoMetadata("dQw4w9WgXcQ", "title", "channel", "", 120),
            path=video_path,
            attempt_count=1,
            failed_attempt_count=0,
            failure_reasons=(),
        )

    def subtitle_work(*_args, **_kwargs) -> SubtitleDownloadResult:
        barrier.wait()
        return SubtitleDownloadResult(None, "none", None, "no_tracks")

    monkeypatch.setattr(provider, "_download_video_work", video_work)
    monkeypatch.setattr(provider, "_download_subtitle_work", subtitle_work)

    bundle = provider.download_bundle(
        "https://youtu.be/dQw4w9WgXcQ", tmp_path / "bundle", job_id="job-a"
    )

    assert bundle.video_path == video_path
    assert bundle.subtitle_fetch_status == "no_tracks"


def test_video_work_retries_at_most_ten_times_and_records_reasons(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    provider = YtDlpIngestionProvider(retry_backoff_seconds=0)
    attempts = 0
    video_path = tmp_path / "source.mp4"
    video_path.write_bytes(b"video")

    def download_once(*_args, **_kwargs):
        nonlocal attempts
        attempts += 1
        if attempts < 10:
            raise RetryableIngestionError("connection reset")
        return VideoMetadata("dQw4w9WgXcQ", "title", "channel", "", 120), video_path

    monkeypatch.setattr(provider, "_download_video_once", download_once)

    result = provider._download_video_work(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "dQw4w9WgXcQ",
        tmp_path,
        job_id="job-a",
    )

    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert attempts == 10
    assert result.attempt_count == 10
    assert result.failed_attempt_count == 9
    assert len(result.failure_reasons) == 9
    assert events[0]["asset"] == "video"
    assert events[0]["failure_reason"].endswith("connection reset")
    assert events[-1]["event"] == "ingestion_work_completed"


def test_video_work_stops_after_tenth_temporary_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    provider = YtDlpIngestionProvider(retry_backoff_seconds=0)
    attempts = 0

    def download_once(*_args, **_kwargs):
        nonlocal attempts
        attempts += 1
        raise RetryableIngestionError("connection timed out")

    monkeypatch.setattr(provider, "_download_video_once", download_once)

    with pytest.raises(RetryExhaustedIngestionError):
        provider._download_video_work(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "dQw4w9WgXcQ",
            tmp_path,
            job_id="job-a",
        )

    assert attempts == 10


def test_subtitle_work_uses_openai_fallback_status_after_ten_network_failures(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    provider = YtDlpIngestionProvider(retry_backoff_seconds=0)
    attempts = 0

    def extract_info(_url: str):
        nonlocal attempts
        attempts += 1
        raise RetryableIngestionError("temporary failure in name resolution")

    monkeypatch.setattr(provider, "_extract_info", extract_info)

    result = provider._download_subtitle_work(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        tmp_path,
        job_id="job-a",
    )

    assert attempts == 10
    assert result.status == "download_failed"
    assert result.work_attempt_count == 10
    assert result.work_failed_attempt_count == 10
    assert len(result.failure_reasons) == 10
