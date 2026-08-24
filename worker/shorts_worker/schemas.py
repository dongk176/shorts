from __future__ import annotations

import secrets
from enum import StrEnum
from math import floor
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .fallback_comments import select_fallback_comment_texts


class TemplateId(StrEnum):
    DARK_RED = "dark-red"
    WHITE_YELLOW = "white-yellow"
    DARK_MINIMAL = "dark-minimal"
    PAPER = "paper"
    COMMENT_CAPTURE = "comment-capture"


class VideoAspectRatio(StrEnum):
    LANDSCAPE = "16:9"
    LANDSCAPE_FIVE_FOUR = "5:4"
    SQUARE = "1:1"
    PORTRAIT = "4:5"
    FULL_VERTICAL = "9:16"


class EditorFontId(StrEnum):
    PRETENDARD = "pretendard"
    BLACK_HAN_SANS = "black-han-sans"
    GMARKET_SANS = "gmarket-sans"
    DO_HYEON = "do-hyeon"
    NOTO_SERIF_KR = "noto-serif-kr"
    NANUM_MYEONGJO = "nanum-myeongjo"
    SUIT = "suit"
    SPOQA_HAN_SANS_NEO = "spoqa-han-sans-neo"
    NOTO_SANS_KR = "noto-sans-kr"
    NANUM_SQUARE_NEO = "nanum-square-neo"
    SANDBOX_AGGRO = "sandbox-aggro"
    JUA = "jua"
    S_CORE_DREAM = "s-core-dream"
    CAFE24_ANEMONE = "cafe24-anemone"
    CAFE24_PRO_UP = "cafe24-pro-up"
    RIDI_BATANG = "ridi-batang"
    JALNAN_2 = "jalnan-2"
    GODO = "godo"
    GALMURI_9 = "galmuri-9"
    PAPERLOGY = "paperlogy"


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


