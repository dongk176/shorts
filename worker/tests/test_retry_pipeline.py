from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from shorts_worker.errors import BotCheckError, IngestionError, RetryableIngestionError
from shorts_worker.worker_pipeline import BatchWorker


@contextmanager
def _context():
    yield


def _worker(tmp_path, error: Exception) -> BatchWorker:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(temp_dir=tmp_path)
    worker.repository = MagicMock()
    worker.repository.get_job.return_value = {
        "id": "job-a",
        "mvp_session_id": "session-a",
        "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "attempt_count": 0,
        "deadline_at": datetime.now(UTC) + timedelta(minutes=15),
    }
    worker.repository.claim_prepare_attempt.return_value = {
        "attempt_count": 1,
        "deadline_at": datetime.now(UTC) + timedelta(minutes=15),
    }
    worker.repository.can_retry_prepare.return_value = True
    worker.repository.ingestion_slot.side_effect = _context
    worker.ingestion = MagicMock()
    worker.ingestion.download_bundle.side_effect = error
    worker.storage = MagicMock()
    worker.queue = MagicMock()
    worker.queue.queue_url = "https://sqs.example/dispatch"
    worker.heartbeat = MagicMock(side_effect=lambda _job_id: _context())
    return worker


def test_bot_check_is_hidden_and_requeued_after_exactly_60_seconds(tmp_path) -> None:
    worker = _worker(tmp_path, BotCheckError("Sign in to confirm you're not a bot"))

    worker.prepare("job-a")

    worker.repository.retry_job.assert_called_once()
    worker.repository.fail_job.assert_not_called()
    worker.queue.send.assert_called_once_with(
        {"kind": "prepare_retry", "jobId": "job-a"}, delay_seconds=60
    )


def test_bot_check_array_retry_uses_parent_batch_id(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("AWS_BATCH_JOB_ID", "batch-parent:3")
    worker = _worker(tmp_path, BotCheckError("bot check"))

    worker.prepare("job-a")

    worker.queue.send.assert_called_once_with(
        {
            "kind": "prepare_retry",
            "jobId": "job-a",
            "failedBatchJobId": "batch-parent",
        },
        delay_seconds=60,
    )


def test_prepare_does_not_start_inside_the_last_five_minutes(tmp_path) -> None:
    worker = _worker(tmp_path, BotCheckError("bot check"))
    worker.repository.get_job.return_value["deadline_at"] = (
        datetime.now(UTC) + timedelta(minutes=4, seconds=59)
    )

    worker.prepare("job-a")

    worker.repository.claim_prepare_attempt.assert_not_called()
    worker.repository.fail_job.assert_called_once_with(
        "job-a", "prepare_deadline", worker.FINAL_INGESTION_MESSAGE
    )


def test_non_retryable_ingestion_error_fails_without_requeue(tmp_path) -> None:
    worker = _worker(tmp_path, IngestionError("Private video"))

    worker.prepare("job-a")

    worker.queue.send.assert_not_called()
    worker.repository.retry_job.assert_not_called()
    worker.repository.fail_job.assert_called_once_with(
        "job-a", "IngestionError", worker.FINAL_INGESTION_MESSAGE
    )


def test_temporary_ingestion_error_is_requeued(tmp_path) -> None:
    worker = _worker(tmp_path, RetryableIngestionError("connection timed out"))

    worker.prepare("job-a")

    worker.repository.retry_job.assert_called_once()
    worker.repository.fail_job.assert_not_called()
    worker.queue.send.assert_called_once_with(
        {"kind": "prepare_retry", "jobId": "job-a"}, delay_seconds=60
    )


def test_tenth_attempt_is_the_last_bot_check_attempt(tmp_path) -> None:
    worker = _worker(tmp_path, BotCheckError("bot check"))
    worker.repository.claim_prepare_attempt.return_value["attempt_count"] = 10

    worker.prepare("job-a")

    worker.queue.send.assert_not_called()
    worker.repository.retry_job.assert_not_called()
    worker.repository.fail_job.assert_called_once_with(
        "job-a", "BotCheckError", worker.FINAL_INGESTION_MESSAGE
    )


def test_rerender_deletes_new_output_if_short_was_deleted_before_commit(tmp_path) -> None:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(temp_dir=tmp_path)
    worker.repository = MagicMock()
    worker.repository.get_short.return_value = {
        "id": "short-a",
        "mvp_session_id": "session-a",
        "job_id": "job-a",
        "clean_clip_s3_key": "edit-sources/clean.mp4",
        "subtitle_segments": [],
        "hook_title": "제목",
        "channel_display_name": "채널",
        "template_id": "dark-red",
        "subtitles_enabled": False,
        "title_font_scale": 1.0,
        "render_version": 1,
    }
    worker.repository.complete_rerender.return_value = None
    worker.storage = MagicMock()
    worker.storage.download.return_value = tmp_path / "clean.mp4"
    worker.storage.upload.return_value = 123
    worker.renderer = MagicMock()

    worker.rerender("short-a")

    worker.storage.delete.assert_called_once_with(
        "outputs/session-a/job-a/short-a/v2.mp4"
    )
    worker.repository.reset_rerender.assert_not_called()


def test_rerender_preserves_output_when_commit_response_is_ambiguous(tmp_path) -> None:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(temp_dir=tmp_path)
    worker.repository = MagicMock()
    worker.repository.get_short.return_value = {
        "id": "short-a",
        "mvp_session_id": "session-a",
        "job_id": "job-a",
        "clean_clip_s3_key": "edit-sources/clean.mp4",
        "subtitle_segments": [],
        "hook_title": "제목",
        "channel_display_name": "채널",
        "template_id": "dark-red",
        "subtitles_enabled": False,
        "title_font_scale": 1.0,
        "render_version": 1,
    }
    worker.repository.complete_rerender.side_effect = ConnectionError("response lost")
    worker.storage = MagicMock()
    worker.storage.download.return_value = tmp_path / "clean.mp4"
    worker.storage.upload.return_value = 123
    worker.renderer = MagicMock()

    with pytest.raises(ConnectionError):
        worker.rerender("short-a")

    worker.storage.delete.assert_not_called()
