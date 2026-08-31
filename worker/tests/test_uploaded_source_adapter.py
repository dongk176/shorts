from __future__ import annotations

import shutil
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, call

import pytest

from shorts_worker.errors import IngestionError
from shorts_worker.schemas import SubtitleSegment
from shorts_worker.worker_pipeline import (
    UPLOAD_SOURCE_MAX_BYTES,
    BatchWorker,
    UploadSourceCleanupError,
    cleanup_uploaded_project_workspace,
    uploaded_project_source_window,
)


@contextmanager
def _heartbeat_context():
    yield


def _upload_project_worker(temp_root: Path) -> BatchWorker:
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = SimpleNamespace(
        temp_dir=temp_root,
        openai_api_key="configured",
        openai_transcribe_model="gpt-4o-mini-transcribe",
        elevenlabs_transcribe_model="scribe_v2",
        max_video_duration_seconds=3600,
        clean_clip_preset="superfast",
        clean_clip_crf=20,
        ffmpeg_threads=2,
        task_vcpus=4,
        edit_timeline_capture_enabled=False,
    )
    worker.repository = MagicMock()
    worker.repository.get_job.return_value = {
        "id": "job-upload",
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "pipeline_version": 2,
        "source_type": "upload",
        "source_duration_seconds": 300,
        "source_range_selection_enabled": True,
        "range_start_seconds": 0,
        "range_end_seconds": 300,
        "video_title": "업로드 영상",
        "output_language": "ko",
        "planned_short_count": 1,
        "template_id": "dark-red",
        "video_aspect_ratio": "1:1",
        "transcription_policy": "openai_stable",
        "ingestion_route_id": "route-that-upload-must-ignore",
    }
    worker.repository.claim_project_run.return_value = {"attempt_count": 1}
    worker.repository.finalize_project_job.return_value = {"final_status": "failed"}
    worker.storage = MagicMock()
    worker.ingestion = MagicMock()
    worker._download_with_inline_route_rotation = MagicMock()
    worker.heartbeat = MagicMock(side_effect=lambda _job_id: _heartbeat_context())
    worker.selector = MagicMock()
    return worker


@pytest.mark.parametrize(
    ("source_seconds", "range_enabled", "start", "end", "expected"),
    [
        (180, False, None, None, 180),
        (239.999, False, None, None, 239.999),
        (240, True, 0, 240, 240),
        (10_800, True, 7200, 10_800, 3600),
    ],
)
def test_uploaded_source_window_accepts_only_the_isolated_contract(
    source_seconds: float,
    range_enabled: bool,
    start: float | None,
    end: float | None,
    expected: float,
) -> None:
    assert uploaded_project_source_window(
        source_duration_seconds=source_seconds,
        source_range_enabled=range_enabled,
        range_start_seconds=start,
        range_end_seconds=end,
    ) == pytest.approx(expected)


@pytest.mark.parametrize(
    (
        "observed_seconds",
        "declared_seconds",
        "range_enabled",
        "start",
        "end",
        "expected",
    ),
    [
        # Browser metadata and ffprobe commonly disagree by a few frames at 4m.
        (239.967, 240.0, True, 0.0, 240.0, 240.0),
        (240.033, 239.967, False, 0.0, 239.967, 240.033),
        # video_jobs currently stores the browser duration rounded up.
        (240.033, 240.0, False, 0.0, 239.967, 240.033),
        # Exact contract edges remain accepted.
        (240.0, 240.0, True, 0.0, 240.0, 240.0),
        (7_200.0, 7_200.0, True, 0.0, 3_600.0, 3_600.0),
        (10_800.0, 10_800.0, True, 7_200.0, 10_800.0, 3_600.0),
    ],
)
def test_uploaded_source_window_uses_one_bounded_duration_tolerance(
    observed_seconds: float,
    declared_seconds: float,
    range_enabled: bool,
    start: float,
    end: float,
    expected: float,
) -> None:
    assert uploaded_project_source_window(
        source_duration_seconds=observed_seconds,
        declared_source_duration_seconds=declared_seconds,
        source_range_enabled=range_enabled,
        range_start_seconds=start,
        range_end_seconds=end,
    ) == pytest.approx(expected)


@pytest.mark.parametrize(
    ("source_seconds", "range_enabled", "start", "end", "code"),
    [
        (179.999, False, None, None, "upload_source_duration_invalid"),
        (10_800.001, True, 0, 240, "upload_source_duration_invalid"),
        (239, True, 1, 239, "upload_range_invalid"),
        (246, False, None, None, "upload_range_invalid"),
        (3600, True, 0, 239.999, "upload_range_invalid"),
        (7200, True, 0, 3600.001, "upload_range_invalid"),
        (7200, True, 7000, 7240, "upload_range_invalid"),
    ],
)
def test_uploaded_source_window_fails_closed(
    source_seconds: float,
    range_enabled: bool,
    start: float | None,
    end: float | None,
    code: str,
) -> None:
    with pytest.raises(IngestionError) as caught:
        uploaded_project_source_window(
            source_duration_seconds=source_seconds,
            source_range_enabled=range_enabled,
            range_start_seconds=start,
            range_end_seconds=end,
        )
    assert caught.value.code == code


