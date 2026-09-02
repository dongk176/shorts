from __future__ import annotations

import json
import math
import os
import resource
import shutil
import stat
import sys
import tempfile
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from functools import cached_property
from pathlib import Path
from uuid import uuid4

from .background_assets import download_owned_background
from .caption_templates import (
    CAPTION_ACCENT,
    CAPTION_STABLE_TIMING_LEAD_FRAMES,
    compile_caption_render_spec,
)
from .channel_thumbnail import download_channel_thumbnail
from .comment_generator import CommentClipInput, CommentGenerator
from .config import Settings
from .editor_renderer import (
    EditorDocumentRenderer,
    editor_highlight_subtitles_enabled,
    editor_subtitle_render_mode,
    project_caption_render_spec_v4,
    retime_editor_subtitles,
)
from .errors import (
    BotCheckError,
    CaptionCompileError,
    IngestionError,
    RenderError,
    RetryableIngestionError,
    RetryExhaustedIngestionError,
    TranscriptionError,
)
from .ingestion import DownloadedAssetBundle, YtDlpIngestionProvider
from .media import media_duration, probe_media, run_command
from .overlays import (
    contrasting_title_text_color,
    default_title_text_styles,
    ensure_title_text_background,
)
from .queueing import WorkQueue
from .release_identity import (
    initial_render_v4_opt_in,
    verify_initial_render_v4_runtime,
)
from .render_spec_v4 import compile_initial_editor_render_spec_v4
from .renderer import VideoRenderer
from .repository import WorkerRepository
from .schemas import (
    CommentOverlay,
    CustomTemplateConfig,
    EditorDocument,
    HighlightClip,
    OutputLanguage,
    SubtitleSegment,
    TemplateId,
    TemplateSubtitleLayer,
    TitleTextStyle,
    VideoAspectRatio,
    fallback_comment_overlays,
)
from .selector import TranscriptSelector, minimum_clip_count
from .storage import ObjectStorage
from .subtitles import (
    ELEVENLABS_FALLBACK_POLICY,
    OPENAI_STABLE_POLICY,
    AudioTranscriber,
    TranscriptWord,
)

EDIT_TIMELINE_PADDING_SECONDS = 30.0
BRAND_COLOR_VALUES = frozenset({
    "#040404", "#000000", "#111111", "#1B1B1E", "#353438", "#64748B",
    "#FFFFFF", "#F3F0E9", "#E32626", "#FF4D4F", "#FF715E", "#FFB4A8",
    "#F97316", "#FFD84D", "#8BFF5A", "#16A34A", "#35E6E3", "#3B82F6",
    "#2563EB", "#A78BFA", "#DB2777",
})

UPLOAD_SOURCE_MIN_DURATION_SECONDS = 180.0
UPLOAD_SOURCE_RANGE_MIN_DURATION_SECONDS = 240.0
UPLOAD_SOURCE_RANGE_MAX_DURATION_SECONDS = 3600.0


class UploadSourceCleanupError(RuntimeError):
    """A receiver must retain its task until this owned snapshot is gone."""

    def __init__(self, workspace: Path) -> None:
        super().__init__("업로드 작업 원본을 안전하게 삭제하지 못했습니다.")
        self.workspace = workspace


class ProjectDeferredForIngestionRoute(RuntimeError):
    """The current task relinquished its project to the durable route queue."""

    def __init__(self, action: str) -> None:
        super().__init__(action)
        self.action = action


def cleanup_uploaded_project_workspace(workspace: Path, *, attempts: int = 3) -> None:
    """Delete only the project-owned directory supplied by its pipeline owner."""
    for attempt in range(max(1, min(3, attempts))):
        try:
            shutil.rmtree(workspace)
        except FileNotFoundError:
            pass
        except OSError:
            pass
        try:
            workspace.lstat()
        except FileNotFoundError:
            return
        except OSError:
            # Permission/stat errors do not prove physical deletion.
            pass
        if attempt + 1 < max(1, min(3, attempts)):
            time.sleep(0.05)
    raise UploadSourceCleanupError(workspace)


def _stored_transcript_words(value: object) -> list[TranscriptWord]:
    if not isinstance(value, list):
        return []
    words: list[TranscriptWord] = []
    for raw in value:
        if not isinstance(raw, dict):
            raise ValueError("저장된 단어 타임스탬프 형식이 올바르지 않습니다.")
        text = str(raw.get("text") or "").strip()
        try:
            start = float(raw["start"])
            end = float(raw["end"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(
                "저장된 단어 타임스탬프 형식이 올바르지 않습니다."
            ) from exc
        if not text or not math.isfinite(start) or not math.isfinite(end):
            raise ValueError("저장된 단어 타임스탬프 형식이 올바르지 않습니다.")
        if start < 0 or end <= start:
            raise ValueError("저장된 단어 타임스탬프 범위가 올바르지 않습니다.")
        words.append(TranscriptWord(
            text=text,
            start=start,
            end=end,
            provider=str(raw.get("provider") or "stored"),
            speaker_id=(
                str(raw["speakerId"])
                if raw.get("speakerId") is not None
                else None
            ),
            space_before=raw.get("spaceBefore") is True,
        ))
    return words
UPLOAD_SOURCE_MAX_DURATION_SECONDS = 10_800.0
UPLOAD_SOURCE_MAX_BYTES = 5 * 1024 * 1024 * 1024


@dataclass(frozen=True)
class ProjectTimelineTarget:
    short_id: str
    slot_index: int
    clip: HighlightClip
    subtitles: list[SubtitleSegment]
    caption_editor_source: dict[str, object] | None = None


def edit_timeline_clip(
    clip: HighlightClip,
    source_duration_seconds: float,
    *,
    padding_seconds: float = EDIT_TIMELINE_PADDING_SECONDS,
) -> HighlightClip:
    """Return the same selected scene with bounded editing handles around it."""
    start_seconds = round(max(0.0, clip.start_seconds - max(0.0, padding_seconds)), 3)
    end_seconds = round(
        min(source_duration_seconds, clip.end_seconds + max(0.0, padding_seconds)),
        3,
    )
    return clip.model_copy(update={
        "start_seconds": start_seconds,
        "end_seconds": end_seconds,
    })


def _custom_template_config(item: dict[str, object]) -> CustomTemplateConfig | None:
    snapshot = item.get("template_snapshot")
    if not isinstance(snapshot, dict):
        return None
    config = snapshot.get("config")
    return CustomTemplateConfig.model_validate(config) if isinstance(config, dict) else None


def _unified_template_subtitle(
    item: dict[str, object],
) -> TemplateSubtitleLayer | None:
    config = _custom_template_config(item)
    return config.subtitle if config is not None and config.schema_version == 5 else None


def _caption_compile_options(
    subtitle: TemplateSubtitleLayer | None,
) -> dict[str, object]:
    if subtitle is None:
        return {}
    return {
        "caption_center_y": subtitle.y,
        "caption_max_width": subtitle.max_width,
        "font_size": subtitle.font_size,
        "text_color": subtitle.color,
    }


def _preset_comment_channel_below(item: dict[str, object]) -> bool:
    snapshot = item.get("template_snapshot")
    if not isinstance(snapshot, dict):
        return False
    version = snapshot.get("presetVersion")
    return isinstance(version, int) and not isinstance(version, bool) and version == 2


def _preset_comment_channel_fixed(item: dict[str, object]) -> bool:
    snapshot = item.get("template_snapshot")
    if not isinstance(snapshot, dict):
        return False
    version = snapshot.get("presetVersion")
    return isinstance(version, int) and not isinstance(version, bool) and version >= 3


def _preset_fixed_channel_position(item: dict[str, object]) -> bool:
    snapshot = item.get("template_snapshot")
    if not isinstance(snapshot, dict):
        return False
    version = snapshot.get("presetVersion")
    return isinstance(version, int) and not isinstance(version, bool) and version >= 3


def _preset_brand_color(item: dict[str, object]) -> str | None:
    snapshot = item.get("template_snapshot")
    if not isinstance(snapshot, dict):
        return None
    brand_color = snapshot.get("brandColor")
    if isinstance(brand_color, str) and brand_color in BRAND_COLOR_VALUES:
        return brand_color
    return None


def _initial_title_text_styles(
    item: dict[str, object],
    *,
    title: str,
    caption_render_spec: dict[str, object] | None,
) -> list[TitleTextStyle]:
    """Return the exact semantic styles paired with the initial v4 boxes.

    These values are persisted on the generated short as well as consumed by
    the v4 compiler.  The editor therefore starts from the same overrides that
    produced the first video instead of reconstructing a different legacy
    default and later reviving a removed background.
    """
    template_id = TemplateId(str(item["template_id"]))
    video_aspect_ratio = VideoAspectRatio(
        str(item.get("video_aspect_ratio") or "1:1")
    )
    custom_config = _custom_template_config(item)
    default_aspect_ratio = (
        VideoAspectRatio.PORTRAIT
        if template_id is TemplateId.COMMENT_CAPTURE
        and video_aspect_ratio is VideoAspectRatio.FULL_VERTICAL
        else video_aspect_ratio
    )
    # A custom template already owns its primary/accent colors and background
    # semantics.  Persisting a preset's implicit title style on top of it would
    # turn that preset fallback into an explicit user override and could revive
    # a background the custom template intentionally removed.
    styles = (
        []
        if custom_config is not None
        else default_title_text_styles(
            title,
            template_id,
            overlay_mode=default_aspect_ratio is VideoAspectRatio.FULL_VERTICAL,
        )
    )
    brand_color = _preset_brand_color(item)
    if custom_config is None and brand_color and styles:
        styles = [
            style.model_copy(update={
                "background_color": brand_color,
                "color": contrasting_title_text_color(brand_color),
            })
            for style in styles
        ]

    if (
        custom_config is None
        and caption_render_spec is not None
        and video_aspect_ratio is VideoAspectRatio.FULL_VERTICAL
    ):
        style_value = caption_render_spec.get("style")
        caption_brand_color = (
            style_value.get("accentColor")
            if isinstance(style_value, dict)
            and isinstance(style_value.get("accentColor"), str)
            and style_value.get("accentColor") in BRAND_COLOR_VALUES
            else CAPTION_ACCENT
        )
        styles = ensure_title_text_background(
            title,
            styles,
            brand_color or str(caption_brand_color),
        )
    return styles


def _subtitle_template_timing_lead_frames(snapshot: object) -> int:
    if not isinstance(snapshot, dict) or "timingLeadFrames" not in snapshot:
        return CAPTION_STABLE_TIMING_LEAD_FRAMES
    value = snapshot["timingLeadFrames"]
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 0 <= value <= 30
    ):
        raise CaptionCompileError("자막 선행 프레임 값이 올바르지 않습니다.")
    return value


def _log_event(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, separators=(",", ":"), default=str), flush=True)


