from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .errors import InvalidYouTubeUrl
from .url_validation import validate_youtube_url


class TemplateId(str, Enum):
    DARK_RED = "dark-red"
    WHITE_YELLOW = "white-yellow"
    DARK_MINIMAL = "dark-minimal"
    PAPER = "paper"


class JobStatus(str, Enum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    TRANSCRIBING = "transcribing"
    SELECTING = "selecting"
    RENDERING = "rendering"
    COMPLETED = "completed"
    FAILED = "failed"


class AnalyzeRequest(BaseModel):
    youtube_url: str = Field(min_length=1, max_length=2048)

    @field_validator("youtube_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        try:
            normalized, _ = validate_youtube_url(value)
            return normalized
        except InvalidYouTubeUrl as exc:
            raise ValueError(exc.message) from exc


class AnalyzeResponse(BaseModel):
    video_id: str
    title: str
    channel_name: str
    thumbnail_url: str
    duration_seconds: float = Field(ge=0)


class CreateJobRequest(AnalyzeRequest):
    template_id: TemplateId = TemplateId.DARK_RED
    rights_confirmed: bool
    range_start_seconds: float = Field(default=0, ge=0)
    range_end_seconds: float | None = Field(default=None, gt=0)


class CreateJobResponse(BaseModel):
    job_id: str
    status: JobStatus


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


class OutputItem(BaseModel):
    id: str
    title: str
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    video_url: str
    download_url: str
    transcript_text: str = ""
    title_color: str | None = None
    title_font_size: int | None = None


class EditOutputRequest(BaseModel):
    title: str = Field(min_length=1, max_length=24)
    title_color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    title_font_size: int = Field(ge=44, le=96)


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: int = Field(ge=0, le=100)
    message: str
    outputs: list[OutputItem] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    detail: str