def test_uploaded_source_adapter_rejects_paths_outside_receiver_temp_root(
    tmp_path: Path,
) -> None:
    receiver_root = tmp_path / "receiver"
    receiver_root.mkdir()
    outside_source = tmp_path / "outside.mp4"
    outside_source.write_bytes(b"video")
    work_dir = receiver_root / "project"
    work_dir.mkdir()
    worker = _upload_project_worker(receiver_root)

    with pytest.raises(IngestionError) as caught:
        worker._borrow_uploaded_source(outside_source, work_dir)

    assert caught.value.code == "upload_source_path_invalid"
    assert outside_source.read_bytes() == b"video"
    assert list(work_dir.iterdir()) == []


def test_uploaded_source_adapter_rejects_oversized_file_before_probe(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    receiver_root = tmp_path / "receiver"
    receiver_root.mkdir()
    source = receiver_root / "source.mov"
    source.write_bytes(b"x")
    source.open("r+b").truncate(UPLOAD_SOURCE_MAX_BYTES + 1)
    work_dir = receiver_root / "project"
    work_dir.mkdir()
    worker = _upload_project_worker(receiver_root)
    probe = MagicMock()
    monkeypatch.setattr("shorts_worker.worker_pipeline.probe_media", probe)

    with pytest.raises(IngestionError) as caught:
        worker._borrow_uploaded_source(source, work_dir)

    assert caught.value.code == "upload_source_size_invalid"
    probe.assert_not_called()
    assert source.exists()


def test_upload_uses_the_existing_ai_pipeline_without_youtube_route_and_cleans_snapshot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    receiver_root = tmp_path / "receiver"
    receiver_root.mkdir()
    receiver_source = receiver_root / "source.mov"
    receiver_source.write_bytes(b"receiver-owned-video")
    worker = _upload_project_worker(receiver_root)
    monkeypatch.setattr(
        "shorts_worker.worker_pipeline.probe_media",
        lambda _path: {
            "format": {"duration": "300"},
            "streams": [
                {"codec_type": "video"},
                {"codec_type": "audio"},
            ],
        },
    )
    borrowed_paths: list[Path] = []
    audio_paths: list[Path] = []

    def transcribe(**kwargs):
        source = Path(kwargs["source"])
        work_dir = Path(kwargs["work_dir"])
        borrowed_paths.append(source)
        assert source != receiver_source
        assert source.is_file()
        audio_path = work_dir / "transcription-audio.wav"
        audio_path.write_bytes(b"temporary-audio")
        audio_paths.append(audio_path)
        return [SubtitleSegment(start=0, end=30, text="공통 전사 결과")]

    worker._transcribe_source = MagicMock(side_effect=transcribe)
    worker.selector.select.side_effect = RuntimeError("stop after common AI selection")

    worker.project("job-upload", prepared_source=receiver_source)

    worker._download_with_inline_route_rotation.assert_not_called()
    worker.repository.record_ingestion_result.assert_not_called()
    worker.repository.release_ingestion_route.assert_not_called()
    worker._transcribe_source.assert_called_once()
    worker.selector.select.assert_called_once()
    assert worker.selector.select.call_args.kwargs["duration_seconds"] == 300
    assert worker.selector.select.call_args.kwargs["transcript"] == [
        SubtitleSegment(start=0, end=30, text="공통 전사 결과")
    ]
    worker.repository.record_source_download_observation.assert_called_once_with(
        "job-upload",
        status="full_source_expected",
        duration_seconds=300,
        media_bytes=len(b"receiver-owned-video"),
        normalized_source_start_seconds=0.0,
    )
    assert receiver_source.read_bytes() == b"receiver-owned-video"
    assert all(not path.exists() for path in borrowed_paths)
    assert all(not path.exists() for path in audio_paths)
    assert list(receiver_root.glob("project-job-upload-*")) == []


def test_youtube_project_rejects_borrowed_upload_path_before_download(
    tmp_path: Path,
) -> None:
    receiver_root = tmp_path / "receiver"
    receiver_root.mkdir()
    receiver_source = receiver_root / "source.mov"
    receiver_source.write_bytes(b"receiver-owned-video")
    worker = _upload_project_worker(receiver_root)
    worker.repository.get_job.return_value.update({
        "source_type": "youtube",
        "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "youtube_video_id": "dQw4w9WgXcQ",
    })

    worker.project("job-upload", prepared_source=receiver_source)

    worker._download_with_inline_route_rotation.assert_not_called()
    worker.repository.fail_open_project_attempts.assert_called_once()
    assert (
        worker.repository.fail_open_project_attempts.call_args.kwargs["code"]
        == "upload_source_not_allowed"
    )
    assert receiver_source.exists()


def test_upload_failure_cleanup_preserves_receiver_source_thumbnail_prefix(
    tmp_path: Path,
) -> None:
    worker = _upload_project_worker(tmp_path)
    job = worker.repository.get_job.return_value

    worker._cleanup_initial_objects(job)

    assert worker.storage.delete_prefix.call_args_list == [
        call("outputs/session-a/job-upload/"),
        call("edit-sources/session-a/job-upload/"),
    ]


def test_youtube_failure_cleanup_keeps_existing_thumbnail_deletion_contract(
    tmp_path: Path,
) -> None:
    worker = _upload_project_worker(tmp_path)
    job = worker.repository.get_job.return_value
    job["source_type"] = "youtube"

    worker._cleanup_initial_objects(job)

    assert worker.storage.delete_prefix.call_args_list == [
        call("outputs/session-a/job-upload/"),
        call("edit-sources/session-a/job-upload/"),
        call("thumbnails/session-a/job-upload/"),
    ]


@pytest.mark.parametrize("copy_fallback", [False, True])
def test_upload_project_retries_snapshot_cleanup_before_returning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, copy_fallback: bool,
) -> None:
    source = tmp_path / "receiver-source.media"
    source.write_bytes(b"receiver-owned-video")
    worker = _upload_project_worker(tmp_path)
    monkeypatch.setattr("shorts_worker.worker_pipeline.probe_media", lambda _path: {
        "format": {"duration": "300"},
        "streams": [{"codec_type": "video"}, {"codec_type": "audio"}],
    })
    if copy_fallback:
        monkeypatch.setattr(
            "shorts_worker.worker_pipeline.os.link",
            MagicMock(side_effect=OSError("cross-device")),
        )
    snapshots = []

    def transcribe(**kwargs):
        snapshots.append(Path(kwargs["source"]))
        raise RuntimeError("stop after borrowing the task-local source")

    worker._transcribe_source = transcribe
    original_rmtree = shutil.rmtree
    attempts = []

    def transient_failure(directory, *args, **kwargs):
        if (
            Path(directory).name.startswith("project-job-upload-")
            and not kwargs.get("ignore_errors")
        ):
            attempts.append(Path(directory))
            if len(attempts) == 1:
                raise PermissionError("transient filesystem failure")
        return original_rmtree(directory, *args, **kwargs)

    monkeypatch.setattr("shorts_worker.worker_pipeline.shutil.rmtree", transient_failure)
    worker.project("job-upload", prepared_source=source)
    assert len(attempts) == 2 and attempts[0] == attempts[1]
    assert len(snapshots) == 1 and not snapshots[0].exists()
    assert source.read_bytes() == b"receiver-owned-video"
    assert list(tmp_path.glob("project-job-upload-*")) == []


