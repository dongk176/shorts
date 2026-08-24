from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from shorts_worker.errors import TranscriptionError
from shorts_worker.schemas import SubtitleSegment
from shorts_worker.subtitles import (
    ELEVENLABS_FALLBACK_POLICY,
    TranscriptionResult,
    TranscriptWord,
)
from shorts_worker.worker_pipeline import BatchWorker


def _worker() -> BatchWorker:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(
        openai_api_key="configured",
        openai_transcribe_model="gpt-4o-mini-transcribe",
    )
    worker.transcriber = MagicMock()
    worker.repository = MagicMock()
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
        "requested_policy": "openai_stable",
        "provider": "openai",
        "model": "gpt-4o-mini-transcribe",
        "status": "succeeded",
        "chunk_count": 4,
        "silent_chunk_count": 1,
        "skipped_chunk_count": 0,
        "failed_chunk_count": 0,
        "failed_audio_seconds": 0.0,
        "input_tokens": 120,
        "output_tokens": 45,
        "transcript_segment_count": 1,
        "transcript_coverage_ratio": 0.2,
        "language_code": None,
        "fallback_chunk_count": 0,
        "fallback_audio_seconds": 0.0,
        "unavailable_range_count": 0,
    }
    worker.repository.save_job_transcript.assert_not_called()


def test_candidate_transcription_persists_words_without_logging_text(
    tmp_path: Path, capsys
) -> None:
    worker = _worker()
    worker.transcriber.transcribe.return_value = TranscriptionResult(
        segments=[SubtitleSegment(start=60, end=61, text="민감한 전사")],
        model="scribe_v2",
        chunk_count=1,
        silent_chunk_count=0,
        input_tokens=0,
        output_tokens=0,
        requested_policy=ELEVENLABS_FALLBACK_POLICY,
        provider="elevenlabs",
        words=(TranscriptWord(
            text="민감한",
            start=60,
            end=60.5,
            provider="elevenlabs",
        ),),
        language_code="kor",
        language_probability=0.99,
    )

    worker._transcribe_source(
        job_id="job-candidate",
        source=tmp_path / "source.mp4",
        work_dir=tmp_path,
        duration_seconds=30,
        start_seconds=60,
        policy=ELEVENLABS_FALLBACK_POLICY,
    )

    output = capsys.readouterr().out
    assert "민감한 전사" not in output
    worker.repository.save_job_transcript.assert_called_once_with(
        "job-candidate",
        requested_policy=ELEVENLABS_FALLBACK_POLICY,
        provider_used="elevenlabs",
        model_used="scribe_v2",
        language_code="kor",
        language_probability=0.99,
        fallback_reasons=[],
        source_offset_seconds=60,
        transcript_text="민감한 전사",
        segments=[{"start": 60.0, "end": 61.0, "text": "민감한 전사"}],
        words=[{
            "text": "민감한",
            "start": 60,
            "end": 60.5,
            "provider": "elevenlabs",
        }],
    )


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
        skipped_chunk_count=1,
        failed_audio_seconds=30,
        unavailable_ranges=((30.0, 60.0),),
    )
    unavailable_ranges: list[tuple[float, float]] = []

    transcript = worker._transcribe_source(
        job_id="job-a",
        source=tmp_path / "source.mp4",
        work_dir=tmp_path,
        duration_seconds=120,
        unavailable_ranges_out=unavailable_ranges,
    )

    event = json.loads(capsys.readouterr().out)
    assert transcript[0].text == "usable transcript"
    assert event["status"] == "partial"
    assert event["failed_chunk_count"] == 1
    assert event["skipped_chunk_count"] == 1
    assert event["failed_audio_seconds"] == 30
    assert event["unavailable_range_count"] == 1
    assert unavailable_ranges == [(30.0, 60.0)]


def test_selected_transcription_records_window_and_limits_audio(tmp_path: Path) -> None:
    worker = _worker()
    worker.transcriber.transcribe.return_value = TranscriptionResult(
        segments=[SubtitleSegment(start=0, end=30, text="selected transcript")],
        model="gpt-4o-mini-transcribe",
        chunk_count=8,
        silent_chunk_count=0,
        input_tokens=10,
        output_tokens=4,
    )
    observation: dict[str, object] = {}

    worker._transcribe_source(
        job_id="job-range",
        source=tmp_path / "source.mp4",
        work_dir=tmp_path,
        duration_seconds=240,
        start_seconds=3600,
        limit_audio=True,
        observation=observation,
    )

    worker.transcriber.transcribe.assert_called_once_with(
        tmp_path / "source.mp4",
        tmp_path,
        start_seconds=3600,
        duration_seconds=240,
        policy="openai_stable",
    )
    assert observation == {
        "audioStartSeconds": 3600,
        "audioDurationSeconds": 240,
        "chunkCount": 8,
        "silentChunkCount": 0,
        "skippedChunkCount": 0,
        "failedChunkCount": 0,
        "provider": "openai",
        "model": "gpt-4o-mini-transcribe",
        "languageCode": None,
        "wordCount": 0,
        "fallbackChunkCount": 0,
        "fallbackAudioSeconds": 0.0,
        "unavailableRangeCount": 0,
    }


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
