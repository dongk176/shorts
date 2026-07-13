from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TemplateId(str, Enum):
    DARK_RED = "dark-red"
    WHITE_YELLOW = "white-yellow"
    DARK_MINIMAL = "dark-minimal"
    PAPER = "paper"


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


class HighlightClip(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_seconds: float
    end_seconds: float
    hook_title: str = Field(min_length=1, max_length=MAX_HOOK_TITLE_CHARS)
    reason: str = ""

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
    reason: str = ""

    @field_validator("hook_title_line1", "hook_title_line2", mode="before")
    @classmethod
    def bound_title_line(cls, value: object) -> str:
        return " ".join(str(value).split())[: MAX_HOOK_TITLE_CHARS // 2].rstrip()


class SelectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clips: list[HighlightCandidate]
