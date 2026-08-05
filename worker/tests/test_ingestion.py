from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

from shorts_worker.errors import (
    BotCheckError,
    IngestionError,
    RetryableIngestionError,
    RetryExhaustedIngestionError,
)
from shorts_worker.ingestion import (
    RETRY_DELAY_BASE_SECONDS,
    VideoMetadata,
    YtDlpIngestionProvider,
)
from shorts_worker.media import first_video_packet_pts, media_duration, probe_media


def _fake_success(args: list[str], info: dict[str, object]) -> subprocess.CompletedProcess[str]:
    stdout = ""
    if "--dump-single-json" in args:
        stdout = json.dumps(info)
    elif "--write-info-json" in args:
        output = Path(args[args.index("--output") + 1])
        output.parent.mkdir(parents=True, exist_ok=True)
        (output.parent / "source.info.json").write_text(json.dumps(info), encoding="utf-8")
        (output.parent / "source.mp4").write_bytes(b"video")
    return subprocess.CompletedProcess(args=args, returncode=0, stdout=stdout, stderr="")


def test_yt_dlp_retries_are_bounded_for_fast_route_failover() -> None:
    args = YtDlpIngestionProvider._base_args()

    assert args[args.index("--socket-timeout") + 1] == "15"
    for option in (
        "--retries",
        "--fragment-retries",
        "--extractor-retries",
        "--file-access-retries",
    ):
        assert args[args.index(option) + 1] == "1"


@pytest.mark.parametrize(
    ("source_seconds", "start_seconds", "end_seconds", "expected"),
    [
        (7200, 120, 360, "*110.000-370.000"),
        (7200, 120, 3720, "*110.000-3730.000"),
        (7200, 6960, 7200, "*6950.000-7200.000"),
    ],
)
def test_source_range_download_adds_only_ten_seconds_of_padding(
    source_seconds: float,
    start_seconds: float,
    end_seconds: float,
    expected: str,
) -> None:
    args, padded_start, padded_end = YtDlpIngestionProvider._download_section_args(
        source_seconds,
        start_seconds,
        end_seconds,
    )

    assert args == ["--download-sections", expected, "--no-force-keyframes-at-cuts"]
    assert padded_start == max(0, start_seconds - 10)
    assert padded_end == min(source_seconds, end_seconds + 10)


@pytest.mark.parametrize(
    ("start_seconds", "end_seconds"),
    [(0, 239.999), (0, 3600.001), (-1, 240), (500, 400)],
)
def test_source_range_download_rejects_out_of_policy_ranges(
    start_seconds: float,
    end_seconds: float,
) -> None:
    with pytest.raises(IngestionError) as caught:
        YtDlpIngestionProvider._download_section_args(
            7200,
            start_seconds,
            end_seconds,
        )
    assert caught.value.code == "ingestion_range_invalid"


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="FFmpeg integration binaries are unavailable",
)
def test_source_range_normalization_resets_pts_and_exact_duration(tmp_path: Path) -> None:
    raw = tmp_path / "raw.mp4"
    generated = subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=6",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
            "-shortest", str(raw),
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert generated.returncode == 0, generated.stderr

    normalized, raw_duration, raw_bytes = (
        YtDlpIngestionProvider._normalize_selected_range(
            raw,
            tmp_path,
            source_duration_seconds=100,
            padded_start_seconds=0,
            range_start_seconds=1,
            range_end_seconds=4,
        )
    )

    normalized_probe = probe_media(normalized)
    assert raw_duration == pytest.approx(6, abs=0.1)
    assert raw_bytes > 0
    assert first_video_packet_pts(normalized) == pytest.approx(0, abs=0.05)
    assert media_duration(normalized_probe) == pytest.approx(3, abs=0.1)
    assert not raw.exists()