def _container_memory_peak_bytes() -> int:
    for path in (
        Path("/sys/fs/cgroup/memory.peak"),
        Path("/sys/fs/cgroup/memory/memory.max_usage_in_bytes"),
    ):
        try:
            return max(0, int(path.read_text(encoding="utf-8").strip()))
        except (OSError, ValueError):
            continue
    peak = int(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
    return peak if sys.platform == "darwin" else peak * 1024


def _container_memory_current_bytes() -> int:
    for path in (
        Path("/sys/fs/cgroup/memory.current"),
        Path("/sys/fs/cgroup/memory/memory.usage_in_bytes"),
    ):
        try:
            return max(0, int(path.read_text(encoding="utf-8").strip()))
        except (OSError, ValueError):
            continue
    return 0


def _container_cpu_usage_seconds() -> float:
    try:
        values = Path("/sys/fs/cgroup/cpu.stat").read_text(encoding="utf-8").splitlines()
        usage = next(
            int(line.split()[1])
            for line in values
            if line.startswith("usage_usec ")
        )
        return usage / 1_000_000
    except (OSError, StopIteration, ValueError, IndexError):
        pass
    try:
        return int(Path("/sys/fs/cgroup/cpuacct/cpuacct.usage").read_text().strip()) / 1e9
    except (OSError, ValueError):
        own = resource.getrusage(resource.RUSAGE_SELF)
        children = resource.getrusage(resource.RUSAGE_CHILDREN)
        return own.ru_utime + own.ru_stime + children.ru_utime + children.ru_stime


@dataclass(slots=True)
class PhaseResourceMonitor:
    allocated_vcpus: int
    _started_at: float = field(init=False, default=0.0)
    _cpu_started_at: float = field(init=False, default=0.0)
    _peak_memory_bytes: int = field(init=False, default=0)
    _stop: threading.Event = field(init=False, default_factory=threading.Event)
    _thread: threading.Thread | None = field(init=False, default=None)
    _metrics: dict[str, object] = field(init=False, default_factory=dict)

    def __enter__(self) -> PhaseResourceMonitor:
        self._started_at = time.monotonic()
        self._cpu_started_at = _container_cpu_usage_seconds()
        self._peak_memory_bytes = _container_memory_current_bytes()

        def sample() -> None:
            while not self._stop.wait(0.25):
                self._peak_memory_bytes = max(
                    self._peak_memory_bytes,
                    _container_memory_current_bytes(),
                )

        self._thread = threading.Thread(target=sample, name="phase-resource-monitor", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1)
        wall_seconds = max(0.001, time.monotonic() - self._started_at)
        cpu_seconds = max(0.0, _container_cpu_usage_seconds() - self._cpu_started_at)
        self._peak_memory_bytes = max(
            self._peak_memory_bytes,
            _container_memory_current_bytes(),
        )
        self._metrics = {
            "wallSeconds": round(wall_seconds, 3),
            "cpuSeconds": round(cpu_seconds, 3),
            "cpuUtilizationPercent": round(
                min(100.0, 100 * cpu_seconds / (wall_seconds * max(1, self.allocated_vcpus))),
                2,
            ),
            "peakMemoryBytes": self._peak_memory_bytes,
        }

    @property
    def metrics(self) -> dict[str, object]:
        return dict(self._metrics)


def _render_queue_delay_seconds() -> float | None:
    submitted_at = os.getenv("RENDER_SUBMITTED_AT")
    if not submitted_at:
        return None
    try:
        submitted = datetime.fromisoformat(submitted_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    return round(max(0.0, (datetime.now(UTC) - submitted).total_seconds()), 3)


def full_source_duration_tolerance_seconds(reference_seconds: float) -> float:
    """Bound browser/container duration drift to the existing 2–5 second rule."""
    return max(2.0, min(5.0, reference_seconds * 0.02))


def classify_full_source_download(
    *,
    source_duration_seconds: float,
    downloaded_duration_seconds: float,
) -> str:
    values = (
        source_duration_seconds,
        downloaded_duration_seconds,
    )
    if (
        not all(math.isfinite(value) for value in values)
        or source_duration_seconds <= 0
        or downloaded_duration_seconds <= 0
    ):
        return "unexpected_duration"

    full_distance = abs(downloaded_duration_seconds - source_duration_seconds)
    full_tolerance = full_source_duration_tolerance_seconds(source_duration_seconds)
    return "full_source_expected" if full_distance <= full_tolerance else "unexpected_duration"


def _absolute_source_second(value: float | None, offset_seconds: float) -> float | None:
    if value is None:
        return None
    return round(offset_seconds + value, 3)


def _offset_highlight_clip(clip: HighlightClip, offset_seconds: float) -> HighlightClip:
    if not offset_seconds:
        return clip
    return clip.model_copy(update={
        "start_seconds": _absolute_source_second(clip.start_seconds, offset_seconds),
        "end_seconds": _absolute_source_second(clip.end_seconds, offset_seconds),
        "selection_raw_start_seconds": _absolute_source_second(
            clip.selection_raw_start_seconds,
            offset_seconds,
        ),
        "selection_raw_end_seconds": _absolute_source_second(
            clip.selection_raw_end_seconds,
            offset_seconds,
        ),
    })


def _relative_source_transcript(
    transcript: list[SubtitleSegment],
    *,
    source_start_seconds: float,
    duration_seconds: float,
) -> list[SubtitleSegment]:
    """Project absolute source timestamps onto a selected window starting at zero."""
    if (
        not math.isfinite(source_start_seconds)
        or not math.isfinite(duration_seconds)
        or source_start_seconds < 0
        or duration_seconds <= 0
    ):
        raise IngestionError(
            "영상 분석 시간축이 올바르지 않습니다.",
            code="selection_timeline_invalid",
        )
    source_end_seconds = source_start_seconds + duration_seconds
    projected: list[SubtitleSegment] = []
    for segment in transcript:
        start = max(source_start_seconds, segment.start)
        end = min(source_end_seconds, segment.end)
        if end <= start:
            continue
        relative_start = round(start - source_start_seconds, 3)
        relative_end = round(end - source_start_seconds, 3)
        if relative_end <= relative_start:
            continue
        projected.append(
            SubtitleSegment(
                start=relative_start,
                end=relative_end,
                text=segment.text,
            )
        )
    return projected


def _validate_clip_in_source_window(
    clip: HighlightClip,
    *,
    source_start_seconds: float,
    source_end_seconds: float,
) -> HighlightClip:
    """Fail closed when a selected clip cannot belong to the requested source window."""
    values = (
        source_start_seconds,
        source_end_seconds,
        clip.start_seconds,
        clip.end_seconds,
    )
    raw_start = clip.selection_raw_start_seconds
    raw_end = clip.selection_raw_end_seconds
    raw_pair_is_valid = (raw_start is None and raw_end is None) or (
        raw_start is not None
        and raw_end is not None
        and math.isfinite(raw_start)
        and math.isfinite(raw_end)
        and source_start_seconds - 0.001 <= raw_start < raw_end
        and raw_end <= source_end_seconds + 0.001
    )
    if (
        not all(math.isfinite(value) for value in values)
        or source_end_seconds <= source_start_seconds
        or clip.start_seconds < source_start_seconds - 0.001
        or clip.end_seconds > source_end_seconds + 0.001
        or clip.end_seconds <= clip.start_seconds
        or not raw_pair_is_valid
    ):
        raise IngestionError(
            "선택한 구간과 분석된 영상 구간이 일치하지 않습니다.",
            code="selection_range_mismatch",
            details={
                "source_window_start_seconds": source_start_seconds,
                "source_window_end_seconds": source_end_seconds,
                "clip_start_seconds": clip.start_seconds,
                "clip_end_seconds": clip.end_seconds,
                "selection_raw_start_seconds": raw_start,
                "selection_raw_end_seconds": raw_end,
            },
        )
    return clip


def project_source_window(
    *,
    source_duration_seconds: float,
    source_range_enabled: bool,
    range_start_seconds: float | None,
    range_end_seconds: float | None,
    max_source_duration_seconds: float,
) -> float:
    if (
        not math.isfinite(source_duration_seconds)
        or source_duration_seconds <= 0
        or source_duration_seconds > max_source_duration_seconds
    ):
        raise IngestionError(
            "원본 영상 길이가 허용된 범위를 벗어났습니다.",
            code="ingestion_source_duration_invalid",
        )
    if not source_range_enabled:
        return source_duration_seconds
    if (
        range_start_seconds is None
        or range_end_seconds is None
        or not all(math.isfinite(value) for value in (
            range_start_seconds,
            range_end_seconds,
        ))
        or range_start_seconds < 0
        or range_end_seconds > source_duration_seconds + 0.001
        or range_end_seconds - range_start_seconds < 240
        or range_end_seconds - range_start_seconds > 3600
    ):
        raise IngestionError(
            "저장된 영상 선택 구간이 유효하지 않습니다.",
            code="ingestion_range_invalid",
        )
    return range_end_seconds - range_start_seconds


def uploaded_project_source_window(
    *,
    source_duration_seconds: float,
    declared_source_duration_seconds: float | None = None,
    source_range_enabled: bool,
    range_start_seconds: float | None,
    range_end_seconds: float | None,
) -> float:
    """Validate the isolated upload path without widening the YouTube limits.

    Uploaded originals may be between three minutes and three hours. Originals
    shorter than four minutes are used in full; every longer original must carry
    an explicit four-to-sixty-minute analysis range.
    """
    declared_duration_seconds = (
        source_duration_seconds
        if declared_source_duration_seconds is None
        else declared_source_duration_seconds
    )
    if (
        not math.isfinite(source_duration_seconds)
        or source_duration_seconds < UPLOAD_SOURCE_MIN_DURATION_SECONDS
        or source_duration_seconds > UPLOAD_SOURCE_MAX_DURATION_SECONDS
        or not math.isfinite(declared_duration_seconds)
        or classify_full_source_download(
            source_duration_seconds=declared_duration_seconds,
            downloaded_duration_seconds=source_duration_seconds,
        )
        != "full_source_expected"
    ):
        raise IngestionError(
            "업로드한 원본 영상 길이가 허용된 범위를 벗어났습니다.",
            code="upload_source_duration_invalid",
        )

    duration_tolerance = full_source_duration_tolerance_seconds(
        declared_duration_seconds
    )
    if not source_range_enabled:
        # The control plane derives this flag from browser metadata before
        # rounding the display duration. A few-frame ffprobe crossover at 4m
        # remains a whole-source upload, but a genuinely longer source cannot
        # use this compatibility path.
        if (
            source_duration_seconds
            > UPLOAD_SOURCE_RANGE_MIN_DURATION_SECONDS + duration_tolerance
        ):
            raise IngestionError(
                "4분 미만 업로드 영상은 전체 구간만 사용할 수 있습니다.",
                code="upload_range_invalid",
            )
        return source_duration_seconds

    if (
        range_start_seconds is None
        or range_end_seconds is None
        or not all(math.isfinite(value) for value in (
            range_start_seconds,
            range_end_seconds,
        ))
        or range_start_seconds < 0
        or range_end_seconds > source_duration_seconds + duration_tolerance
        or range_end_seconds - range_start_seconds
        < UPLOAD_SOURCE_RANGE_MIN_DURATION_SECONDS
        or range_end_seconds - range_start_seconds
        > UPLOAD_SOURCE_RANGE_MAX_DURATION_SECONDS
    ):
        raise IngestionError(
            "업로드 영상의 선택 구간은 4분에서 60분 사이여야 합니다.",
            code="upload_range_invalid",
        )
    return range_end_seconds - range_start_seconds


class BatchWorker:
    MAX_INLINE_INGESTION_ROUTES = 20
    INGESTION_ROUTE_WAIT_SECONDS = 30.0
    INGESTION_ROUTE_POLL_SECONDS = 1.0
    PROJECT_RENDER_ATTEMPTS = 2
    RENDER_SHARD_SIZE = 2

    def __init__(self, settings: Settings) -> None:
        settings.validate_runtime()
        settings.ensure_directories()
        self.settings = settings
        self.repository = WorkerRepository(str(settings.database_url), settings.aws_region)
        self.storage = ObjectStorage(str(settings.s3_bucket), settings.aws_region)
        self.transcriber = AudioTranscriber(settings)
        self.selector = TranscriptSelector(settings)
        self.comment_generator = CommentGenerator(settings)
        self.renderer = VideoRenderer(settings)
        self.editor_renderer = EditorDocumentRenderer(settings)
        self.queue = WorkQueue(settings.aws_region)

    def _project_worker_count(self) -> int:
        return max(
            1,
            min(4, self.settings.task_vcpus // max(1, self.settings.ffmpeg_threads)),
        )

    def _project_resource_tier(self) -> str:
        configured = os.getenv("PROJECT_RESOURCE_TIER", "").strip().lower()
        if configured in {
            "standard",
            "heavy",
            "source_range",
            "elevenlabs_transcription",
        }:
            return configured
        return "heavy" if self.settings.task_vcpus >= 8 else "standard"

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
    FINAL_CAPTION_MESSAGE = (
        "자막을 구성하는 중 오류가 발생했습니다.\n"
        "사용량은 다시 복구되었습니다."
    )
    FINAL_TRANSCRIPTION_MESSAGE = (
        "영상에서 사람의 목소리를 찾지 못해 쇼츠를 생성할 수 없습니다.\n"
        "사용량은 다시 복구되었습니다."
    )
    FINAL_RESTRICTED_CONTENT_MESSAGE = (
        "멤버십 전용 여부, 구매·대여 콘텐츠는 사용할 수 없습니다.\n"
        "사용량은 다시 복구되었습니다. 영상 확인 후 다시 시도해주세요."
    )
    RESTRICTED_CONTENT_ERROR_CODES = frozenset(
        {"youtube_members_only", "youtube_paid_content"}
    )

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
        start_seconds: float = 0.0,
        limit_audio: bool = False,
        policy: str = OPENAI_STABLE_POLICY,
        observation: dict[str, object] | None = None,
        words_out: list[TranscriptWord] | None = None,
        unavailable_ranges_out: list[tuple[float, float]] | None = None,
    ) -> list[SubtitleSegment]:
        try:
            result = (
                self.transcriber.transcribe(
                    source,
                    work_dir,
                    start_seconds=start_seconds,
                    duration_seconds=duration_seconds,
                    policy=policy,
                )
                if limit_audio
                else self.transcriber.transcribe(source, work_dir, policy=policy)
            )
        except TranscriptionError as exc:
            _log_event(
                "transcription_pipeline_observed",
                job_id=job_id,
                requested_policy=policy,
                provider=(
                    "elevenlabs"
                    if policy == ELEVENLABS_FALLBACK_POLICY
                    else "openai"
                ),
                model=(
                    self.settings.elevenlabs_transcribe_model
                    if policy == ELEVENLABS_FALLBACK_POLICY
                    else self.settings.openai_transcribe_model
                ),
                status="failed",
                error_type=type(exc).__name__,
            )
            raise
        _log_event(
            "transcription_pipeline_observed",
            job_id=job_id,
            requested_policy=result.requested_policy,
            provider=result.provider,
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
            transcript_coverage_ratio=self._transcript_coverage(
                _relative_source_transcript(
                    result.segments,
                    source_start_seconds=start_seconds,
                    duration_seconds=duration_seconds,
                ),
                duration_seconds,
            ),
            language_code=result.language_code,
            fallback_chunk_count=result.fallback_chunk_count,
            fallback_audio_seconds=result.fallback_audio_seconds,
            unavailable_range_count=len(result.unavailable_ranges),
        )
        if policy == ELEVENLABS_FALLBACK_POLICY:
            self.repository.save_job_transcript(
                job_id,
                requested_policy=result.requested_policy,
                provider_used=result.provider,
                model_used=result.model,
                language_code=result.language_code,
                language_probability=result.language_probability,
                fallback_reasons=list(result.fallback_reasons),
                source_offset_seconds=start_seconds,
                transcript_text=" ".join(segment.text for segment in result.segments),
                segments=[segment.model_dump() for segment in result.segments],
                words=[word.as_dict() for word in result.words],
            )
        if observation is not None:
            observation.update({
                "audioStartSeconds": round(start_seconds, 3),
                "audioDurationSeconds": round(duration_seconds, 3),
                "chunkCount": result.chunk_count,
                "silentChunkCount": result.silent_chunk_count,
                "skippedChunkCount": result.skipped_chunk_count,
                "failedChunkCount": result.failed_chunk_count,
                "provider": result.provider,
                "model": result.model,
                "languageCode": result.language_code,
                "wordCount": len(result.words),
                "fallbackChunkCount": result.fallback_chunk_count,
                "fallbackAudioSeconds": result.fallback_audio_seconds,
                "unavailableRangeCount": len(result.unavailable_ranges),
            })
        if words_out is not None:
            words_out.extend(result.words)
        if unavailable_ranges_out is not None:
            unavailable_ranges_out.extend(result.unavailable_ranges)
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

    def _borrow_uploaded_source(
        self,
        prepared_source: Path,
        work_dir: Path,
    ) -> tuple[Path, dict[str, object], float, int]:
        """Create a task-local snapshot while leaving receiver ownership intact.

        The receiver owns and deletes ``prepared_source`` and must keep it
        immutable until this call returns. The project worker only creates a
        fixed-name hard link beneath its private work directory, falling back
        to a byte-for-byte copy when the paths are on different filesystems.
        Project cleanup therefore never recursively touches the receiver path.
        """
        candidate = Path(prepared_source)
        if candidate.is_symlink():
            raise IngestionError(
                "업로드 원본 경로가 올바르지 않습니다.",
                code="upload_source_path_invalid",
            )
        try:
            resolved = candidate.resolve(strict=True)
            temp_root = Path(self.settings.temp_dir).resolve(strict=True)
            resolved.relative_to(temp_root)
            source_stat = resolved.stat()
        except (OSError, RuntimeError, ValueError):
            raise IngestionError(
                "업로드 원본 경로가 올바르지 않습니다.",
                code="upload_source_path_invalid",
            ) from None
        if not stat.S_ISREG(source_stat.st_mode):
            raise IngestionError(
                "업로드 원본은 일반 파일이어야 합니다.",
                code="upload_source_not_regular_file",
            )
        source_bytes = source_stat.st_size
        if source_bytes <= 0 or source_bytes > UPLOAD_SOURCE_MAX_BYTES:
            raise IngestionError(
                "업로드 원본 파일 크기가 허용된 범위를 벗어났습니다.",
                code="upload_source_size_invalid",
            )

        snapshot_dir = work_dir / "source"
        snapshot_dir.mkdir(parents=True, exist_ok=False)
        snapshot = snapshot_dir / "uploaded-source.media"
        try:
            os.link(resolved, snapshot, follow_symlinks=False)
        except OSError:
            shutil.copyfile(resolved, snapshot, follow_symlinks=False)
        snapshot_stat = snapshot.stat()
        if (
            not stat.S_ISREG(snapshot_stat.st_mode)
            or snapshot_stat.st_size != source_bytes
        ):
            raise IngestionError(
                "업로드 원본 파일을 안전하게 준비하지 못했습니다.",
                code="upload_source_snapshot_invalid",
            )

        source_probe = probe_media(snapshot)
        streams = source_probe.get("streams")
        if not isinstance(streams, list) or not any(
            isinstance(stream, dict) and stream.get("codec_type") == "video"
            for stream in streams
        ):
            raise IngestionError(
                "업로드 원본에서 영상 트랙을 찾지 못했습니다.",
                code="upload_source_video_missing",
            )
        if not any(
            isinstance(stream, dict) and stream.get("codec_type") == "audio"
            for stream in streams
        ):
            raise IngestionError(
                "업로드 원본에서 음성 트랙을 찾지 못했습니다.",
                code="upload_source_audio_missing",
            )
        return snapshot, source_probe, media_duration(source_probe), source_bytes

    def project(
        self,
        job_id: str,
        *,
        resume: bool = False,
        prepared_source: Path | None = None,
        expected_dispatch_generation: int | None = None,
    ) -> None:
        """Run one pipeline-v2 project inside a single Fargate task."""
        job = self.repository.get_job(job_id)
        if not job:
            raise KeyError(job_id)
        if int(job.get("pipeline_version") or 1) != 2:
            raise ValueError("project command requires pipeline_version=2")
        initial_render_v4 = verify_initial_render_v4_runtime(job) is not None
        dispatch_generation = int(job.get("project_dispatch_generation") or 0)
        if expected_dispatch_generation is None:
            raw_dispatch_generation = os.getenv("PROJECT_DISPATCH_GENERATION")
            expected_dispatch_generation = (
                int(raw_dispatch_generation)
                if raw_dispatch_generation is not None
                else dispatch_generation
            )
        claimed = self.repository.claim_project_run(
            job_id,
            resume=resume,
            expected_dispatch_generation=expected_dispatch_generation,
        )
        if not claimed:
            return

        started_at = time.monotonic()
        queue_delay_seconds = _render_queue_delay_seconds()
        resource_tier = self._project_resource_tier()
        project_worker_count = self._project_worker_count()
        self.repository.merge_job_performance_metrics(
            job_id,
            {
                "schemaVersion": 1,
                "batchQueueSeconds": queue_delay_seconds,
                "workerImageTag": os.getenv("WORKER_IMAGE_TAG"),
                "resourceTier": resource_tier,
                "taskVcpus": self.settings.task_vcpus,
                "ffmpeg": {
                    "cleanClipPreset": self.settings.clean_clip_preset,
                    "cleanClipCrf": self.settings.clean_clip_crf,
                    "cleanClipThreads": self.settings.ffmpeg_threads,
                    "renderWorkers": project_worker_count,
                    "outputWidth": 1080,
                    "outputHeight": 1920,
                    "outputFpsCap": 30,
                },
            },
        )
        _log_event(
            "project_run_started",
            job_id=job_id,
            resume=resume,
            batch_job_id=os.getenv("AWS_BATCH_JOB_ID"),
            queue_delay_seconds=queue_delay_seconds,
            resource_tier=resource_tier,
            task_vcpus=self.settings.task_vcpus,
            worker_count=project_worker_count,
        )
        if resume:
            render_summary = self._render_project_outputs(job_id)
            total_seconds = time.monotonic() - started_at
            self.repository.merge_job_performance_metrics(
                job_id,
                {
                    "render": render_summary,
                    "totalSeconds": round(total_seconds, 3),
                    "resumed": True,
                },
            )
            result = self.repository.finalize_project_job(job_id)
            _log_event(
                "project_run_finalized",
                job_id=job_id,
                resume=True,
                elapsed_seconds=round(total_seconds, 3),
                container_peak_memory_bytes=_container_memory_peak_bytes(),
                render_summary=render_summary,
                resource_tier=resource_tier,
                result=result,
            )
            return

        work_dir: Path | None = None
        source_type = str(job.get("source_type") or "youtube")
        is_uploaded_source = source_type == "upload"
        route_id = (
            None
            if is_uploaded_source
            else str(job.get("ingestion_route_id") or "").strip() or None
        )
        route_download_started = False
        preparation_finished = False
        try:
            work_dir = Path(tempfile.mkdtemp(
                prefix=f"project-{job_id}-",
                dir=self.settings.temp_dir,
            ))
            with self.heartbeat(job_id):
                if not self.settings.openai_api_key:
                    raise TranscriptionError(
                        "OPENAI_API_KEY가 없어 필수 전사를 시작할 수 없습니다."
                    )
                normalized_source_start_seconds = 0.0

                if is_uploaded_source:
                    if prepared_source is None:
                        raise IngestionError(
                            "업로드 원본 파일이 준비되지 않았습니다.",
                            code="upload_source_missing",
                        )
                    declared_source_duration_seconds = float(
                        job["source_duration_seconds"]
                    )
                    source_range_enabled = bool(
                        job.get("source_range_selection_enabled")
                    )
                    range_start_seconds = (
                        float(job["range_start_seconds"])
                        if source_range_enabled
                        and job.get("range_start_seconds") is not None
                        else None
                    )
                    range_end_seconds = (
                        float(job["range_end_seconds"])
                        if source_range_enabled
                        and job.get("range_end_seconds") is not None
                        else None
                    )
                    acquisition_started_at = time.monotonic()
                    with PhaseResourceMonitor(
                        self.settings.task_vcpus
                    ) as acquisition_resources:
                        (
                            source,
                            source_probe,
                            observed_duration_seconds,
                            source_bytes,
                        ) = self._borrow_uploaded_source(prepared_source, work_dir)
                    download_status = classify_full_source_download(
                        source_duration_seconds=declared_source_duration_seconds,
                        downloaded_duration_seconds=observed_duration_seconds,
                    )
                    observed_media_bytes = source_bytes
                    self.repository.record_source_download_observation(
                        job_id,
                        status=download_status,
                        duration_seconds=observed_duration_seconds,
                        media_bytes=observed_media_bytes,
                        normalized_source_start_seconds=normalized_source_start_seconds,
                    )
                    if download_status != "full_source_expected":
                        raise IngestionError(
                            "업로드한 원본 영상 길이가 확인된 정보와 일치하지 않습니다.",
                            code="upload_source_duration_mismatch",
                        )
                    source_duration_seconds = observed_duration_seconds
                    selected_duration_seconds = uploaded_project_source_window(
                        source_duration_seconds=source_duration_seconds,
                        declared_source_duration_seconds=(
                            declared_source_duration_seconds
                        ),
                        source_range_enabled=source_range_enabled,
                        range_start_seconds=range_start_seconds,
                        range_end_seconds=range_end_seconds,
                    )
                    acquisition_seconds = time.monotonic() - acquisition_started_at
                    job["normalized_source_start_seconds"] = (
                        normalized_source_start_seconds
                    )
                    _log_event(
                        "uploaded_source_observed",
                        job_id=job_id,
                        source_range_enabled=source_range_enabled,
                        source_duration_seconds=source_duration_seconds,
                        selected_duration_seconds=selected_duration_seconds,
                        media_bytes=observed_media_bytes,
                        status=download_status,
                    )
                    self.repository.merge_job_performance_metrics(
                        job_id,
                        {
                            "download": {
                                **acquisition_resources.metrics,
                                "sourceType": "upload",
                                "transfer": "receiver_snapshot",
                                "seconds": round(acquisition_seconds, 3),
                                "bytes": source_bytes,
                                "durationSeconds": round(source_duration_seconds, 3),
                                "rawBytes": observed_media_bytes,
                                "rawDurationSeconds": round(
                                    observed_duration_seconds,
                                    3,
                                ),
                                "normalizedSourceStartSeconds": (
                                    normalized_source_start_seconds
                                ),
                                "selectedStartSeconds": range_start_seconds,
                                "selectedEndSeconds": range_end_seconds,
                                "selectedDurationSeconds": round(
                                    selected_duration_seconds,
                                    3,
                                ),
                                "status": download_status,
                            }
                        },
                    )
                else:
                    if prepared_source is not None:
                        raise IngestionError(
                            "링크 프로젝트에는 업로드 원본 경로를 사용할 수 없습니다.",
                            code="upload_source_not_allowed",
                        )
                    if not route_id:
                        raise IngestionError(
                            "프로젝트에 원본 다운로드 경로가 할당되지 않았습니다.",
                            code="ingestion_route_missing",
                        )
                    source_duration_seconds = float(job["source_duration_seconds"])
                    source_range_enabled = bool(
                        job.get("source_range_selection_enabled")
                    )
                    range_start_seconds = (
                        float(job["range_start_seconds"])
                        if source_range_enabled
                        and job.get("range_start_seconds") is not None
                        else None
                    )
                    range_end_seconds = (
                        float(job["range_end_seconds"])
                        if source_range_enabled
                        and job.get("range_end_seconds") is not None
                        else None
                    )
                    selected_duration_seconds = project_source_window(
                        source_duration_seconds=source_duration_seconds,
                        source_range_enabled=source_range_enabled,
                        range_start_seconds=range_start_seconds,
                        range_end_seconds=range_end_seconds,
                        max_source_duration_seconds=(
                            self.settings.max_video_duration_seconds
                        ),
                    )
                    route_download_started = True
                    download_started_at = time.monotonic()
                    with PhaseResourceMonitor(
                        self.settings.task_vcpus
                    ) as download_resources:
                        bundle, successful_route_id = (
                            self._download_with_inline_route_rotation(
                                job_id=job_id,
                                job_attempt=int(claimed["attempt_count"]),
                                youtube_url=str(job["youtube_url"]),
                                destination=work_dir / "source",
                                initial_route_id=route_id,
                                expected_dispatch_generation=(
                                    expected_dispatch_generation
                                ),
                            )
                        )
                        source = bundle.video_path
                        source_probe = probe_media(source)
                        downloaded_duration_seconds = media_duration(source_probe)
                    self.repository.record_ingestion_result(
                        job_id,
                        "success",
                        route_id=successful_route_id,
                        egress_class=(
                            self.ingestion.egress_class_for(successful_route_id)
                            if successful_route_id else None
                        ),
                        job_attempt=int(claimed["attempt_count"]),
                    )
                    download_seconds = time.monotonic() - download_started_at
                    source_bytes = source.stat().st_size
                    download_status = classify_full_source_download(
                        source_duration_seconds=source_duration_seconds,
                        downloaded_duration_seconds=downloaded_duration_seconds,
                    )
                    observed_duration_seconds = downloaded_duration_seconds
                    observed_media_bytes = source_bytes or None
                    self.repository.record_source_download_observation(
                        job_id,
                        status=download_status,
                        duration_seconds=observed_duration_seconds,
                        media_bytes=observed_media_bytes,
                        normalized_source_start_seconds=(
                            normalized_source_start_seconds
                        ),
                    )
                    job["normalized_source_start_seconds"] = (
                        normalized_source_start_seconds
                    )
                    _log_event(
                        "source_download_observed",
                        job_id=job_id,
                        source_range_enabled=source_range_enabled,
                        source_duration_seconds=source_duration_seconds,
                        selected_duration_seconds=selected_duration_seconds,
                        normalized_duration_seconds=downloaded_duration_seconds,
                        raw_duration_seconds=observed_duration_seconds,
                        raw_media_bytes=observed_media_bytes,
                        status=download_status,
                    )
                    if (
                        bundle.metadata.video_id != job["youtube_video_id"]
                        or bundle.metadata.duration_seconds
                        > self.settings.max_video_duration_seconds
                        or download_status != "full_source_expected"
                    ):
                        raise IngestionError(
                            "다운로드한 원본 영상의 검증에 실패했습니다.",
                            code="ingestion_source_validation_failed",
                        )
                    self.repository.merge_job_performance_metrics(
                        job_id,
                        {
                            "download": {
                                **download_resources.metrics,
                                "seconds": round(download_seconds, 3),
                                "bytes": source_bytes,
                                "durationSeconds": round(
                                    downloaded_duration_seconds,
                                    3,
                                ),
                                "rawBytes": observed_media_bytes,
                                "rawDurationSeconds": round(
                                    observed_duration_seconds,
                                    3,
                                ),
                                "normalizedSourceStartSeconds": (
                                    normalized_source_start_seconds
                                ),
                                "selectedStartSeconds": range_start_seconds,
                                "selectedEndSeconds": range_end_seconds,
                                "selectedDurationSeconds": round(
                                    selected_duration_seconds,
                                    3,
                                ),
                                "status": download_status,
                            }
                        },
                    )

                self.repository.stage(job_id, "transcribing", 28, "영상 내용을 분석하고 있습니다.")
                transcription_started_at = time.monotonic()
                transcription_observation: dict[str, object] = {}
                unified_template_subtitle = _unified_template_subtitle(job)
                stored_subtitle_template_id = str(
                    job.get("subtitle_template_id") or ""
                )
                subtitle_template_id = (
                    unified_template_subtitle.variant
                    if unified_template_subtitle is not None
                    else stored_subtitle_template_id
                )
                subtitle_template_enabled = (
                    unified_template_subtitle.visible
                    if unified_template_subtitle is not None
                    else bool(stored_subtitle_template_id)
                )
                transcript_words: list[TranscriptWord] = []
                transcription_unavailable_ranges: list[tuple[float, float]] = []
                if (
                    subtitle_template_id
                    and str(job.get("transcription_policy") or "")
                    != ELEVENLABS_FALLBACK_POLICY
                ):
                    raise TranscriptionError(
                        "자막 템플릿 작업에 단어 타임스탬프 전사 정책이 고정되지 않았습니다."
                    )
                with PhaseResourceMonitor(self.settings.task_vcpus) as transcription_resources:
                    transcript = self._transcribe_source(
                        job_id=job_id,
                        source=source,
                        work_dir=work_dir,
                        duration_seconds=selected_duration_seconds,
                        start_seconds=(float(range_start_seconds) if source_range_enabled else 0.0),
                        limit_audio=source_range_enabled,
                        policy=str(
                            job.get("transcription_policy") or OPENAI_STABLE_POLICY
                        ),
                        observation=transcription_observation,
                        words_out=(transcript_words if subtitle_template_id else None),
                        unavailable_ranges_out=(
                            transcription_unavailable_ranges
                            if subtitle_template_id
                            else None
                        ),
                    )
                source_offset_seconds = (
                    float(range_start_seconds) if source_range_enabled else 0.0
                )
                source_window_end_seconds = (
                    source_offset_seconds + selected_duration_seconds
                )
                selection_transcript = _relative_source_transcript(
                    transcript,
                    source_start_seconds=source_offset_seconds,
                    duration_seconds=selected_duration_seconds,
                )
                if subtitle_template_id and not transcript_words:
                    raise TranscriptionError(
                        "자막 템플릿에 필요한 단어 타임스탬프가 비어 있습니다."
                    )
                transcription_seconds = time.monotonic() - transcription_started_at
                self.repository.merge_job_performance_metrics(
                    job_id,
                    {
                        "transcription": {
                            **transcription_resources.metrics,
                            **transcription_observation,
                            "seconds": round(transcription_seconds, 3),
                            "segmentCount": len(transcript),
                        }
                    },
                )
                self.repository.stage(job_id, "selecting", 42, "쇼츠로 만들 장면을 찾고 있습니다.")
                target_count = int(job["planned_short_count"])
                required_minimum_count = minimum_clip_count(target_count)
                selection_started_at = time.monotonic()
                with PhaseResourceMonitor(self.settings.task_vcpus) as selection_resources:
                    clips = self.selector.select(
                        video_title=str(job["video_title"]),
                        duration_seconds=selected_duration_seconds,
                        transcript=selection_transcript,
                        required_count=target_count,
                        output_language=OutputLanguage(str(job["output_language"])),
                    )[:target_count]
                for clip in clips:
                    _validate_clip_in_source_window(
                        _offset_highlight_clip(clip, source_offset_seconds),
                        source_start_seconds=source_offset_seconds,
                        source_end_seconds=source_window_end_seconds,
                    )
                selection_seconds = time.monotonic() - selection_started_at
                self.repository.merge_job_performance_metrics(
                    job_id,
                    {
                        "selection": {
                            **selection_resources.metrics,
                            "seconds": round(selection_seconds, 3),
                            "selectedCount": len(clips),
                            "targetCount": target_count,
                            "minimumCount": required_minimum_count,
                        }
                    },
                )
                caption_render_specs: dict[int, dict[str, object]] = {}
                caption_editor_sources: dict[int, dict[str, object]] = {}
                subtitle_template_snapshot = job.get("subtitle_template_snapshot")
                caption_timing_lead_frames = (
                    _subtitle_template_timing_lead_frames(
                        subtitle_template_snapshot,
                    )
                    if subtitle_template_id
                    else CAPTION_STABLE_TIMING_LEAD_FRAMES
                )
                if subtitle_template_id:
                    aspect_ratio = VideoAspectRatio(
                        str(job.get("video_aspect_ratio") or "1:1")
                    )
                    caption_placement = (
                        str(subtitle_template_snapshot.get("captionPlacement") or "lower")
                        if isinstance(subtitle_template_snapshot, dict)
                        else "lower"
                    )
                    snapshot_font = (
                        subtitle_template_snapshot.get("font")
                        if isinstance(subtitle_template_snapshot, dict)
                        else None
                    )
                    caption_font_id = (
                        snapshot_font.get("id")
                        if isinstance(snapshot_font, dict)
                        else None
                    )
                    compiled_clips: list[tuple[HighlightClip, dict[str, object]]] = []
                    rejected_caption_clips = 0
                    for original_index, clip in enumerate(clips, start=1):
                        absolute_clip = _offset_highlight_clip(
                            clip,
                            source_offset_seconds,
                        )
                        if any(
                            unavailable_end > absolute_clip.start_seconds
                            and unavailable_start < absolute_clip.end_seconds
                            for unavailable_start, unavailable_end
                            in transcription_unavailable_ranges
                        ):
                            rejected_caption_clips += 1
                            _log_event(
                                "project_caption_clip_rejected",
                                job_id=job_id,
                                clip_index=original_index,
                                error_type="TranscriptionRangeUnavailable",
                            )
                            continue
                        try:
                            caption_spec = compile_caption_render_spec(
                                transcript_words,
                                template_id=subtitle_template_id,
                                clip_start=absolute_clip.start_seconds,
                                clip_end=absolute_clip.end_seconds,
                                video_aspect_ratio=aspect_ratio,
                                caption_placement=caption_placement,
                                accent_color=(
                                    unified_template_subtitle.accent_color
                                    if unified_template_subtitle is not None
                                    else _preset_brand_color(job) or CAPTION_ACCENT
                                ),
                                font_id=(
                                    unified_template_subtitle.font_id
                                    if unified_template_subtitle is not None
                                    else caption_font_id
                                ),
                                timing_lead_frames=caption_timing_lead_frames,
                                schema_version=4 if initial_render_v4 else 3,
                                **_caption_compile_options(
                                    unified_template_subtitle
                                ),
                            )
                        except (
                            CaptionCompileError,
                            RenderError,
                            TranscriptionError,
                        ) as exc:
                            rejected_caption_clips += 1
                            _log_event(
                                "project_caption_clip_rejected",
                                job_id=job_id,
                                clip_index=original_index,
                                error_type=type(exc).__name__,
                            )
                            continue
                        compiled_clips.append((clip, caption_spec))
                    if len(compiled_clips) < required_minimum_count:
                        raise TranscriptionError(
                            "자막을 만들 수 있는 음성 구간이 부족합니다."
                        )
                    clips = [clip for clip, _spec in compiled_clips]
                    caption_render_specs = {
                        index: spec
                        for index, (_clip, spec) in enumerate(compiled_clips, start=1)
                    }
                    self.repository.merge_job_performance_metrics(
                        job_id,
                        {
                            "captionValidation": {
                                "acceptedCount": len(compiled_clips),
                                "rejectedCount": rejected_caption_clips,
                                "minimumCount": required_minimum_count,
                            }
                        },
                    )
                clip_subtitles = {
                    index: self._relative_subtitles(selection_transcript, clip)
                    for index, clip in enumerate(clips, start=1)
                }
                edit_timeline_clips = {
                    index: edit_timeline_clip(clip, selected_duration_seconds)
                    for index, clip in enumerate(clips, start=1)
                } if (
                    getattr(self.settings, "edit_timeline_capture_enabled", False)
                ) else {}
                if subtitle_template_id and edit_timeline_clips:
                    aspect_ratio = VideoAspectRatio(
                        str(job.get("video_aspect_ratio") or "1:1")
                    )
                    caption_placement = (
                        str(subtitle_template_snapshot.get("captionPlacement") or "lower")
                        if isinstance(subtitle_template_snapshot, dict)
                        else "lower"
                    )
                    snapshot_font = (
                        subtitle_template_snapshot.get("font")
                        if isinstance(subtitle_template_snapshot, dict)
                        else None
                    )
                    caption_font_id = (
                        snapshot_font.get("id")
                        if isinstance(snapshot_font, dict)
                        else None
                    )
                    unavailable_timeline_indexes: list[int] = []
                    for index, timeline_clip in edit_timeline_clips.items():
                        absolute_timeline_clip = _offset_highlight_clip(
                            timeline_clip,
                            source_offset_seconds,
                        )
                        try:
                            timeline_spec = compile_caption_render_spec(
                                transcript_words,
                                template_id=subtitle_template_id,
                                clip_start=absolute_timeline_clip.start_seconds,
                                clip_end=absolute_timeline_clip.end_seconds,
                                video_aspect_ratio=aspect_ratio,
                                caption_placement=caption_placement,
                                accent_color=(
                                    unified_template_subtitle.accent_color
                                    if unified_template_subtitle is not None
                                    else _preset_brand_color(job) or CAPTION_ACCENT
                                ),
                                font_id=(
                                    unified_template_subtitle.font_id
                                    if unified_template_subtitle is not None
                                    else caption_font_id
                                ),
                                timing_lead_frames=caption_timing_lead_frames,
                                schema_version=4 if initial_render_v4 else 3,
                                **_caption_compile_options(
                                    unified_template_subtitle
                                ),
                            )
                            if initial_render_v4:
                                selected_clip = _offset_highlight_clip(
                                    clips[index - 1],
                                    source_offset_seconds,
                                )
                                # The padded timeline is the one canonical word
                                # source.  Derive the first-render selection from
                                # it with the same projector used by a no-op edit;
                                # never compile two competing v4 geometries.
                                caption_render_specs[index] = (
                                    project_caption_render_spec_v4(
                                        timeline_spec,
                                        clip_start_seconds=round(
                                            selected_clip.start_seconds
                                            - absolute_timeline_clip.start_seconds,
                                            3,
                                        ),
                                        clip_end_seconds=round(
                                            selected_clip.end_seconds
                                            - absolute_timeline_clip.start_seconds,
                                            3,
                                        ),
                                    )
                                )
                        except (
                            CaptionCompileError,
                            RenderError,
                            TranscriptionError,
                        ) as exc:
                            unavailable_timeline_indexes.append(index)
                            _log_event(
                                "caption_edit_timeline_rejected",
                                job_id=job_id,
                                clip_index=index,
                                error_type=type(exc).__name__,
                            )
                            continue
                        caption_editor_sources[index] = {
                            "timelineStartSeconds": round(
                                absolute_timeline_clip.start_seconds,
                                3,
                            ),
                            "timelineEndSeconds": round(
                                absolute_timeline_clip.end_seconds,
                                3,
                            ),
                            "spec": timeline_spec,
                        }
                    for index in unavailable_timeline_indexes:
                        edit_timeline_clips.pop(index, None)
                edit_timeline_subtitles = {
                    index: self._relative_subtitles(selection_transcript, timeline_clip)
                    for index, timeline_clip in edit_timeline_clips.items()
                }
                comments_by_clip: dict[int, list[dict[str, object]]] = {
                    index: [] for index in clip_subtitles
                }
                if str(job.get("template_id")) == TemplateId.COMMENT_CAPTURE.value and clips:
                    comment_inputs = [
                        CommentClipInput(
                            clip_index=index,
                            hook_title=clip.hook_title,
                            reason=clip.reason,
                            duration_seconds=clip.end_seconds - clip.start_seconds,
                            transcript=clip_subtitles[index],
                        )
                        for index, clip in enumerate(clips, start=1)
                    ]
                    comment_started_at = time.monotonic()
                    used_comment_fallback = False
                    with PhaseResourceMonitor(self.settings.task_vcpus) as comment_resources:
                        try:
                            comments_by_clip = self.comment_generator.generate(comment_inputs)
                        except Exception as exc:
                            used_comment_fallback = True
                            _log_event(
                                "comment_generation_unexpected_fallback",
                                job_id=job_id,
                                error_type=type(exc).__name__,
                            )
                            comments_by_clip = {
                                item.clip_index: fallback_comment_overlays(
                                    item.duration_seconds,
                                    count=item.target_count,
                                    clip_index=item.clip_index,
                                )
                                for item in comment_inputs
                            }
                    self.repository.merge_job_performance_metrics(
                        job_id,
                        {
                            "commentGeneration": {
                                **comment_resources.metrics,
                                "seconds": round(time.monotonic() - comment_started_at, 3),
                                "clipCount": len(comment_inputs),
                                "commentCount": sum(
                                    len(comments) for comments in comments_by_clip.values()
                                ),
                                "fallback": used_comment_fallback,
                            }
                        },
                    )

                absolute_clips = {
                    index: _validate_clip_in_source_window(
                        _offset_highlight_clip(clip, source_offset_seconds),
                        source_start_seconds=source_offset_seconds,
                        source_end_seconds=source_window_end_seconds,
                    )
                    for index, clip in enumerate(clips, start=1)
                }
                absolute_timeline_clips = {
                    index: _validate_clip_in_source_window(
                        _offset_highlight_clip(clip, source_offset_seconds),
                        source_start_seconds=source_offset_seconds,
                        source_end_seconds=source_window_end_seconds,
                    )
                    for index, clip in edit_timeline_clips.items()
                }

                for index in range(1, len(clips) + 1):
                    self.repository.set_project_attempt_selected(job_id, index)
                selection_shortfall = self.repository.fail_unselected_project_attempts(job_id)
                completed_extractions = selection_shortfall
                self.repository.stage(
                    job_id,
                    "extracting",
                    45 + round(15 * completed_extractions / max(1, target_count)),
                    f"쇼츠 영상을 준비하고 있습니다. ({completed_extractions}/{target_count})",
                    completed_count=completed_extractions,
                    total_count=target_count,
                )
                local_clean_paths: dict[str, Path] = {}
                clean_results: list[dict[str, object]] = []
                timeline_targets: list[ProjectTimelineTarget] = []
                extraction_failures = 0
                with PhaseResourceMonitor(self.settings.task_vcpus) as extraction_resources:
                    with ThreadPoolExecutor(
                        max_workers=project_worker_count,
                        thread_name_prefix="project-extract",
                    ) as executor:
                        futures = {
                            executor.submit(
                                self._prepare_project_clip,
                                job_id=job_id,
                                job=job,
                                source=source,
                                source_probe=source_probe,
                                work_dir=work_dir,
                                slot_index=index,
                                clip=absolute_clips[index],
                                subtitles=clip_subtitles[index],
                                comments=comments_by_clip.get(index, []),
                                caption_render_spec=caption_render_specs.get(index),
                                caption_enabled=subtitle_template_enabled,
                            ): index
                            for index, _clip in enumerate(clips, start=1)
                        }
                        for future in as_completed(futures):
                            index = futures[future]
                            prepared = future.result()
                            if prepared:
                                short_id, clean_path, clean_metrics = prepared
                                local_clean_paths[short_id] = clean_path
                                clean_results.append(clean_metrics)
                                if timeline_clip := absolute_timeline_clips.get(index):
                                    timeline_targets.append(ProjectTimelineTarget(
                                        short_id=short_id,
                                        slot_index=index,
                                        clip=timeline_clip,
                                        subtitles=edit_timeline_subtitles.get(index, []),
                                        caption_editor_source=(
                                            caption_editor_sources.get(index)
                                        ),
                                    ))
                            else:
                                extraction_failures += 1
                            completed_extractions += 1
                            self.repository.stage(
                                job_id,
                                "extracting",
                                45 + round(
                                    15 * completed_extractions / max(1, target_count)
                                ),
                                (
                                    "쇼츠 영상을 준비하고 있습니다. "
                                    f"({completed_extractions}/{target_count})"
                                ),
                                completed_count=completed_extractions,
                                total_count=target_count,
                            )

                clean_clip_seconds = sum(
                    float(item.get("clipDurationSeconds") or 0) for item in clean_results
                )
                clean_clip_bytes = sum(
                    int(clean.get("fileBytes") or 0)
                    for item in clean_results
                    if isinstance((clean := item.get("clean")), dict)
                )
                extraction_summary = {
                    **extraction_resources.metrics,
                    "selectedCount": len(clips),
                    "succeededCount": len(clean_results),
                    "failedCount": extraction_failures + selection_shortfall,
                    "workers": project_worker_count,
                    "ffmpegThreads": self.settings.ffmpeg_threads,
                    "preset": self.settings.clean_clip_preset,
                    "crf": self.settings.clean_clip_crf,
                    "clipDurationSeconds": round(clean_clip_seconds, 3),
                    "outputBytes": clean_clip_bytes,
                    "bytesPerSecond": round(clean_clip_bytes / clean_clip_seconds, 3)
                    if clean_clip_seconds
                    else None,
                }
                self.repository.merge_job_performance_metrics(
                    job_id,
                    {
                        "extraction": extraction_summary,
                        "preparationSeconds": round(time.monotonic() - started_at, 3),
                    },
                )
                _log_event("project_extraction_observed", job_id=job_id, **extraction_summary)

                if not self.repository.mark_project_preparation_finished(job_id):
                    raise RuntimeError("프로젝트 준비 체크포인트를 저장하지 못했습니다.")
                preparation_finished = True
                render_summary = self._render_project_outputs(job_id, local_clean_paths)
                total_seconds = time.monotonic() - started_at
                self.repository.merge_job_performance_metrics(
                    job_id,
                    {
                        "render": render_summary,
                        "totalSeconds": round(total_seconds, 3),
                        "containerPeakMemoryBytes": _container_memory_peak_bytes(),
                    },
                )
                result = self.repository.finalize_project_job(job_id)
                _log_event(
                    "project_run_finalized",
                    job_id=job_id,
                    resume=False,
                    elapsed_seconds=round(total_seconds, 3),
                    container_peak_memory_bytes=_container_memory_peak_bytes(),
                    extraction_summary=extraction_summary,
                    render_summary=render_summary,
                    resource_tier=resource_tier,
                    result=result,
                )
                if (
                    result
                    and result.get("final_status") == "completed"
                    and timeline_targets
                ):
                    timeline_summary = self._capture_project_timelines(
                        job_id=job_id,
                        job=job,
                        source=source,
                        source_probe=source_probe,
                        work_dir=work_dir,
                        targets=timeline_targets,
                    )
                    batch_total_seconds = time.monotonic() - started_at
                    self.repository.merge_job_performance_metrics(
                        job_id,
                        {
                            "timelinePostprocessing": timeline_summary,
                            "batchTotalSeconds": round(batch_total_seconds, 3),
                            "containerPeakMemoryBytes": _container_memory_peak_bytes(),
                        },
                    )
                    _log_event(
                        "project_timeline_postprocessing_finished",
                        job_id=job_id,
                        elapsed_seconds=round(batch_total_seconds, 3),
                        **timeline_summary,
                    )
        except ProjectDeferredForIngestionRoute as exc:
            _log_event(
                "project_ingestion_route_deferred",
                job_id=job_id,
                action=exc.action,
                dispatch_generation=expected_dispatch_generation,
                resource_tier=resource_tier,
            )
            return
        except Exception as exc:
            error_code = (
                exc.code if isinstance(exc, IngestionError) else type(exc).__name__
            )
            if error_code in self.RESTRICTED_CONTENT_ERROR_CODES:
                error_message = self.FINAL_RESTRICTED_CONTENT_MESSAGE
            elif isinstance(exc, CaptionCompileError):
                error_message = self.FINAL_CAPTION_MESSAGE
            elif isinstance(exc, TranscriptionError):
                error_message = self.FINAL_TRANSCRIPTION_MESSAGE
            else:
                error_message = str(exc)
            _log_event(
                "project_run_failed",
                job_id=job_id,
                resume=False,
                preparation_finished=preparation_finished,
                error_type=type(exc).__name__,
                error_code=error_code,
                resource_tier=resource_tier,
                container_peak_memory_bytes=_container_memory_peak_bytes(),
            )
            if not preparation_finished:
                self._cleanup_initial_objects(job)
            self.repository.fail_open_project_attempts(
                job_id,
                stage="project",
                code=error_code,
                message=error_message,
            )
            self.repository.finalize_project_job(
                job_id,
                error_code=error_code,
                error_message=error_message,
            )
        finally:
            if route_id and not route_download_started:
                try:
                    self.repository.release_ingestion_route(
                        job_id,route_id,result="terminal",cooldown_seconds=0
                    )
                except Exception:
                    pass
            if work_dir is not None:
                if is_uploaded_source and prepared_source is not None:
                    cleanup_uploaded_project_workspace(work_dir)
                shutil.rmtree(work_dir, ignore_errors=True)

    def _prepare_project_clip(
        self,
        *,
        job_id: str,
        job: dict[str, object],
        source: Path,
        source_probe: dict[str, object],
        work_dir: Path,
        slot_index: int,
        clip: HighlightClip,
        subtitles: list[SubtitleSegment],
        comments: list[dict[str, object]],
        caption_render_spec: dict[str, object] | None = None,
        caption_enabled: bool | None = None,
    ) -> tuple[str, Path, dict[str, object]] | None:
        started_at = time.monotonic()
        short_id = str(uuid4())
        clean_path = work_dir / "clean" / f"{short_id}.mp4"
        clean_path.parent.mkdir(parents=True, exist_ok=True)
        clean_key: str | None = None
        clean_metrics: dict[str, object] = {}
        source_offset_seconds = float(job.get("normalized_source_start_seconds") or 0.0)
        initial_v4 = initial_render_v4_opt_in(job)
        visible_caption_spec = (
            caption_render_spec if caption_enabled is not False else None
        )
        initial_title_text_styles = (
            _initial_title_text_styles(
                job,
                title=clip.hook_title,
                caption_render_spec=visible_caption_spec,
            )
            if initial_v4
            else None
        )
        initial_render_spec = (
            compile_initial_editor_render_spec_v4(
                title=clip.hook_title,
                template_id=str(job["template_id"]),
                video_aspect_ratio=str(job.get("video_aspect_ratio") or "1:1"),
                font_scale=1,
                title_text_styles=initial_title_text_styles,
                custom_template_config=_custom_template_config(job),
                comments=comments,
                caption_render_spec=visible_caption_spec,
                channel_visible=bool(str(job.get("channel_name") or "").strip()),
                custom_template_id=str(job.get("custom_template_id") or "") or None,
                duration_seconds=clip.end_seconds - clip.start_seconds,
            )
            if initial_v4
            else None
        )
        try:
            self.renderer.extract_clean_clip(
                source_path=source,
                output_path=clean_path,
                clip=clip,
                work_dir=work_dir / "extract" / short_id,
                video_aspect_ratio=VideoAspectRatio(
                    str(job.get("video_aspect_ratio") or "1:1")
                ),
                source_probe=source_probe,
                metrics_callback=clean_metrics.update,
            )
            upload_started_at = time.monotonic()
            prefix = f"{job['mvp_session_id']}/{job_id}/{short_id}"
            clean_key = f"edit-sources/{prefix}.mp4"
            uploaded_size = self.storage.upload(clean_path, clean_key, "video/mp4")
            upload_seconds = time.monotonic() - upload_started_at
            inserted = self.repository.add_pending_short(
                short_id=short_id,
                job=job,
                clip_index=slot_index,
                start_seconds=float(_absolute_source_second(
                    clip.start_seconds, source_offset_seconds
                )),
                end_seconds=float(_absolute_source_second(
                    clip.end_seconds, source_offset_seconds
                )),
                hook_title=clip.hook_title,
                highlight_reason=clip.reason,
                selection_raw_start_seconds=_absolute_source_second(
                    clip.selection_raw_start_seconds, source_offset_seconds
                ),
                selection_raw_end_seconds=_absolute_source_second(
                    clip.selection_raw_end_seconds, source_offset_seconds
                ),
                selection_raw_duration_seconds=clip.selection_raw_duration_seconds,
                selection_candidate_index=clip.selection_candidate_index,
                selection_provider=clip.selection_provider,
                selection_model=clip.selection_model,
                selection_length_adjustment=clip.selection_length_adjustment,
                selection_repositioned=clip.selection_repositioned,
                viral_score=clip.viral_score,
                subtitles=[item.model_dump() for item in subtitles],
                comment_overlays=comments,
                clean_key=clean_key,
                timeline_key=None,
                timeline_start_seconds=None,
                timeline_end_seconds=None,
                timeline_subtitles=None,
                retention_days=int(job["retention_days"]),
                shard_index=0,
                caption_render_spec=caption_render_spec,
                initial_render_spec=initial_render_spec,
                title_text_styles=(
                    [
                        style.model_dump(by_alias=True, exclude_none=True)
                        for style in initial_title_text_styles
                    ]
                    if initial_title_text_styles is not None
                    else None
                ),
                title_text_styles_initialized=initial_v4,
                subtitles_enabled=caption_enabled,
            )
            if not inserted:
                raise RuntimeError("작업 제한 시간이 종료되었습니다.")
            total_seconds = time.monotonic() - started_at
            metrics = {
                "clipDurationSeconds": round(clip.end_seconds - clip.start_seconds, 3),
                "commentCount": len(comments),
                "clean": {
                    **clean_metrics,
                    "uploadSeconds": round(upload_seconds, 3),
                    "fileBytes": uploaded_size,
                    "totalSeconds": round(total_seconds, 3),
                },
            }
            self.repository.merge_project_attempt_performance_metrics(
                job_id,
                slot_index,
                metrics,
            )
            _log_event(
                "clean_clip_succeeded",
                job_id=job_id,
                short_id=short_id,
                slot_index=slot_index,
                clip_duration_seconds=round(clip.end_seconds - clip.start_seconds, 3),
                elapsed_seconds=round(total_seconds, 3),
                ffmpeg_seconds=clean_metrics.get("ffmpegSeconds"),
                upload_seconds=round(upload_seconds, 3),
                clean_clip_bytes=uploaded_size,
                clean_clip_bytes_per_second=round(
                    uploaded_size / max(0.001, clip.end_seconds - clip.start_seconds),
                    3,
                ),
                clean_clip_preset=self.settings.clean_clip_preset,
                clean_clip_crf=self.settings.clean_clip_crf,
            )
            return short_id, clean_path, metrics
        except Exception as exc:
            if clean_key:
                try:
                    self.storage.delete(clean_key)
                except Exception:
                    pass
            self.repository.fail_project_attempt(
                job_id,
                slot_index,
                stage="extraction",
                code=type(exc).__name__,
                message=str(exc),
            )
            self.repository.merge_project_attempt_performance_metrics(
                job_id,
                slot_index,
                {
                    "clipDurationSeconds": round(clip.end_seconds - clip.start_seconds, 3),
                    "commentCount": len(comments),
                    "clean": {
                        **clean_metrics,
                        "totalSeconds": round(time.monotonic() - started_at, 3),
                        "failed": True,
                    },
                },
            )
            _log_event(
                "project_output_failed",
                job_id=job_id,
                slot_index=slot_index,
                failure_stage="extraction",
                error_type=type(exc).__name__,
            )
            return None

    def _capture_project_timelines(
        self,
        *,
        job_id: str,
        job: dict[str, object],
        source: Path,
        source_probe: dict[str, object],
        work_dir: Path,
        targets: list[ProjectTimelineTarget],
    ) -> dict[str, object]:
        started_at = time.monotonic()
        project_worker_count = self._project_worker_count()
        results: list[dict[str, object]] = []
        failed_count = 0
        with PhaseResourceMonitor(self.settings.task_vcpus) as resources:
            with ThreadPoolExecutor(
                max_workers=project_worker_count,
                thread_name_prefix="project-timeline",
            ) as executor:
                futures = [
                    executor.submit(
                        self._capture_project_timeline,
                        job_id=job_id,
                        job=job,
                        source=source,
                        source_probe=source_probe,
                        work_dir=work_dir,
                        target=target,
                    )
                    for target in targets
                ]
                for future in as_completed(futures):
                    try:
                        results.append(future.result())
                    except Exception as exc:
                        failed_count += 1
                        _log_event(
                            "edit_timeline_capture_failed",
                            job_id=job_id,
                            error_type=type(exc).__name__,
                            failure_scope="unexpected_postprocessing",
                        )
        ready = [item for item in results if item.get("status") == "ready"]
        return {
            **resources.metrics,
            "wallSeconds": round(time.monotonic() - started_at, 3),
            "requestedCount": len(targets),
            "succeededCount": len(ready),
            "skippedCount": sum(
                item.get("status") == "skipped" for item in results
            ),
            "failedCount": failed_count + sum(
                item.get("status") == "failed" for item in results
            ),
            "workers": project_worker_count,
            "ffmpegThreads": self.settings.ffmpeg_threads,
            "ffmpegSeconds": round(sum(
                float(item.get("ffmpegSeconds") or 0) for item in ready
            ), 3),
            "outputBytes": sum(
                int(item.get("fileBytes") or 0) for item in ready
            ),
        }

    def _capture_project_timeline(
        self,
        *,
        job_id: str,
        job: dict[str, object],
        source: Path,
        source_probe: dict[str, object],
        work_dir: Path,
        target: ProjectTimelineTarget,
    ) -> dict[str, object]:
        if not self.repository.project_timeline_needed(target.short_id):
            return {"status": "skipped"}

        timeline_path = work_dir / "timelines" / f"{target.short_id}.mp4"
        timeline_path.parent.mkdir(parents=True, exist_ok=True)
        timeline_key = (
            f"edit-sources/{job['mvp_session_id']}/{job_id}/"
            f"{target.short_id}/timeline-v1.mp4"
        )
        started_at = time.monotonic()
        last_error: Exception | None = None
        for attempt in range(1, 3):
            timeline_metrics: dict[str, object] = {}
            try:
                self.renderer.extract_clean_clip(
                    source_path=source,
                    output_path=timeline_path,
                    clip=target.clip,
                    work_dir=(
                        work_dir
                        / "timeline-extract"
                        / target.short_id
                        / f"attempt-{attempt}"
                    ),
                    video_aspect_ratio=VideoAspectRatio(
                        str(job.get("video_aspect_ratio") or "1:1")
                    ),
                    source_probe=source_probe,
                    metrics_callback=timeline_metrics.update,
                )
                upload_started_at = time.monotonic()
                timeline_size = self.storage.upload(
                    timeline_path,
                    timeline_key,
                    "video/mp4",
                )
                upload_seconds = time.monotonic() - upload_started_at
            except Exception as exc:
                last_error = exc
                _log_event(
                    "edit_timeline_capture_retrying"
                    if attempt == 1
                    else "edit_timeline_capture_failed",
                    job_id=job_id,
                    short_id=target.short_id,
                    slot_index=target.slot_index,
                    attempt=attempt,
                    error_type=type(exc).__name__,
                )
                continue

            try:
                committed = self.repository.complete_project_timeline(
                    short_id=target.short_id,
                    timeline_key=timeline_key,
                    timeline_start_seconds=float(_absolute_source_second(
                        target.clip.start_seconds,
                        float(job.get("normalized_source_start_seconds") or 0.0),
                    )),
                    timeline_end_seconds=float(_absolute_source_second(
                        target.clip.end_seconds,
                        float(job.get("normalized_source_start_seconds") or 0.0),
                    )),
                    timeline_subtitles=[
                        item.model_dump() for item in target.subtitles
                    ],
                    caption_editor_source=target.caption_editor_source,
                )
            except Exception as exc:
                # The database may have committed before the connection failed.
                # Preserve the deterministic object key rather than deleting
                # media that a successful commit could now reference.
                _log_event(
                    "edit_timeline_commit_ambiguous",
                    job_id=job_id,
                    short_id=target.short_id,
                    slot_index=target.slot_index,
                    error_type=type(exc).__name__,
                )
                return {"status": "failed", "commitAmbiguous": True}

            if not committed:
                try:
                    self.storage.delete(timeline_key)
                except Exception:
                    pass
                return {"status": "skipped"}

            elapsed_seconds = time.monotonic() - started_at
            metrics = {
                **timeline_metrics,
                "fileBytes": timeline_size,
                "uploadSeconds": round(upload_seconds, 3),
                "totalSeconds": round(elapsed_seconds, 3),
                "attempts": attempt,
            }
            self.repository.merge_project_attempt_performance_metrics(
                job_id,
                target.slot_index,
                {"editTimeline": metrics},
            )
            _log_event(
                "edit_timeline_capture_succeeded",
                job_id=job_id,
                short_id=target.short_id,
                slot_index=target.slot_index,
                elapsed_seconds=round(elapsed_seconds, 3),
                ffmpeg_seconds=timeline_metrics.get("ffmpegSeconds"),
                upload_seconds=round(upload_seconds, 3),
                file_bytes=timeline_size,
                attempts=attempt,
            )
            return {
                "status": "ready",
                "ffmpegSeconds": timeline_metrics.get("ffmpegSeconds"),
                "fileBytes": timeline_size,
            }

        self.repository.merge_project_attempt_performance_metrics(
            job_id,
            target.slot_index,
            {
                "editTimeline": {
                    "failed": True,
                    "attempts": 2,
                    "totalSeconds": round(time.monotonic() - started_at, 3),
                    "errorType": (
                        type(last_error).__name__ if last_error else "UnknownError"
                    ),
                }
            },
        )
        return {"status": "failed"}

    def _render_project_output_with_retry(
        self,
        item: dict[str, object],
        local_clean_path: Path | None,
    ) -> dict[str, object] | None:
        last_error: Exception | None = None
        for attempt in range(1, self.PROJECT_RENDER_ATTEMPTS + 1):
            try:
                return self._render_initial_short(
                    item,
                    local_clean_path if attempt == 1 else None,
                )
            except Exception as exc:
                last_error = exc
                if attempt < self.PROJECT_RENDER_ATTEMPTS:
                    _log_event(
                        "project_output_render_retrying",
                        job_id=item.get("job_id"),
                        short_id=item["id"],
                        slot_index=item.get("slot_index"),
                        attempt=attempt,
                        next_attempt=attempt + 1,
                        error_type=type(exc).__name__,
                    )
        if last_error:
            raise last_error
        return None

    def _render_project_outputs(
        self,
        job_id: str,
        local_clean_paths: dict[str, Path] | None = None,
    ) -> dict[str, object]:
        items = self.repository.get_project_render_items(job_id)
        if not items:
            return {
                "wallSeconds": 0.0,
                "renderedCount": 0,
                "failedCount": 0,
                "localCleanReuseCount": 0,
                "s3CleanDownloadCount": 0,
            }
        total = len(items)
        self.repository.stage(
            job_id,
            "rendering",
            60,
            f"쇼츠를 렌더링하고 있습니다. (0/{total})",
            completed_count=0,
            total_count=total,
        )
        results: list[dict[str, object]] = []
        failed_count = 0
        clean_sources: dict[str, str] = {}
        project_worker_count = self._project_worker_count()
        with PhaseResourceMonitor(self.settings.task_vcpus) as resources:
            with ThreadPoolExecutor(
                max_workers=project_worker_count,
                thread_name_prefix="project-render",
            ) as executor:
                futures = {}
                for item in items:
                    short_id = str(item["id"])
                    local_path = (local_clean_paths or {}).get(short_id)
                    clean_sources[short_id] = (
                        "local" if local_path is not None and local_path.is_file() else "s3"
                    )
                    self.repository.mark_project_attempt_rendering(short_id)
                    futures[
                        executor.submit(
                            self._render_project_output_with_retry,
                            item,
                            local_path,
                        )
                    ] = item
                completed = 0
                for future in as_completed(futures):
                    item = futures[future]
                    try:
                        render_metrics = future.result()
                        if render_metrics:
                            results.append(render_metrics)
                    except Exception as exc:
                        failed_count += 1
                        self.repository.fail_initial_render(
                            str(item["id"]),type(exc).__name__,str(exc),terminal=True
                        )
                        _log_event(
                            "project_output_failed",
                            job_id=job_id,
                            short_id=item["id"],
                            slot_index=item["slot_index"],
                            failure_stage="rendering",
                            error_type=type(exc).__name__,
                        )
                    completed += 1
                    self.repository.stage(
                        job_id,
                        "rendering",
                        60 + round(35 * completed / max(1, total)),
                        f"쇼츠를 렌더링하고 있습니다. ({completed}/{total})",
                        completed_count=completed,
                        total_count=total,
                    )

        ffmpeg_seconds = sum(float(item.get("ffmpegSeconds") or 0) for item in results)
        render_seconds = sum(float(item.get("totalSeconds") or 0) for item in results)
        clip_seconds = sum(float(item.get("clipDurationSeconds") or 0) for item in results)
        summary = {
            **resources.metrics,
            "renderedCount": len(results),
            "failedCount": failed_count,
            "workers": project_worker_count,
            "ffmpegThreads": self.settings.ffmpeg_threads,
            "ffmpegSeconds": round(ffmpeg_seconds, 3),
            "shortRenderSeconds": round(render_seconds, 3),
            "clipDurationSeconds": round(clip_seconds, 3),
            "renderComputeFactor": round(ffmpeg_seconds / clip_seconds, 4)
            if clip_seconds else None,
            "renderFfmpegShare": round(ffmpeg_seconds / render_seconds, 4)
            if render_seconds else None,
            "localCleanReuseCount": sum(
                1 for source in clean_sources.values() if source == "local"
            ),
            "s3CleanDownloadCount": sum(
                1 for source in clean_sources.values() if source == "s3"
            ),
        }
        _log_event("project_render_observed", job_id=job_id, **summary)
        return summary

    def _claim_next_ingestion_route(
        self,
        *,
        job_id: str,
        current_route_id: str,
        result: str,
        cooldown_seconds: int,
        attempted_route_ids: list[str],
        wait_seconds: float | None = None,
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

        bounded_wait_seconds = (
            self.INGESTION_ROUTE_WAIT_SECONDS
            if wait_seconds is None
            else max(0.0, wait_seconds)
        )
        if bounded_wait_seconds <= 0:
            return None
        wait_deadline = time.monotonic() + bounded_wait_seconds
        _log_event(
            "ingestion_route_wait_started",
            job_id=job_id,
            attempted_route_count=len(attempted_route_ids),
            max_wait_seconds=bounded_wait_seconds,
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
        initial_route_id: str | None,
        expected_dispatch_generation: int | None = None,
    ) -> tuple[DownloadedAssetBundle, str | None]:
        if not initial_route_id:
            return (
                self.ingestion.download_bundle(
                    youtube_url,
                    destination,
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
        capacity_requeue_enabled = bool(
            expected_dispatch_generation is not None
            and self.repository.ingestion_capacity_requeue_enabled()
        )

        try:
            while True:
                egress_class = self.ingestion.egress_class_for(route_id)
                try:
                    bundle = self.ingestion.download_bundle(
                        youtube_url,
                        destination,
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
                        wait_seconds=(0 if capacity_requeue_enabled else None),
                    )
                    route_is_leased = bool(next_route_id)
                    if not next_route_id:
                        if capacity_requeue_enabled:
                            action = self.repository.defer_project_for_ingestion_route(
                                job_id,
                                expected_dispatch_generation=(
                                    expected_dispatch_generation
                                ),
                                expected_batch_job_id=(
                                    str(os.getenv("AWS_BATCH_JOB_ID") or "").strip()
                                    or None
                                ),
                                attempted_route_ids=attempted_route_ids,
                            )
                            if action in {"deferred", "expired", "stale"}:
                                raise ProjectDeferredForIngestionRoute(action) from exc
                            if action == "disabled":
                                next_route_id = self._claim_next_ingestion_route(
                                    job_id=job_id,
                                    current_route_id=None,
                                    result=route_result,
                                    cooldown_seconds=0,
                                    attempted_route_ids=attempted_route_ids,
                                )
                                route_is_leased = bool(next_route_id)
                                if next_route_id:
                                    route_id = next_route_id
                                    continue
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
        if job.get("subtitle_template_id"):
            raise TranscriptionError(
                "자막 완성형 템플릿은 프로젝트 파이프라인 v2가 필요합니다."
            )
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
                source_duration_seconds = float(job["source_duration_seconds"])
                route_cleanup_owned_by_download = bool(route_id)
                with self.repository.ingestion_slot():
                    bundle, successful_route_id = self._download_with_inline_route_rotation(
                        job_id=job_id,
                        job_attempt=attempt,
                        youtube_url=job["youtube_url"],
                        destination=work_dir / "source",
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
                    self.repository.record_source_download_observation(
                        job_id,
                        status="unexpected_duration",
                        duration_seconds=None,
                        media_bytes=downloaded_media_bytes,
                    )
                    raise
                source_download_status = classify_full_source_download(
                    source_duration_seconds=source_duration_seconds,
                    downloaded_duration_seconds=downloaded_duration_seconds,
                )
                self.repository.record_source_download_observation(
                    job_id,
                    status=source_download_status,
                    duration_seconds=downloaded_duration_seconds or None,
                    media_bytes=downloaded_media_bytes,
                )
                _log_event(
                    "source_download_observed",
                    job_id=job_id,
                    status=source_download_status,
                    source_duration_seconds=source_duration_seconds,
                    downloaded_duration_seconds=downloaded_duration_seconds,
                    downloaded_media_bytes=downloaded_media_bytes,
                )
                if source_download_status == "unexpected_duration":
                    raise IngestionError(
                        "다운로드한 전체 영상의 길이가 원본과 일치하지 않습니다.",
                        code="ingestion_source_duration_mismatch",
                        details={
                            "source_download_status": source_download_status,
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
                    policy=str(
                        job.get("transcription_policy") or OPENAI_STABLE_POLICY
                    ),
                )

                self.repository.stage(job_id, "selecting", 42, "쇼츠로 만들 장면을 찾고 있습니다.")
                clips = self.selector.select(
                    video_title=job["video_title"],
                    duration_seconds=downloaded_duration_seconds,
                    transcript=transcript,
                    required_count=int(job["expected_short_count"]),
                    output_language=OutputLanguage(job["output_language"]),
                )
                if not clips:
                    raise RuntimeError("사용할 수 있는 하이라이트 구간이 없습니다.")

                clip_subtitles = {
                    index: self._relative_subtitles(transcript, clip)
                    for index, clip in enumerate(clips, start=1)
                }
                edit_timeline_clips = {
                    index: edit_timeline_clip(clip, downloaded_duration_seconds)
                    for index, clip in enumerate(clips, start=1)
                } if getattr(self.settings, "edit_timeline_capture_enabled", False) else {}
                edit_timeline_subtitles = {
                    index: self._relative_subtitles(transcript, timeline_clip)
                    for index, timeline_clip in edit_timeline_clips.items()
                }
                comments_by_clip: dict[int, list[dict[str, object]]] = {
                    index: [] for index in clip_subtitles
                }
                if str(job.get("template_id")) == TemplateId.COMMENT_CAPTURE.value:
                    self.repository.stage(
                        job_id,
                        "selecting",
                        44,
                        "시청자 반응을 만들고 있습니다.",
                    )
                    comment_inputs = [
                        CommentClipInput(
                            clip_index=index,
                            hook_title=clip.hook_title,
                            reason=clip.reason,
                            duration_seconds=clip.end_seconds - clip.start_seconds,
                            transcript=clip_subtitles[index],
                        )
                        for index, clip in enumerate(clips, start=1)
                    ]
                    try:
                        comments_by_clip = self.comment_generator.generate(comment_inputs)
                    except Exception as exc:
                        _log_event(
                            "comment_generation_unexpected_fallback",
                            job_id=job_id,
                            error_type=type(exc).__name__,
                        )
                        comments_by_clip = {
                            item.clip_index: fallback_comment_overlays(
                                item.duration_seconds,
                                count=item.target_count,
                                clip_index=item.clip_index,
                            )
                            for item in comment_inputs
                        }

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
                    relative_subtitles = clip_subtitles[index]
                    prefix = f"{job['mvp_session_id']}/{job_id}/{short_id}"
                    clean_key = f"edit-sources/{prefix}.mp4"
                    self.storage.upload(clean_path, clean_key, "video/mp4")
                    timeline_clip = edit_timeline_clips.get(index)
                    timeline_key: str | None = None
                    if timeline_clip is not None:
                        timeline_path = work_dir / "timelines" / f"{short_id}.mp4"
                        try:
                            self.renderer.extract_clean_clip(
                                source_path=source,
                                output_path=timeline_path,
                                clip=timeline_clip,
                                work_dir=work_dir / "timeline-extract" / short_id,
                                video_aspect_ratio=VideoAspectRatio(
                                    str(job.get("video_aspect_ratio") or "1:1")
                                ),
                            )
                            timeline_key = f"edit-sources/{prefix}/timeline-v1.mp4"
                            self.storage.upload(timeline_path, timeline_key, "video/mp4")
                        except Exception as exc:
                            if timeline_key:
                                try:
                                    self.storage.delete(timeline_key)
                                except Exception:
                                    pass
                            timeline_key = None
                            _log_event(
                                "edit_timeline_capture_failed",
                                job_id=job_id,
                                short_id=short_id,
                                error_type=type(exc).__name__,
                            )
                    inserted = self.repository.add_pending_short(
                        short_id=short_id,
                        job=job,
                        clip_index=index,
                        start_seconds=clip.start_seconds,
                        end_seconds=clip.end_seconds,
                        hook_title=clip.hook_title,
                        highlight_reason=clip.reason,
                        selection_raw_start_seconds=clip.selection_raw_start_seconds,
                        selection_raw_end_seconds=clip.selection_raw_end_seconds,
                        selection_raw_duration_seconds=clip.selection_raw_duration_seconds,
                        selection_candidate_index=clip.selection_candidate_index,
                        selection_provider=clip.selection_provider,
                        selection_model=clip.selection_model,
                        selection_length_adjustment=clip.selection_length_adjustment,
                        selection_repositioned=clip.selection_repositioned,
                        viral_score=clip.viral_score,
                        subtitles=[item.model_dump() for item in relative_subtitles],
                        comment_overlays=comments_by_clip[index],
                        clean_key=clean_key,
                        timeline_key=timeline_key,
                        timeline_start_seconds=(
                            timeline_clip.start_seconds if timeline_key else None
                        ),
                        timeline_end_seconds=(
                            timeline_clip.end_seconds if timeline_key else None
                        ),
                        timeline_subtitles=(
                            [
                                item.model_dump()
                                for item in edit_timeline_subtitles.get(index, [])
                            ] if timeline_key else None
                        ),
                        retention_days=int(job["retention_days"]),
                        shard_index=(index - 1) // self.RENDER_SHARD_SIZE,
                    )
                    if not inserted:
                        for key in (clean_key, timeline_key):
                            if key:
                                try:
                                    self.storage.delete(key)
                                except Exception:
                                    pass
                        raise RuntimeError("작업 제한 시간이 종료되었습니다.")
                if not self.repository.mark_render_queued(job_id, len(clips)):
                    raise RuntimeError("작업 제한 시간이 종료되었습니다.")
                shard_count = (
                    len(clips) + self.RENDER_SHARD_SIZE - 1
                ) // self.RENDER_SHARD_SIZE
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
        except CaptionCompileError as exc:
            _log_event(
                "prepare_failed",
                job_id=job_id,
                attempt=attempt,
                error_type=type(exc).__name__,
                retryable=False,
            )
            self._cleanup_initial_objects(job)
            self.repository.remove_partial_shorts(job_id)
            self.repository.fail_job(
                job_id,
                type(exc).__name__,
                self.FINAL_CAPTION_MESSAGE,
            )
            raise
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
            self.repository.fail_job(
                job_id,
                type(exc).__name__,
                self.FINAL_TRANSCRIPTION_MESSAGE,
            )
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
        storage_prefixes = [
            f"outputs/{prefix}",
            f"edit-sources/{prefix}",
        ]
        # Upload projects own a receiver-derived ``source.jpg`` under the job
        # thumbnail prefix. It remains the project-card image through failure
        # retention; pre-render project cleanup has no generated thumbnails to
        # remove from this prefix.
        if str(job.get("source_type") or "youtube") != "upload":
            storage_prefixes.append(f"thumbnails/{prefix}")
        for storage_prefix in storage_prefixes:
            try:
                self.storage.delete_prefix(storage_prefix)
            except Exception:
                pass

    def render_shard(self, job_id: str, shard_index: int) -> None:
        job = self.repository.get_job(job_id)
        if not job:
            raise KeyError(job_id)
        verify_initial_render_v4_runtime(job)
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

        started_at = time.monotonic()
        _log_event(
            "render_shard_started",
            job_id=job_id,
            shard_index=shard_index,
            pending_count=len(pending),
            queue_delay_seconds=_render_queue_delay_seconds(),
            batch_job_id=os.getenv("AWS_BATCH_JOB_ID"),
        )
        try:
            for item in pending:
                self._render_initial_short(item)
        except Exception as exc:
            _log_event(
                "render_shard_failed",
                job_id=job_id,
                shard_index=shard_index,
                elapsed_seconds=round(time.monotonic() - started_at, 3),
                error_type=type(exc).__name__,
                container_peak_memory_bytes=_container_memory_peak_bytes(),
            )
            raise
        self.repository.maybe_complete_job(job_id)
        _log_event(
            "render_shard_succeeded",
            job_id=job_id,
            shard_index=shard_index,
            elapsed_seconds=round(time.monotonic() - started_at, 3),
            rendered_count=len(pending),
            container_peak_memory_bytes=_container_memory_peak_bytes(),
        )

    def _background_render_arguments(
        self,
        item: dict[str, object],
        work_dir: Path,
        document: EditorDocument | None = None,
    ) -> dict[str, Path]:
        config = _custom_template_config(
            {"template_snapshot": document.template.snapshot} if document else item
        )
        background = document.overlays.background if document else None
        if background is None and config is not None:
            background = config.background
        if background is None or background.kind != "uploaded_image":
            return {}
        return {"uploaded_background_path": download_owned_background(
            repository=self.repository,
            storage=self.storage,
            user_id=str(item.get("user_id") or ""),
            asset_id=str(background.asset_id or ""),
            work_dir=work_dir,
        )}

    def _render_initial_short(
        self,
        item: dict[str, object],
        local_clean_path: Path | None = None,
    ) -> dict[str, object] | None:
        short_id = str(item["id"])
        if not self.repository.begin_initial_render(short_id):
            return None
        started_at = time.monotonic()
        clip_duration_seconds = max(
            0.0,
            float(item.get("end_seconds") or 0) - float(item.get("start_seconds") or 0),
        )
        _log_event(
            "render_short_started",
            job_id=item["job_id"],
            short_id=short_id,
            clip_duration_seconds=round(clip_duration_seconds, 3),
            template_id=item["template_id"],
            batch_attempt=os.getenv("AWS_BATCH_JOB_ATTEMPT", "1"),
        )
        work_dir = self.settings.temp_dir / f"render-{short_id}"
        uploaded_keys: list[str] = []
        committed = False
        completion_started = False
        render_metrics: dict[str, object] = {}
        clean_source = "s3"
        clean_acquire_seconds = 0.0
        thumbnail_seconds = 0.0
        upload_seconds = 0.0
        shutil.rmtree(work_dir, ignore_errors=True)
        work_dir.mkdir(parents=True)
        try:
            clean_acquire_started_at = time.monotonic()
            if local_clean_path is not None and local_clean_path.is_file():
                clean_path = local_clean_path
                clean_source = "local"
            else:
                clean_path = self.storage.download(
                    str(item["clean_clip_s3_key"]), work_dir / "clean.mp4"
                )
            clean_acquire_seconds = time.monotonic() - clean_acquire_started_at
            self.repository.update_initial_render_progress(short_id, 30)
            output_path = work_dir / "output.mp4"
            thumbnail_path = work_dir / "thumbnail.jpg"
            subtitles = [
                SubtitleSegment.model_validate(segment)
                for segment in item["subtitle_segments"]  # type: ignore[union-attr]
            ]
            comments = [
                CommentOverlay.model_validate(comment)
                for comment in (item.get("comment_overlays") or [])  # type: ignore[union-attr]
            ]
            raw_title_text_styles = item.get("title_text_styles")  # type: ignore[union-attr]
            title_text_styles = None if not item.get("title_text_styles_initialized") else [  # type: ignore[union-attr]
                TitleTextStyle.model_validate(style)
                for style in (raw_title_text_styles or [])  # type: ignore[union-attr]
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
                comment_overlays=comments,
                comment_channel_below=_preset_comment_channel_below(item),
                comment_channel_fixed=_preset_comment_channel_fixed(item),
                fixed_preset_channel=_preset_fixed_channel_position(item),
                title_text_styles=title_text_styles,
                custom_template_config=_custom_template_config(item),
                caption_render_spec=(
                    dict(caption_spec)
                    if isinstance((caption_spec := item.get("caption_render_spec")), dict)
                    else None
                ),
                initial_render_spec=(
                    dict(initial_render_spec)
                    if isinstance(
                        (initial_render_spec := item.get("initial_render_spec")),
                        dict,
                    )
                    else None
                ),
                title_accent_color=_preset_brand_color(item),
                metrics_callback=render_metrics.update,
                **self._background_render_arguments(item, work_dir),
            )
            thumbnail_started_at = time.monotonic()
            self._thumbnail(output_path, thumbnail_path, work_dir)
            thumbnail_seconds = time.monotonic() - thumbnail_started_at
            self.repository.update_initial_render_progress(short_id, 82)
            prefix = f"{item['mvp_session_id']}/{item['job_id']}/{short_id}"
            output_key = f"outputs/{prefix}/v1.mp4"
            thumbnail_key = f"thumbnails/{prefix}.jpg"
            upload_started_at = time.monotonic()
            size = self.storage.upload(output_path, output_key, "video/mp4")
            uploaded_keys.append(output_key)
            self.storage.upload(thumbnail_path, thumbnail_key, "image/jpeg")
            uploaded_keys.append(thumbnail_key)
            upload_seconds = time.monotonic() - upload_started_at
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
            total_seconds = time.monotonic() - started_at
            metrics = {
                **render_metrics,
                "clipDurationSeconds": round(clip_duration_seconds, 3),
                "commentCount": len(comments),
                "cleanSource": clean_source,
                "cleanAcquireSeconds": round(clean_acquire_seconds, 3),
                "thumbnailSeconds": round(thumbnail_seconds, 3),
                "uploadSeconds": round(upload_seconds, 3),
                "outputBytes": size,
                "totalSeconds": round(total_seconds, 3),
                "committed": committed,
            }
            self.repository.merge_project_attempt_performance_metrics(
                str(item["job_id"]),
                int(item.get("slot_index") or item.get("clip_index") or 0),
                {"render": metrics},
            )
            _log_event(
                "render_short_succeeded" if committed else "render_short_discarded",
                job_id=item["job_id"],
                short_id=short_id,
                elapsed_seconds=round(total_seconds, 3),
                clip_duration_seconds=round(clip_duration_seconds, 3),
                clean_source=clean_source,
                clean_acquire_seconds=round(clean_acquire_seconds, 3),
                overlay_seconds=render_metrics.get("overlaySeconds"),
                ffmpeg_seconds=render_metrics.get("ffmpegSeconds"),
                thumbnail_seconds=round(thumbnail_seconds, 3),
                upload_seconds=round(upload_seconds, 3),
                average_fps=render_metrics.get("averageFps"),
                average_speed=render_metrics.get("speed"),
                output_size_bytes=size,
                container_peak_memory_bytes=_container_memory_peak_bytes(),
            )
            return metrics if committed else None
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
            self.repository.merge_project_attempt_performance_metrics(
                str(item["job_id"]),
                int(item.get("slot_index") or item.get("clip_index") or 0),
                {
                    "render": {
                        **render_metrics,
                        "clipDurationSeconds": round(clip_duration_seconds, 3),
                        "cleanSource": clean_source,
                        "cleanAcquireSeconds": round(clean_acquire_seconds, 3),
                        "thumbnailSeconds": round(thumbnail_seconds, 3),
                        "uploadSeconds": round(upload_seconds, 3),
                        "totalSeconds": round(time.monotonic() - started_at, 3),
                        "failed": True,
                        "errorType": type(exc).__name__,
                    }
                },
            )
            _log_event(
                "render_short_failed",
                job_id=item["job_id"],
                short_id=short_id,
                elapsed_seconds=round(time.monotonic() - started_at, 3),
                clip_duration_seconds=round(clip_duration_seconds, 3),
                error_type=type(exc).__name__,
                container_peak_memory_bytes=_container_memory_peak_bytes(),
            )
            raise
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
            if local_clean_path is not None:
                local_clean_path.unlink(missing_ok=True)

    def _rerender_editor_document(
        self,
        short_id: str,
        item: dict[str, object],
        snapshot: dict[str, object],
    ) -> None:
        work_dir = self.settings.temp_dir / f"rerender-{short_id}"
        attempt = max(1, int(os.getenv("AWS_BATCH_JOB_ATTEMPT", "1")))
        uploaded_keys: list[str] = []
        committed = False
        completion_started = False
        shutil.rmtree(work_dir, ignore_errors=True)
        work_dir.mkdir(parents=True)
        try:
            document = EditorDocument.model_validate(snapshot)
            if document.source_short_id != short_id:
                raise ValueError("편집 문서의 영상 식별자가 일치하지 않습니다.")
            if document.base_render_version != int(item["render_version"]):
                raise ValueError("편집 문서의 기준 렌더 버전이 일치하지 않습니다.")
            captured_timeline_key = item.get("edit_timeline_s3_key")
            edit_source_key = (
                str(captured_timeline_key)
                if captured_timeline_key
                else str(item["clean_clip_s3_key"])
            )
            timeline_start = (
                float(item["edit_timeline_start_seconds"])
                if captured_timeline_key
                else float(item["start_seconds"])
            )
            timeline_end = (
                float(item["edit_timeline_end_seconds"])
                if captured_timeline_key
                else float(item["end_seconds"])
            )
            if (
                abs(document.video.timeline_start_seconds - timeline_start) > 0.051
                or abs(document.video.timeline_end_seconds - timeline_end) > 0.051
            ):
                raise ValueError("편집 문서의 타임라인 범위가 일치하지 않습니다.")

            self.repository.mark_editor_render_request_rendering(short_id)
            version = int(item["render_version"]) + 1
            self.repository.update_rerender_progress(short_id, 12)
            timeline_path = self.storage.download(
                edit_source_key,
                work_dir / "timeline.mp4",
            )
            clean_path = self.editor_renderer.extract_sequence(
                timeline_path=timeline_path,
                output_path=work_dir / "clean.mp4",
                document=document,
                work_dir=work_dir / "sequence",
            )
            new_clean_key = (
                f"edit-sources/{item['mvp_session_id']}/{item['job_id']}/"
                f"{short_id}/clean-v{version}.mp4"
            )
            self.storage.upload(clean_path, new_clean_key, "video/mp4")
            uploaded_keys.append(new_clean_key)
            self.repository.update_rerender_progress(short_id, 28)

            if document.channel.thumbnail_asset_key:
                channel_thumbnail_path = self.storage.download(
                    document.channel.thumbnail_asset_key,
                    work_dir / "channel-thumbnail",
                )
            else:
                channel_thumbnail_path = download_channel_thumbnail(
                    document.channel.thumbnail_url
                    or str(item.get("channel_thumbnail_url") or "")
                    or None,
                    work_dir / "channel-thumbnail.png",
                )
            caption_render_spec = item.get("caption_render_spec")
            resolved_caption_render_spec = (
                (
                    editor_source["spec"]
                    if captured_timeline_key
                    and isinstance(
                        editor_source := caption_render_spec.get("editorSource"),
                        dict,
                    )
                    and isinstance(editor_source.get("spec"), dict)
                    else caption_render_spec
                )
                if isinstance(caption_render_spec, dict)
                else None
            )
            if (
                document.subtitles.enabled
                and item.get("subtitle_template_id")
                and resolved_caption_render_spec is None
            ):
                raise ValueError(
                    "이전 자막 형식은 새 편집기에서 지원하지 않습니다."
                )
            caption_overlay_only = False
            if (
                resolved_caption_render_spec is None
                and editor_highlight_subtitles_enabled(document)
                and document.render_spec is not None
                and document.render_spec.version == 3
                and "transcript_words" in item
            ):
                transcript_words = _stored_transcript_words(
                    item.get("transcript_words")
                )
                if not transcript_words:
                    raise ValueError(
                        "정확한 단어 타임스탬프가 없어 자막을 켤 수 없습니다."
                    )
                render_subtitles = document.render_spec.subtitles
                assert render_subtitles is not None
                resolved_caption_render_spec = compile_caption_render_spec(
                    transcript_words,
                    template_id="highlight",
                    clip_start=document.video.timeline_start_seconds,
                    clip_end=document.video.timeline_end_seconds,
                    video_aspect_ratio=document.video.aspect_ratio,
                    accent_color=(
                        render_subtitles.accent_color or CAPTION_ACCENT
                    ),
                    font_id=render_subtitles.font_id,
                    font_size=(
                        round(render_subtitles.font_size)
                        if render_subtitles.font_size is not None
                        else None
                    ),
                    text_color=render_subtitles.color or "#FFFFFF",
                    timing_lead_frames=CAPTION_STABLE_TIMING_LEAD_FRAMES,
                )
                if not resolved_caption_render_spec.get("cues"):
                    raise ValueError(
                        "선택한 영상 구간에서 단어 타임스탬프를 찾을 수 없습니다."
                    )
                caption_overlay_only = True
            visible_caption_render_spec = (
                resolved_caption_render_spec
                if document.subtitles.enabled
                else None
            )
            caption_composition_spec = (
                None
                if caption_overlay_only
                else resolved_caption_render_spec
            )
            subtitle_render_mode = editor_subtitle_render_mode(
                document,
                visible_caption_render_spec,
            )
            _log_event(
                "editor_render_plan",
                short_id=short_id,
                document_version=document.version,
                render_spec_version=(
                    document.render_spec.version if document.render_spec else None
                ),
                template_id=document.template.id.value,
                subtitle_render_mode=subtitle_render_mode,
                subtitle_segment_count=len(document.subtitles.segments),
                clip_count=len(document.video.clips),
                channel_offset_x=document.overlays.offsets["channel"].x,
                channel_offset_y=document.overlays.offsets["channel"].y,
                channel_scale=document.overlays.scales["channel"],
                layer_order=document.overlays.layer_order,
            )
            output_path = self.editor_renderer.render(
                clean_path=clean_path,
                output_path=work_dir / "output.mp4",
                document=document,
                work_dir=work_dir,
                channel_thumbnail_path=channel_thumbnail_path,
                caption_render_spec=visible_caption_render_spec,
                caption_composition_spec=caption_composition_spec,
                caption_overlay_only=caption_overlay_only,
                **self._background_render_arguments(item, work_dir, document),
            )
            thumbnail_path = work_dir / "thumbnail.jpg"
            self._thumbnail(output_path, thumbnail_path, work_dir)
            self.repository.update_rerender_progress(short_id, 82)
            output_key = (
                f"outputs/{item['mvp_session_id']}/{item['job_id']}/"
                f"{short_id}/v{version}.mp4"
            )
            thumbnail_key = (
                f"thumbnails/{item['mvp_session_id']}/{item['job_id']}/"
                f"{short_id}/v{version}.jpg"
            )
            size = self.storage.upload(output_path, output_key, "video/mp4")
            uploaded_keys.append(output_key)
            self.storage.upload(thumbnail_path, thumbnail_key, "image/jpeg")
            uploaded_keys.append(thumbnail_key)
            self.repository.update_rerender_progress(short_id, 94)
            completion_started = True
            old_keys = self.repository.complete_editor_document_rerender(
                short_id,
                output_key=output_key,
                thumbnail_key=thumbnail_key,
                clean_key=new_clean_key,
                size=size,
                version=version,
                start_seconds=round(
                    document.video.timeline_start_seconds
                    + document.video.clips[0].source_start_seconds,
                    3,
                ),
                duration_seconds=document.video.output_duration_seconds,
                subtitle_segments=[
                    segment.model_dump(by_alias=True)
                    for segment in retime_editor_subtitles(document)
                ],
            )
            if old_keys is None:
                for key in uploaded_keys:
                    try:
                        self.storage.delete(key)
                    except Exception:
                        pass
                return
            committed = True
            for old_key in old_keys.values():
                if old_key and old_key not in uploaded_keys:
                    try:
                        self.storage.delete(old_key)
                    except Exception:
                        pass
        except Exception:
            if not committed and not completion_started:
                for key in uploaded_keys:
                    try:
                        self.storage.delete(key)
                    except Exception:
                        pass
            if attempt >= 2:
                self.repository.reset_rerender(short_id)
            raise
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def rerender(self, short_id: str) -> None:
        item = self.repository.get_short(short_id)
        if not item:
            raise KeyError(short_id)
        pending_snapshot = item.get("pending_edit_snapshot")
        if (
            isinstance(pending_snapshot, dict)
            and pending_snapshot.get("version") in {2, 3}
        ):
            self._rerender_editor_document(short_id, item, pending_snapshot)
            return
        work_dir = self.settings.temp_dir / f"rerender-{short_id}"
        attempt = max(1, int(os.getenv("AWS_BATCH_JOB_ATTEMPT", "1")))
        uploaded_keys: list[str] = []
        committed = False
        completion_started = False
        shutil.rmtree(work_dir, ignore_errors=True)
        work_dir.mkdir(parents=True)
        try:
            snapshot = item.get("pending_edit_snapshot")
            snapshot = snapshot if isinstance(snapshot, dict) else None
            version = int(item["render_version"]) + 1
            self.repository.update_rerender_progress(short_id, 12)
            clean_path = work_dir / "clean.mp4"
            new_clean_key: str | None = None
            render_item = dict(item)
            if snapshot:
                captured_timeline_key = item.get("edit_timeline_s3_key")
                edit_source_key = (
                    str(captured_timeline_key)
                    if captured_timeline_key
                    else str(item["clean_clip_s3_key"])
                )
                timeline_path = self.storage.download(
                    edit_source_key,
                    work_dir / "timeline.mp4",
                )
                timeline_start = (
                    float(item["edit_timeline_start_seconds"])
                    if captured_timeline_key
                    else float(item["start_seconds"])
                )
                relative_start = float(snapshot["startSeconds"]) - timeline_start
                relative_end = float(snapshot["endSeconds"]) - timeline_start
                selected_clip = HighlightClip(
                    start_seconds=round(relative_start, 3),
                    end_seconds=round(relative_end, 3),
                    hook_title=str(snapshot["hookTitle"]),
                )
                self.renderer.extract_clean_clip(
                    source_path=timeline_path,
                    output_path=clean_path,
                    clip=selected_clip,
                    work_dir=work_dir / "range-extract",
                    video_aspect_ratio=VideoAspectRatio(
                        str(snapshot.get("videoAspectRatio") or "1:1")
                    ),
                )
                new_clean_key = (
                    f"edit-sources/{item['mvp_session_id']}/{item['job_id']}/"
                    f"{short_id}/clean-v{version}.mp4"
                )
                self.storage.upload(clean_path, new_clean_key, "video/mp4")
                uploaded_keys.append(new_clean_key)
                render_item.update({
                    "hook_title": snapshot["hookTitle"],
                    "channel_display_name": snapshot["channelDisplayName"],
                    "subtitles_enabled": snapshot["subtitlesEnabled"],
                    "subtitle_segments": snapshot.get("subtitleSegments") or [],
                    "comment_overlays": snapshot.get("commentOverlays") or [],
                    "template_id": snapshot["templateId"],
                    "custom_template_id": snapshot.get("customTemplateId"),
                    "template_snapshot": snapshot.get("templateSnapshot"),
                    "video_aspect_ratio": snapshot.get("videoAspectRatio") or "1:1",
                    "title_font_scale": snapshot.get("titleFontScale") or 1,
                    "title_text_styles": snapshot.get("titleTextStyles") or [],
                    "title_text_styles_initialized": snapshot.get(
                        "titleTextStylesInitialized", True
                    ),
                })
            else:
                clean_path = self.storage.download(
                    str(item["clean_clip_s3_key"]), clean_path
                )
            self.repository.update_rerender_progress(short_id, 28)
            output_path = work_dir / "output.mp4"
            subtitles = [
                SubtitleSegment.model_validate(segment)
                for segment in render_item["subtitle_segments"]
            ]
            comments = [
                CommentOverlay.model_validate(comment)
                for comment in (render_item.get("comment_overlays") or [])
            ]
            raw_title_text_styles = render_item.get("title_text_styles")
            title_text_styles = None if not render_item.get("title_text_styles_initialized") else [
                TitleTextStyle.model_validate(style)
                for style in (raw_title_text_styles or [])
            ]
            channel_thumbnail_path = download_channel_thumbnail(
                str(item.get("channel_thumbnail_url") or "") or None,
                work_dir / "channel-thumbnail.png",
            )
            self.renderer.render_clean_clip(
                clean_path=clean_path,
                output_path=output_path,
                title=str(render_item["hook_title"]),
                channel_name=str(render_item["channel_display_name"]),
                template_id=TemplateId(str(render_item["template_id"])),
                transcript=subtitles,
                subtitles_enabled=bool(render_item["subtitles_enabled"]),
                work_dir=work_dir,
                prefix="rerender",
                title_font_scale=float(render_item["title_font_scale"]),
                channel_thumbnail_path=channel_thumbnail_path,
                video_aspect_ratio=VideoAspectRatio(
                    str(render_item.get("video_aspect_ratio") or "1:1")
                ),
                comment_overlays=comments,
                comment_channel_below=_preset_comment_channel_below(render_item),
                comment_channel_fixed=_preset_comment_channel_fixed(render_item),
                fixed_preset_channel=_preset_fixed_channel_position(render_item),
                title_text_styles=title_text_styles,
                custom_template_config=_custom_template_config(render_item),
                caption_render_spec=(
                    dict(caption_spec)
                    if isinstance(
                        (caption_spec := render_item.get("caption_render_spec")),
                        dict,
                    )
                    else None
                ),
                title_accent_color=_preset_brand_color(render_item),
            )
            thumbnail_path = work_dir / "thumbnail.jpg"
            self._thumbnail(output_path, thumbnail_path, work_dir)
            self.repository.update_rerender_progress(short_id, 82)
            new_key = f"outputs/{item['mvp_session_id']}/{item['job_id']}/{short_id}/v{version}.mp4"
            thumbnail_key = (
                f"thumbnails/{item['mvp_session_id']}/{item['job_id']}/"
                f"{short_id}/v{version}.jpg"
            )
            size = self.storage.upload(output_path, new_key, "video/mp4")
            uploaded_keys.append(new_key)
            self.storage.upload(thumbnail_path, thumbnail_key, "image/jpeg")
            uploaded_keys.append(thumbnail_key)
            self.repository.update_rerender_progress(short_id, 94)
            completion_started = True
            if snapshot and new_clean_key:
                old_keys = self.repository.complete_snapshot_rerender(
                    short_id,
                    output_key=new_key,
                    thumbnail_key=thumbnail_key,
                    clean_key=new_clean_key,
                    size=size,
                    version=version,
                )
                if old_keys is None:
                    for key in uploaded_keys:
                        try:
                            self.storage.delete(key)
                        except Exception:
                            pass
                    return
                committed = True
                for old_key in old_keys.values():
                    if old_key and old_key not in uploaded_keys:
                        try:
                            self.storage.delete(old_key)
                        except Exception:
                            pass
            else:
                old_keys = self.repository.complete_rerender(
                    short_id,
                    new_key,
                    thumbnail_key,
                    size,
                    version,
                )
                if old_keys is None:
                    for key in uploaded_keys:
                        try:
                            self.storage.delete(key)
                        except Exception:
                            pass
                    return
                committed = True
                for old_key in old_keys.values():
                    if old_key and old_key not in uploaded_keys:
                        try:
                            self.storage.delete(old_key)
                        except Exception:
                            pass
        except Exception:
            if not committed and not completion_started:
                for key in uploaded_keys:
                    try:
                        self.storage.delete(key)
                    except Exception:
                        pass
            if attempt >= 2:
                self.repository.reset_rerender(short_id)
            raise
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
