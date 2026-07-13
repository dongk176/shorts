from __future__ import annotations

import os
import shutil
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from .config import Settings
from .errors import BotCheckError, IngestionError
from .ingestion import YtDlpIngestionProvider
from .media import run_command
from .queueing import WorkQueue
from .renderer import VideoRenderer
from .repository import WorkerRepository
from .schemas import (
    HighlightClip,
    OutputLanguage,
    SubtitleSegment,
    TemplateId,
)
from .selector import TranscriptSelector
from .storage import ObjectStorage
from .subtitles import AudioTranscriber, parse_subtitle_file


class BatchWorker:
    def __init__(self, settings: Settings) -> None:
        settings.validate_runtime()
        settings.ensure_directories()
        self.settings = settings
        self.repository = WorkerRepository(str(settings.database_url))
        self.storage = ObjectStorage(str(settings.s3_bucket), settings.aws_region)
        self.ingestion = YtDlpIngestionProvider(timeout_seconds=settings.download_timeout_seconds)
        self.transcriber = AudioTranscriber(settings)
        self.selector = TranscriptSelector(settings)
        self.renderer = VideoRenderer(settings)
        self.queue = WorkQueue(settings.aws_region)

    FINAL_INGESTION_MESSAGE = (
        "영상을 가져오지 못했습니다. 영상이 공개 상태인지, 로그인·연령·지역 제한이 "
        "없는지, 삭제되거나 비공개 처리되지 않았는지 확인한 뒤 다시 시도해 주세요."
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
            if overlap > 0 and (
                segment_duration <= 0 or overlap / segment_duration >= 0.5
            ):
                result.append(
                    SubtitleSegment(
                        start=round(start - clip.start_seconds, 3),
                        end=round(end - clip.start_seconds, 3),
                        text=segment.text,
                    )
                )
        return result

    def _thumbnail(self, video: Path, output: Path, work_dir: Path) -> Path:
        result = run_command(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-ss", "0.5",
                "-i", str(video), "-frames:v", "1", "-vf", "scale=360:-2", str(output),
            ],
            timeout=60,
            cwd=work_dir,
        )
        if result.returncode != 0 or not output.is_file():
            raise RuntimeError("썸네일 생성에 실패했습니다.")
        return output

    def initial(self, job_id: str, *, attempt_override: int | None = None) -> None:
        self.prepare(job_id, attempt_override=attempt_override)

    def prepare(self, job_id: str, *, attempt_override: int | None = None) -> None:
        job = self.repository.get_job(job_id)
        if not job:
            raise KeyError(job_id)
        work_dir = self.settings.temp_dir / job_id
        deadline = job.get("deadline_at")
        if (
            int(job.get("attempt_count") or 0) >= 10
            or (deadline and deadline <= datetime.now(UTC) + timedelta(minutes=5))
        ):
            self.repository.fail_job(
                job_id, "prepare_deadline", self.FINAL_INGESTION_MESSAGE
            )
            return
        claimed = self.repository.claim_prepare_attempt(
            job_id, attempt_override=attempt_override
        )
        if not claimed:
            return
        attempt = int(claimed["attempt_count"])
        shutil.rmtree(work_dir, ignore_errors=True)
        work_dir.mkdir(parents=True)
        try:
            with self.heartbeat(job_id):
                self.repository.stage(job_id, "downloading", 10, "원본 영상을 준비하고 있습니다.")
                with self.repository.ingestion_slot():
                    bundle = self.ingestion.download_bundle(
                        job["youtube_url"], work_dir / "source"
                    )
                self.repository.record_ingestion_result(job_id, "success")
                metadata = bundle.metadata
                if (
                    metadata.video_id != job["youtube_video_id"]
                    or metadata.duration_seconds > self.settings.max_video_duration_seconds
                ):
                    raise ValueError("원본 영상 검증에 실패했습니다.")
                source = bundle.video_path

                self.repository.stage(job_id, "transcribing", 28, "영상 내용을 분석하고 있습니다.")
                transcript: list[SubtitleSegment] = []
                subtitle_path = bundle.subtitle_path
                if subtitle_path:
                    transcript = parse_subtitle_file(subtitle_path)
                if not transcript:
                    transcript = self.transcriber.transcribe(source, work_dir)

                self.repository.stage(job_id, "selecting", 42, "쇼츠로 만들 장면을 찾고 있습니다.")
                clips = self.selector.select(
                    video_title=job["video_title"],
                    duration_seconds=float(job["source_duration_seconds"]),
                    transcript=transcript,
                    required_count=int(job["expected_short_count"]),
                    range_start_seconds=float(job["range_start_seconds"]),
                    range_end_seconds=float(job["range_end_seconds"]),
                    output_language=OutputLanguage(job["output_language"]),
                )
                if not clips:
                    raise RuntimeError("사용할 수 있는 하이라이트 구간이 없습니다.")

                expires_at = datetime.now(UTC) + timedelta(days=min(30, int(job["retention_days"])))
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
                    )
                    relative_subtitles = self._relative_subtitles(transcript, clip)
                    prefix = f"{job['mvp_session_id']}/{job_id}/{short_id}"
                    clean_key = f"edit-sources/{prefix}.mp4"
                    self.storage.upload(clean_path, clean_key, "video/mp4")
                    self.repository.add_pending_short(
                        short_id=short_id,
                        job=job,
                        clip_index=index,
                        start_seconds=clip.start_seconds,
                        end_seconds=clip.end_seconds,
                        hook_title=clip.hook_title,
                        subtitles=[item.model_dump() for item in relative_subtitles],
                        clean_key=clean_key,
                        expires_at=expires_at,
                        shard_index=(index - 1) // 4,
                    )
                self.repository.mark_render_queued(job_id, len(clips))
                shard_count = (len(clips) + 3) // 4
                if self.queue.queue_url:
                    self.queue.send({
                        "kind": "render",
                        "jobId": job_id,
                        "shardCount": shard_count,
                    })
                else:
                    for shard_index in range(shard_count):
                        self.render_shard(job_id, shard_index)
        except BotCheckError as exc:
            self._cleanup_initial_objects(job)
            self.repository.remove_partial_shorts(job_id)
            self.repository.record_ingestion_result(job_id, "bot_check")
            if attempt < 10 and self.repository.can_retry_prepare(job_id):
                self.repository.retry_job(job_id, type(exc).__name__, str(exc))
                if self.queue.queue_url:
                    self.queue.send({"kind": "prepare_retry", "jobId": job_id}, delay_seconds=60)
            else:
                self.repository.fail_job(
                    job_id, type(exc).__name__, self.FINAL_INGESTION_MESSAGE
                )
        except IngestionError as exc:
            self._cleanup_initial_objects(job)
            self.repository.remove_partial_shorts(job_id)
            self.repository.record_ingestion_result(job_id, "other_error")
            self.repository.fail_job(
                job_id, type(exc).__name__, self.FINAL_INGESTION_MESSAGE
            )
        except Exception as exc:
            self._cleanup_initial_objects(job)
            self.repository.remove_partial_shorts(job_id)
            self.repository.record_ingestion_result(job_id, "other_error")
            self.repository.fail_job(job_id, type(exc).__name__, str(exc))
            traceback.print_exc()
            raise
        finally:
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
            self.repository.fail_job(
                job_id, "render_deadline", "쇼츠 생성 제한 시간이 초과되었습니다."
            )
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
            raise failures[0]
        self.repository.maybe_complete_job(job_id)

    def _render_initial_short(self, item: dict[str, object]) -> None:
        short_id = str(item["id"])
        if not self.repository.begin_initial_render(short_id):
            return
        work_dir = self.settings.temp_dir / f"render-{short_id}"
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
            )
            self._thumbnail(output_path, thumbnail_path, work_dir)
            self.repository.update_initial_render_progress(short_id, 82)
            prefix = f"{item['mvp_session_id']}/{item['job_id']}/{short_id}"
            output_key = f"outputs/{prefix}/v1.mp4"
            thumbnail_key = f"thumbnails/{prefix}.jpg"
            size = self.storage.upload(output_path, output_key, "video/mp4")
            self.storage.upload(thumbnail_path, thumbnail_key, "image/jpeg")
            self.repository.complete_initial_render(
                short_id, output_key, thumbnail_key, size
            )
        except Exception as exc:
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
            )
            self.repository.update_rerender_progress(short_id, 82)
            version = int(item["render_version"]) + 1
            new_key = f"outputs/{item['mvp_session_id']}/{item['job_id']}/{short_id}/v{version}.mp4"
            size = self.storage.upload(output_path, new_key, "video/mp4")
            self.repository.update_rerender_progress(short_id, 94)
            old_key = self.repository.complete_rerender(short_id, new_key, size, version)
            try:
                self.storage.delete(old_key)
            except Exception:
                pass
        except Exception:
            if attempt >= 2:
                self.repository.reset_rerender(short_id)
            raise
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