def test_range_timeout_terminates_the_entire_process_group(tmp_path: Path) -> None:
    child_pid_path = tmp_path / "child.pid"
    script = (
        "import pathlib,subprocess,sys,time;"
        "child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);"
        "pathlib.Path(sys.argv[1]).write_text(str(child.pid));"
        "time.sleep(60)"
    )
    provider = YtDlpIngestionProvider(timeout_seconds=1.0)

    with pytest.raises(RetryableIngestionError):
        provider._run(
            [sys.executable, "-c", script, str(child_pid_path)],
            timeout=1.0,
            terminate_process_group=True,
        )

    child_pid = int(child_pid_path.read_text())
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        try:
            os.kill(child_pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.05)
    else:
        pytest.fail("timed-out child process remained alive")


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


def test_download_bundle_only_fetches_video_and_never_requests_subtitles(
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

    assert len(calls) == 1
    assert any("--write-info-json" in call for call in calls)
    assert not any("--write-subs" in call for call in calls)
    assert not any("--write-auto-subs" in call for call in calls)
    assert not any("--sub-langs" in call for call in calls)
    download_call = calls[0]
    assert "--download-sections" not in download_call
    assert "--force-keyframes-at-cuts" not in download_call
    assert "--no-force-keyframes-at-cuts" not in download_call
    assert not (tmp_path / "subtitles").exists()
    assert bundle.metadata.video_id == "dQw4w9WgXcQ"
    assert bundle.video_path == tmp_path / "video" / "source.mp4"

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
    assert caught.value.code == "youtube_rate_limited"


def test_rate_limit_fails_over_configured_egress_paths_then_fails(monkeypatch) -> None:
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
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert len(calls) == 3
    assert calls[0][-2:] == ["--proxy", "socks5://127.0.0.1:1080"]
    assert "--proxy" not in calls[1]
    assert calls[2][-2:] == ["--proxy", "socks5://127.0.0.1:2080"]


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
            stderr="ERROR: private video",
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

    result = YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert result.returncode == 0
    assert len(calls) == 1
    assert calls[0][-2:] == ["--proxy", "socks5://127.0.0.1:1080"]


def test_bot_check_fails_over_configured_egress_paths_then_fails(monkeypatch) -> None:
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

    assert len(calls) == 3
    assert calls[0][-2:] == ["--proxy", "socks5://127.0.0.1:1080"]
    assert "--proxy" not in calls[1]
    assert calls[2][-2:] == ["--proxy", "socks5://127.0.0.1:2080"]


def test_warp_bot_check_falls_back_to_direct_connection(monkeypatch) -> None:
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

    result = YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert result.returncode == 0
    assert len(calls) == 2
    assert calls[0][-2:] == ["--proxy", "socks5://127.0.0.1:1080"]
    assert "--proxy" not in calls[1]


def test_content_restriction_never_fails_over_egress(monkeypatch) -> None:
    calls: list[list[str]] = []
    monkeypatch.setenv("WARP_PROXY_URL", "socks5://127.0.0.1:1080")
    monkeypatch.setenv("FALLBACK_PROXY_URL", "socks5://127.0.0.1:2080")

    def fake_run(args: list[str], **_kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(
            args=args,
            returncode=1,
            stdout="",
            stderr="ERROR: This video is private",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(IngestionError, match="비공개") as caught:
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert caught.value.code == "youtube_private_video"
    assert len(calls) == 1


@pytest.mark.parametrize(
    ("upstream_error", "expected_code"),
    [
        ("ERROR: This video is not available in your country", "youtube_region_restricted"),
        ("ERROR: This video is members-only", "youtube_members_only"),
        ("ERROR: Please purchase this content", "youtube_paid_content"),
        ("ERROR: This format is DRM-protected", "youtube_drm_restricted"),
    ],
)
def test_content_restrictions_have_distinct_failure_codes(
    monkeypatch: pytest.MonkeyPatch,
    upstream_error: str,
    expected_code: str,
) -> None:
    monkeypatch.delenv("WARP_PROXY_URL", raising=False)
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr=upstream_error
        ),
    )

    with pytest.raises(IngestionError) as caught:
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert caught.value.code == expected_code


@pytest.mark.parametrize(
    "upstream_error",
    [
        "ERROR: [youtube] abc: Video unavailable. This content isn't available.",
        "ERROR: [youtube] abc: Video unavailable. This content isn’t available.",
    ],
)
def test_generic_content_unavailable_is_retryable(
    monkeypatch: pytest.MonkeyPatch,
    upstream_error: str,
) -> None:
    monkeypatch.delenv("WARP_PROXY_URL", raising=False)
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr=upstream_error
        ),
    )

    with pytest.raises(RetryableIngestionError) as caught:
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert caught.value.code == "youtube_extractor_failed"
    assert caught.value.retryable is True
    assert caught.value.failure_details()["upstream_reason"] == upstream_error


