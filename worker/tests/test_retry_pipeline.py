from __future__ import annotations

import inspect
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
from shorts_worker.schemas import HighlightClip, SubtitleSegment, TemplateId
from shorts_worker.worker_pipeline import (
    BatchWorker,
    ProjectTimelineTarget,
    classify_full_source_download,
)


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
    }
    worker.repository.claim_prepare_attempt.return_value = {
        "attempt_count": 1,
        "deadline_at": datetime.now(UTC) + timedelta(minutes=15),
    }
    worker.repository.can_retry_prepare.return_value = True
    worker.repository.ingestion_slot.side_effect = _context
    worker.ingestion = MagicMock()
    worker.ingestion.configured_route_count = 10
    worker.ingestion.download_bundle.side_effect = error
    worker.storage = MagicMock()
    worker.queue = MagicMock()
    worker.queue.queue_url = "https://sqs.example/dispatch"
    worker.heartbeat = MagicMock(side_effect=lambda _job_id: _context())
    return worker


def _assert_ingestion_failure(
    worker: BatchWorker,
    *,
    code: str,
    reason: str,
    job_attempt: int = 1,
) -> dict[str, object]:
    worker.repository.fail_job.assert_called_once()
    args = worker.repository.fail_job.call_args.args
    kwargs = worker.repository.fail_job.call_args.kwargs
    assert args == ("job-a", code, worker.FINAL_INGESTION_MESSAGE)
    details = kwargs["error_details"]
    assert details["category"] == "ingestion"
    assert details["reason"] == reason
    assert details["job_attempt"] == job_attempt
    return details


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


def test_prepare_downloads_full_source_without_range_arguments(tmp_path) -> None:
    worker = _worker(tmp_path, RuntimeError("stop after download arguments"))

    with pytest.raises(RuntimeError, match="stop after download arguments"):
        worker.prepare("job-a")

    download_kwargs = worker.ingestion.download_bundle.call_args.kwargs
    assert "range_start_seconds" not in download_kwargs
    assert "range_end_seconds" not in download_kwargs


def test_prepare_uses_a_fresh_attempt_directory_and_cleans_it(tmp_path) -> None:
    worker = _worker(tmp_path, IngestionError("Private video"))

    worker.prepare("job-a")

    assert list(tmp_path.iterdir()) == []


