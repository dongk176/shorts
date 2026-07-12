from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TemplateId(str, Enum):
    DARK_RED = "dark-red"
    WHITE_YELLOW = "white-yellow"
    DARK_MINIMAL = "dark-minimal"
    PAPER = "paper"


class ClipLengthOption(str, Enum):
    SEC_30 = "sec_30"
    SEC_31_60 = "sec_31_60"
    SEC_61_180 = "sec_61_180"


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


CLIP_LENGTH_RULES = {
    ClipLengthOption.SEC_30: (20.0, 30.0, 29.0),
    ClipLengthOption.SEC_31_60: (31.0, 60.0, 50.0),
    ClipLengthOption.SEC_61_180: (61.0, 180.0, 90.0),
}


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
    hook_title: str = Field(min_length=1)
    reason: str = ""


class SelectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clips: list[HighlightClip]