def test_explicit_region_restriction_remains_terminal_with_generic_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("WARP_PROXY_URL", raising=False)
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr=(
                "ERROR: Video unavailable. This content isn’t available.\n"
                "ERROR: This video is not available in your country"
            ),
        ),
    )

    with pytest.raises(IngestionError) as caught:
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert type(caught.value) is IngestionError
    assert caught.value.code == "youtube_region_restricted"


def test_unknown_upstream_failure_detail_redacts_urls_and_credentials(monkeypatch) -> None:
    monkeypatch.delenv("WARP_PROXY_URL", raising=False)
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr=(
                "ERROR: extractor failed at https://user:pass@example.test/video?token=secret "
                "Authorization: Bearer top-secret"
            ),
        ),
    )

    with pytest.raises(IngestionError) as caught:
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert caught.value.code == "youtube_extractor_failed"
    upstream_reason = str(caught.value.failure_details()["upstream_reason"])
    assert "[url]" in upstream_reason
    assert "[redacted]" in upstream_reason
    assert "secret" not in upstream_reason


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

    with pytest.raises(RetryableIngestionError) as caught:
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert caught.value.code == "youtube_network_error"


def test_media_data_forbidden_is_retryable(monkeypatch) -> None:
    monkeypatch.delenv("WARP_PROXY_URL", raising=False)
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="ERROR: unable to download video data: HTTP Error 403: Forbidden",
        ),
    )

    with pytest.raises(RetryableIngestionError) as caught:
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert caught.value.code == "youtube_media_forbidden"


def test_generic_forbidden_remains_terminal(monkeypatch) -> None:
    monkeypatch.delenv("WARP_PROXY_URL", raising=False)
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="ERROR: HTTP Error 403: Forbidden",
        ),
    )

    with pytest.raises(IngestionError) as caught:
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert type(caught.value) is IngestionError
    assert caught.value.code == "youtube_extractor_failed"


def test_media_data_forbidden_with_content_restriction_remains_terminal(
    monkeypatch,
) -> None:
    monkeypatch.delenv("WARP_PROXY_URL", raising=False)
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr=(
                "ERROR: This video is private\n"
                "ERROR: unable to download video data: HTTP Error 403: Forbidden"
            ),
        ),
    )

    with pytest.raises(IngestionError) as caught:
        YtDlpIngestionProvider()._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    assert type(caught.value) is IngestionError