class TemplateSubtitleLayer(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    visible: bool
    variant: str = Field(default="highlight", pattern=r"^(highlight|pop)$")
    x: int = Field(default=540, ge=540, le=540)
    y: int = Field(ge=0, le=1920)
    max_width: int = Field(alias="maxWidth", ge=180, le=1080)
    font_id: EditorFontId = Field(default=EditorFontId.PRETENDARD, alias="fontId")
    font_size: int = Field(alias="fontSize", ge=24, le=120)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    accent_color: str = Field(
        default="#35E6E3",
        alias="accentColor",
        pattern=r"^#[0-9A-Fa-f]{6}$",
    )
    background_color: str | None = Field(
        default=None,
        alias="backgroundColor",
        pattern=r"^#[0-9A-Fa-f]{6}$",
    )


class TemplateTitleLayer(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    visible: bool
    x: int = Field(ge=0, le=1080)
    y: int = Field(ge=0, le=1920)
    max_width: int = Field(alias="maxWidth", ge=180, le=1080)
    font_size: int = Field(alias="fontSize", ge=24, le=96)
    font_id: EditorFontId | None = Field(default=None, alias="fontId")
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

    schema_version: int = Field(alias="schemaVersion", ge=1, le=5)
    background: TemplateBackground
    video: TemplateVideoLayer
    title: TemplateTitleLayer
    subtitle: TemplateSubtitleLayer
    channel: TemplateTextLayer
    comment: TemplateCommentLayer

    @model_validator(mode="before")
    @classmethod
    def upgrade_comment_layer(cls, value: object) -> object:
        if not isinstance(value, dict):
            return value
        upgraded = dict(value)
        schema_version = upgraded.get("schemaVersion")
        subtitle = upgraded.get("subtitle")
        if (
            schema_version == 5
            and isinstance(subtitle, dict)
            and "backgroundColor" in subtitle
        ):
            raise ValueError("template v5 subtitle backgroundColor is unsupported")
        if isinstance(subtitle, dict) and schema_version in {1, 2, 3, 4}:
            legacy_font_size = subtitle.get("fontSize", 24)
            if not isinstance(legacy_font_size, int | float):
                legacy_font_size = 24
            upgraded["subtitle"] = {
                **subtitle,
                "visible": False,
                "variant": "highlight",
                "x": 540,
                "fontId": "pretendard",
                "fontSize": max(24, round(legacy_font_size)),
                "accentColor": "#35E6E3",
            }
        if "comment" in upgraded:
            return upgraded
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

    @model_validator(mode="after")
    def validate_v5_fonts(self) -> CustomTemplateConfig:
        if self.schema_version == 5 and self.title.font_id is None:
            raise ValueError("template v5 title requires fontId")
        if self.schema_version == 5:
            subtitle_height = max(140, self.subtitle.font_size + 32)
            if (
                self.subtitle.y - subtitle_height / 2 < 0
                or self.subtitle.y + subtitle_height / 2 > 1920
            ):
                raise ValueError("template v5 subtitle exceeds canvas")
        return self


class OutputLanguage(StrEnum):
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
AI_CLIP_MAX_SECONDS = 120.0
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
EDITOR_DOCUMENT_LATEST_VERSION = 3
EDITOR_RENDER_SPEC_VERSION = 1
EDITOR_RENDER_SPEC_LATEST_VERSION = 3
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


EDITOR_FONT_FILE_IDS = {
    EditorFontId.PRETENDARD: "Pretendard-Bold.woff2",
    EditorFontId.BLACK_HAN_SANS: "BlackHanSans-Regular.ttf",
    EditorFontId.GMARKET_SANS: "GmarketSans-Bold.ttf",
    EditorFontId.DO_HYEON: "DoHyeon-Regular.ttf",
    EditorFontId.NOTO_SERIF_KR: "NotoSerifKR-Variable.ttf",
    EditorFontId.NANUM_MYEONGJO: "NanumMyeongjo-Bold.ttf",
    EditorFontId.SUIT: "SUIT-Bold.woff2",
    EditorFontId.SPOQA_HAN_SANS_NEO: "SpoqaHanSansNeo-Bold.woff2",
    EditorFontId.NOTO_SANS_KR: "NotoSansKR-Variable.ttf",
    EditorFontId.NANUM_SQUARE_NEO: "NanumSquareNeo-Bold.ttf",
    EditorFontId.SANDBOX_AGGRO: "SandboxAggro-Bold.ttf",
    EditorFontId.JUA: "Jua-Regular.ttf",
    EditorFontId.S_CORE_DREAM: "SCoreDream-ExtraBold.otf",
    EditorFontId.CAFE24_ANEMONE: "Cafe24Anemone-Bold.woff",
    EditorFontId.CAFE24_PRO_UP: "Cafe24ProUp-Regular.woff2",
    EditorFontId.RIDI_BATANG: "RIDIBatang-Regular.woff",
    EditorFontId.JALNAN_2: "Jalnan2-Regular.woff2",
    EditorFontId.GODO: "Godo-Bold.ttf",
    EditorFontId.GALMURI_9: "Galmuri9-Regular.ttf",
    EditorFontId.PAPERLOGY: "Paperlogy-7Bold.ttf",
}
EDITOR_FONT_STATIC_WEIGHTS = {
    EditorFontId.PRETENDARD: 700,
    EditorFontId.BLACK_HAN_SANS: 400,
    EditorFontId.GMARKET_SANS: 700,
    EditorFontId.DO_HYEON: 400,
    EditorFontId.NANUM_MYEONGJO: 700,
    EditorFontId.SUIT: 700,
    EditorFontId.SPOQA_HAN_SANS_NEO: 700,
    EditorFontId.NANUM_SQUARE_NEO: 700,
    EditorFontId.SANDBOX_AGGRO: 700,
    EditorFontId.JUA: 400,
    EditorFontId.S_CORE_DREAM: 800,
    EditorFontId.CAFE24_ANEMONE: 700,
    EditorFontId.CAFE24_PRO_UP: 400,
    EditorFontId.RIDI_BATANG: 400,
    EditorFontId.JALNAN_2: 400,
    EditorFontId.GODO: 700,
    EditorFontId.GALMURI_9: 400,
    EditorFontId.PAPERLOGY: 700,
}
EDITOR_FONT_VARIABLE_IDS = {
    EditorFontId.NOTO_SERIF_KR,
    EditorFontId.NOTO_SANS_KR,
}


class EditorResolvedFontFace(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    font_id: EditorFontId = Field(alias="fontId")
    file_id: str = Field(alias="fileId", min_length=1, max_length=100)
    family: str = Field(min_length=1, max_length=200)
    requested_weight: int = Field(alias="requestedWeight")
    resolved_weight: int = Field(alias="resolvedWeight")
    variable_weight: int | None = Field(alias="variableWeight")

    @model_validator(mode="after")
    def validate_face(self) -> EditorResolvedFontFace:
        if self.file_id != EDITOR_FONT_FILE_IDS[self.font_id]:
            raise ValueError("editor render font file does not match font id")
        if self.requested_weight not in {700, 800}:
            raise ValueError("editor render requested font weight is invalid")
        if self.font_id in EDITOR_FONT_VARIABLE_IDS:
            if (
                self.variable_weight != self.requested_weight
                or self.resolved_weight != self.requested_weight
            ):
                raise ValueError("editor variable font axis is invalid")
        elif (
            self.variable_weight is not None
            or self.resolved_weight != EDITOR_FONT_STATIC_WEIGHTS[self.font_id]
        ):
            raise ValueError("editor static font weight is invalid")
        return self


class EditorRenderTitleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    lines: list[str] = Field(min_length=1, max_length=2)
    center_x: int = Field(alias="centerX", ge=540, le=540)
    offset_y: float = Field(alias="offsetY", ge=-1920, le=1920)
    font_size: float = Field(alias="fontSize", ge=18, le=200)
    scale: float = Field(ge=1, le=1)
    font: EditorResolvedFontFace


class EditorRenderChannelSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    offset_x: float = Field(alias="offsetX", ge=-1080, le=1080)
    offset_y: float = Field(alias="offsetY", ge=-1920, le=1920)
    scale: float = Field(ge=0.5, le=2)
    font: EditorResolvedFontFace


class EditorRenderCommentSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9:_-]+$")
    offset_y: float = Field(alias="offsetY", ge=-1920, le=1920)
    start_frame: int = Field(alias="startFrame", ge=0)
    end_frame: int = Field(alias="endFrame", gt=0)

    @model_validator(mode="after")
    def validate_frames(self) -> EditorRenderCommentSpec:
        if self.end_frame <= self.start_frame:
            raise ValueError("editor comment frames are invalid")
        return self


class EditorSubtitleCueEdit(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    cue_index: int = Field(alias="cueIndex", ge=0, le=1_999)
    text: str = Field(min_length=1, max_length=200)

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("edited caption text cannot be empty")
        return stripped


class EditorRenderSubtitleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    center_x: int = Field(alias="centerX", ge=540, le=540)
    offset_y: float = Field(alias="offsetY", ge=-900, le=900)
    scale: float = Field(ge=0.5, le=2)
    font_id: EditorFontId | None = Field(default=None, alias="fontId")
    accent_color: str | None = Field(
        default=None,
        alias="accentColor",
        pattern=r"^#[0-9A-Fa-f]{6}$",
    )
    font_size: float | None = Field(default=None, alias="fontSize", ge=24, le=120)
    color: str | None = Field(
        default=None,
        pattern=r"^#[0-9A-Fa-f]{6}$",
    )
    cue_edits: list[EditorSubtitleCueEdit] = Field(
        default_factory=list,
        alias="cueEdits",
        max_length=2_000,
    )

    @model_validator(mode="after")
    def validate_unique_cue_edits(self) -> EditorRenderSubtitleSpec:
        indexes = [edit.cue_index for edit in self.cue_edits]
        if len(indexes) != len(set(indexes)):
            raise ValueError("edited caption cue indexes must be unique")
        return self


class EditorRenderTextSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9:_-]+$")
    lines: list[str] = Field(min_length=1, max_length=20)
    center_x: float = Field(alias="centerX", ge=-1080, le=2160)
    center_y: float = Field(alias="centerY", ge=-1920, le=3840)
    width: float = Field(ge=1, le=1000)
    font_size: int = Field(alias="fontSize", ge=72, le=72)
    line_height: int = Field(alias="lineHeight", ge=86, le=86)
    scale: float = Field(ge=0.25, le=3)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    effect: str = Field(pattern=r"^(none|outline|shadow)$")
    outline_width: int = Field(alias="outlineWidth", ge=0, le=10)
    shadow_blur: int = Field(alias="shadowBlur", ge=0, le=13)
    start_frame: int = Field(alias="startFrame", ge=0)
    end_frame: int = Field(alias="endFrame", gt=0)
    font: EditorResolvedFontFace

    @model_validator(mode="after")
    def validate_values(self) -> EditorRenderTextSpec:
        if self.end_frame <= self.start_frame:
            raise ValueError("editor text frames are invalid")
        if self.outline_width != (10 if self.effect == "outline" else 0):
            raise ValueError("editor text outline spec is invalid")
        if self.shadow_blur != (13 if self.effect == "shadow" else 0):
            raise ValueError("editor text shadow spec is invalid")
        return self


class EditorRenderVideoSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    offset_x: float = Field(alias="offsetX", ge=-1080, le=1080)
    offset_y: float = Field(alias="offsetY", ge=-1920, le=1920)
    scale: float = Field(ge=0.1, le=5)


class EditorRenderSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    version: int = Field(
        ge=EDITOR_RENDER_SPEC_VERSION,
        le=EDITOR_RENDER_SPEC_LATEST_VERSION,
    )
    canvas: dict[str, int]
    fps: int = Field(ge=30, le=30)
    layer_order: list[str] = Field(alias="layerOrder", min_length=1, max_length=24)
    title: EditorRenderTitleSpec
    channel: EditorRenderChannelSpec
    comments: list[EditorRenderCommentSpec] = Field(max_length=20)
    text_overlays: list[EditorRenderTextSpec] = Field(alias="textOverlays", max_length=20)
    video: EditorRenderVideoSpec
    subtitles: EditorRenderSubtitleSpec | None = None

    @model_validator(mode="after")
    def validate_canvas(self) -> EditorRenderSpec:
        if self.canvas != {"width": 1080, "height": 1920}:
            raise ValueError("editor render canvas is invalid")
        if self.version == 1 and self.subtitles is not None:
            raise ValueError("editor renderSpec v1 cannot contain subtitle layout")
        if self.version in {2, 3} and self.subtitles is None:
            raise ValueError("editor renderSpec subtitle layout is required")
        if self.version == 3 and (
            self.subtitles is None
            or self.subtitles.font_size is None
            or self.subtitles.color is None
        ):
            raise ValueError("editor renderSpec v3 requires subtitle style")
        return self


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

    version: int = Field(
        ge=EDITOR_DOCUMENT_VERSION,
        le=EDITOR_DOCUMENT_LATEST_VERSION,
    )
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
    render_spec: EditorRenderSpec | None = Field(default=None, alias="renderSpec")

    @model_validator(mode="after")
    def validate_document(self) -> EditorDocument:
        if self.version == 2 and self.render_spec is not None:
            raise ValueError("editor v2 cannot contain renderSpec")
        if self.version == 3 and self.render_spec is None:
            raise ValueError("editor v3 requires renderSpec")
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
        if self.render_spec is not None:
            spec = self.render_spec
            if spec.layer_order != self.overlays.layer_order:
                raise ValueError("renderSpec layer order does not match editor overlays")
            if spec.title.center_x != 540:
                raise ValueError("editor title must remain horizontally centered")
            if (
                spec.title.offset_y != self.overlays.offsets["title"].y
                or spec.title.font.font_id != self.overlays.fonts["title"]
                or spec.title.font.requested_weight != 700
            ):
                raise ValueError("renderSpec title does not match editor title")
            if (
                spec.channel.offset_x != self.overlays.offsets["channel"].x
                or spec.channel.offset_y != self.overlays.offsets["channel"].y
                or spec.channel.scale != self.overlays.scales["channel"]
                or spec.channel.font.font_id != self.overlays.fonts["channel"]
                or spec.channel.font.requested_weight != 700
            ):
                raise ValueError("renderSpec channel does not match editor channel")
            if (
                spec.video.offset_x != self.overlays.offsets["video"].x
                or spec.video.offset_y != self.overlays.offsets["video"].y
                or spec.video.scale != self.overlays.scales["video"]
            ):
                raise ValueError("renderSpec video does not match editor video")
            comment_specs = {item.id: item for item in spec.comments}
            if set(comment_specs) != {item.id for item in self.comments}:
                raise ValueError("renderSpec comments do not match editor comments")
            for comment in self.comments:
                item = comment_specs[comment.id]
                expected_offset = self.overlays.comment_offsets.get(
                    comment.id,
                    self.overlays.offsets["comment"],
                ).y
                if (
                    item.offset_y != expected_offset
                    or item.start_frame != floor(comment.start_seconds * 30 + 0.5)
                    or item.end_frame != floor(comment.end_seconds * 30 + 0.5)
                ):
                    raise ValueError("renderSpec comment timing is invalid")
            text_specs = {item.id: item for item in spec.text_overlays}
            if set(text_specs) != {item.id for item in self.overlays.text_overlays}:
                raise ValueError("renderSpec text layers do not match editor text layers")
            for overlay in self.overlays.text_overlays:
                item = text_specs[overlay.id]
                if (
                    item.center_x != 540 + overlay.offset.x
                    or item.center_y != 960 + overlay.offset.y
                    or item.width != overlay.width
                    or item.scale != overlay.scale
                    or item.color != overlay.color
                    or item.effect != overlay.effect
                    or item.start_frame != floor(overlay.start_seconds * 30 + 0.5)
                    or item.end_frame != floor(overlay.end_seconds * 30 + 0.5)
                    or item.font.font_id != overlay.font_id
                    or item.font.requested_weight != 800
                ):
                    raise ValueError("renderSpec text layer does not match editor overlay")
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
    viral_score: int | None = Field(default=None, ge=0, le=100)
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
    hook_score: int = Field(ge=0, le=30)
    completeness_score: int = Field(ge=0, le=20)
    impact_score: int = Field(ge=0, le=20)
    shareability_score: int = Field(ge=0, le=20)
    density_score: int = Field(ge=0, le=10)

    @field_validator("hook_title_line1", "hook_title_line2", mode="before")
    @classmethod
    def bound_title_line(cls, value: object) -> str:
        return " ".join(str(value).split())[: MAX_HOOK_TITLE_CHARS // 2].rstrip()


class SelectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clips: list[HighlightCandidate]
