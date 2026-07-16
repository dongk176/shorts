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
    TranscriptionError,
)
from shorts_worker.ingestion import DownloadedAssetBundle, VideoMetadata
from shorts_worker.schemas import HighlightClip, SubtitleSegment
from shorts_worker.worker_pipeline import BatchWorker, classify_range_download


@contextmanager
def _context():
    yield


def _worker(tmp_path, error: Exception) -> BatchWorker:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(
        temp_dir=tmp_path,
        openai_api_key="configured",
        openai_transcribe_model="gpt-4o-mini-transcribe",
    )
    worker.repository = MagicMock()
    worker.repository.get_job.return_value = {
        "id": "job-a",
        "mvp_session_id": "session-a",
        "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "attempt_count": 0,
        "deadline_at": datetime.now(UTC) + timedelta(minutes=15),
        "source_duration_seconds": 120,
        "range_start_seconds": 0,
        "range_end_seconds": 120,
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


def test_missing_openai_key_fails_before_youtube_download(tmp_path) -> None:
    worker = _worker(tmp_path, AssertionError("download must not start"))
    worker.settings.openai_api_key = None

    with pytest.raises(TranscriptionError):
        worker.prepare("job-a")

    worker.ingestion.download_bundle.assert_not_called()
    worker.repository.stage.assert_not_called()
    worker.repository.fail_job.assert_called_once_with(
        "job-a", "TranscriptionError", worker.FINAL_PROCESSING_MESSAGE
    )


def test_prepare_transcribes_only_the_downloaded_range_before_selection(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    worker = _worker(tmp_path, AssertionError("replaced below"))
    worker.settings.max_video_duration_seconds = 3600
    worker.repository.get_job.return_value.update(
        {
            "youtube_video_id": "dQw4w9WgXcQ",
            "video_title": "테스트 영상",
            "source_duration_seconds": 120,
            "expected_short_count": 1,
            "range_start_seconds": 30,
            "range_end_seconds": 90,
            "output_language": "ko",
        }
    )
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    order: list[str] = []

    def download(*_args, **_kwargs):
        order.append("download")
        return DownloadedAssetBundle(
            metadata=VideoMetadata("dQw4w9WgXcQ", "테스트 영상", "채널", "", 120),
            video_path=source,
        )

    def transcribe(**kwargs):
        order.append("transcribe")
        assert kwargs["duration_seconds"] == pytest.approx(60)
        return [SubtitleSegment(start=0, end=30, text="전사 결과")]

    def select(**kwargs):
        order.append("select")
        assert kwargs["duration_seconds"] == pytest.approx(60)
        assert kwargs["range_start_seconds"] == 0
        assert kwargs["range_end_seconds"] == pytest.approx(60)
        raise RuntimeError("stop after ordering assertion point")

    monkeypatch.setattr(
        "shorts_worker.worker_pipeline.probe_media",
        lambda _path: {"format": {"duration": "60"}},
    )
    worker.ingestion.download_bundle.side_effect = download
    worker._transcribe_source = MagicMock(side_effect=transcribe)
    worker.selector = MagicMock()
    worker.selector.select.side_effect = select

    with pytest.raises(RuntimeError):
        worker.prepare("job-a")

    assert order == ["download", "transcribe", "select"]
    download_kwargs = worker.ingestion.download_bundle.call_args.kwargs
    assert download_kwargs["range_start_seconds"] == 30
    assert download_kwargs["range_end_seconds"] == 90
    worker.repository.record_range_download_observation.assert_called_once_with(
        "job-a",
        status="selected_range",
        duration_seconds=60,
        media_bytes=5,
    )


@pytest.mark.parametrize(
    (
        "source_duration",
        "range_start",
        "range_end",
        "downloaded_duration",
        "expected",
    ),
    [
        (120, 30, 90, 60, "selected_range"),
        (120, 30, 90, 120, "full_source_unexpected"),
        (120, 0, 120, 120, "full_source_expected"),
        (120, 30, 90, 80, "unexpected_duration"),
    ],
)
def test_classify_range_download(
    source_duration: float,
    range_start: float,
    range_end: float,
    downloaded_duration: float,
    expected: str,
) -> None:
    assert (
        classify_range_download(
            source_duration_seconds=source_duration,
            range_start_seconds=range_start,
            range_end_seconds=range_end,
            downloaded_duration_seconds=downloaded_duration,
        )
        == expected
    )


def test_prepare_stops_before_openai_when_range_download_was_ignored(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    worker = _worker(tmp_path, AssertionError("replaced below"))
    worker.settings.max_video_duration_seconds = 3600
    worker.repository.get_job.return_value.update(
        {
            "youtube_video_id": "dQw4w9WgXcQ",
            "video_title": "테스트 영상",
            "source_duration_seconds": 120,
            "expected_short_count": 1,
            "range_start_seconds": 30,
            "range_end_seconds": 90,
            "output_language": "ko",
        }
    )
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    worker.ingestion.download_bundle.side_effect = None
    worker.ingestion.download_bundle.return_value = DownloadedAssetBundle(
        metadata=VideoMetadata("dQw4w9WgXcQ", "테스트 영상", "채널", "", 120),
        video_path=source,
    )
    worker._transcribe_source = MagicMock()
    monkeypatch.setattr(
        "shorts_worker.worker_pipeline.probe_media",
        lambda _path: {"format": {"duration": "120"}},
    )

    worker.prepare("job-a")

    worker._transcribe_source.assert_not_called()
    worker.repository.record_range_download_observation.assert_called_once_with(
        "job-a",
        status="full_source_unexpected",
        duration_seconds=120,
        media_bytes=5,
    )
    worker.repository.fail_job.assert_called_once_with(
        "job-a", "IngestionError", worker.FINAL_INGESTION_MESSAGE
    )


def test_prepare_persists_original_timestamps_for_clips_from_ranged_media(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    worker = _worker(tmp_path, AssertionError("replaced below"))
    worker.settings.max_video_duration_seconds = 3600
    worker.repository.get_job.return_value.update(
        {
            "youtube_video_id": "dQw4w9WgXcQ",
            "video_title": "테스트 영상",
            "source_duration_seconds": 120,
            "expected_short_count": 1,
            "range_start_seconds": 30,
            "range_end_seconds": 90,
            "output_language": "ko",
            "video_aspect_ratio": "1:1",
            "retention_days": 30,
        }
    )
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    worker.ingestion.download_bundle.side_effect = None
    worker.ingestion.download_bundle.return_value = DownloadedAssetBundle(
        metadata=VideoMetadata("dQw4w9WgXcQ", "테스트 영상", "채널", "", 120),
        video_path=source,
    )
    worker._transcribe_source = MagicMock(
        return_value=[SubtitleSegment(start=10, end=40, text="전사 결과")]
    )
    worker.selector = MagicMock()
    worker.selector.select.return_value = [
        HighlightClip(start_seconds=10, end_seconds=40, hook_title="핵심 장면")
    ]
    worker.renderer = MagicMock()
    worker.repository.add_pending_short.return_value = True
    worker.repository.mark_render_queued.return_value = True
    monkeypatch.setattr(
        "shorts_worker.worker_pipeline.probe_media",
        lambda _path: {"format": {"duration": "60"}},
    )

    worker.prepare("job-a")

    relative_clip = worker.renderer.extract_clean_clip.call_args.kwargs["clip"]
    assert relative_clip.start_seconds == 10
    assert relative_clip.end_seconds == 40
    pending_kwargs = worker.repository.add_pending_short.call_args.kwargs
    assert pending_kwargs["start_seconds"] == 40
    assert pending_kwargs["end_seconds"] == 70


def test_prepare_records_unexpected_duration_when_downloaded_media_cannot_be_probed(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    worker = _worker(tmp_path, AssertionError("replaced below"))
    worker.settings.max_video_duration_seconds = 3600
    worker.repository.get_job.return_value.update(
        {
            "youtube_video_id": "dQw4w9WgXcQ",
            "video_title": "테스트 영상",
            "expected_short_count": 1,
            "output_language": "ko",
        }
    )
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    worker.ingestion.download_bundle.side_effect = None
    worker.ingestion.download_bundle.return_value = DownloadedAssetBundle(
        metadata=VideoMetadata("dQw4w9WgXcQ", "테스트 영상", "채널", "", 120),
        video_path=source,
    )
    worker._transcribe_source = MagicMock()

    def fail_probe(_path):
        raise RuntimeError("invalid media")

    monkeypatch.setattr("shorts_worker.worker_pipeline.probe_media", fail_probe)

    with pytest.raises(RuntimeError, match="invalid media"):
        worker.prepare("job-a")

    worker._transcribe_source.assert_not_called()
    worker.repository.record_range_download_observation.assert_called_once_with(
        "job-a",
        status="unexpected_duration",
        duration_seconds=None,
        media_bytes=5,
    )


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
    worker.repository.get_job.return_value["deadline_at"] = datetime.now(UTC) + timedelta(
        minutes=4, seconds=59
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

    worker.storage.delete.assert_called_once_with("outputs/session-a/job-a/short-a/v2.mp4")
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
