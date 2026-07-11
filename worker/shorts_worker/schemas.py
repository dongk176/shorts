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
    hook_title: str = Field(min_length=1, max_length=80)
    reason: str = ""


class SelectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clips: list[HighlightClip]
