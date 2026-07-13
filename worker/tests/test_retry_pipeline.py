from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

from shorts_worker.errors import BotCheckError, IngestionError
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


def test_tenth_attempt_is_the_last_bot_check_attempt(tmp_path) -> None:
    worker = _worker(tmp_path, BotCheckError("bot check"))
    worker.repository.claim_prepare_attempt.return_value["attempt_count"] = 10

    worker.prepare("job-a")

    worker.queue.send.assert_not_called()
    worker.repository.retry_job.assert_not_called()
    worker.repository.fail_job.assert_called_once_with(
        "job-a", "BotCheckError", worker.FINAL_INGESTION_MESSAGE
    )
