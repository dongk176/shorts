from __future__ import annotations

import secrets
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .fallback_comments import select_fallback_comment_texts


class TemplateId(str, Enum):
    DARK_RED = "dark-red"
    WHITE_YELLOW = "white-yellow"
    DARK_MINIMAL = "dark-minimal"
    PAPER = "paper"
    COMMENT_CAPTURE = "comment-capture"


class VideoAspectRatio(str, Enum):
    LANDSCAPE = "16:9"
    LANDSCAPE_FIVE_FOUR = "5:4"
    SQUARE = "1:1"
    PORTRAIT = "4:5"
    FULL_VERTICAL = "9:16"


class TemplateBackground(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = Field(pattern=r"^(color|image)$")
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    asset_id: str | None = Field(default=None, alias="assetId", pattern=r"^[a-z0-9-]+$")

    @model_validator(mode="after")
    def validate_kind_value(self) -> TemplateBackground:
        if self.kind == "color" and not self.color:
            raise ValueError("color background requires color")
        if self.kind == "image" and not self.asset_id:
            raise ValueError("image background requires assetId")
        return self


class TemplateVideoLayer(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    aspect_ratio: VideoAspectRatio = Field(alias="aspectRatio")
    x: int = Field(ge=0, le=840)
    y: int = Field(ge=0, le=1785)
    width: int = Field(ge=240, le=1080)
    height: int = Field(ge=135, le=1920)
    fit: str = Field(pattern=r"^cover$")

    @model_validator(mode="after")
    def validate_bounds_and_ratio(self) -> TemplateVideoLayer:
        ratios = {
            VideoAspectRatio.LANDSCAPE: 9 / 16,
            VideoAspectRatio.LANDSCAPE_FIVE_FOUR: 4 / 5,
            VideoAspectRatio.SQUARE: 1,
            VideoAspectRatio.PORTRAIT: 5 / 4,
            VideoAspectRatio.FULL_VERTICAL: 16 / 9,
        }
        if abs(self.height - round(self.width * ratios[self.aspect_ratio])) > 1:
            raise ValueError("video layer ratio is invalid")
        if self.x + self.width > 1080 or self.y + self.height > 1920:
            raise ValueError("video layer exceeds canvas")
        return self


class TemplateTextLayer(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    visible: bool
    x: int = Field(ge=0, le=1080)
    y: int = Field(ge=0, le=1920)
    max_width: int = Field(alias="maxWidth", ge=180, le=1080)
    font_size: int = Field(alias="fontSize", ge=20, le=96)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    background_color: str | None = Field(
        default=None, alias="backgroundColor", pattern=r"^#[0-9A-Fa-f]{6}$"
    )


class TemplateTitleLayer(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    visible: bool
    x: int = Field(ge=0, le=1080)
    y: int = Field(ge=0, le=1920)
    max_width: int = Field(alias="maxWidth", ge=180, le=1080)
    font_size: int = Field(alias="fontSize", ge=24, le=96)
    primary_color: str = Field(alias="primaryColor", pattern=r"^#[0-9A-Fa-f]{6}$")
    accent_color: str = Field(alias="accentColor", pattern=r"^#[0-9A-Fa-f]{6}$")
    primary_background_color: str | None = Field(
        default=None, alias="primaryBackgroundColor", pattern=r"^#[0-9A-Fa-f]{6}$"
    )
    accent_background_color: str | None = Field(
        default=None, alias="accentBackgroundColor", pattern=r"^#[0-9A-Fa-f]{6}$"
    )

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy_background(cls, value: object) -> object:
        if not isinstance(value, dict) or "backgroundColor" not in value:
            return value
        upgraded = dict(value)
        background_color = upgraded.pop("backgroundColor")
        upgraded.setdefault("primaryBackgroundColor", background_color)
        upgraded.setdefault("accentBackgroundColor", background_color)
        return upgraded


class TemplateCommentLayer(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    visible: bool = True
    theme: str = Field(default="dark", pattern=r"^(dark|light)$")
    size: str = Field(default="medium", pattern=r"^(small|medium|large)$")
    y: int = Field(default=1392, ge=0, le=1920)
    docked_to_video: bool = Field(default=True, alias="dockedToVideo")


class CustomTemplateConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_version: int = Field(alias="schemaVersion", ge=1, le=4)
    background: TemplateBackground
    video: TemplateVideoLayer
    title: TemplateTitleLayer
    subtitle: TemplateTextLayer
    channel: TemplateTextLayer
    comment: TemplateCommentLayer

    @model_validator(mode="before")
    @classmethod
    def upgrade_comment_layer(cls, value: object) -> object:
        if not isinstance(value, dict) or "comment" in value:
            return value
        upgraded = dict(value)
        video = upgraded.get("video")
        y = 1392
        if isinstance(video, dict):
            video_y = video.get("y")
            video_height = video.get("height")
            if isinstance(video_y, int) and isinstance(video_height, int):
                y = min(1920, video_y + video_height)
        upgraded["comment"] = {
            "visible": True,
            "theme": "dark",
            "size": "medium",
            "y": y,
            "dockedToVideo": True,
        }
        return upgraded


class OutputLanguage(str, Enum):
    KO = "ko"
    EN = "en"
    JA = "ja"
    ZH_CN = "zh-CN"
    ES = "es"
    FR = "fr"
    DE = "de"
    PT_BR = "pt-BR"


OUTPUT_LANGUAGE_NAMES = {
    OutputLanguage.KO: "한국어",
    OutputLanguage.EN: "영어",
    OutputLanguage.JA: "일본어",
    OutputLanguage.ZH_CN: "중국어(간체)",
    OutputLanguage.ES: "스페인어",
    OutputLanguage.FR: "프랑스어",
    OutputLanguage.DE: "독일어",
    OutputLanguage.PT_BR: "포르투갈어(브라질)",
}


AI_CLIP_MIN_SECONDS = 30.0
AI_CLIP_MAX_SECONDS = 60.0
AI_CLIP_FALLBACK_SECONDS = 45.0
MAX_HOOK_TITLE_CHARS = 80
MAX_CHANNEL_NAME_CHARS = 50


class SubtitleSegment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    start: float = Field(ge=0)
    end: float = Field(gt=0)
    text: str = Field(min_length=1)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.split())


class CommentOverlay(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9:_-]+$")
    start_seconds: float = Field(alias="startSeconds", ge=0)
    end_seconds: float = Field(alias="endSeconds", gt=0)
    text: str = Field(min_length=1, max_length=200)
    initial: str = Field(min_length=1, max_length=2)
    avatar_color: str = Field(alias="avatarColor", pattern=r"^#[0-9A-Fa-f]{6}$")
    nickname: str = Field(min_length=1, max_length=30)
    like_count: int = Field(alias="likeCount", ge=10, le=999_999)
    age_label: str = Field(alias="ageLabel", min_length=1, max_length=20)

    @field_validator("text", "nickname", "age_label")
    @classmethod
    def clean_comment_text(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("end_seconds")
    @classmethod
    def validate_range(cls, value: float, info) -> float:
        start = info.data.get("start_seconds")
        if start is not None and value <= start:
            raise ValueError("comment end must be after start")
        return value


class TitleTextStyle(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    start: int = Field(ge=0)
    end: int = Field(gt=0)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    background_color: str | None = Field(
        default=None,
        alias="backgroundColor",
        pattern=r"^#[0-9A-Fa-f]{6}$",
    )

    @field_validator("end")
    @classmethod
    def validate_title_style_range(cls, value: int, info) -> int:
        start = info.data.get("start")
        if start is not None and value <= start:
            raise ValueError("title style end must be after start")
        return value


EDITOR_DOCUMENT_VERSION = 2
EDITOR_CANVAS_WIDTH = 1080
EDITOR_CANVAS_HEIGHT = 1920
EDITOR_PRESET_COLORS = {
    "#040404",
    "#000000",
    "#111111",
    "#1B1B1E",
    "#353438",
    "#64748B",
    "#FFFFFF",
    "#F3F0E9",
    "#E32626",
    "#FF4D4F",
    "#FF715E",
    "#FFB4A8",
    "#F97316",
    "#FFD84D",
    "#8BFF5A",
    "#16A34A",
    "#35E6E3",
    "#3B82F6",
    "#2563EB",
    "#A78BFA",
    "#DB2777",
}
EDITOR_STOCK_BACKGROUND_IDS = {
    "news-blue-geometric",
    "news-blue-diagonal",
    "news-red-globe",
    "trust-network",
    "trust-circuit",
    "white-vinyl",
    "white-grid",
    "white-hanji",
}


class EditorFontId(str, Enum):
    PRETENDARD = "pretendard"
    BLACK_HAN_SANS = "black-han-sans"
    GMARKET_SANS = "gmarket-sans"
    DO_HYEON = "do-hyeon"
    NOTO_SERIF_KR = "noto-serif-kr"
    NANUM_MYEONGJO = "nanum-myeongjo"
    SUIT = "suit"
    SPOQA_HAN_SANS_NEO = "spoqa-han-sans-neo"


class EditorCanvasPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=-EDITOR_CANVAS_WIDTH, le=EDITOR_CANVAS_WIDTH)
    y: float = Field(ge=-EDITOR_CANVAS_HEIGHT, le=EDITOR_CANVAS_HEIGHT)


class EditorCanvasBackground(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    kind: str = Field(pattern=r"^(color|image)$")
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    asset_id: str | None = Field(default=None, alias="assetId")

    @model_validator(mode="after")
    def validate_value(self) -> EditorCanvasBackground:
        if self.kind == "color":
            if self.color not in EDITOR_PRESET_COLORS:
                raise ValueError("unsupported editor background color")
            if self.asset_id is not None:
                raise ValueError("color background cannot contain assetId")
        else:
            if self.asset_id not in EDITOR_STOCK_BACKGROUND_IDS:
                raise ValueError("unsupported editor background asset")
            if self.color is not None:
                raise ValueError("image background cannot contain color")
        return self


class EditorTextOverlay(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9:_-]+$")
    text: str = Field(max_length=120)
    font_id: EditorFontId = Field(alias="fontId")
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    effect: str = Field(pattern=r"^(none|outline|shadow)$")
    offset: EditorCanvasPoint
    width: float = Field(ge=1, le=1000)
    scale: float = Field(ge=0.25, le=3)
    start_seconds: float = Field(alias="startSeconds", ge=0)
    end_seconds: float = Field(alias="endSeconds", gt=0)

    @model_validator(mode="after")
    def validate_text_overlay(self) -> EditorTextOverlay:
        if self.color not in EDITOR_PRESET_COLORS:
            raise ValueError("unsupported editor text color")
        if self.end_seconds <= self.start_seconds:
            raise ValueError("text overlay end must be after start")
        return self


class EditorOverlayLayout(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    offsets: dict[str, EditorCanvasPoint]
    comment_offsets: dict[str, EditorCanvasPoint] = Field(alias="commentOffsets")
    scales: dict[str, float]
    fonts: dict[str, EditorFontId]
    visible: dict[str, bool]
    comment_theme: str | None = Field(alias="commentTheme", pattern=r"^(dark|light)$")
    text_overlays: list[EditorTextOverlay] = Field(
        alias="textOverlays",
        max_length=20,
    )
    layer_order: list[str] = Field(alias="layerOrder", min_length=1, max_length=24)
    background: EditorCanvasBackground | None

    @model_validator(mode="after")
    def validate_layout(self) -> EditorOverlayLayout:
        base_layers = {"video", "title", "comment", "channel"}
        if set(self.offsets) != base_layers:
            raise ValueError("editor offsets must contain every base layer")
        if self.offsets["comment"].x != 0 or any(
            offset.x != 0 for offset in self.comment_offsets.values()
        ):
            raise ValueError("comment offsets must remain vertically constrained")
        if set(self.scales) != {"video", "title", "channel"}:
            raise ValueError("editor scales are invalid")
        if not 0.1 <= self.scales["video"] <= 5:
            raise ValueError("video scale is invalid")
        if any(not 0.5 <= self.scales[layer] <= 2 for layer in ("title", "channel")):
            raise ValueError("text scale is invalid")
        if set(self.fonts) != {"title", "channel"}:
            raise ValueError("editor fonts are invalid")
        if set(self.visible) != base_layers or self.visible["video"] is not True:
            raise ValueError("video layer must remain visible")
        text_ids = {overlay.id for overlay in self.text_overlays}
        if len(text_ids) != len(self.text_overlays):
            raise ValueError("text overlay ids must be unique")
        expected_layers = base_layers | {f"text:{text_id}" for text_id in text_ids}
        if len(self.layer_order) != len(set(self.layer_order)):
            raise ValueError("layer order cannot contain duplicates")
        if set(self.layer_order) != expected_layers:
            raise ValueError("layer order does not match editor overlays")
        return self


class EditorVideoClip(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9:_-]+$")
    source_start_seconds: float = Field(alias="sourceStartSeconds", ge=0)
    source_end_seconds: float = Field(alias="sourceEndSeconds", gt=0)

    @model_validator(mode="after")
    def validate_clip(self) -> EditorVideoClip:
        if self.source_end_seconds - self.source_start_seconds < 0.149:
            raise ValueError("editor video clip is too short")
        return self


class EditorDocumentTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: TemplateId
    custom_template_id: str | None = Field(
        default=None,
        alias="customTemplateId",
        pattern=(
            r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-"
            r"[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$"
        ),
    )
    preset_version: int = Field(alias="presetVersion", ge=0, le=100)
    snapshot: dict[str, object] | None


class EditorDocumentTitle(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    text: str = Field(min_length=1, max_length=80)
    text_styles: list[TitleTextStyle] = Field(alias="textStyles", max_length=80)
    font_scale: float = Field(alias="fontScale", ge=0.5, le=2)

    @model_validator(mode="after")
    def validate_title(self) -> EditorDocumentTitle:
        if len(self.text.splitlines()) > 2:
            raise ValueError("editor title can contain at most two lines")
        text_length = len(self.text)
        ordered = sorted(self.text_styles, key=lambda style: style.start)
        if any(style.end > text_length for style in ordered):
            raise ValueError("title style exceeds title length")
        if any(
            style.start < ordered[index - 1].end
            for index, style in enumerate(ordered)
            if index > 0
        ):
            raise ValueError("title styles cannot overlap")
        return self


class EditorDocumentChannel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    display_name: str = Field(alias="displayName", min_length=1, max_length=50)
    thumbnail_url: str | None = Field(default=None, alias="thumbnailUrl", max_length=400_000)
    thumbnail_asset_key: str | None = Field(
        default=None,
        alias="thumbnailAssetKey",
        pattern=(
            r"^edit-sources/[A-Za-z0-9/_-]+/editor-assets/"
            r"[A-Za-z0-9_-]+\.(png|jpg|webp)$"
        ),
    )

    @model_validator(mode="after")
    def validate_thumbnail_source(self) -> EditorDocumentChannel:
        if self.thumbnail_url and self.thumbnail_asset_key:
            raise ValueError("channel thumbnail must use one source")
        return self


class EditorDocumentSubtitles(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    segments: list[SubtitleSegment] = Field(max_length=2000)


class EditorDocumentVideo(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    clips: list[EditorVideoClip] = Field(min_length=1, max_length=120)
    aspect_ratio: VideoAspectRatio = Field(alias="aspectRatio")
    timeline_start_seconds: float = Field(alias="timelineStartSeconds", ge=0)
    timeline_end_seconds: float = Field(alias="timelineEndSeconds", gt=0)
    selection_start_seconds: float = Field(alias="selectionStartSeconds", ge=0)
    selection_end_seconds: float = Field(alias="selectionEndSeconds", gt=0)

    @model_validator(mode="after")
    def validate_video(self) -> EditorDocumentVideo:
        timeline_duration = self.timeline_end_seconds - self.timeline_start_seconds
        if timeline_duration <= 0:
            raise ValueError("editor timeline is invalid")
        for index, clip in enumerate(self.clips):
            if clip.source_end_seconds > timeline_duration + 0.001:
                raise ValueError("editor clip exceeds timeline")
            if (
                index > 0
                and clip.source_start_seconds
                < self.clips[index - 1].source_end_seconds - 0.001
            ):
                raise ValueError("editor clips cannot overlap")
        first_clip = self.clips[0]
        last_clip = self.clips[-1]
        if (
            self.selection_end_seconds <= self.selection_start_seconds
            or self.selection_start_seconds < self.timeline_start_seconds - 0.001
            or self.selection_end_seconds > self.timeline_end_seconds + 0.001
            or abs(
                self.selection_start_seconds
                - self.timeline_start_seconds
                - first_clip.source_start_seconds
            )
            > 0.051
            or abs(
                self.selection_end_seconds
                - self.timeline_start_seconds
                - last_clip.source_end_seconds
            )
            > 0.051
        ):
            raise ValueError("editor selection does not match clips")
        return self

    @property
    def output_duration_seconds(self) -> float:
        return round(
            sum(
                clip.source_end_seconds - clip.source_start_seconds
                for clip in self.clips
            ),
            3,
        )


class EditorDocument(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    version: int = Field(ge=EDITOR_DOCUMENT_VERSION, le=EDITOR_DOCUMENT_VERSION)
    source_short_id: str = Field(
        alias="sourceShortId",
        pattern=(
            r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-"
            r"[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$"
        ),
    )
    base_render_version: int = Field(alias="baseRenderVersion", ge=0)
    template: EditorDocumentTemplate
    title: EditorDocumentTitle
    channel: EditorDocumentChannel
    comments: list[CommentOverlay] = Field(max_length=20)
    subtitles: EditorDocumentSubtitles
    overlays: EditorOverlayLayout
    video: EditorDocumentVideo

    @model_validator(mode="after")
    def validate_document(self) -> EditorDocument:
        duration = self.video.output_duration_seconds
        if duration < 0.999:
            raise ValueError("editor output must be at least one second")
        ordered_comments = sorted(self.comments, key=lambda comment: comment.start_seconds)
        if len({comment.id for comment in self.comments}) != len(self.comments):
            raise ValueError("comment ids must be unique")
        for index, comment in enumerate(ordered_comments):
            if comment.end_seconds > duration + 0.001:
                raise ValueError("comment exceeds editor output")
            if (
                index > 0
                and comment.start_seconds
                < ordered_comments[index - 1].end_seconds - 0.001
            ):
                raise ValueError("comments cannot overlap")
        if any(
            overlay.end_seconds > duration + 0.001
            for overlay in self.overlays.text_overlays
        ):
            raise ValueError("text overlay exceeds editor output")
        if any(
            segment.end
            > (
                self.video.timeline_end_seconds
                - self.video.timeline_start_seconds
                + 0.001
            )
            for segment in self.subtitles.segments
        ):
            raise ValueError("subtitle exceeds editor timeline")
        comment_ids = {comment.id for comment in self.comments}
        if any(
            comment_id not in comment_ids
            for comment_id in self.overlays.comment_offsets
        ):
            raise ValueError("comment offset references a deleted comment")
        return self


_COMMENT_COLORS = ("#8B2CC4", "#D84572", "#2674C8", "#257A5A", "#C76624", "#6655C7")
_COMMENT_NICKNAME_PREFIXES = ("하루", "모카", "여름", "초코", "구름", "새벽", "라온", "소담")
_COMMENT_NICKNAME_SUFFIXES = ("기록", "한스푼", "로그", "이야기", "채널", "노트", "생활", "공간")
COMMENT_LIKE_COUNT_MIN = 10
COMMENT_LIKE_COUNT_MAX = 8_000
COMMENT_DURATION_MIN_MILLISECONDS = 2_500
COMMENT_DURATION_MAX_MILLISECONDS = 5_500
COMMENT_DURATION_MIN_JITTER_MILLISECONDS = 250


def random_comment_time_ranges(
    duration_seconds: float,
    count: int,
) -> list[tuple[float, float]]:
    """Split a clip into continuous, bounded comment ranges with paired jitter."""
    if count <= 0:
        return []

    total_milliseconds = max(500, round(float(duration_seconds) * 1_000))
    base_milliseconds, remainder = divmod(total_milliseconds, count)
    durations = [
        base_milliseconds + (1 if index < remainder else 0)
        for index in range(count)
    ]

    bounds_are_feasible = (
        count * COMMENT_DURATION_MIN_MILLISECONDS
        <= total_milliseconds
        <= count * COMMENT_DURATION_MAX_MILLISECONDS
    )
    if bounds_are_feasible:
        rng = secrets.SystemRandom()
        rng.shuffle(durations)
        for index in range(0, count - 1, 2):
            left = durations[index]
            right = durations[index + 1]
            if rng.randrange(2):
                pair_capacity = min(
                    COMMENT_DURATION_MAX_MILLISECONDS - left,
                    right - COMMENT_DURATION_MIN_MILLISECONDS,
                )
                direction = 1
            else:
                pair_capacity = min(
                    left - COMMENT_DURATION_MIN_MILLISECONDS,
                    COMMENT_DURATION_MAX_MILLISECONDS - right,
                )
                direction = -1

            minimum_jitter = min(
                COMMENT_DURATION_MIN_JITTER_MILLISECONDS,
                pair_capacity,
            )
            jitter = rng.randint(minimum_jitter, pair_capacity)
            durations[index] += direction * jitter
            durations[index + 1] -= direction * jitter
        rng.shuffle(durations)

    ranges: list[tuple[float, float]] = []
    cursor = 0
    for milliseconds in durations:
        end = cursor + milliseconds
        ranges.append((cursor / 1_000, end / 1_000))
        cursor = end
    return ranges


def build_comment_overlay(
    *,
    start_seconds: float,
    end_seconds: float,
    text: str,
) -> dict[str, object]:
    """Attach renderer metadata to validated AI or fallback comment content."""
    nickname = (
        secrets.choice(_COMMENT_NICKNAME_PREFIXES)
        + secrets.choice(_COMMENT_NICKNAME_SUFFIXES)
        + str(secrets.randbelow(90) + 10)
    )
    comment = CommentOverlay(
        id=str(uuid4()),
        startSeconds=round(start_seconds, 3),
        endSeconds=round(end_seconds, 3),
        text=text,
        initial=nickname[0],
        avatarColor=secrets.choice(_COMMENT_COLORS),
        nickname=nickname,
        likeCount=secrets.randbelow(COMMENT_LIKE_COUNT_MAX - COMMENT_LIKE_COUNT_MIN + 1)
        + COMMENT_LIKE_COUNT_MIN,
        ageLabel=f"{secrets.randbelow(11) + 1}개월 전",
    )
    return comment.model_dump(by_alias=True)


def fallback_comment_overlays(
    duration_seconds: float,
    *,
    count: int,
    clip_index: int,
) -> list[dict[str, object]]:
    """Create stable, non-overlapping fallback comments for one numbered short."""
    duration = max(0.5, float(duration_seconds))
    fallback_texts = select_fallback_comment_texts(
        count,
        clip_index=clip_index,
    )
    if not fallback_texts:
        return []
    time_ranges = random_comment_time_ranges(duration, len(fallback_texts))
    comments: list[dict[str, object]] = []
    for text, (start_seconds, end_seconds) in zip(
        fallback_texts,
        time_ranges,
        strict=True,
    ):
        comments.append(
            build_comment_overlay(
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                text=text,
            )
        )
    return comments


def default_comment_overlays(duration_seconds: float) -> list[dict[str, object]]:
    """Create five fallback comments for legacy and renderer-only callers."""
    return fallback_comment_overlays(duration_seconds, count=5, clip_index=1)


class HighlightClip(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_seconds: float
    end_seconds: float
    hook_title: str = Field(min_length=1, max_length=MAX_HOOK_TITLE_CHARS)
    reason: str = Field(default="", max_length=1000)
    selection_raw_start_seconds: float | None = None
    selection_raw_end_seconds: float | None = None
    selection_raw_duration_seconds: float | None = None
    selection_candidate_index: int | None = Field(default=None, ge=1)
    selection_provider: str | None = Field(default=None, max_length=50)
    selection_model: str | None = Field(default=None, max_length=200)
    selection_length_adjustment: str | None = Field(
        default=None,
        pattern=r"^(none|min_clamp|max_clamp)$",
    )
    selection_repositioned: bool | None = None

    @field_validator("hook_title", mode="before")
    @classmethod
    def bound_hook_title(cls, value: object) -> str:
        lines = [" ".join(line.split()) for line in str(value).splitlines() if line.strip()]
        clean = "\n".join(lines[:2]) or "핵심 장면"
        return clean[:MAX_HOOK_TITLE_CHARS].rstrip()


class HighlightCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_seconds: float
    end_seconds: float
    hook_title_line1: str = Field(min_length=1, max_length=MAX_HOOK_TITLE_CHARS // 2)
    hook_title_line2: str = Field(min_length=1, max_length=MAX_HOOK_TITLE_CHARS // 2)
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("hook_title_line1", "hook_title_line2", mode="before")
    @classmethod
    def bound_title_line(cls, value: object) -> str:
        return " ".join(str(value).split())[: MAX_HOOK_TITLE_CHARS // 2].rstrip()


class SelectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clips: list[HighlightCandidate]