def test_prepare_transcribes_the_full_source_before_selection(
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
        assert kwargs["duration_seconds"] == pytest.approx(120)
        return [SubtitleSegment(start=0, end=30, text="전사 결과")]

    def select(**kwargs):
        order.append("select")
        assert kwargs["duration_seconds"] == pytest.approx(120)
        assert "range_start_seconds" not in kwargs
        assert "range_end_seconds" not in kwargs
        raise RuntimeError("stop after ordering assertion point")

    monkeypatch.setattr(
        "shorts_worker.worker_pipeline.probe_media",
        lambda _path: {"format": {"duration": "120"}},
    )
    worker.ingestion.download_bundle.side_effect = download
    worker._transcribe_source = MagicMock(side_effect=transcribe)
    worker.selector = MagicMock()
    worker.selector.select.side_effect = select

    with pytest.raises(RuntimeError):
        worker.prepare("job-a")

    assert order == ["download", "transcribe", "select"]
    download_kwargs = worker.ingestion.download_bundle.call_args.kwargs
    assert "range_start_seconds" not in download_kwargs
    assert "range_end_seconds" not in download_kwargs
    worker.repository.record_source_download_observation.assert_called_once_with(
        "job-a",
        status="full_source_expected",
        duration_seconds=120,
        media_bytes=5,
    )


@pytest.mark.parametrize(
    (
        "source_duration",
        "downloaded_duration",
        "expected",
    ),
    [
        (120, 120, "full_source_expected"),
        (120, 80, "unexpected_duration"),
    ],
)
def test_classify_full_source_download(
    source_duration: float,
    downloaded_duration: float,
    expected: str,
) -> None:
    assert (
        classify_full_source_download(
            source_duration_seconds=source_duration,
            downloaded_duration_seconds=downloaded_duration,
        )
        == expected
    )


def test_prepare_stops_before_openai_when_full_source_duration_is_wrong(
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
        lambda _path: {"format": {"duration": "80"}},
    )

    worker.prepare("job-a")

    worker._transcribe_source.assert_not_called()
    worker.repository.record_source_download_observation.assert_called_once_with(
        "job-a",
        status="unexpected_duration",
        duration_seconds=80,
        media_bytes=5,
    )
    details = _assert_ingestion_failure(
        worker,
        code="ingestion_source_duration_mismatch",
        reason="다운로드한 전체 영상의 길이가 원본과 일치하지 않습니다.",
    )
    assert details["source_download_status"] == "unexpected_duration"


@pytest.mark.parametrize(
    ("template_id", "expects_comment_generation"),
    [("dark-red", False), ("comment-capture", True)],
)
def test_prepare_persists_full_source_timestamps_and_generates_template_comments(
    template_id: str,
    expects_comment_generation: bool,
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
            "output_language": "ko",
            "video_aspect_ratio": "1:1",
            "retention_days": 30,
            "template_id": template_id,
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
        HighlightClip(
            start_seconds=10,
            end_seconds=40,
            hook_title="핵심 장면",
            selection_raw_start_seconds=10,
            selection_raw_end_seconds=27,
            selection_raw_duration_seconds=17,
            selection_candidate_index=1,
            selection_provider="gemini",
            selection_model="gemini-2.5-flash-lite",
            selection_length_adjustment="min_clamp",
            selection_repositioned=False,
        )
    ]
    generated_comments = [{"text": "AI 댓글", "startSeconds": 0, "endSeconds": 3}]
    worker.comment_generator = MagicMock()
    worker.comment_generator.generate.return_value = {1: generated_comments}
    worker.renderer = MagicMock()
    worker.repository.add_pending_short.return_value = True
    worker.repository.mark_render_queued.return_value = True
    monkeypatch.setattr(
        "shorts_worker.worker_pipeline.probe_media",
        lambda _path: {"format": {"duration": "120"}},
    )

    worker.prepare("job-a")

    relative_clip = worker.renderer.extract_clean_clip.call_args.kwargs["clip"]
    assert relative_clip.start_seconds == 10
    assert relative_clip.end_seconds == 40
    pending_kwargs = worker.repository.add_pending_short.call_args.kwargs
    assert pending_kwargs["start_seconds"] == 10
    assert pending_kwargs["end_seconds"] == 40
    assert pending_kwargs["selection_raw_start_seconds"] == 10
    assert pending_kwargs["selection_raw_end_seconds"] == 27
    assert pending_kwargs["selection_raw_duration_seconds"] == 17
    assert pending_kwargs["selection_candidate_index"] == 1
    assert pending_kwargs["selection_provider"] == "gemini"
    assert pending_kwargs["selection_model"] == "gemini-2.5-flash-lite"
    assert pending_kwargs["selection_length_adjustment"] == "min_clamp"
    assert pending_kwargs["selection_repositioned"] is False
    if expects_comment_generation:
        worker.comment_generator.generate.assert_called_once()
        comment_input = worker.comment_generator.generate.call_args.args[0][0]
        assert comment_input.transcript == [
            SubtitleSegment(start=0, end=30, text="전사 결과")
        ]
        assert pending_kwargs["comment_overlays"] == generated_comments
    else:
        worker.comment_generator.generate.assert_not_called()
        assert pending_kwargs["comment_overlays"] == []


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
    worker.repository.record_source_download_observation.assert_called_once_with(
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
    _assert_ingestion_failure(
        worker,
        code="youtube_bot_challenge",
        reason="Sign in to confirm you're not a bot",
    )


def test_bot_check_array_attempt_does_not_requeue_parent(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("AWS_BATCH_JOB_ID", "batch-parent:3")
    worker = _worker(tmp_path, BotCheckError("bot check"))

    worker.prepare("job-a")

    worker.queue.send.assert_not_called()
    worker.repository.retry_job.assert_not_called()
    _assert_ingestion_failure(
        worker,
        code="youtube_bot_challenge",
        reason="bot check",
    )


def test_centrally_assigned_isp_route_rotates_inline_without_requeue(
    tmp_path,
) -> None:
    worker = _worker(tmp_path, BotCheckError("bot check"))
    worker.repository.get_job.return_value["ingestion_route_id"] = "webshare-03"
    worker.ingestion.egress_class_for.return_value = "webshare_isp"
    worker.ingestion.configured_route_count = 2
    worker.repository.rotate_ingestion_route.return_value = "webshare-04"

    worker.prepare("job-a")

    assert [
        call.kwargs["route_id"]
        for call in worker.ingestion.download_bundle.call_args_list
    ] == ["webshare-03", "webshare-04"]
    worker.repository.rotate_ingestion_route.assert_called_once_with(
        "job-a",
        "webshare-03",
        result="bot_check",
        cooldown_seconds=30,
        excluded_route_ids=["webshare-03"],
    )
    worker.repository.release_ingestion_route.assert_called_once_with(
        "job-a", "webshare-04", result="bot_check", cooldown_seconds=30
    )
    worker.repository.retry_job.assert_not_called()
    details = _assert_ingestion_failure(
        worker,
        code="ingestion_retry_exhausted",
        reason="사용 가능한 모든 ISP 경로에서 원본 영상 다운로드가 실패했습니다.",
    )
    assert details["attempted_route_ids"] == ("webshare-03", "webshare-04")
    assert details["cause"]["code"] == "youtube_bot_challenge"


def test_retryable_extractor_failure_rotates_inline_to_the_next_route(tmp_path) -> None:
    worker = _worker(tmp_path, AssertionError("replaced below"))
    worker.ingestion.configured_route_count = 2
    worker.ingestion.egress_class_for.return_value = "webshare_isp"
    successful_bundle = DownloadedAssetBundle(
        metadata=VideoMetadata("dQw4w9WgXcQ", "테스트 영상", "채널", "", 120),
        video_path=tmp_path / "source.mp4",
    )
    worker.ingestion.download_bundle.side_effect = [
        RetryableIngestionError(
            "temporary unavailable",
            code="youtube_extractor_failed",
        ),
        successful_bundle,
    ]
    worker.repository.rotate_ingestion_route.return_value = "webshare-04"

    bundle, route_id = worker._download_with_inline_route_rotation(
        job_id="job-a",
        job_attempt=1,
        youtube_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        destination=tmp_path / "source",
        initial_route_id="webshare-03",
    )

    assert bundle is successful_bundle
    assert route_id == "webshare-04"
    worker.repository.rotate_ingestion_route.assert_called_once_with(
        "job-a",
        "webshare-03",
        result="network_error",
        cooldown_seconds=30,
        excluded_route_ids=["webshare-03"],
    )
    worker.repository.release_ingestion_route.assert_called_once_with(
        "job-a", "webshare-04", result="success", cooldown_seconds=0
    )


def test_inline_rotation_can_try_all_ten_configured_routes(tmp_path) -> None:
    worker = _worker(tmp_path, AssertionError("replaced below"))
    worker.ingestion.configured_route_count = 10
    worker.ingestion.egress_class_for.return_value = "webshare_isp"
    successful_bundle = DownloadedAssetBundle(
        metadata=VideoMetadata("dQw4w9WgXcQ", "테스트 영상", "채널", "", 120),
        video_path=tmp_path / "source.mp4",
    )
    worker.ingestion.download_bundle.side_effect = [
        *(BotCheckError("bot check") for _ in range(9)),
        successful_bundle,
    ]
    worker.repository.rotate_ingestion_route.side_effect = [
        f"webshare-{index:02d}" for index in range(2, 11)
    ]

    bundle, route_id = worker._download_with_inline_route_rotation(
        job_id="job-a",
        job_attempt=1,
        youtube_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        destination=tmp_path / "source",
        initial_route_id="webshare-01",
    )

    assert bundle is successful_bundle
    assert route_id == "webshare-10"
    assert [
        call.kwargs["route_id"]
        for call in worker.ingestion.download_bundle.call_args_list
    ] == [f"webshare-{index:02d}" for index in range(1, 11)]
    assert worker.repository.rotate_ingestion_route.call_count == 9
    worker.repository.release_ingestion_route.assert_called_once_with(
        "job-a", "webshare-10", result="success", cooldown_seconds=0
    )
    worker.repository.retry_job.assert_not_called()


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
    _assert_ingestion_failure(
        worker,
        code="ingestion_unknown",
        reason="Private video",
    )


def test_escaped_temporary_ingestion_error_does_not_requeue_prepare(tmp_path) -> None:
    worker = _worker(tmp_path, RetryableIngestionError("connection timed out"))

    worker.prepare("job-a")

    worker.repository.retry_job.assert_not_called()
    worker.queue.send.assert_not_called()
    _assert_ingestion_failure(
        worker,
        code="ingestion_temporary_failure",
        reason="connection timed out",
    )


def test_exhausted_video_work_fails_without_another_prepare_retry(tmp_path) -> None:
    worker = _worker(
        tmp_path,
        RetryExhaustedIngestionError("video download failed ten times"),
    )

    worker.prepare("job-a")

    worker.repository.retry_job.assert_not_called()
    worker.queue.send.assert_not_called()
    _assert_ingestion_failure(
        worker,
        code="ingestion_retry_exhausted",
        reason="video download failed ten times",
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
    _assert_ingestion_failure(
        worker,
        code="youtube_bot_challenge",
        reason="bot check",
        job_attempt=10,
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
        "thumbnail_s3_key": "thumbnails/session-a/job-a/short-a.jpg",
    }
    worker.repository.complete_rerender.return_value = None
    worker.storage = MagicMock()
    worker.storage.download.return_value = tmp_path / "clean.mp4"
    worker.storage.upload.return_value = 123
    worker.renderer = MagicMock()
    worker._thumbnail = MagicMock()

    worker.rerender("short-a")

    assert {call.args[0] for call in worker.storage.delete.call_args_list} == {
        "outputs/session-a/job-a/short-a/v2.mp4",
        "thumbnails/session-a/job-a/short-a/v2.jpg",
    }
    worker.repository.reset_rerender.assert_not_called()


def _range_rerender_worker(tmp_path, completion_result) -> BatchWorker:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(temp_dir=tmp_path)
    worker.repository = MagicMock()
    worker.repository.get_short.return_value = {
        "id": "short-a",
        "mvp_session_id": "session-a",
        "job_id": "job-a",
        "output_s3_key": "outputs/session-a/job-a/short-a/v1.mp4",
        "thumbnail_s3_key": "thumbnails/session-a/job-a/short-a.jpg",
        "clean_clip_s3_key": "edit-sources/session-a/job-a/short-a.mp4",
        "edit_timeline_s3_key": "edit-sources/session-a/job-a/short-a/timeline-v1.mp4",
        "edit_timeline_start_seconds": 90,
        "render_version": 1,
        "pending_edit_snapshot": {
            "startSeconds": 105,
            "endSeconds": 165,
            "durationSeconds": 60,
            "hookTitle": "새 제목",
            "channelDisplayName": "채널",
            "subtitlesEnabled": True,
            "subtitleSegments": [],
            "commentOverlays": [],
            "templateId": "dark-red",
            "customTemplateId": None,
            "templateSnapshot": {"presetVersion": 3},
            "videoAspectRatio": "1:1",
            "titleFontScale": 1,
            "titleTextStyles": [],
            "titleTextStylesInitialized": True,
        },
    }
    if isinstance(completion_result, Exception):
        worker.repository.complete_snapshot_rerender.side_effect = completion_result
    else:
        worker.repository.complete_snapshot_rerender.return_value = completion_result
    worker.storage = MagicMock()
    worker.storage.download.return_value = tmp_path / "timeline.mp4"
    worker.storage.upload.side_effect = [456, 789, 321]
    worker.renderer = MagicMock()
    worker._thumbnail = MagicMock()
    return worker


def test_range_rerender_atomically_promotes_new_clean_and_output(tmp_path) -> None:
    worker = _range_rerender_worker(tmp_path, {
        "output_s3_key": "outputs/session-a/job-a/short-a/v1.mp4",
        "thumbnail_s3_key": "thumbnails/session-a/job-a/short-a.jpg",
        "clean_clip_s3_key": "edit-sources/session-a/job-a/short-a.mp4",
    })

    worker.rerender("short-a")

    selected_clip = worker.renderer.extract_clean_clip.call_args.kwargs["clip"]
    assert selected_clip.start_seconds == 15
    assert selected_clip.end_seconds == 75
    worker.repository.complete_snapshot_rerender.assert_called_once_with(
        "short-a",
        output_key="outputs/session-a/job-a/short-a/v2.mp4",
        thumbnail_key="thumbnails/session-a/job-a/short-a/v2.jpg",
        clean_key="edit-sources/session-a/job-a/short-a/clean-v2.mp4",
        size=789,
        version=2,
    )
    assert {call.args[0] for call in worker.storage.delete.call_args_list} == {
        "outputs/session-a/job-a/short-a/v1.mp4",
        "thumbnails/session-a/job-a/short-a.jpg",
        "edit-sources/session-a/job-a/short-a.mp4",
    }


def test_range_rerender_uses_clean_fallback_and_renders_added_comments(
    tmp_path,
) -> None:
    worker = _range_rerender_worker(tmp_path, {
        "output_s3_key": "outputs/session-a/job-a/short-a/v1.mp4",
        "thumbnail_s3_key": "thumbnails/session-a/job-a/short-a.jpg",
        "clean_clip_s3_key": "edit-sources/session-a/job-a/short-a.mp4",
    })
    item = worker.repository.get_short.return_value
    item["edit_timeline_s3_key"] = None
    item["edit_timeline_start_seconds"] = None
    item["start_seconds"] = 100
    item["pending_edit_snapshot"].update({
        "startSeconds": 105,
        "endSeconds": 135,
        "durationSeconds": 30,
        "commentOverlays": [{
            "id": "comment-added",
            "startSeconds": 0,
            "endSeconds": 30,
            "text": "편집기에서 추가한 댓글",
            "initial": "편",
            "avatarColor": "#2674C8",
            "nickname": "편집테스트",
            "likeCount": 100,
            "ageLabel": "방금 전",
        }],
        "templateId": "comment-capture",
        "templateSnapshot": None,
    })

    worker.rerender("short-a")

    worker.storage.download.assert_called_once_with(
        "edit-sources/session-a/job-a/short-a.mp4",
        tmp_path / "rerender-short-a" / "timeline.mp4",
    )
    selected_clip = worker.renderer.extract_clean_clip.call_args.kwargs["clip"]
    assert selected_clip.start_seconds == 5
    assert selected_clip.end_seconds == 35
    render_call = worker.renderer.render_clean_clip.call_args.kwargs
    assert render_call["template_id"] is TemplateId.COMMENT_CAPTURE
    assert [comment.text for comment in render_call["comment_overlays"]] == [
        "편집기에서 추가한 댓글"
    ]


def test_range_rerender_failure_removes_only_uncommitted_versions(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AWS_BATCH_JOB_ATTEMPT", "2")
    worker = _range_rerender_worker(tmp_path, None)
    worker.renderer.render_clean_clip.side_effect = RuntimeError("render failed")

    with pytest.raises(RuntimeError, match="render failed"):
        worker.rerender("short-a")

    worker.storage.delete.assert_called_once_with(
        "edit-sources/session-a/job-a/short-a/clean-v2.mp4"
    )
    worker.repository.complete_snapshot_rerender.assert_not_called()
    worker.repository.reset_rerender.assert_called_once_with("short-a")


def test_range_rerender_deletes_new_versions_if_short_is_deleted_before_commit(
    tmp_path,
) -> None:
    worker = _range_rerender_worker(tmp_path, None)

    worker.rerender("short-a")

    assert {call.args[0] for call in worker.storage.delete.call_args_list} == {
        "outputs/session-a/job-a/short-a/v2.mp4",
        "thumbnails/session-a/job-a/short-a/v2.jpg",
        "edit-sources/session-a/job-a/short-a/clean-v2.mp4",
    }


def test_range_rerender_preserves_versions_when_commit_response_is_ambiguous(
    tmp_path,
) -> None:
    worker = _range_rerender_worker(tmp_path, ConnectionError("response lost"))

    with pytest.raises(ConnectionError, match="response lost"):
        worker.rerender("short-a")

    worker.storage.delete.assert_not_called()


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


def test_render_shard_processes_two_short_shard_sequentially() -> None:
    worker = BatchWorker.__new__(BatchWorker)
    worker.repository = MagicMock()
    worker.repository.get_job.return_value = {"status": "rendering", "deadline_at": None}
    worker.repository.get_render_shard.return_value = [
        {"id": "short-a", "status": "rendering"},
        {"id": "short-b", "status": "rendering"},
    ]
    rendered: list[str] = []
    worker._render_initial_short = lambda item: rendered.append(str(item["id"]))

    worker.render_shard("job-a", 0)

    assert BatchWorker.RENDER_SHARD_SIZE == 2
    assert rendered == ["short-a", "short-b"]
    worker.repository.maybe_complete_job.assert_called_once_with("job-a")
    assert "ThreadPoolExecutor" not in inspect.getsource(BatchWorker.render_shard)


def test_project_render_isolates_one_failure_and_scales_workers_from_vcpus() -> None:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(task_vcpus=8, ffmpeg_threads=2)
    worker.repository = MagicMock()
    worker.repository.get_project_render_items.return_value = [
        {"id": "short-a", "slot_index": 1},
        {"id": "short-b", "slot_index": 2},
        {"id": "short-c", "slot_index": 3},
    ]
    rendered: list[str] = []

    def render(item, _local_clean_path=None):
        rendered.append(str(item["id"]))
        if item["id"] == "short-b":
            raise RuntimeError("one output failed")

    worker._render_initial_short = render

    summary = worker._render_project_outputs("job-a")

    assert set(rendered) == {"short-a", "short-b", "short-c"}
    worker.repository.fail_initial_render.assert_called_once_with(
        "short-b", "RuntimeError", "one output failed", terminal=True
    )
    assert worker._project_worker_count() == 4
    assert summary["workers"] == 4
    worker.settings.task_vcpus = 4
    assert worker._project_worker_count() == 2
    source = inspect.getsource(BatchWorker._render_project_outputs)
    assert "max_workers=project_worker_count" in source


def test_project_output_render_retries_before_it_can_fail_terminally() -> None:
    worker = BatchWorker.__new__(BatchWorker)
    worker._render_initial_short = MagicMock(side_effect=[
        RuntimeError("transient render failure"),
        {"ffmpegSeconds": 10.0},
    ])
    local_path = MagicMock()
    item = {"id": "short-a", "job_id": "job-a", "slot_index": 1}

    result = worker._render_project_output_with_retry(item, local_path)

    assert result == {"ffmpegSeconds": 10.0}
    assert worker._render_initial_short.call_count == 2
    assert worker._render_initial_short.call_args_list[0].args == (item, local_path)
    assert worker._render_initial_short.call_args_list[1].args == (item, None)


def _timeline_target(short_id: str, slot_index: int) -> ProjectTimelineTarget:
    return ProjectTimelineTarget(
        short_id=short_id,
        slot_index=slot_index,
        clip=HighlightClip(
            start_seconds=10,
            end_seconds=80,
            hook_title=f"timeline-{slot_index}",
        ),
        subtitles=[SubtitleSegment(start=0, end=3, text="자막")],
    )


def _timeline_worker(tmp_path) -> BatchWorker:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(
        task_vcpus=4,
        ffmpeg_threads=2,
    )
    worker.repository = MagicMock()
    worker.repository.project_timeline_needed.return_value = True
    worker.repository.complete_project_timeline.return_value = True
    worker.storage = MagicMock()
    worker.storage.upload.return_value = 42_000_000
    worker.renderer = MagicMock()
    return worker


def test_project_finishes_user_outputs_before_timeline_postprocessing() -> None:
    source = inspect.getsource(BatchWorker.project)
    timeline_index = source.index(
        "timeline_summary = self._capture_project_timelines"
    )
    render_index = source.rfind(
        "render_summary = self._render_project_outputs",
        0,
        timeline_index,
    )
    finalize_index = source.rfind(
        "result = self.repository.finalize_project_job",
        0,
        timeline_index,
    )

    assert 0 <= render_index < finalize_index < timeline_index


def test_deferred_timeline_retries_once_and_commits_after_upload(tmp_path) -> None:
    worker = _timeline_worker(tmp_path)
    calls = 0

    def extract_clean_clip(**kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("transient ffmpeg failure")
        kwargs["metrics_callback"]({"ffmpegSeconds": 52.5})

    worker.renderer.extract_clean_clip.side_effect = extract_clean_clip

    result = worker._capture_project_timeline(
        job_id="job-a",
        job={"mvp_session_id": "session-a", "video_aspect_ratio": "1:1"},
        source=tmp_path / "source.mp4",
        source_probe={},
        work_dir=tmp_path,
        target=_timeline_target("short-a", 1),
    )

    assert result == {
        "status": "ready",
        "ffmpegSeconds": 52.5,
        "fileBytes": 42_000_000,
    }
    assert calls == 2
    worker.storage.upload.assert_called_once()
    worker.repository.complete_project_timeline.assert_called_once()
    metrics = worker.repository.merge_project_attempt_performance_metrics.call_args.args[2]
    assert metrics["editTimeline"]["attempts"] == 2


def test_deferred_timeline_failure_does_not_fail_other_outputs(tmp_path) -> None:
    worker = _timeline_worker(tmp_path)

    def extract_clean_clip(**kwargs):
        if "short-a" in str(kwargs["output_path"]):
            raise RuntimeError("broken timeline")
        kwargs["metrics_callback"]({"ffmpegSeconds": 40.0})

    worker.renderer.extract_clean_clip.side_effect = extract_clean_clip

    summary = worker._capture_project_timelines(
        job_id="job-a",
        job={"mvp_session_id": "session-a", "video_aspect_ratio": "1:1"},
        source=tmp_path / "source.mp4",
        source_probe={},
        work_dir=tmp_path,
        targets=[
            _timeline_target("short-a", 1),
            _timeline_target("short-b", 2),
        ],
    )

    assert summary["requestedCount"] == 2
    assert summary["succeededCount"] == 1
    assert summary["failedCount"] == 1
    assert worker.renderer.extract_clean_clip.call_count == 3
    completed_short_ids = {
        call.kwargs["short_id"]
        for call in worker.repository.complete_project_timeline.call_args_list
    }
    assert completed_short_ids == {"short-b"}


def test_project_resume_renders_checkpoints_without_downloading_source() -> None:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(
        clean_clip_preset="superfast",
        clean_clip_crf=20,
        ffmpeg_threads=2,
        task_vcpus=4,
    )
    worker.repository = MagicMock()
    worker.repository.get_job.return_value = {
        "id": "job-a", "pipeline_version": 2,
    }
    worker.repository.claim_project_run.return_value = {"attempt_count": 1}
    worker.repository.finalize_project_job.return_value = {
        "final_status": "completed",
    }
    worker._render_project_outputs = MagicMock(return_value={"wallSeconds": 1.0})
    worker._download_with_inline_route_rotation = MagicMock()

    worker.project("job-a", resume=True)

    worker._render_project_outputs.assert_called_once_with("job-a")
    worker.repository.finalize_project_job.assert_called_once_with("job-a")
    worker._download_with_inline_route_rotation.assert_not_called()


def test_project_preserves_restricted_content_codes_and_user_message() -> None:
    source = inspect.getsource(BatchWorker.project)

    assert "exc.code if isinstance(exc, IngestionError)" in source
    assert "RESTRICTED_CONTENT_ERROR_CODES" in source
    assert BatchWorker.RESTRICTED_CONTENT_ERROR_CODES == {
        "youtube_members_only",
        "youtube_paid_content",
    }
    assert BatchWorker.FINAL_RESTRICTED_CONTENT_MESSAGE == (
        "멤버십 전용 여부, 구매·대여 콘텐츠는 사용할 수 없습니다.\n"
        "사용량은 다시 복구되었습니다. 영상 확인 후 다시 시도해주세요."
    )


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


def test_project_initial_render_reuses_local_clean_clip_without_s3_download(tmp_path) -> None:
    worker = _initial_render_worker(tmp_path, True)
    local_clean = tmp_path / "project-clean.mp4"
    local_clean.write_bytes(b"checkpointed-clean-clip")

    metrics = worker._render_initial_short(_initial_render_item(), local_clean)

    worker.storage.download.assert_not_called()
    assert metrics is not None
    assert metrics["cleanSource"] == "local"
    assert not local_clean.exists()
    worker.repository.merge_project_attempt_performance_metrics.assert_called_once()


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
        "thumbnail_s3_key": "thumbnails/session-a/job-a/short-a.jpg",
    }
    worker.repository.complete_rerender.side_effect = ConnectionError("response lost")
    worker.storage = MagicMock()
    worker.storage.download.return_value = tmp_path / "clean.mp4"
    worker.storage.upload.return_value = 123
    worker.renderer = MagicMock()
    worker._thumbnail = MagicMock()

    with pytest.raises(ConnectionError):
        worker.rerender("short-a")

    worker.storage.delete.assert_not_called()
