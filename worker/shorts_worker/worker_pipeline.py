from __future__ import annotations

import json
import math
import os
import shutil
import tempfile
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from functools import cached_property
from pathlib import Path
from uuid import uuid4

from .channel_thumbnail import download_channel_thumbnail
from .config import Settings
from .errors import (
    BotCheckError,
    IngestionError,
    RetryableIngestionError,
    RetryExhaustedIngestionError,
    TranscriptionError,
)
from .ingestion import DownloadedAssetBundle, YtDlpIngestionProvider
from .media import media_duration, probe_media, run_command
from .queueing import WorkQueue
from .renderer import VideoRenderer
from .repository import WorkerRepository
from .schemas import (
    HighlightClip,
    OutputLanguage,
    SubtitleSegment,
    TemplateId,
    VideoAspectRatio,
)
from .selector import TranscriptSelector
from .storage import ObjectStorage
from .subtitles import AudioTranscriber


def _log_event(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, separators=(",", ":"), default=str), flush=True)


def classify_range_download(
    *,
    source_duration_seconds: float,
    range_start_seconds: float,
    range_end_seconds: float,
    downloaded_duration_seconds: float,
) -> str:
    values = (
        source_duration_seconds,
        range_start_seconds,
        range_end_seconds,
        downloaded_duration_seconds,
    )
    if (
        not all(math.isfinite(value) for value in values)
        or source_duration_seconds <= 0
        or range_start_seconds < 0
        or range_end_seconds <= range_start_seconds
        or downloaded_duration_seconds <= 0
    ):
        return "unexpected_duration"

    selected_duration = range_end_seconds - range_start_seconds
    selected_distance = abs(downloaded_duration_seconds - selected_duration)
    full_distance = abs(downloaded_duration_seconds - source_duration_seconds)
    selected_tolerance = max(2.0, min(5.0, selected_duration * 0.05))
    full_tolerance = max(2.0, min(5.0, source_duration_seconds * 0.02))
    partial_range_requested = is_partial_range_requested(
        source_duration_seconds=source_duration_seconds,
        range_start_seconds=range_start_seconds,
        range_end_seconds=range_end_seconds,
    )

    if not partial_range_requested:
        if full_distance <= full_tolerance:
            return "full_source_expected"
        return "unexpected_duration"
    if selected_distance <= selected_tolerance and selected_distance <= full_distance:
        return "selected_range"
    if full_distance <= full_tolerance:
        return "full_source_unexpected"
    return "unexpected_duration"


def is_partial_range_requested(
    *,
    source_duration_seconds: float,
    range_start_seconds: float,
    range_end_seconds: float,
) -> bool:
    return (
        range_start_seconds > 0.5
        or range_end_seconds < source_duration_seconds - 0.5
    )


