from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from shorts_worker.errors import TranscriptionError
from shorts_worker.schemas import SubtitleSegment
from shorts_worker.subtitles import TranscriptionResult
from shorts_worker.worker_pipeline import BatchWorker


def _worker() -> BatchWorker:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(
        openai_api_key="configured",
        openai_transcribe_model="gpt-4o-mini-transcribe",
    )
    worker.transcriber = MagicMock()
    return worker


def test_transcription_observability_records_usage_without_source_text(
    tmp_path: Path, capsys
) -> None:
    worker = _worker()
    worker.transcriber.transcribe.return_value = TranscriptionResult(
        segments=[SubtitleSegment(start=10, end=30, text="sensitive transcript")],
        model="gpt-4o-mini-transcribe",
        chunk_count=4,
        silent_chunk_count=1,
        input_tokens=120,
        output_tokens=45,
    )

    transcript = worker._transcribe_source(
        job_id="job-a",
        source=tmp_path / "source.mp4",
        work_dir=tmp_path,
        duration_seconds=100,
    )

    output = capsys.readouterr().out
    event = json.loads(output)
    assert transcript[0].text == "sensitive transcript"
    assert "sensitive transcript" not in output
    assert event == {
        "event": "transcription_pipeline_observed",
        "job_id": "job-a",
        "provider": "openai",
        "model": "gpt-4o-mini-transcribe",
        "status": "succeeded",
        "chunk_count": 4,
        "silent_chunk_count": 1,
        "skipped_chunk_count": 0,
        "failed_chunk_count": 0,
        "quality_rejected_chunk_count": 0,
        "failed_audio_seconds": 0.0,
        "input_tokens": 120,
        "output_tokens": 45,
        "transcript_segment_count": 1,
        "transcript_coverage_ratio": 0.2,
    }


def test_partial_transcription_is_observed_without_failing_the_pipeline(
    tmp_path: Path, capsys
) -> None:
    worker = _worker()
    worker.transcriber.transcribe.return_value = TranscriptionResult(
        segments=[SubtitleSegment(start=0, end=30, text="usable transcript")],
        model="gpt-4o-mini-transcribe",
        chunk_count=4,
        silent_chunk_count=0,
        input_tokens=100,
        output_tokens=30,
        failed_chunk_count=1,
        quality_rejected_chunk_count=1,
        skipped_chunk_count=1,
        failed_audio_seconds=30,
    )

    transcript = worker._transcribe_source(
        job_id="job-a",
        source=tmp_path / "source.mp4",
        work_dir=tmp_path,
        duration_seconds=120,
    )

    event = json.loads(capsys.readouterr().out)
    assert transcript[0].text == "usable transcript"
    assert event["status"] == "partial"
    assert event["failed_chunk_count"] == 1
    assert event["quality_rejected_chunk_count"] == 1
    assert event["skipped_chunk_count"] == 1
    assert event["failed_audio_seconds"] == 30


def test_transcription_failure_is_logged_without_provider_details(
    tmp_path: Path, capsys
) -> None:
    worker = _worker()
    worker.transcriber.transcribe.side_effect = TranscriptionError(
        "provider response contained sensitive details"
    )

    with pytest.raises(TranscriptionError):
        worker._transcribe_source(
            job_id="job-a",
            source=tmp_path / "source.mp4",
            work_dir=tmp_path,
            duration_seconds=100,
        )

    output = capsys.readouterr().out
    event = json.loads(output)
    assert "sensitive details" not in output
    assert event["status"] == "failed"
    assert event["error_type"] == "TranscriptionError"
