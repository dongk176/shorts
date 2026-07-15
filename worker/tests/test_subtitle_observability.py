from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from shorts_worker.ingestion import DownloadedAssetBundle, VideoMetadata
from shorts_worker.schemas import SubtitleSegment
from shorts_worker.worker_pipeline import BatchWorker


def _bundle(tmp_path: Path, **overrides: object) -> DownloadedAssetBundle:
    values: dict[str, object] = {
        "metadata": VideoMetadata("video-a", "title", "channel", "", 100),
        "video_path": tmp_path / "source.mp4",
        "subtitle_path": None,
        "subtitle_source": "none",
        "subtitle_fetch_status": "no_tracks",
    }
    values.update(overrides)
    return DownloadedAssetBundle(**values)  # type: ignore[arg-type]


def _worker(tmp_path: Path, *, openai_configured: bool = True) -> BatchWorker:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(
        openai_api_key="configured" if openai_configured else None,
        openai_transcribe_model="gpt-4o-transcribe",
    )
    worker.transcriber = MagicMock()
    worker.transcriber.transcribe.return_value = [
        SubtitleSegment(start=10, end=30, text="transcribed")
    ]
    return worker


def test_observability_records_why_openai_fallback_was_selected(
    tmp_path: Path, capsys
) -> None:
    worker = _worker(tmp_path)
    bundle = _bundle(
        tmp_path,
        subtitle_fetch_status="no_matching_language",
        subtitle_matching_track_count=0,
    )

    transcript = worker._resolve_transcript(
        job_id="job-a",
        bundle=bundle,
        source=tmp_path / "source.mp4",
        work_dir=tmp_path,
        duration_seconds=100,
    )

    event = json.loads(capsys.readouterr().out)
    assert transcript[0].text == "transcribed"
    assert event["event"] == "subtitle_pipeline_observed"
    assert event["openai_fallback_selected"] is True
    assert event["openai_fallback_reason"] == "no_matching_language"
    assert event["openai_result_status"] == "segments"
    assert event["transcript_source"] == "openai"
    assert event["transcript_segment_count"] == 1
    assert event["transcript_coverage_ratio"] == 0.2


def test_observability_uses_caption_without_openai_and_merges_coverage(
    tmp_path: Path, capsys, monkeypatch
) -> None:
    worker = _worker(tmp_path)
    subtitle_path = tmp_path / "captions.ko.vtt"
    subtitle_path.write_text("WEBVTT\n", encoding="utf-8")
    bundle = _bundle(
        tmp_path,
        subtitle_path=subtitle_path,
        subtitle_source="official",
        subtitle_language="ko",
        subtitle_fetch_status="downloaded",
        subtitle_matching_track_count=1,
    )
    monkeypatch.setattr(
        "shorts_worker.worker_pipeline.parse_subtitle_file",
        lambda _path: [
            SubtitleSegment(start=0, end=20, text="first"),
            SubtitleSegment(start=10, end=30, text="overlap"),
        ],
    )

    worker._resolve_transcript(
        job_id="job-a",
        bundle=bundle,
        source=tmp_path / "source.mp4",
        work_dir=tmp_path,
        duration_seconds=100,
    )

    event = json.loads(capsys.readouterr().out)
    worker.transcriber.transcribe.assert_not_called()
    assert event["caption_parse_status"] == "parsed"
    assert event["openai_fallback_selected"] is False
    assert event["transcript_source"] == "official"
    assert event["transcript_coverage_ratio"] == 0.3


def test_missing_openai_key_is_distinguished_from_empty_transcription(
    tmp_path: Path, capsys
) -> None:
    worker = _worker(tmp_path, openai_configured=False)

    transcript = worker._resolve_transcript(
        job_id="job-a",
        bundle=_bundle(tmp_path),
        source=tmp_path / "source.mp4",
        work_dir=tmp_path,
        duration_seconds=100,
    )

    event = json.loads(capsys.readouterr().out)
    assert transcript == []
    worker.transcriber.transcribe.assert_not_called()
    assert event["openai_result_status"] == "not_configured"
    assert event["transcript_source"] == "none"


def test_empty_caption_parse_is_recorded_as_the_fallback_reason(
    tmp_path: Path, capsys, monkeypatch
) -> None:
    worker = _worker(tmp_path)
    subtitle_path = tmp_path / "captions.ko.vtt"
    subtitle_path.write_text("WEBVTT\n", encoding="utf-8")
    monkeypatch.setattr(
        "shorts_worker.worker_pipeline.parse_subtitle_file", lambda _path: []
    )

    worker._resolve_transcript(
        job_id="job-a",
        bundle=_bundle(
            tmp_path,
            subtitle_path=subtitle_path,
            subtitle_source="automatic",
            subtitle_language="ko",
            subtitle_fetch_status="downloaded",
        ),
        source=tmp_path / "source.mp4",
        work_dir=tmp_path,
        duration_seconds=100,
    )

    event = json.loads(capsys.readouterr().out)
    assert event["caption_parse_status"] == "empty"
    assert event["openai_fallback_reason"] == "caption_parse_empty"
    assert event["transcript_source"] == "openai"


def test_subtitle_retry_exhaustion_keeps_openai_fallback_and_failure_details(
    tmp_path: Path, capsys
) -> None:
    worker = _worker(tmp_path)
    reasons = ("RetryableIngestionError: connection timed out",) * 10

    transcript = worker._resolve_transcript(
        job_id="job-a",
        bundle=_bundle(
            tmp_path,
            subtitle_fetch_status="download_failed",
            subtitle_attempt_count=10,
            subtitle_work_failed_attempt_count=10,
            subtitle_failure_reasons=reasons,
            video_attempt_count=2,
            video_failed_attempt_count=1,
            video_failure_reasons=("RetryableIngestionError: connection reset",),
        ),
        source=tmp_path / "source.mp4",
        work_dir=tmp_path,
        duration_seconds=100,
    )

    event = json.loads(capsys.readouterr().out)
    assert transcript[0].text == "transcribed"
    worker.transcriber.transcribe.assert_called_once()
    assert event["openai_fallback_reason"] == "download_failed"
    assert event["caption_attempt_count"] == 10
    assert event["caption_work_failed_attempt_count"] == 10
    assert len(event["caption_failure_reasons"]) == 10
    assert event["video_attempt_count"] == 2
    assert event["video_failed_attempt_count"] == 1