class BatchWorker:
    MAX_INLINE_INGESTION_ROUTES = 10
    INGESTION_ROUTE_WAIT_SECONDS = 30.0
    INGESTION_ROUTE_POLL_SECONDS = 1.0

    def __init__(self, settings: Settings) -> None:
        settings.validate_runtime()
        settings.ensure_directories()
        self.settings = settings
        self.repository = WorkerRepository(str(settings.database_url), settings.aws_region)
        self.storage = ObjectStorage(str(settings.s3_bucket), settings.aws_region)
        self.transcriber = AudioTranscriber(settings)
        self.selector = TranscriptSelector(settings)
        self.renderer = VideoRenderer(settings)
        self.queue = WorkQueue(settings.aws_region)

    @cached_property
    def ingestion(self) -> YtDlpIngestionProvider:
        return YtDlpIngestionProvider(
            timeout_seconds=self.settings.download_timeout_seconds
        )

    FINAL_INGESTION_MESSAGE = (
        "영상을 가져오지 못했습니다. 영상이 공개 상태인지, 로그인·연령·지역 제한이 "
        "없는지, 삭제되거나 비공개 처리되지 않았는지 확인한 뒤 다시 시도해 주세요."
    )
    FINAL_PROCESSING_MESSAGE = "쇼츠를 준비하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    FINAL_RENDER_MESSAGE = "쇼츠 영상을 만드는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."

    def _fail_ingestion_job(
        self,
        job_id: str,
        error: IngestionError,
        *,
        job_attempt: int,
        assigned_route_id: str | None,
        assigned_egress_class: str | None,
    ) -> None:
        error_details = error.failure_details()
        error_details["job_attempt"] = job_attempt
        if assigned_route_id:
            error_details["assigned_route_id"] = assigned_route_id
        if assigned_egress_class:
            error_details["assigned_egress_class"] = assigned_egress_class
        self.repository.fail_job(
            job_id,
            error.code,
            self.FINAL_INGESTION_MESSAGE,
            error_details=error_details,
        )

    @contextmanager
    def heartbeat(self, job_id: str):
        stop = threading.Event()

        def beat() -> None:
            while not stop.wait(60):
                try:
                    self.repository.heartbeat(job_id)
                except Exception:
                    pass

        thread = threading.Thread(target=beat, daemon=True)
        thread.start()
        try:
            yield
        finally:
            stop.set()
            thread.join(timeout=2)

    @staticmethod
    def _relative_subtitles(
        transcript: list[SubtitleSegment], clip: HighlightClip
    ) -> list[SubtitleSegment]:
        result: list[SubtitleSegment] = []
        for segment in transcript:
            start = max(segment.start, clip.start_seconds)
            end = min(segment.end, clip.end_seconds)
            overlap = end - start
            segment_duration = segment.end - segment.start
            if overlap > 0 and (segment_duration <= 0 or overlap / segment_duration >= 0.5):
                result.append(
                    SubtitleSegment(
                        start=round(start - clip.start_seconds, 3),
                        end=round(end - clip.start_seconds, 3),
                        text=segment.text,
                    )
                )
        return result

    @staticmethod
    def _transcript_coverage(transcript: list[SubtitleSegment], duration_seconds: float) -> float:
        if duration_seconds <= 0 or not transcript:
            return 0.0
        ranges = sorted(
            (
                max(0.0, min(duration_seconds, segment.start)),
                max(0.0, min(duration_seconds, segment.end)),
            )
            for segment in transcript
            if segment.end > segment.start
        )
        covered = 0.0
        current_start: float | None = None
        current_end = 0.0
        for start, end in ranges:
            if end <= start:
                continue
            if current_start is None:
                current_start, current_end = start, end
            elif start <= current_end:
                current_end = max(current_end, end)
            else:
                covered += current_end - current_start
                current_start, current_end = start, end
        if current_start is not None:
            covered += current_end - current_start
        return round(min(1.0, covered / duration_seconds), 4)

    def _transcribe_source(
        self,
        *,
        job_id: str,
        source: Path,
        work_dir: Path,
        duration_seconds: float,
    ) -> list[SubtitleSegment]:
        try:
            result = self.transcriber.transcribe(source, work_dir)
        except TranscriptionError as exc:
            _log_event(
                "transcription_pipeline_observed",
                job_id=job_id,
                provider="openai",
                model=self.settings.openai_transcribe_model,
                status="failed",
                error_type=type(exc).__name__,
            )
            raise
        _log_event(
            "transcription_pipeline_observed",
            job_id=job_id,
            provider="openai",
            model=result.model,
            status="partial" if result.failed_chunk_count else "succeeded",
            chunk_count=result.chunk_count,
            silent_chunk_count=result.silent_chunk_count,
            skipped_chunk_count=result.skipped_chunk_count,
            failed_chunk_count=result.failed_chunk_count,
            failed_audio_seconds=result.failed_audio_seconds,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            transcript_segment_count=len(result.segments),
            transcript_coverage_ratio=self._transcript_coverage(result.segments, duration_seconds),
        )
        return result.segments

    def _thumbnail(self, video: Path, output: Path, work_dir: Path) -> Path:
        result = run_command(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "warning",
                "-y",
                "-ss",
                "0.5",
                "-i",
                str(video),
                "-frames:v",
                "1",
                "-vf",
                "scale=360:-2",
                str(output),
            ],
            timeout=60,
            cwd=work_dir,
        )
        if result.returncode != 0 or not output.is_file():
            raise RuntimeError("썸네일 생성에 실패했습니다.")
        return output

    def initial(self, job_id: str, *, attempt_override: int | None = None) -> None:
        self.prepare(job_id, attempt_override=attempt_override)

    def _claim_next_ingestion_route(
        self,
        *,
        job_id: str,
        current_route_id: str,
        result: str,
        cooldown_seconds: int,
        attempted_route_ids: list[str],
    ) -> str | None:
        next_route_id = self.repository.rotate_ingestion_route(
            job_id,
            current_route_id,
            result=result,
            cooldown_seconds=cooldown_seconds,
            excluded_route_ids=list(attempted_route_ids),
        )
        if next_route_id:
            return next_route_id

        wait_deadline = time.monotonic() + self.INGESTION_ROUTE_WAIT_SECONDS
        _log_event(
            "ingestion_route_wait_started",
            job_id=job_id,
            attempted_route_count=len(attempted_route_ids),
            max_wait_seconds=self.INGESTION_ROUTE_WAIT_SECONDS,
        )
        while time.monotonic() < wait_deadline:
            remaining = wait_deadline - time.monotonic()
            time.sleep(min(self.INGESTION_ROUTE_POLL_SECONDS, max(0.0, remaining)))
            next_route_id = self.repository.rotate_ingestion_route(
                job_id,
                None,
                result=result,
                cooldown_seconds=0,
                excluded_route_ids=list(attempted_route_ids),
            )
            if next_route_id:
                return next_route_id
        return None

    def _download_with_inline_route_rotation(
        self,
        *,
        job_id: str,
        job_attempt: int,
        youtube_url: str,
        destination: Path,
        range_start_seconds: float | None,
        range_end_seconds: float | None,
        initial_route_id: str | None,
    ) -> tuple[DownloadedAssetBundle, str | None]:
        if not initial_route_id:
            return (
                self.ingestion.download_bundle(
                    youtube_url,
                    destination,
                    range_start_seconds=range_start_seconds,
                    range_end_seconds=range_end_seconds,
                    job_id=job_id,
                    route_id=None,
                ),
                None,
            )

        max_route_attempts = max(
            1,
            min(
                self.MAX_INLINE_INGESTION_ROUTES,
                self.ingestion.configured_route_count,
            ),
        )
        attempted_route_ids: list[str] = []
        route_id = initial_route_id
        route_is_leased = True

        try:
            while True:
                egress_class = self.ingestion.egress_class_for(route_id)
                try:
                    bundle = self.ingestion.download_bundle(
                        youtube_url,
                        destination,
                        range_start_seconds=range_start_seconds,
                        range_end_seconds=range_end_seconds,
                        job_id=job_id,
                        route_id=route_id,
                    )
                except (BotCheckError, RetryableIngestionError) as exc:
                    is_bot_check = isinstance(exc, BotCheckError)
                    route_result = "bot_check" if is_bot_check else "network_error"
                    ingestion_result = "bot_check" if is_bot_check else "other_error"
                    cooldown_seconds = 30
                    attempted_route_ids.append(route_id)
                    self.repository.record_ingestion_result(
                        job_id,
                        ingestion_result,
                        route_id=route_id,
                        egress_class=egress_class,
                        job_attempt=job_attempt,
                    )
                    _log_event(
                        "ingestion_route_attempt_failed",
                        job_id=job_id,
                        route_id=route_id,
                        error_type=type(exc).__name__,
                        attempted_route_count=len(attempted_route_ids),
                        max_route_attempts=max_route_attempts,
                    )
                    if len(attempted_route_ids) >= max_route_attempts:
                        self.repository.release_ingestion_route(
                            job_id,
                            route_id,
                            result=route_result,
                            cooldown_seconds=cooldown_seconds,
                        )
                        route_is_leased = False
                        raise RetryExhaustedIngestionError(
                            "사용 가능한 모든 ISP 경로에서 원본 영상 다운로드가 실패했습니다.",
                            details={
                                "route_attempt_count": len(attempted_route_ids),
                                "attempted_route_ids": tuple(attempted_route_ids),
                            },
                        ) from exc

                    shutil.rmtree(destination, ignore_errors=True)
                    destination.mkdir(parents=True, exist_ok=True)
                    next_route_id = self._claim_next_ingestion_route(
                        job_id=job_id,
                        current_route_id=route_id,
                        result=route_result,
                        cooldown_seconds=cooldown_seconds,
                        attempted_route_ids=attempted_route_ids,
                    )
                    route_is_leased = bool(next_route_id)
                    if not next_route_id:
                        raise RetryExhaustedIngestionError(
                            "대기 시간 안에 사용할 수 있는 ISP 경로를 확보하지 못했습니다.",
                            code="ingestion_route_wait_exhausted",
                            details={
                                "route_attempt_count": len(attempted_route_ids),
                                "attempted_route_ids": tuple(attempted_route_ids),
                            },
                        ) from exc
                    route_id = next_route_id
                except IngestionError:
                    self.repository.record_ingestion_result(
                        job_id,
                        "other_error",
                        route_id=route_id,
                        egress_class=egress_class,
                        job_attempt=job_attempt,
                    )
                    self.repository.release_ingestion_route(
                        job_id,
                        route_id,
                        result="terminal",
                        cooldown_seconds=0,
                    )
                    route_is_leased = False
                    raise
                except Exception:
                    self.repository.record_ingestion_result(
                        job_id,
                        "other_error",
                        route_id=route_id,
                        egress_class=egress_class,
                        job_attempt=job_attempt,
                    )
                    self.repository.release_ingestion_route(
                        job_id,
                        route_id,
                        result="terminal",
                        cooldown_seconds=0,
                    )
                    route_is_leased = False
                    raise
                else:
                    self.repository.release_ingestion_route(
                        job_id,
                        route_id,
                        result="success",
                        cooldown_seconds=0,
                    )
                    route_is_leased = False
                    return bundle, route_id
        finally:
            if route_is_leased:
                try:
                    self.repository.release_ingestion_route(
                        job_id,
                        route_id,
                        result="terminal",
                        cooldown_seconds=0,
                    )
                except Exception:
                    pass

    def prepare(self, job_id: str, *, attempt_override: int | None = None) -> None:
        job = self.repository.get_job(job_id)
        if not job:
            raise KeyError(job_id)
        route_id = str(job.get("ingestion_route_id") or "").strip() or None
        egress_class = self.ingestion.egress_class_for(route_id) if route_id else None
        route_cleanup_owned_by_download = False
        work_dir: Path | None = None
        deadline = job.get("deadline_at")
        if int(job.get("attempt_count") or 0) >= 10 or (
            deadline and deadline <= datetime.now(UTC) + timedelta(minutes=5)
        ):
            self.repository.fail_job(job_id, "prepare_deadline", self.FINAL_INGESTION_MESSAGE)
            return
        claimed = self.repository.claim_prepare_attempt(job_id, attempt_override=attempt_override)
        if not claimed:
            return
        attempt = int(claimed["attempt_count"])
        try:
            work_dir = Path(tempfile.mkdtemp(
                prefix=f"prepare-{job_id}-attempt-{attempt}-",
                dir=self.settings.temp_dir,
            ))
            with self.heartbeat(job_id):
                if not self.settings.openai_api_key:
                    _log_event(
                        "transcription_pipeline_observed",
                        job_id=job_id,
                        provider="openai",
                        model=self.settings.openai_transcribe_model,
                        status="not_configured",
                    )
                    raise TranscriptionError(
                        "OPENAI_API_KEY가 없어 필수 전사를 시작할 수 없습니다."
                    )
                _log_event(
                    "prepare_download_starting",
                    job_id=job_id,
                    attempt=attempt,
                )
                range_start_seconds = float(job["range_start_seconds"])
                range_end_seconds = float(job["range_end_seconds"])
                source_duration_seconds = float(job["source_duration_seconds"])
                partial_range_requested = is_partial_range_requested(
                    source_duration_seconds=source_duration_seconds,
                    range_start_seconds=range_start_seconds,
                    range_end_seconds=range_end_seconds,
                )
                route_cleanup_owned_by_download = bool(route_id)
                with self.repository.ingestion_slot():
                    bundle, successful_route_id = self._download_with_inline_route_rotation(
                        job_id=job_id,
                        job_attempt=attempt,
                        youtube_url=job["youtube_url"],
                        destination=work_dir / "source",
                        range_start_seconds=(
                            range_start_seconds if partial_range_requested else None
                        ),
                        range_end_seconds=(
                            range_end_seconds if partial_range_requested else None
                        ),
                        initial_route_id=route_id,
                    )
                successful_egress_class = (
                    self.ingestion.egress_class_for(successful_route_id)
                    if successful_route_id
                    else None
                )
                self.repository.record_ingestion_result(
                    job_id,
                    "success",
                    route_id=successful_route_id,
                    egress_class=successful_egress_class,
                    job_attempt=attempt,
                )
                metadata = bundle.metadata
                if (
                    metadata.video_id != job["youtube_video_id"]
                    or metadata.duration_seconds > self.settings.max_video_duration_seconds
                    or source_duration_seconds > self.settings.max_video_duration_seconds
                ):
                    raise ValueError("원본 영상 검증에 실패했습니다.")
                source = bundle.video_path
                downloaded_media_bytes = source.stat().st_size or None
                try:
                    downloaded_duration_seconds = media_duration(probe_media(source))
                except Exception:
                    self.repository.record_range_download_observation(
                        job_id,
                        status="unexpected_duration",
                        duration_seconds=None,
                        media_bytes=downloaded_media_bytes,
                    )
                    raise
                range_download_status = classify_range_download(
                    source_duration_seconds=source_duration_seconds,
                    range_start_seconds=range_start_seconds,
                    range_end_seconds=range_end_seconds,
                    downloaded_duration_seconds=downloaded_duration_seconds,
                )
                self.repository.record_range_download_observation(
                    job_id,
                    status=range_download_status,
                    duration_seconds=downloaded_duration_seconds or None,
                    media_bytes=downloaded_media_bytes,
                )
                _log_event(
                    "range_download_observed",
                    job_id=job_id,
                    status=range_download_status,
                    source_duration_seconds=source_duration_seconds,
                    requested_start_seconds=range_start_seconds,
                    requested_end_seconds=range_end_seconds,
                    downloaded_duration_seconds=downloaded_duration_seconds,
                    downloaded_media_bytes=downloaded_media_bytes,
                )
                if range_download_status in {
                    "full_source_unexpected",
                    "unexpected_duration",
                }:
                    raise IngestionError(
                        "선택한 구간만 다운로드되지 않아 전체 영상 처리를 중단했습니다.",
                        code="ingestion_range_mismatch",
                        details={
                            "range_download_status": range_download_status,
                            "source_duration_seconds": source_duration_seconds,
                            "downloaded_duration_seconds": downloaded_duration_seconds,
                        },
                    )

                self.repository.stage(job_id, "transcribing", 28, "영상 내용을 분석하고 있습니다.")
                transcript = self._transcribe_source(
                    job_id=job_id,
                    source=source,
                    work_dir=work_dir,
                    duration_seconds=downloaded_duration_seconds,
                )

                self.repository.stage(job_id, "selecting", 42, "쇼츠로 만들 장면을 찾고 있습니다.")
                clips = self.selector.select(
                    video_title=job["video_title"],
                    duration_seconds=downloaded_duration_seconds,
                    transcript=transcript,
                    required_count=int(job["expected_short_count"]),
                    range_start_seconds=0,
                    range_end_seconds=downloaded_duration_seconds,
                    output_language=OutputLanguage(job["output_language"]),
                )
                if not clips:
                    raise RuntimeError("사용할 수 있는 하이라이트 구간이 없습니다.")

                for index, clip in enumerate(clips, start=1):
                    self.repository.stage(
                        job_id,
                        "extracting",
                        45 + round(15 * index / len(clips)),
                        "편집용 영상을 준비하고 있습니다.",
                    )
                    short_id = str(uuid4())
                    clean_path = work_dir / "clean" / f"{short_id}.mp4"
                    clean_path.parent.mkdir(parents=True, exist_ok=True)
                    self.renderer.extract_clean_clip(
                        source_path=source,
                        output_path=clean_path,
                        clip=clip,
                        work_dir=work_dir,
                        video_aspect_ratio=VideoAspectRatio(
                            str(job.get("video_aspect_ratio") or "1:1")
                        ),
                    )
                    relative_subtitles = self._relative_subtitles(transcript, clip)
                    prefix = f"{job['mvp_session_id']}/{job_id}/{short_id}"
                    clean_key = f"edit-sources/{prefix}.mp4"
                    self.storage.upload(clean_path, clean_key, "video/mp4")
                    inserted = self.repository.add_pending_short(
                        short_id=short_id,
                        job=job,
                        clip_index=index,
                        start_seconds=range_start_seconds + clip.start_seconds,
                        end_seconds=range_start_seconds + clip.end_seconds,
                        hook_title=clip.hook_title,
                        subtitles=[item.model_dump() for item in relative_subtitles],
                        clean_key=clean_key,
                        retention_days=int(job["retention_days"]),
                        shard_index=(index - 1) // 4,
                    )
                    if not inserted:
                        try:
                            self.storage.delete(clean_key)
                        except Exception:
                            pass
                        raise RuntimeError("작업 제한 시간이 종료되었습니다.")
                if not self.repository.mark_render_queued(job_id, len(clips)):
                    raise RuntimeError("작업 제한 시간이 종료되었습니다.")
                shard_count = (len(clips) + 3) // 4
                if self.queue.queue_url:
                    self.queue.send(
                        {
                            "kind": "render",
                            "jobId": job_id,
                            "shardCount": shard_count,
                        }
                    )
                else:
                    for shard_index in range(shard_count):
                        self.render_shard(job_id, shard_index)
        except TranscriptionError as exc:
            _log_event(
                "prepare_failed",
                job_id=job_id,
                attempt=attempt,
                error_type=type(exc).__name__,
                retryable=False,
            )
            self._cleanup_initial_objects(job)
            self.repository.remove_partial_shorts(job_id)
            self.repository.fail_job(job_id, type(exc).__name__, self.FINAL_PROCESSING_MESSAGE)
            raise
        except BotCheckError as exc:
            _log_event(
                "prepare_failed",
                job_id=job_id,
                attempt=attempt,
                error_type=type(exc).__name__,
                retryable=False,
            )
            self._cleanup_initial_objects(job)
            self.repository.remove_partial_shorts(job_id)
            if not route_id:
                self.repository.record_ingestion_result(
                    job_id,
                    "bot_check",
                    route_id=None,
                    egress_class=None,
                    job_attempt=attempt,
                )
            self._fail_ingestion_job(
                job_id,
                exc,
                job_attempt=attempt,
                assigned_route_id=route_id,
                assigned_egress_class=egress_class,
            )
        except RetryableIngestionError as exc:
            _log_event(
                "prepare_failed",
                job_id=job_id,
                attempt=attempt,
                error_type=type(exc).__name__,
                retryable=False,
            )
            self._cleanup_initial_objects(job)
            self.repository.remove_partial_shorts(job_id)
            if not route_id:
                self.repository.record_ingestion_result(
                    job_id,
                    "other_error",
                    route_id=None,
                    egress_class=None,
                    job_attempt=attempt,
                )
            self._fail_ingestion_job(
                job_id,
                exc,
                job_attempt=attempt,
                assigned_route_id=route_id,
                assigned_egress_class=egress_class,
            )
        except IngestionError as exc:
            _log_event(
                "prepare_failed",
                job_id=job_id,
                attempt=attempt,
                error_type=type(exc).__name__,
                retryable=False,
            )
            self._cleanup_initial_objects(job)
            self.repository.remove_partial_shorts(job_id)
            if not route_id:
                self.repository.record_ingestion_result(
                    job_id,
                    "other_error",
                    route_id=None,
                    egress_class=None,
                    job_attempt=attempt,
                )
            self._fail_ingestion_job(
                job_id,
                exc,
                job_attempt=attempt,
                assigned_route_id=route_id,
                assigned_egress_class=egress_class,
            )
        except Exception as exc:
            _log_event(
                "prepare_failed",
                job_id=job_id,
                attempt=attempt,
                error_type=type(exc).__name__,
                retryable=False,
            )
            self._cleanup_initial_objects(job)
            self.repository.remove_partial_shorts(job_id)
            self.repository.record_ingestion_result(
                job_id,
                "other_error",
                route_id=route_id,
                egress_class=egress_class,
                job_attempt=attempt,
            )
            self.repository.fail_job(job_id, type(exc).__name__, self.FINAL_PROCESSING_MESSAGE)
            traceback.print_exc()
            raise
        finally:
            if route_id and not route_cleanup_owned_by_download:
                try:
                    self.repository.release_ingestion_route(
                        job_id,
                        route_id,
                        result="terminal",
                        cooldown_seconds=0,
                    )
                except Exception:
                    pass
            if work_dir is not None:
                shutil.rmtree(work_dir, ignore_errors=True)

    def _cleanup_initial_objects(self, job: dict[str, object]) -> None:
        prefix = f"{job['mvp_session_id']}/{job['id']}/"
        for storage_prefix in (
            f"outputs/{prefix}",
            f"edit-sources/{prefix}",
            f"thumbnails/{prefix}",
        ):
            try:
                self.storage.delete_prefix(storage_prefix)
            except Exception:
                pass

    def render_shard(self, job_id: str, shard_index: int) -> None:
        job = self.repository.get_job(job_id)
        if not job:
            raise KeyError(job_id)
        if job["status"] in {"completed", "failed", "expired", "deleted"}:
            return
        if job.get("deadline_at") and job["deadline_at"] <= datetime.now(UTC):
            self.repository.fail_job(job_id, "render_deadline", self.FINAL_RENDER_MESSAGE)
            return
        items = self.repository.get_render_shard(job_id, shard_index)
        pending = [item for item in items if item["status"] == "rendering"]
        if not pending:
            self.repository.maybe_complete_job(job_id)
            return

        failures: list[Exception] = []
        with ThreadPoolExecutor(max_workers=min(2, len(pending))) as executor:
            futures = [executor.submit(self._render_initial_short, item) for item in pending]
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as exc:
                    failures.append(exc)
        if failures:
            _log_event(
                "render_shard_failed",
                job_id=job_id,
                shard_index=shard_index,
                error_type=type(failures[0]).__name__,
            )
            raise failures[0]
        self.repository.maybe_complete_job(job_id)

    def _render_initial_short(self, item: dict[str, object]) -> None:
        short_id = str(item["id"])
        if not self.repository.begin_initial_render(short_id):
            return
        work_dir = self.settings.temp_dir / f"render-{short_id}"
        uploaded_keys: list[str] = []
        committed = False
        completion_started = False
        shutil.rmtree(work_dir, ignore_errors=True)
        work_dir.mkdir(parents=True)
        try:
            clean_path = self.storage.download(
                str(item["clean_clip_s3_key"]), work_dir / "clean.mp4"
            )
            self.repository.update_initial_render_progress(short_id, 30)
            output_path = work_dir / "output.mp4"
            thumbnail_path = work_dir / "thumbnail.jpg"
            subtitles = [
                SubtitleSegment.model_validate(segment)
                for segment in item["subtitle_segments"]  # type: ignore[union-attr]
            ]
            channel_thumbnail_path = download_channel_thumbnail(
                str(item.get("channel_thumbnail_url") or "") or None,
                work_dir / "channel-thumbnail.png",
            )
            self.renderer.render_clean_clip(
                clean_path=clean_path,
                output_path=output_path,
                title=str(item["hook_title"]),
                channel_name=str(item["channel_display_name"]),
                template_id=TemplateId(str(item["template_id"])),
                transcript=subtitles,
                subtitles_enabled=bool(item["subtitles_enabled"]),
                work_dir=work_dir,
                prefix="initial",
                title_font_scale=float(item["title_font_scale"]),
                channel_thumbnail_path=channel_thumbnail_path,
                video_aspect_ratio=VideoAspectRatio(str(item.get("video_aspect_ratio") or "1:1")),
            )
            self._thumbnail(output_path, thumbnail_path, work_dir)
            self.repository.update_initial_render_progress(short_id, 82)
            prefix = f"{item['mvp_session_id']}/{item['job_id']}/{short_id}"
            output_key = f"outputs/{prefix}/v1.mp4"
            thumbnail_key = f"thumbnails/{prefix}.jpg"
            size = self.storage.upload(output_path, output_key, "video/mp4")
            uploaded_keys.append(output_key)
            self.storage.upload(thumbnail_path, thumbnail_key, "image/jpeg")
            uploaded_keys.append(thumbnail_key)
            completion_started = True
            committed = self.repository.complete_initial_render(
                short_id, output_key, thumbnail_key, size
            )
            if not committed:
                # A duplicate worker may have committed the same deterministic
                # keys first. Re-read before deleting anything referenced by DB.
                committed = self.repository.initial_render_matches(
                    short_id, output_key, thumbnail_key
                )
                if not committed:
                    for key in uploaded_keys:
                        try:
                            self.storage.delete(key)
                        except Exception:
                            pass
        except Exception as exc:
            # Once the commit request has started its outcome can be ambiguous: the
            # database may already point at these keys even if the response was lost.
            # Preserve the objects and let the idempotent Batch retry reconcile it.
            if not committed and not completion_started:
                for key in uploaded_keys:
                    try:
                        self.storage.delete(key)
                    except Exception:
                        pass
            self.repository.fail_initial_render(short_id, type(exc).__name__, str(exc))
            raise
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def rerender(self, short_id: str) -> None:
        item = self.repository.get_short(short_id)
        if not item:
            raise KeyError(short_id)
        work_dir = self.settings.temp_dir / f"rerender-{short_id}"
        attempt = max(1, int(os.getenv("AWS_BATCH_JOB_ATTEMPT", "1")))
        uploaded_key: str | None = None
        committed = False
        completion_started = False
        shutil.rmtree(work_dir, ignore_errors=True)
        work_dir.mkdir(parents=True)
        try:
            self.repository.update_rerender_progress(short_id, 12)
            clean_path = self.storage.download(item["clean_clip_s3_key"], work_dir / "clean.mp4")
            self.repository.update_rerender_progress(short_id, 28)
            output_path = work_dir / "output.mp4"
            subtitles = [
                SubtitleSegment.model_validate(segment) for segment in item["subtitle_segments"]
            ]
            channel_thumbnail_path = download_channel_thumbnail(
                str(item.get("channel_thumbnail_url") or "") or None,
                work_dir / "channel-thumbnail.png",
            )
            self.renderer.render_clean_clip(
                clean_path=clean_path,
                output_path=output_path,
                title=item["hook_title"],
                channel_name=item["channel_display_name"],
                template_id=TemplateId(item["template_id"]),
                transcript=subtitles,
                subtitles_enabled=bool(item["subtitles_enabled"]),
                work_dir=work_dir,
                prefix="rerender",
                title_font_scale=float(item["title_font_scale"]),
                channel_thumbnail_path=channel_thumbnail_path,
                video_aspect_ratio=VideoAspectRatio(str(item.get("video_aspect_ratio") or "1:1")),
            )
            self.repository.update_rerender_progress(short_id, 82)
            version = int(item["render_version"]) + 1
            new_key = f"outputs/{item['mvp_session_id']}/{item['job_id']}/{short_id}/v{version}.mp4"
            size = self.storage.upload(output_path, new_key, "video/mp4")
            uploaded_key = new_key
            self.repository.update_rerender_progress(short_id, 94)
            completion_started = True
            old_key = self.repository.complete_rerender(short_id, new_key, size, version)
            if old_key is None:
                try:
                    self.storage.delete(new_key)
                except Exception:
                    pass
                uploaded_key = None
                return
            committed = True
            try:
                self.storage.delete(old_key)
            except Exception:
                pass
        except Exception:
            if uploaded_key is not None and not committed and not completion_started:
                try:
                    self.storage.delete(uploaded_key)
                except Exception:
                    pass
            if attempt >= 2:
                self.repository.reset_rerender(short_id)
            raise
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