def test_media_data_forbidden_retries_exactly_ten_times(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("WARP_PROXY_URL", raising=False)
    monkeypatch.delenv("FALLBACK_PROXY_URL", raising=False)
    provider = YtDlpIngestionProvider(retry_backoff_seconds=0)
    calls = 0

    def forbidden(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="ERROR: unable to download video data: HTTP Error 403: Forbidden",
        )

    def download_once(*_args, **kwargs):
        provider._run(
            ["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"],
            route=kwargs.get("route"),
            job_id=kwargs.get("job_id"),
            attempt=kwargs.get("attempt", 1),
        )

    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(provider, "_download_video_once", download_once)

    with pytest.raises(RetryExhaustedIngestionError):
        provider._download_video_work(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "dQw4w9WgXcQ",
            tmp_path,
            job_id="job-a",
        )

    assert calls == 10


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


def test_retry_delays_use_the_staged_schedule_with_twenty_percent_jitter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = YtDlpIngestionProvider()
    bounds: list[tuple[float, float]] = []

    def choose_upper_bound(lower: float, upper: float) -> float:
        bounds.append((lower, upper))
        return upper

    monkeypatch.setattr("shorts_worker.ingestion.random.uniform", choose_upper_bound)

    delays = [provider._retry_delay_seconds(attempt) for attempt in range(1, 10)]

    assert len(bounds) == 9
    for base, (lower, upper), delay in zip(RETRY_DELAY_BASE_SECONDS, bounds, delays, strict=True):
        assert lower == pytest.approx(base * 0.8)
        assert upper == pytest.approx(base * 1.2)
        assert delay == pytest.approx(upper)


@pytest.mark.parametrize(
    "message",
    ["Sign in to confirm you're not a bot", "HTTP Error 429: Too Many Requests"],
)
def test_video_work_retries_bot_checks_independently_until_tenth_attempt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, message: str
) -> None:
    provider = YtDlpIngestionProvider(retry_backoff_seconds=0)
    attempts = 0
    video_path = tmp_path / "source.mp4"
    video_path.write_bytes(b"video")

    def download_once(*_args, **_kwargs):
        nonlocal attempts
        attempts += 1
        if attempts < 10:
            raise BotCheckError(message)
        return VideoMetadata("dQw4w9WgXcQ", "title", "channel", "", 120), video_path

    monkeypatch.setattr(provider, "_download_video_once", download_once)

    result = provider._download_video_work(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "dQw4w9WgXcQ",
        tmp_path,
        job_id="job-a",
    )

    assert attempts == 10
    assert result.attempt_count == 10
    assert result.failed_attempt_count == 9
    assert all(reason.startswith("BotCheckError:") for reason in result.failure_reasons)


def test_video_work_fails_after_tenth_bot_check(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys
) -> None:
    provider = YtDlpIngestionProvider(retry_backoff_seconds=0)
    attempts = 0

    def download_once(*_args, **_kwargs):
        nonlocal attempts
        attempts += 1
        raise BotCheckError("Sign in to confirm you're not a bot")

    monkeypatch.setattr(provider, "_download_video_once", download_once)

    with pytest.raises(BotCheckError):
        provider._download_video_work(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "dQw4w9WgXcQ",
            tmp_path,
            job_id="job-a",
        )

    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert attempts == 10
    assert events[-1]["event"] == "ingestion_work_exhausted"
    assert events[-1]["error_type"] == "BotCheckError"


def test_multi_warp_routes_wait_for_cooldown_instead_of_failing(
    monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    routes = [
        {"id": f"warp-{suffix}", "proxy_url": f"socks5://127.0.0.1:{port}"}
        for suffix, port in zip("abcd", range(1081, 1085), strict=True)
    ]
    monkeypatch.setenv("WARP_PROXY_ROUTES_JSON", json.dumps(routes))
    now = [100.0]
    waits: list[float] = []

    def wait(seconds: float) -> None:
        waits.append(seconds)
        now[0] += seconds

    provider = YtDlpIngestionProvider(
        retry_backoff_seconds=0,
        bot_check_cooldown_seconds=12,
        route_clock=lambda: now[0],
        route_waiter=wait,
    )
    calls: list[list[str]] = []

    def fake_run(args: list[str], **_kwargs):
        calls.append(args)
        if len(calls) <= 4:
            return subprocess.CompletedProcess(
                args=args,
                returncode=1,
                stdout="",
                stderr="ERROR: Sign in to confirm you're not a bot",
            )
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    for _ in range(4):
        with pytest.raises(BotCheckError):
            provider._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])
    result = provider._run(["yt-dlp", "https://youtu.be/dQw4w9WgXcQ"])

    selected_proxies = [call[call.index("--proxy") + 1] for call in calls]
    assert result.returncode == 0
    assert selected_proxies == [
        "socks5://127.0.0.1:1081",
        "socks5://127.0.0.1:1082",
        "socks5://127.0.0.1:1083",
        "socks5://127.0.0.1:1084",
        "socks5://127.0.0.1:1081",
    ]
    assert waits == [pytest.approx(12)]
    events = capsys.readouterr().out
    assert "ingestion_routes_waiting" in events
    assert "127.0.0.1" not in events