def test_upload_project_reports_owned_raw_workspace_when_cleanup_remains_unconfirmed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "receiver-source.media"
    source.write_bytes(b"receiver-owned-video")
    worker = _upload_project_worker(tmp_path)
    monkeypatch.setattr("shorts_worker.worker_pipeline.probe_media", lambda _path: {
        "format": {"duration": "300"},
        "streams": [{"codec_type": "video"}, {"codec_type": "audio"}],
    })
    worker._transcribe_source = MagicMock(side_effect=RuntimeError("stop after source acquisition"))
    original_rmtree = shutil.rmtree
    attempts = []

    def cannot_delete(directory, *args, **kwargs):
        if Path(directory).name.startswith("project-job-upload-"):
            attempts.append(Path(directory))
            raise PermissionError("filesystem failure")
        return original_rmtree(directory, *args, **kwargs)

    monkeypatch.setattr("shorts_worker.worker_pipeline.shutil.rmtree", cannot_delete)
    with pytest.raises(UploadSourceCleanupError) as caught:
        worker.project("job-upload", prepared_source=source)
    workspace = caught.value.workspace
    assert len(attempts) == 3 and set(attempts) == {workspace}
    assert workspace.parent == tmp_path
    assert (workspace / "source" / "uploaded-source.media").is_file()
    assert source.is_file()
    assert str(tmp_path) not in str(caught.value)
    original_rmtree(workspace)


def test_upload_cleanup_never_treats_stat_permission_error_as_verified_deletion(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "owned-project"
    workspace.mkdir()
    original_lstat = Path.lstat

    def inaccessible(path):
        if path == workspace:
            raise PermissionError("cannot verify absence")
        return original_lstat(path)

    monkeypatch.setattr(Path, "lstat", inaccessible)
    with pytest.raises(UploadSourceCleanupError):
        cleanup_uploaded_project_workspace(workspace, attempts=1)


def test_youtube_project_never_uses_receiver_only_verified_cleanup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "receiver-source.media"
    source.write_bytes(b"video")
    worker = _upload_project_worker(tmp_path)
    worker.repository.get_job.return_value.update({
        "source_type": "youtube", "youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "youtube_video_id": "dQw4w9WgXcQ",
    })
    cleanup = MagicMock()
    monkeypatch.setattr("shorts_worker.worker_pipeline.cleanup_uploaded_project_workspace", cleanup)
    worker.project("job-upload", prepared_source=source)
    cleanup.assert_not_called()
    assert source.exists()
