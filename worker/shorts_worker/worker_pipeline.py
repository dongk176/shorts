from __future__ import annotations

import os
import shutil
import threading
import traceback
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from .config import Settings
from .errors import BotCheckError
from .ingestion import YtDlpIngestionProvider
from .media import run_command
from .renderer import VideoRenderer
from .repository import WorkerRepository
from .schemas import (
    ClipLengthOption,
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
            if end > start:
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
        job = self.repository.get_job(job_id)
        if not job:
            raise KeyError(job_id)
        work_dir = self.settings.temp_dir / job_id
        attempt = attempt_override or max(1, int(os.getenv("AWS_BATCH_JOB_ATTEMPT", "1")))
        shutil.rmtree(work_dir, ignore_errors=True)
        work_dir.mkdir(parents=True)
        try:
            self.repository.begin_attempt(job_id, attempt)
            with self.heartbeat(job_id):
                self.repository.stage(job_id, "downloading", 10, "원본 영상을 준비하고 있습니다.")
                with self.repository.ingestion_slot():
                    bundle = self.ingestion.download_bundle(
                        job["youtube_url"], work_dir / "source"
                    )
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
                    clip_length_option=ClipLengthOption(job["clip_length_option"]),
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
                    output_path = work_dir / "outputs" / f"{short_id}.mp4"
                    thumbnail_path = work_dir / "thumbnails" / f"{short_id}.jpg"
                    clean_path.parent.mkdir(parents=True, exist_ok=True)
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
                    self.renderer.extract_clean_clip(
                        source_path=source,
                        output_path=clean_path,
                        clip=clip,
                        work_dir=work_dir,
                    )
                    relative_subtitles = self._relative_subtitles(transcript, clip)
                    self.repository.stage(
                        job_id,
                        "rendering",
                        60 + round(25 * index / len(clips)),
                        f"쇼츠 {index}/{len(clips)}를 만들었습니다.",
                    )
                    self.renderer.render_clean_clip(
                        clean_path=clean_path,
                        output_path=output_path,
                        title=clip.hook_title,
                        channel_name=job["channel_name"],
                        template_id=TemplateId(job["template_id"]),
                        transcript=relative_subtitles,
                        subtitles_enabled=False,
                        work_dir=work_dir,
                        prefix=f"short-{index}",
                    )
                    self._thumbnail(output_path, thumbnail_path, work_dir)
                    prefix = f"{job['mvp_session_id']}/{job_id}/{short_id}"
                    clean_key = f"edit-sources/{prefix}.mp4"
                    output_key = f"outputs/{prefix}/v1.mp4"
                    thumbnail_key = f"thumbnails/{prefix}.jpg"
                    self.repository.stage(job_id, "uploading", 86, "영상을 업로드하고 있습니다.")
                    self.storage.upload(clean_path, clean_key, "video/mp4")
                    size = self.storage.upload(output_path, output_key, "video/mp4")
                    self.storage.upload(thumbnail_path, thumbnail_key, "image/jpeg")
                    self.repository.add_short(
                        short_id=short_id,
                        job=job,
                        clip_index=index,
                        start_seconds=clip.start_seconds,
                        end_seconds=clip.end_seconds,
                        hook_title=clip.hook_title,
                        subtitles=[item.model_dump() for item in relative_subtitles],
                        clean_key=clean_key,
                        output_key=output_key,
                        thumbnail_key=thumbnail_key,
                        file_size=size,
                        expires_at=expires_at,
                    )
                self.repository.complete_job(job_id)
        except Exception as exc:
            prefix = f"{job['mvp_session_id']}/{job_id}/"
            for storage_prefix in (
                f"outputs/{prefix}",
                f"edit-sources/{prefix}",
                f"thumbnails/{prefix}",
            ):
                try:
                    self.storage.delete_prefix(storage_prefix)
                except Exception:
                    pass
            self.repository.remove_partial_shorts(job_id)
            non_retryable = isinstance(exc, BotCheckError)
            if non_retryable or attempt >= 2:
                self.repository.fail_job(job_id, type(exc).__name__, str(exc))
            else:
                self.repository.retry_job(job_id, type(exc).__name__, str(exc))
            traceback.print_exc()
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
