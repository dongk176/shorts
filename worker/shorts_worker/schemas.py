from __future__ import annotations

import secrets
from enum import Enum
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    like_count: int = Field(alias="likeCount", ge=1_312, le=999_999)
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


def default_comment_overlays(duration_seconds: float) -> list[dict[str, object]]:
    """Create three non-overlapping placeholder comments once for persisted rendering."""
    duration = max(0.3, float(duration_seconds))
    boundaries = [0.0, duration / 3, duration * 2 / 3, duration]
    comments: list[dict[str, object]] = []
    for index in range(3):
        nickname = (
            secrets.choice(_COMMENT_NICKNAME_PREFIXES)
            + secrets.choice(_COMMENT_NICKNAME_SUFFIXES)
            + str(secrets.randbelow(90) + 10)
        )
        comment = CommentOverlay(
            id=str(uuid4()),
            startSeconds=round(boundaries[index], 3),
            endSeconds=round(boundaries[index + 1], 3),
            text="아 진짜 ㅋㅋㅋㅋㅋㅋㅋㅋ",
            initial=nickname[0],
            avatarColor=secrets.choice(_COMMENT_COLORS),
            nickname=nickname,
            likeCount=secrets.randbelow(18_689) + 1_312,
            ageLabel=f"{secrets.randbelow(11) + 1}개월 전",
        )
        comments.append(comment.model_dump(by_alias=True))
    return comments


class HighlightClip(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_seconds: float
    end_seconds: float
    hook_title: str = Field(min_length=1, max_length=MAX_HOOK_TITLE_CHARS)
    reason: str = Field(default="", max_length=1000)

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