def test_multi_warp_video_keeps_ten_attempt_budget_across_cooldown_waits(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    routes = [
        {"id": f"warp-{suffix}", "proxy_url": f"socks5://127.0.0.1:{port}"}
        for suffix, port in zip("abcd", range(1081, 1085), strict=True)
    ]
    monkeypatch.setenv("WARP_PROXY_ROUTES_JSON", json.dumps(routes))
    now = [0.0]
    waits: list[float] = []

    def wait(seconds: float) -> None:
        waits.append(seconds)
        now[0] += seconds

    provider = YtDlpIngestionProvider(
        retry_backoff_seconds=0,
        bot_check_cooldown_seconds=10,
        route_clock=lambda: now[0],
        route_waiter=wait,
    )
    info: dict[str, object] = {
        "id": "dQw4w9WgXcQ",
        "title": "테스트 영상",
        "channel": "테스트 채널",
        "duration": 120,
    }
    calls: list[list[str]] = []

    def fake_run(args: list[str], **_kwargs):
        calls.append(args)
        if len(calls) < 10:
            return subprocess.CompletedProcess(
                args=args,
                returncode=1,
                stdout="",
                stderr="ERROR: HTTP Error 429: Too Many Requests",
            )
        return _fake_success(args, info)

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = provider._download_video_work(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "dQw4w9WgXcQ",
        tmp_path,
        job_id="job-a",
    )

    assert len(calls) == 10
    assert result.attempt_count == 10
    assert result.failed_attempt_count == 9
    assert waits == [pytest.approx(10), pytest.approx(10)]


def test_centrally_assigned_webshare_route_uses_only_that_proxy(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    routes = [
        {
            "id": f"webshare-{index:02d}",
            "proxy_url": f"http://user:pass@192.0.2.{index}:{2000 + index}",
            "egress_class": "webshare_isp",
        }
        for index in range(1, 11)
    ]
    monkeypatch.setenv("INGESTION_EGRESS_MODE", "webshare_isp")
    monkeypatch.setenv("INGESTION_PROXY_ROUTES_JSON", json.dumps(routes))
    provider = YtDlpIngestionProvider(retry_backoff_seconds=0)
    info: dict[str, object] = {
        "id": "dQw4w9WgXcQ",
        "title": "테스트 영상",
        "channel": "테스트 채널",
        "duration": 120,
    }
    calls: list[list[str]] = []

    def fake_run(args: list[str], **_kwargs):
        calls.append(args)
        return _fake_success(args, info)

    monkeypatch.setattr(subprocess, "run", fake_run)

    provider.download_bundle(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        tmp_path,
        job_id="job-a",
        route_id="webshare-07",
    )

    assert len(calls) == 1
    assert calls[0][calls[0].index("--proxy") + 1] == routes[6]["proxy_url"]


def test_webshare_mode_fails_closed_without_a_central_route_assignment(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    routes = [{
        "id": "webshare-01",
        "proxy_url": "http://user:pass@192.0.2.1:2001",
        "egress_class": "webshare_isp",
    }]
    monkeypatch.setenv("INGESTION_EGRESS_MODE", "webshare_isp")
    monkeypatch.setenv("INGESTION_PROXY_ROUTES_JSON", json.dumps(routes))
    provider = YtDlpIngestionProvider()

    with pytest.raises(IngestionError, match="전용 경로"):
        provider.download_bundle(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            tmp_path,
            job_id="job-a",
        )
