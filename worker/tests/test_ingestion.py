from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from shorts_worker.errors import BotCheckError
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


def test_download_bundle_uses_one_ytdlp_process(
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
        (tmp_path / "source.en.vtt").write_text("WEBVTT\n", encoding="utf-8")
        (tmp_path / "source.ko.vtt").write_text("WEBVTT\n한국어\n", encoding="utf-8")
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
