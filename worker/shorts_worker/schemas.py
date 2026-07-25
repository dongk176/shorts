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

    id: str
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
