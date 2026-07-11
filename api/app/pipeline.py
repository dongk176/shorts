from __future__ import annotations

import shutil
import threading
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from .config import Settings
from .database import JobDatabase
from .errors import ShortsMakerError
from .ingestion import IngestionProvider, VideoMetadata
from .renderer import VideoRenderer
from .schemas import JobStatus, SubtitleSegment, TemplateId
from .selector import TranscriptSelector, clip_count_for_duration
from .subtitles import AudioTranscriber, parse_subtitle_file


class JobPipeline:
    def __init__(
        self,
        *,
        settings: Settings,
        database: JobDatabase,
        ingestion: IngestionProvider,
    ) -> None:
        self.settings = settings
        self.database = database
        self.ingestion = ingestion
        self.transcriber = AudioTranscriber(settings)
        self.selector = TranscriptSelector(settings)
        self.renderer = VideoRenderer(settings)

    def _update(
        self,
        job_id: str,
        status: JobStatus,
        progress: int,
        message: str,
    ) -> None:
        self.database.update_job(
            job_id,
            status=status,
            progress=progress,
            message=message,
        )

    def run(self, job_id: str, metadata: VideoMetadata) -> None:
        job = self.database.get_job(job_id)
        if job is None:
            return
        work_dir = self.settings.temp_dir / job_id
        rendered_paths: list[Path] = []
        try:
            work_dir.mkdir(parents=True, exist_ok=False)
            self._update(job_id, JobStatus.DOWNLOADING, 10, "원본 영상을 가져오고 있습니다.")
            source = self.ingestion.download_video(job["youtube_url"], work_dir / "source")

            self._update(job_id, JobStatus.TRANSCRIBING, 30, "자막을 분석하고 있습니다.")
            transcript: list[SubtitleSegment] = []
            try:
                subtitle_path = self.ingestion.download_subtitles(
                    job["youtube_url"], work_dir / "captions"
                )
                if subtitle_path:
                    transcript = parse_subtitle_file(subtitle_path)
            except Exception as exc:
                self.database.append_log(job_id, "WARNING", f"자막 다운로드 실패: {exc}")
            if not transcript:
                transcript = self.transcriber.transcribe(source, work_dir)
            if not transcript:
                self.database.append_log(
                    job_id,
                    "INFO",
                    "사용 가능한 자막이 없어 deterministic fallback을 사용합니다.",
                )

            self._update(job_id, JobStatus.SELECTING, 50, "핵심 구간을 고르고 있습니다.")
            range_start = float(job.get("range_start_seconds") or 0)
            range_end = float(job.get("range_end_seconds") or metadata.duration_seconds)
            count = clip_count_for_duration(
                range_end - range_start,
                maximum_seconds=self.settings.max_video_duration_seconds,
            )
            clips = self.selector.select(
                video_title=metadata.title,
                duration_seconds=metadata.duration_seconds,
                transcript=transcript,
                required_count=count,
                range_start_seconds=range_start,
                range_end_seconds=range_end,
            )
            if not clips:
                raise ShortsMakerError("영상에서 사용할 수 있는 구간을 찾지 못했습니다.")

            self._update(job_id, JobStatus.RENDERING, 60, "쇼츠 영상을 만들고 있습니다.")
            outputs: list[dict] = []
            template_id = TemplateId(job["template_id"])
            output_dir = self.settings.storage_dir / job_id
            source_dir = self.settings.storage_dir / "_sources"
            source_dir.mkdir(parents=True, exist_ok=True)
            persisted_source = source_dir / f"{job_id}{source.suffix.lower()}"
            shutil.copy2(source, persisted_source)
            self.database.update_job(
                job_id,
                channel_name=metadata.channel_name,
                source_path=str(persisted_source.relative_to(self.settings.storage_dir)),
            )
            for index, clip in enumerate(clips, start=1):
                output_path = output_dir / f"{job_id}_{index}.mp4"
                try:
                    self.renderer.render(
                        source_path=source,
                        output_path=output_path,
                        clip=clip,
                        clip_index=index,
                        channel_name=metadata.channel_name,
                        template_id=template_id,
                        transcript=transcript,
                        work_dir=work_dir,
                        log=lambda message, current_job=job_id: self.database.append_log(
                            current_job, "FFMPEG", message
                        ),
                    )
                    rendered_paths.append(output_path)
                    relative = f"{job_id}/{output_path.name}"
                    outputs.append(
                        {
                            "id": f"{job_id}-{index}",
                            "title": clip.hook_title,
                            "start_seconds": round(clip.start_seconds, 3),
                            "end_seconds": round(clip.end_seconds, 3),
                            "duration_seconds": round(
                                clip.end_seconds - clip.start_seconds, 3
                            ),
                            "video_url": f"/files/{relative}",
                            "download_url": f"/files/{relative}?download=true",
                            "transcript_text": " ".join(
                                segment.text
                                for segment in transcript
                                if segment.end > clip.start_seconds
                                and segment.start < clip.end_seconds
                            ),
                            "title_color": None,
                            "title_font_size": None,
                        }
                    )
                except Exception as exc:
                    self.database.append_log(
                        job_id,
                        "ERROR",
                        f"클립 {index} 렌더링 실패: {exc}\n{traceback.format_exc()}",
                    )
                progress = 60 + round(35 * index / len(clips))
                self.database.update_job(
                    job_id,
                    progress=progress,
                    message=f"쇼츠 영상을 만들고 있습니다. ({index}/{len(clips)})",
                )

            if not outputs:
                raise ShortsMakerError(
                    "모든 쇼츠 렌더링에 실패했습니다. 작업을 다시 시도해 주세요."
                )
            self.database.update_job(
                job_id,
                status=JobStatus.COMPLETED,
                progress=100,
                message=f"쇼츠 {len(outputs)}개를 완성했습니다.",
                outputs=outputs,
            )
        except Exception as exc:
            for path in rendered_paths:
                path.unlink(missing_ok=True)
            shutil.rmtree(self.settings.storage_dir / job_id, ignore_errors=True)
            user_message = (
                exc.message
                if isinstance(exc, ShortsMakerError)
                else "작업 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
            )
            try:
                self.database.append_log(job_id, "ERROR", traceback.format_exc())
                self.database.update_job(
                    job_id,
                    status=JobStatus.FAILED,
                    progress=100,
                    message=user_message,
                    error_message=str(exc)[:1000],
                    outputs=[],
                )
            except Exception:
                pass
        finally:
            if not self.settings.keep_temp_files:
                shutil.rmtree(work_dir, ignore_errors=True)


class JobManager:
    """Bounded in-process executor suitable for the local single-process MVP."""

    def __init__(self, pipeline: JobPipeline, max_workers: int) -> None:
        self.pipeline = pipeline
        self.executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="shorts-job",
        )
        self._futures: dict[str, Future[None]] = {}
        self._lock = threading.Lock()

    def submit(self, job_id: str, metadata: VideoMetadata) -> None:
        future = self.executor.submit(self.pipeline.run, job_id, metadata)
        with self._lock:
            self._futures[job_id] = future
        future.add_done_callback(lambda _: self._discard(job_id))

    def _discard(self, job_id: str) -> None:
        with self._lock:
            self._futures.pop(job_id, None)

    def shutdown(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=True)
