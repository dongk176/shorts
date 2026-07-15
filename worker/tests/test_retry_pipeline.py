from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from shorts_worker.errors import (
    BotCheckError,
    IngestionError,
    RetryableIngestionError,
    RetryExhaustedIngestionError,
)
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


def test_bot_check_does_not_requeue_prepare(tmp_path) -> None:
    worker = _worker(tmp_path, BotCheckError("Sign in to confirm you're not a bot"))

    worker.prepare("job-a")

    worker.repository.retry_job.assert_not_called()
    worker.queue.send.assert_not_called()
    worker.repository.fail_job.assert_called_once_with(
        "job-a", "BotCheckError", worker.FINAL_INGESTION_MESSAGE
    )


def test_bot_check_array_attempt_does_not_requeue_parent(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("AWS_BATCH_JOB_ID", "batch-parent:3")
    worker = _worker(tmp_path, BotCheckError("bot check"))

    worker.prepare("job-a")

    worker.queue.send.assert_not_called()
    worker.repository.retry_job.assert_not_called()
    worker.repository.fail_job.assert_called_once_with(
        "job-a", "BotCheckError", worker.FINAL_INGESTION_MESSAGE
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


def test_escaped_temporary_ingestion_error_does_not_requeue_prepare(tmp_path) -> None:
    worker = _worker(tmp_path, RetryableIngestionError("connection timed out"))

    worker.prepare("job-a")

    worker.repository.retry_job.assert_not_called()
    worker.queue.send.assert_not_called()
    worker.repository.fail_job.assert_called_once_with(
        "job-a", "RetryableIngestionError", worker.FINAL_INGESTION_MESSAGE
    )


def test_exhausted_video_work_fails_without_another_prepare_retry(tmp_path) -> None:
    worker = _worker(
        tmp_path,
        RetryExhaustedIngestionError("video download failed ten times"),
    )

    worker.prepare("job-a")

    worker.repository.retry_job.assert_not_called()
    worker.queue.send.assert_not_called()
    worker.repository.fail_job.assert_called_once_with(
        "job-a", "RetryExhaustedIngestionError", worker.FINAL_INGESTION_MESSAGE
    )


def test_non_ingestion_prepare_failure_uses_processing_message(tmp_path) -> None:
    worker = _worker(tmp_path, RuntimeError("database constraint"))

    with pytest.raises(RuntimeError):
        worker.prepare("job-a")

    worker.repository.fail_job.assert_called_once_with(
        "job-a", "RuntimeError", worker.FINAL_PROCESSING_MESSAGE
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


def _initial_render_worker(tmp_path, completion_result) -> BatchWorker:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(temp_dir=tmp_path)
    worker.repository = MagicMock()
    worker.repository.begin_initial_render.return_value = True
    worker.repository.initial_render_matches.return_value = False
    if isinstance(completion_result, Exception):
        worker.repository.complete_initial_render.side_effect = completion_result
    else:
        worker.repository.complete_initial_render.return_value = completion_result
    worker.storage = MagicMock()
    worker.storage.download.return_value = tmp_path / "clean.mp4"
    worker.storage.upload.return_value = 123
    worker.renderer = MagicMock()
    worker._thumbnail = MagicMock()
    return worker


def _initial_render_item() -> dict[str, object]:
    return {
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
    }


def test_initial_render_deletes_uploads_when_database_rejects_completion(tmp_path) -> None:
    worker = _initial_render_worker(tmp_path, False)

    worker._render_initial_short(_initial_render_item())

    deleted = [call.args[0] for call in worker.storage.delete.call_args_list]
    assert deleted == [
        "outputs/session-a/job-a/short-a/v1.mp4",
        "thumbnails/session-a/job-a/short-a.jpg",
    ]


def test_initial_render_preserves_uploads_when_commit_response_is_ambiguous(tmp_path) -> None:
    worker = _initial_render_worker(tmp_path, ConnectionError("response lost"))

    with pytest.raises(ConnectionError):
        worker._render_initial_short(_initial_render_item())

    worker.storage.delete.assert_not_called()
    worker.repository.fail_initial_render.assert_called_once()


def test_initial_render_preserves_keys_committed_by_duplicate_worker(tmp_path) -> None:
    worker = _initial_render_worker(tmp_path, False)
    worker.repository.initial_render_matches.return_value = True

    worker._render_initial_short(_initial_render_item())

    worker.storage.delete.assert_not_called()


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
