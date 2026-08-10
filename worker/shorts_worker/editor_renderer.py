from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from math import ceil, floor
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from .caption_templates import (
    create_caption_ass,
    prepare_caption_fonts,
    reflow_caption_cues_for_clips,
)
from .config import Settings
from .errors import RenderError
from .media import media_duration, probe_media, run_command, video_fps
from .overlays import (
    CUSTOM_BACKGROUND_ASSETS,
    TEMPLATE_STYLES,
    _title_line_character_indices,
    _title_style_runs,
    create_ass_subtitles,
    create_comment_panel,
    wrap_korean_title,
)
from .renderer import VideoLayout, caption_video_layout
from .schemas import (
    CustomTemplateConfig,
    EditorDocument,
    EditorFontId,
    EditorRenderTextSpec,
    EditorTextOverlay,
    SubtitleSegment,
    TemplateId,
    VideoAspectRatio,
)

CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920
TITLE_MAX_WIDTH = 930
TITLE_LINE_GAP = 18
COMMENT_CAPTURE_LANDSCAPE_LIFT_PX = 160
PRESET_SQUARE_CHANNEL_CENTER_Y = 1580
COMMENT_CAPTURE_SQUARE_CHANNEL_CENTER_Y = 1840
VIDEO_HEIGHTS = {
    VideoAspectRatio.LANDSCAPE: 608,
    VideoAspectRatio.LANDSCAPE_FIVE_FOUR: 864,
    VideoAspectRatio.SQUARE: 1080,
    VideoAspectRatio.PORTRAIT: 1350,
    VideoAspectRatio.FULL_VERTICAL: 1920,
}
EDITOR_FONT_FILES = {
    EditorFontId.PRETENDARD: "Pretendard-Bold.woff2",
    EditorFontId.BLACK_HAN_SANS: "BlackHanSans-Regular.ttf",
    EditorFontId.GMARKET_SANS: "GmarketSans-Bold.ttf",
    EditorFontId.DO_HYEON: "DoHyeon-Regular.ttf",
    EditorFontId.NOTO_SERIF_KR: "NotoSerifKR-Variable.ttf",
    EditorFontId.NANUM_MYEONGJO: "NanumMyeongjo-Bold.ttf",
    EditorFontId.SUIT: "SUIT-Bold.woff2",
    EditorFontId.SPOQA_HAN_SANS_NEO: "SpoqaHanSansNeo-Bold.woff2",
}
EDITOR_FONT_DIRECTORY = Path(__file__).parent / "assets" / "editor_fonts"
EDITOR_FONT_DEFAULT_VARIATION_WEIGHTS = {
    EditorFontId.NOTO_SERIF_KR: 700,
}
TIMED_OVERLAY_TRANSITION_FRAMES = 3
TIMED_OVERLAY_CONTIGUOUS_TOLERANCE_SECONDS = 0.001
EDITOR_SUBTITLE_DEFAULT_MARGIN_V = 445
EDITOR_SUBTITLE_DEFAULT_FONT_SIZE = 48


@dataclass(frozen=True, slots=True)
class EditorVideoFrame:
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class EditorSubtitleStyle:
    margin_v: int
    font_size: int


def editor_subtitle_style(document: EditorDocument) -> EditorSubtitleStyle:
    render_subtitles = (
        document.render_spec.subtitles
        if document.render_spec and document.render_spec.version == 2
        else None
    )
    if render_subtitles is None:
        return EditorSubtitleStyle(
            margin_v=EDITOR_SUBTITLE_DEFAULT_MARGIN_V,
            font_size=EDITOR_SUBTITLE_DEFAULT_FONT_SIZE,
        )
    return EditorSubtitleStyle(
        margin_v=round(
            EDITOR_SUBTITLE_DEFAULT_MARGIN_V - render_subtitles.offset_y
        ),
        font_size=round(
            EDITOR_SUBTITLE_DEFAULT_FONT_SIZE * render_subtitles.scale
        ),
    )


@dataclass(frozen=True, slots=True)
class EditorLayerAsset:
    path: Path
    start_seconds: float | None = None
    end_seconds: float | None = None
    x: int = 0
    y: int = 0
    fade_in: bool = False
    fade_out: bool = False


def _prepare_editor_layer_asset(
    asset: EditorLayerAsset,
    output_path: Path,
) -> EditorLayerAsset | None:
    with Image.open(asset.path) as source:
        image = source.convert("RGBA")
        bounds = image.getchannel("A").getbbox()
        if bounds is None:
            return None
        left, top, right, bottom = bounds
        cropped = image.crop(bounds)
        cropped.save(output_path, format="PNG", compress_level=1)
    return EditorLayerAsset(
        path=output_path,
        start_seconds=asset.start_seconds,
        end_seconds=asset.end_seconds,
        x=left,
        y=top,
        fade_in=asset.fade_in,
        fade_out=asset.fade_out,
    )


def editor_render_timeout_seconds(
    configured_timeout_seconds: float,
    duration_seconds: float,
) -> float:
    duration_budget = min(1_200.0, 120.0 + duration_seconds * 15.0)
    return max(configured_timeout_seconds, duration_budget)


def editor_font_path(font_id: EditorFontId) -> Path:
    path = EDITOR_FONT_DIRECTORY / EDITOR_FONT_FILES[font_id]
    if not path.is_file():
        raise RenderError(f"편집기 폰트 파일을 찾지 못했습니다: {font_id.value}")
    return path


def load_editor_font(
    font_id: EditorFontId,
    size: int,
    *,
    weight: int | None = None,
) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(
        str(editor_font_path(font_id)),
        size=max(1, round(size)),
    )
    variation_weight = (
        weight
        if font_id is EditorFontId.NOTO_SERIF_KR and weight is not None
        else EDITOR_FONT_DEFAULT_VARIATION_WEIGHTS.get(font_id)
    )
    if variation_weight is not None:
        # The browser preview requests font-weight: 700. Pillow otherwise opens
        # variable fonts at their default axis value, which made Noto Serif KR
        # visibly thinner in the rendered video than in the editor preview.
        font.set_variation_by_axes([variation_weight])
    return font


def verify_editor_fonts() -> None:
    for font_id in EditorFontId:
        font = load_editor_font(font_id, 48)
        box = font.getbbox("한글 Aa 123")
        if box[2] <= box[0] or box[3] <= box[1]:
            raise RenderError(f"편집기 폰트 글리프를 읽지 못했습니다: {font_id.value}")


def _custom_template_config(document: EditorDocument) -> CustomTemplateConfig | None:
    snapshot = document.template.snapshot
    if not isinstance(snapshot, dict):
        return None
    config = snapshot.get("config")
    return CustomTemplateConfig.model_validate(config) if isinstance(config, dict) else None


def _editor_caption_layout(
    caption_render_spec: dict[str, object] | None,
) -> VideoLayout | None:
    return (
        caption_video_layout(caption_render_spec)
        if caption_render_spec is not None
        else None
    )


def editor_video_frame(
    document: EditorDocument,
    caption_render_spec: dict[str, object] | None = None,
) -> EditorVideoFrame:
    config = _custom_template_config(document)
    caption_layout = _editor_caption_layout(caption_render_spec)
    if caption_layout is not None:
        base_x = 0
        base_y = caption_layout.video_y
        base_width = CANVAS_WIDTH
        base_height = caption_layout.video_height
    elif config is not None:
        base_x = config.video.x
        base_y = config.video.y
        base_width = config.video.width
        base_height = config.video.height
    else:
        aspect_ratio = document.video.aspect_ratio
        if (
            document.template.id is TemplateId.COMMENT_CAPTURE
            and aspect_ratio is VideoAspectRatio.FULL_VERTICAL
        ):
            aspect_ratio = VideoAspectRatio.PORTRAIT
        base_width = CANVAS_WIDTH
        base_height = VIDEO_HEIGHTS[aspect_ratio]
        base_x = 0
        base_y = round((CANVAS_HEIGHT - base_height) / 2)
        if (
            document.template.id is TemplateId.COMMENT_CAPTURE
            and document.template.preset_version >= 2
            and aspect_ratio is VideoAspectRatio.LANDSCAPE
        ):
            base_y -= COMMENT_CAPTURE_LANDSCAPE_LIFT_PX
    scale = document.overlays.scales["video"]
    offset = document.overlays.offsets["video"]
    width = max(1, round(base_width * scale))
    height = max(1, round(base_height * scale))
    x = round(base_x + offset.x - base_width * (scale - 1) / 2)
    y = round(base_y + offset.y - base_height * (scale - 1) / 2)
    # The browser intentionally allows an enlarged video to extend beyond the
    # canvas. FFmpeg's overlay filter clips the overflow in the same way CSS
    # overflow-hidden clips the preview.
    return EditorVideoFrame(x=x, y=y, width=width, height=height)


def retime_editor_subtitles(document: EditorDocument) -> list[SubtitleSegment]:
    retimed: list[SubtitleSegment] = []
    output_cursor = 0.0
    for clip in document.video.clips:
        for segment in document.subtitles.segments:
            start = max(segment.start, clip.source_start_seconds)
            end = min(segment.end, clip.source_end_seconds)
            if end <= start:
                continue
            retimed.append(SubtitleSegment(
                start=round(output_cursor + start - clip.source_start_seconds, 3),
                end=round(output_cursor + end - clip.source_start_seconds, 3),
                text=segment.text,
            ))
        output_cursor += clip.source_end_seconds - clip.source_start_seconds
    return retimed


def retime_editor_caption_spec(
    document: EditorDocument,
    caption_render_spec: dict[str, object],
) -> dict[str, object] | None:
    """Apply trusted editor timing and layout to an immutable caption template."""
    spec = deepcopy(caption_render_spec)
    if int(spec.get("schemaVersion") or 0) != 3:
        raise RenderError("원본 자막 렌더 사양 버전이 올바르지 않습니다.")
    if str(spec.get("templateId") or "") not in {"basic", "highlight", "pop"}:
        raise RenderError("원본 자막 렌더 템플릿이 올바르지 않습니다.")
    fps = int(spec.get("fps") or 0)
    if fps != 30:
        raise RenderError("원본 자막 렌더 프레임레이트가 올바르지 않습니다.")

    render_subtitles = (
        document.render_spec.subtitles
        if document.render_spec and document.render_spec.version == 2
        else None
    )
    offset_y = render_subtitles.offset_y if render_subtitles else 0.0
    scale = render_subtitles.scale if render_subtitles else 1.0

    cue_edits = {
        edit.cue_index: edit.text
        for edit in (render_subtitles.cue_edits if render_subtitles else [])
    }

    source_cues = spec.get("cues")
    safe_area_value = spec.get("safeArea")
    if not isinstance(source_cues, list) or not isinstance(safe_area_value, dict):
        raise RenderError("원본 자막 편집 정보를 찾을 수 없습니다.")
    safe_area = {
        key: int(safe_area_value[key])
        for key in ("x", "y", "width", "height")
    }

    clip_windows: list[tuple[int, int, int]] = []
    output_cursor = 0
    for clip in document.video.clips:
        clip_start = floor(clip.source_start_seconds * fps + 0.5)
        clip_end = floor(clip.source_end_seconds * fps + 0.5)
        if clip_end <= clip_start:
            continue
        clip_windows.append((clip_start, clip_end, output_cursor))
        output_cursor += clip_end - clip_start
    supports_word_reflow = all(
        isinstance(cue, dict)
        and isinstance(cue.get("words"), list)
        and all(
            isinstance(word, dict)
            and "startFrame" in word
            and "endFrame" in word
            for word in cue["words"]
        )
        for cue in source_cues
    )
    try:
        if supports_word_reflow or cue_edits:
            spec["cues"] = reflow_caption_cues_for_clips(
                source_cues,
                template_id=str(spec["templateId"]),
                safe_area=safe_area,
                clip_windows=clip_windows,
                cue_edits=cue_edits,
                fps=fps,
            )
        else:
            # Schema-v3 probes and early stored specs predate per-word frame
            # fields. Keep their immutable event layout compatible; every new
            # generated caption spec takes the word-reflow path above.
            legacy_cues: list[dict[str, object]] = []
            for cue_value in source_cues:
                if not isinstance(cue_value, dict):
                    raise RenderError("원본 자막 큐가 올바르지 않습니다.")
                events_value = cue_value.get("events")
                if not isinstance(events_value, list):
                    raise RenderError("원본 자막 이벤트가 올바르지 않습니다.")
                retimed_events: list[dict[str, object]] = []
                for clip_start, clip_end, output_start in clip_windows:
                    for event_value in events_value:
                        if not isinstance(event_value, dict):
                            raise RenderError("원본 자막 이벤트가 올바르지 않습니다.")
                        event_start = int(event_value.get("startFrame") or 0)
                        event_end = int(event_value.get("endFrame") or 0)
                        visible_start = max(event_start, clip_start)
                        visible_end = min(event_end, clip_end)
                        if visible_end <= visible_start:
                            continue
                        event = deepcopy(event_value)
                        event["startFrame"] = (
                            output_start + visible_start - clip_start
                        )
                        event["endFrame"] = output_start + visible_end - clip_start
                        retimed_events.append(event)
                if not retimed_events:
                    continue
                cue = deepcopy(cue_value)
                cue["events"] = retimed_events
                cue["startFrame"] = min(
                    int(event["startFrame"]) for event in retimed_events
                )
                cue["endFrame"] = max(
                    int(event["endFrame"]) for event in retimed_events
                )
                legacy_cues.append(cue)
            spec["cues"] = legacy_cues
    except Exception as exc:
        if isinstance(exc, RenderError):
            raise
        raise RenderError("편집한 자막을 다시 배치하지 못했습니다.") from exc

    def scaled_x(value: object) -> float:
        return round(540 + (float(value) - 540) * scale, 3)

    def shifted_y(value: object) -> float:
        return round(float(value) + offset_y, 3)

    style = spec.get("style")
    if not isinstance(style, dict):
        raise RenderError("원본 자막 스타일이 올바르지 않습니다.")
    if render_subtitles and render_subtitles.accent_color:
        style["accentColor"] = render_subtitles.accent_color
    style["fontSize"] = round(float(style.get("fontSize") or 0) * scale, 3)
    style["outlineWidth"] = round(
        float(style.get("outlineWidth") or 0) * scale,
        3,
    )

    for rectangle_key in ("safeArea",):
        rectangle = spec.get(rectangle_key)
        if not isinstance(rectangle, dict):
            continue
        original_width = float(rectangle.get("width") or 0)
        original_height = float(rectangle.get("height") or 0)
        original_center_x = float(rectangle.get("x") or 0) + original_width / 2
        original_center_y = float(rectangle.get("y") or 0) + original_height / 2
        rectangle["width"] = round(original_width * scale, 3)
        rectangle["height"] = round(original_height * scale, 3)
        rectangle["x"] = round(
            scaled_x(original_center_x) - float(rectangle["width"]) / 2,
            3,
        )
        rectangle["y"] = round(
            original_center_y + offset_y - float(rectangle["height"]) / 2,
            3,
        )
    layout = spec.get("layout")
    if isinstance(layout, dict) and isinstance(layout.get("caption"), dict):
        layout["caption"] = deepcopy(spec.get("safeArea"))

    cues = spec.get("cues")
    if not isinstance(cues, list):
        raise RenderError("원본 자막 큐가 올바르지 않습니다.")

    retimed_cues: list[dict[str, object]] = []
    for cue_value in cues:
        if not isinstance(cue_value, dict):
            raise RenderError("원본 자막 큐가 올바르지 않습니다.")
        cue = cue_value
        words = cue.get("words")
        events = cue.get("events")
        if not isinstance(words, list) or not isinstance(events, list):
            raise RenderError("원본 자막 이벤트가 올바르지 않습니다.")

        if "centerX" in cue:
            cue["centerX"] = scaled_x(cue["centerX"])
        if "centerY" in cue:
            cue["centerY"] = shifted_y(cue["centerY"])
        if "fontSize" in cue:
            cue["fontSize"] = round(float(cue["fontSize"]) * scale, 3)
        for word_value in words:
            if not isinstance(word_value, dict):
                raise RenderError("원본 자막 어절이 올바르지 않습니다.")
            if "fontSize" in word_value:
                word_value["fontSize"] = round(
                    float(word_value["fontSize"]) * scale,
                    3,
                )
            if "centerX" in word_value:
                word_value["centerX"] = scaled_x(word_value["centerX"])
            if "centerY" in word_value:
                word_value["centerY"] = shifted_y(word_value["centerY"])

        for event in events:
            if not isinstance(event, dict):
                raise RenderError("원본 자막 이벤트가 올바르지 않습니다.")
            positions = event.get("positions")
            if isinstance(positions, list):
                for position in positions:
                    if not isinstance(position, dict):
                        raise RenderError("원본 팝 자막 위치가 올바르지 않습니다.")
                    position["centerX"] = scaled_x(position["centerX"])
                    position["centerY"] = shifted_y(position["centerY"])
        retimed_cues.append(cue)

    if not retimed_cues:
        return None
    spec["cues"] = retimed_cues
    return spec


def _text_size(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
) -> tuple[int, int, tuple[int, int, int, int]]:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0], box[3] - box[1], box


def _fit_title_font(
    lines: list[str],
    font_id: EditorFontId,
    maximum_width: int,
    preferred_size: int = 84,
    weight: int | None = None,
) -> ImageFont.FreeTypeFont:
    image = Image.new("L", (1, 1))
    draw = ImageDraw.Draw(image)
    for size in range(preferred_size, 21, -2):
        font = load_editor_font(font_id, size, weight=weight)
        if max(_text_size(draw, line, font)[0] for line in lines) <= maximum_width:
            return font
    return load_editor_font(font_id, 22, weight=weight)


def _scale_layer(image: Image.Image, scale: float) -> Image.Image:
    if abs(scale - 1) < 0.0005:
        return image
    return image.resize(
        (
            max(1, round(image.width * scale)),
            max(1, round(image.height * scale)),
        ),
        Image.Resampling.LANCZOS,
    )


def _paste_center(
    canvas: Image.Image,
    layer: Image.Image,
    center_x: float,
    center_y: float,
) -> None:
    left = round(center_x - layer.width / 2)
    top = round(center_y - layer.height / 2)
    canvas.paste(layer, (left, top), layer)


def _clamp_centered_layer_position(
    layer: Image.Image,
    center_x: float,
    center_y: float,
) -> tuple[float, float]:
    """Keep movable non-video overlays visible inside the output canvas."""
    if (
        layer.width > CANVAS_WIDTH
        or center_x - layer.width / 2 < 0
        or center_x + layer.width / 2 > CANVAS_WIDTH
    ):
        center_x = CANVAS_WIDTH / 2
    if layer.height <= CANVAS_HEIGHT:
        center_y = min(
            CANVAS_HEIGHT - layer.height / 2,
            max(layer.height / 2, center_y),
        )
    else:
        center_y = CANVAS_HEIGHT / 2
    return center_x, center_y


def _paste_center_clamped(
    canvas: Image.Image,
    layer: Image.Image,
    center_x: float,
    center_y: float,
) -> None:
    center_x, center_y = _clamp_centered_layer_position(
        layer,
        center_x,
        center_y,
    )
    _paste_center(canvas, layer, center_x, center_y)


def _draw_styled_title_content(
    document: EditorDocument,
    *,
    font_id: EditorFontId,
    font_size: int,
    custom_config: CustomTemplateConfig | None,
    title_accent_color: str | None = None,
) -> Image.Image:
    render_title = document.render_spec.title if document.render_spec else None
    lines = render_title.lines if render_title else wrap_korean_title(document.title.text)
    font_weight = render_title.font.resolved_weight if render_title else None
    font = load_editor_font(font_id, font_size, weight=font_weight)
    probe = Image.new("RGBA", (CANVAS_WIDTH, 500), (0, 0, 0, 0))
    draw = ImageDraw.Draw(probe)
    if custom_config is not None and render_title is None:
        while (
            font_size > 20
            and max(_text_size(draw, line, font)[0] for line in lines)
            > custom_config.title.max_width
        ):
            font_size -= 2
            font = load_editor_font(font_id, font_size, weight=font_weight)
    indices = _title_line_character_indices(document.title.text, lines)
    metrics = [_text_size(draw, line, font) for line in lines]
    if custom_config is not None:
        gap = max(6, round(font_size * 0.18))
        line_padding_x = max(10, round(font_size * 0.28))
        line_padding_y = max(6, round(font_size * 0.14))
    else:
        gap = TITLE_LINE_GAP
        line_padding_x = max(1, round(font_size * 0.34))
        line_padding_y = max(1, round(font_size * 0.14))
    line_runs = [
        _title_style_runs(
            lines[index],
            indices[index],
            document.title.text_styles,
        )
        for index in range(len(lines))
    ]
    custom_backgrounds = [
        (
            custom_config.title.accent_background_color
            if index > 0
            else custom_config.title.primary_background_color
        )
        if custom_config is not None
        else None
        for index in range(len(lines))
    ]
    padded_lines = [
        custom_config is not None
        or custom_backgrounds[index] is not None
        or any(run_background for _, _, _, run_background in line_runs[index])
        for index in range(len(lines))
    ]
    line_heights: list[int] = []
    line_widths: list[int] = []
    for index, (width, _height, _box) in enumerate(metrics):
        line_heights.append(
            font_size + (line_padding_y * 2 if padded_lines[index] else 0),
        )
        line_widths.append(
            width + (line_padding_x * 2 if padded_lines[index] else 0),
        )
    content_width = max(line_widths)
    content_height = sum(line_heights) + gap * max(0, len(lines) - 1)
    content = Image.new(
        "RGBA",
        (max(1, content_width), max(1, content_height)),
        (0, 0, 0, 0),
    )
    draw = ImageDraw.Draw(content)
    cursor_y = 0
    style = TEMPLATE_STYLES[document.template.id]
    for index, line in enumerate(lines):
        width, height, box = metrics[index]
        left = (content.width - width) / 2
        custom_background = custom_backgrounds[index]
        runs = line_runs[index]
        line_height = line_heights[index]
        visible_y = cursor_y + (line_height - height) / 2
        if custom_background:
            draw.rounded_rectangle(
                (
                    left - line_padding_x,
                    cursor_y,
                    left + width + line_padding_x,
                    cursor_y + line_height,
                ),
                radius=max(6, round(font_size * 0.14)),
                fill=custom_background,
            )
        for start, end, _run_color, run_background in runs:
            if not run_background:
                continue
            run_left = draw.textlength(line[:start], font=font)
            run_right = draw.textlength(line[:end], font=font)
            draw.rounded_rectangle(
                (
                    left + run_left - line_padding_x,
                    cursor_y,
                    left + run_right + line_padding_x,
                    cursor_y + line_height,
                ),
                radius=max(6, round(font_size * 0.14)),
                fill=run_background,
            )
        if custom_config is not None:
            default_color = (
                custom_config.title.accent_color
                if index > 0
                else custom_config.title.primary_color
            )
        else:
            overlay_mode = document.video.aspect_ratio is VideoAspectRatio.FULL_VERTICAL
            default_color = (
                title_accent_color or style.accent
                if index > 0
                or (overlay_mode and document.template.id is not TemplateId.PAPER)
                else style.primary
            )
        for start, end, run_color, _run_background in runs:
            run_left = draw.textlength(line[:start], font=font)
            draw.text(
                (
                    left + run_left - box[0],
                    visible_y - box[1],
                ),
                line[start:end],
                font=font,
                fill=run_color or default_color,
            )
        cursor_y += line_heights[index] + gap
    return content


def create_editor_title_layer(
    document: EditorDocument,
    output_path: Path,
    *,
    title_accent_color: str | None = None,
    caption_render_spec: dict[str, object] | None = None,
) -> Path:
    canvas = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
    if not document.overlays.visible["title"]:
        canvas.save(output_path)
        return output_path
    config = _custom_template_config(document)
    caption_layout = _editor_caption_layout(caption_render_spec)
    font_id = document.overlays.fonts["title"]
    render_title = document.render_spec.title if document.render_spec else None
    if render_title is not None:
        base_font_size = max(1, round(render_title.font_size))
        center_x = CANVAS_WIDTH / 2
        if caption_layout is not None:
            panel_height = caption_layout.top_height
            panel_top = caption_layout.top_y
            bottom_margin = min(44, max(24, round(panel_height * 0.105)))
            center_y = panel_top + panel_height - bottom_margin
        elif config is not None:
            center_y = config.title.y
        else:
            aspect_ratio = document.video.aspect_ratio
            if (
                document.template.id is TemplateId.COMMENT_CAPTURE
                and aspect_ratio is VideoAspectRatio.FULL_VERTICAL
            ):
                aspect_ratio = VideoAspectRatio.PORTRAIT
            if aspect_ratio is VideoAspectRatio.FULL_VERTICAL:
                panel_height = 360
                panel_top = 96
            else:
                panel_height = round((CANVAS_HEIGHT - VIDEO_HEIGHTS[aspect_ratio]) / 2)
                if (
                    document.template.id is TemplateId.COMMENT_CAPTURE
                    and document.template.preset_version >= 2
                    and aspect_ratio is VideoAspectRatio.LANDSCAPE
                ):
                    panel_height -= COMMENT_CAPTURE_LANDSCAPE_LIFT_PX
                panel_top = 0
            bottom_margin = (
                12
                if panel_height == 285
                else min(44, max(24, round(panel_height * 0.105)))
            )
            center_y = panel_top + panel_height - bottom_margin
    elif config is not None:
        base_font_size = max(1, round(config.title.font_size * document.title.font_scale))
        center_x = config.title.x
        center_y = config.title.y
    else:
        fitted = _fit_title_font(
            wrap_korean_title(document.title.text),
            font_id,
            TITLE_MAX_WIDTH,
        )
        base_font_size = max(
            18,
            min(200, round(fitted.size * document.title.font_scale)),
        )
        aspect_ratio = document.video.aspect_ratio
        if (
            document.template.id is TemplateId.COMMENT_CAPTURE
            and aspect_ratio is VideoAspectRatio.FULL_VERTICAL
        ):
            aspect_ratio = VideoAspectRatio.PORTRAIT
        if aspect_ratio is VideoAspectRatio.FULL_VERTICAL:
            panel_height = 360
            panel_top = 96
        else:
            panel_height = round((CANVAS_HEIGHT - VIDEO_HEIGHTS[aspect_ratio]) / 2)
            if (
                document.template.id is TemplateId.COMMENT_CAPTURE
                and document.template.preset_version >= 2
                and aspect_ratio is VideoAspectRatio.LANDSCAPE
            ):
                panel_height -= COMMENT_CAPTURE_LANDSCAPE_LIFT_PX
            panel_top = 0
        bottom_margin = (
            12
            if panel_height == 285
            else min(44, max(24, round(panel_height * 0.105)))
        )
        center_x = CANVAS_WIDTH / 2
        center_y = panel_top + panel_height - bottom_margin
    content = _draw_styled_title_content(
        document,
        font_id=font_id,
        font_size=base_font_size,
        custom_config=config,
        title_accent_color=title_accent_color,
    )
    if config is None:
        center_y -= content.height / 2
    content = _scale_layer(content, document.overlays.scales["title"])
    offset = document.overlays.offsets["title"]
    _paste_center_clamped(
        canvas,
        content,
        center_x,
        center_y + (render_title.offset_y if render_title else offset.y),
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", compress_level=1)
    return output_path


def _trim_text_to_width(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    maximum_width: int,
) -> str:
    result = text
    while result and draw.textlength(result, font=font) > maximum_width:
        result = result[:-1]
    return result


def create_editor_channel_layer(
    document: EditorDocument,
    output_path: Path,
    thumbnail_path: Path | None,
    caption_render_spec: dict[str, object] | None = None,
) -> Path:
    canvas = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
    if not document.overlays.visible["channel"]:
        canvas.save(output_path)
        return output_path
    config = _custom_template_config(document)
    caption_layout = _editor_caption_layout(caption_render_spec)
    font_id = document.overlays.fonts["channel"]
    if caption_layout is not None:
        base_font_size = 48
        center_x = CANVAS_WIDTH / 2
        center_y = caption_layout.bottom_y + caption_layout.bottom_height / 2
        foreground = TEMPLATE_STYLES[document.template.id].channel
        background = None
        maximum_width = 760
        avatar_size = 64
        gap = 26
        padding_x = 53
        padding_y = 8
    elif config is not None:
        base_font_size = config.channel.font_size
        center_x = config.channel.x
        center_y = config.channel.y
        foreground = config.channel.color
        background = config.channel.background_color
        maximum_width = config.channel.max_width
        avatar_size = 58
        gap = 22
        padding_x = 16
        padding_y = 8
    else:
        base_font_size = 45
        center_x = CANVAS_WIDTH / 2
        center_y = (
            COMMENT_CAPTURE_SQUARE_CHANNEL_CENTER_Y
            if document.template.id is TemplateId.COMMENT_CAPTURE
            else PRESET_SQUARE_CHANNEL_CENTER_Y
        )
        foreground = TEMPLATE_STYLES[document.template.id].channel
        background = None
        maximum_width = 760
        avatar_size = 66
        gap = 26
        padding_x = 53
        padding_y = 8
    channel_weight = (
        document.render_spec.channel.font.resolved_weight
        if document.render_spec
        else None
    )
    font = load_editor_font(font_id, base_font_size, weight=channel_weight)
    probe = Image.new("RGBA", (1, 1))
    probe_draw = ImageDraw.Draw(probe)
    name = _trim_text_to_width(
        probe_draw,
        " ".join(document.channel.display_name.split()),
        font,
        maximum_width - avatar_size - gap,
    ) or "채널"
    text_width, text_height, text_box = _text_size(probe_draw, name, font)
    content_width = (
        maximum_width
        if config is not None
        else avatar_size + gap + text_width + padding_x * 2
    )
    content_height = max(avatar_size, text_height) + padding_y * 2
    content = Image.new(
        "RGBA",
        (content_width, content_height),
        (0, 0, 0, 0),
    )
    draw = ImageDraw.Draw(content)
    if background:
        draw.rounded_rectangle(
            (0, 0, content_width - 1, content_height - 1),
            radius=max(6, round(base_font_size * 0.18)),
            fill=background,
        )
    avatar_left = (
        round((content_width - avatar_size - gap - text_width) / 2)
        if config is not None
        else padding_x
    )
    avatar_top = round((content_height - avatar_size) / 2)
    rendered_avatar = False
    if thumbnail_path and thumbnail_path.is_file():
        try:
            with Image.open(thumbnail_path) as source:
                avatar = ImageOps.fit(
                    source.convert("RGB"),
                    (avatar_size, avatar_size),
                    method=Image.Resampling.LANCZOS,
                )
            mask = Image.new("L", (avatar_size, avatar_size), 0)
            ImageDraw.Draw(mask).ellipse(
                (0, 0, avatar_size - 1, avatar_size - 1),
                fill=255,
            )
            content.paste(avatar, (avatar_left, avatar_top), mask)
            rendered_avatar = True
        except (OSError, ValueError):
            rendered_avatar = False
    if not rendered_avatar:
        draw.ellipse(
            (
                avatar_left,
                avatar_top,
                avatar_left + avatar_size,
                avatar_top + avatar_size,
            ),
            fill=foreground,
        )
        fallback = background or TEMPLATE_STYLES[document.template.id].background
        draw.ellipse(
            (
                avatar_left + avatar_size * 0.325,
                avatar_top + avatar_size * 0.2,
                avatar_left + avatar_size * 0.675,
                avatar_top + avatar_size * 0.55,
            ),
            fill=fallback,
        )
        draw.rounded_rectangle(
            (
                avatar_left + avatar_size * 0.19,
                avatar_top + avatar_size * 0.57,
                avatar_left + avatar_size * 0.81,
                avatar_top + avatar_size * 0.92,
            ),
            radius=round(avatar_size * 0.2),
            fill=fallback,
        )
    draw.text(
        (
            avatar_left + avatar_size + gap - text_box[0],
            (content_height - text_height) / 2 - text_box[1],
        ),
        name,
        font=font,
        fill=foreground,
    )
    content = _scale_layer(content, document.overlays.scales["channel"])
    offset = document.overlays.offsets["channel"]
    _paste_center_clamped(
        canvas,
        content,
        center_x + offset.x,
        center_y + offset.y,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", compress_level=1)
    return output_path


def editor_layer_order(document: EditorDocument) -> list[str]:
    return [
        *(
            layer_name
            for layer_name in document.overlays.layer_order
            if layer_name != "channel"
        ),
        "channel",
    ]


def _wrap_overlay_text(
    text: str,
    font: ImageFont.FreeTypeFont,
    maximum_width: int,
) -> list[str]:
    probe = Image.new("L", (1, 1))
    draw = ImageDraw.Draw(probe)
    lines: list[str] = []
    for paragraph in (text or "텍스트").splitlines() or [""]:
        current = ""
        for character in paragraph:
            candidate = current + character
            if current and draw.textlength(candidate, font=font) > maximum_width:
                lines.append(current.rstrip())
                current = character.lstrip()
            else:
                current = candidate
        lines.append(current or " ")
    return lines[:20]


def create_editor_text_layer(
    overlay: EditorTextOverlay,
    output_path: Path,
    render_spec: EditorRenderTextSpec | None = None,
) -> Path:
    canvas = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
    font_size = render_spec.font_size if render_spec else 72
    font = load_editor_font(
        overlay.font_id,
        font_size,
        weight=render_spec.font.resolved_weight if render_spec else None,
    )
    padding_x = 22
    padding_y = 11
    layout_width = max(1, round(overlay.width))
    lines = (
        render_spec.lines
        if render_spec
        else _wrap_overlay_text(
            overlay.text,
            font,
            max(1, layout_width - padding_x * 2),
        )
    )
    probe = Image.new("RGBA", (1, 1))
    draw = ImageDraw.Draw(probe)
    boxes = [draw.textbbox((0, 0), line, font=font, stroke_width=10) for line in lines]
    widths = [box[2] - box[0] for box in boxes]
    heights = [box[3] - box[1] for box in boxes]
    line_height = render_spec.line_height if render_spec else round(72 * 1.2)
    # CSS lets glyphs overflow the technical 1px width while still using that
    # width to decide line breaks. Keep the same narrow wrapping without
    # clipping every glyph out of the rendered video.
    content_width = max(
        layout_width,
        max(widths, default=1) + padding_x * 2,
    )
    content = Image.new(
        "RGBA",
        (
            content_width,
            max(1, line_height * len(lines) + padding_y * 2),
        ),
        (0, 0, 0, 0),
    )
    foreground = Image.new("RGBA", content.size, (0, 0, 0, 0))
    foreground_draw = ImageDraw.Draw(foreground)
    cursor_y = padding_y
    for line, box, width, height in zip(lines, boxes, widths, heights, strict=True):
        x = (content.width - width) / 2 - box[0]
        y = cursor_y + (line_height - height) / 2 - box[1]
        foreground_draw.text(
            (x, y),
            line,
            font=font,
            fill=overlay.color,
            stroke_width=(
                render_spec.outline_width
                if render_spec
                else 10 if overlay.effect == "outline" else 0
            ),
            stroke_fill="#000000",
        )
        cursor_y += line_height
    if overlay.effect == "shadow":
        alpha = foreground.getchannel("A")
        shadow = Image.new("RGBA", content.size, (0, 0, 0, 0))
        shadow.putalpha(alpha.filter(ImageFilter.GaussianBlur(
            radius=render_spec.shadow_blur if render_spec else 13,
        )))
        shadow_color = Image.new("RGBA", content.size, (0, 0, 0, 220))
        shadow_color.putalpha(shadow.getchannel("A"))
        content.paste(shadow_color, (0, 7), shadow_color)
    content.alpha_composite(foreground)
    content = _scale_layer(content, overlay.scale)
    _paste_center_clamped(
        canvas,
        content,
        render_spec.center_x if render_spec else CANVAS_WIDTH / 2 + overlay.offset.x,
        render_spec.center_y if render_spec else CANVAS_HEIGHT / 2 + overlay.offset.y,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", compress_level=1)
    return output_path


def _base_comment_y(
    document: EditorDocument,
    caption_render_spec: dict[str, object] | None = None,
) -> int:
    config = _custom_template_config(document)
    caption_layout = _editor_caption_layout(caption_render_spec)
    if caption_layout is not None:
        return caption_layout.video_y + caption_layout.video_height
    if config is not None:
        video_bottom = config.video.y + config.video.height
        if config.comment.docked_to_video and 720 <= video_bottom <= 1480:
            return video_bottom
        return config.comment.y
    if document.template.id is not TemplateId.COMMENT_CAPTURE:
        return round(CANVAS_HEIGHT * 0.62)
    aspect_ratio = document.video.aspect_ratio
    if aspect_ratio is VideoAspectRatio.FULL_VERTICAL:
        aspect_ratio = VideoAspectRatio.PORTRAIT
    height = VIDEO_HEIGHTS[aspect_ratio]
    y = round((CANVAS_HEIGHT - height) / 2)
    if (
        document.template.preset_version >= 2
        and aspect_ratio is VideoAspectRatio.LANDSCAPE
    ):
        y -= COMMENT_CAPTURE_LANDSCAPE_LIFT_PX
    return y + height


def create_editor_comment_layers(
    document: EditorDocument,
    directory: Path,
    caption_render_spec: dict[str, object] | None = None,
) -> list[EditorLayerAsset]:
    if not document.overlays.visible["comment"]:
        return []
    config = _custom_template_config(document)
    theme = (
        document.overlays.comment_theme
        or (config.comment.theme if config is not None else "dark")
    )
    size = config.comment.size if config is not None else "medium"
    base_y = _base_comment_y(document, caption_render_spec)
    assets: list[EditorLayerAsset] = []
    comments = sorted(document.comments, key=lambda item: item.start_seconds)
    output_duration = document.video.output_duration_seconds
    render_comments = {
        item.id: item
        for item in (document.render_spec.comments if document.render_spec else [])
    }
    for index, comment in enumerate(comments):
        panel_path = directory / f"comment-panel-{index:02d}.png"
        create_comment_panel(
            comment,
            panel_path,
            overlay_mode=True,
            theme=theme,
            size=size,
        )
        with Image.open(panel_path) as source:
            panel = source.convert("RGBA")
        layer = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
        offset = document.overlays.comment_offsets.get(
            comment.id,
            document.overlays.offsets["comment"],
        )
        y = min(
            max(0, CANVAS_HEIGHT - panel.height),
            max(0, round(base_y + offset.y)),
        )
        layer.paste(panel, (0, y), panel)
        layer_path = directory / f"comment-layer-{index:02d}.png"
        layer.save(layer_path, format="PNG", compress_level=1)
        previous = comments[index - 1] if index > 0 else None
        following = comments[index + 1] if index + 1 < len(comments) else None
        touches_previous = previous is not None and abs(
            previous.end_seconds - comment.start_seconds
        ) <= TIMED_OVERLAY_CONTIGUOUS_TOLERANCE_SECONDS
        touches_following = following is not None and abs(
            comment.end_seconds - following.start_seconds
        ) <= TIMED_OVERLAY_CONTIGUOUS_TOLERANCE_SECONDS
        render_comment = render_comments.get(comment.id)
        start_seconds = (
            render_comment.start_frame / 30
            if render_comment
            else comment.start_seconds
        )
        end_seconds = (
            render_comment.end_frame / 30
            if render_comment
            else comment.end_seconds
        )
        assets.append(EditorLayerAsset(
            path=layer_path,
            start_seconds=start_seconds,
            end_seconds=end_seconds,
            fade_in=(
                document.render_spec is None
                and comment.start_seconds > 0.001
                and not touches_previous
            ),
            fade_out=(
                document.render_spec is None
                and comment.end_seconds < output_duration - 0.001
                and not touches_following
            ),
        ))
    return assets


def create_editor_background(document: EditorDocument, output_path: Path) -> Path:
    background = document.overlays.background
    config = _custom_template_config(document)
    if background is None and config is not None:
        background = config.background
    if background is not None and background.kind == "image":
        asset_id = background.asset_id or ""
        asset_path = CUSTOM_BACKGROUND_ASSETS.get(asset_id)
        if not asset_path or not asset_path.is_file():
            raise RenderError("편집기 배경 이미지를 찾지 못했습니다.")
        with Image.open(asset_path) as source:
            image = ImageOps.fit(
                source.convert("RGB"),
                (CANVAS_WIDTH, CANVAS_HEIGHT),
                method=Image.Resampling.LANCZOS,
            )
    else:
        color = (
            background.color
            if background is not None
            else TEMPLATE_STYLES[document.template.id].background
        )
        image = Image.new("RGB", (CANVAS_WIDTH, CANVAS_HEIGHT), color)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG", compress_level=1)
    return output_path


def _escape_filter_path(path: Path) -> str:
    return str(path).replace("\\", "\\\\").replace(":", "\\:").replace("'", r"\'")


def _timed_overlay_enable_expression(
    start_seconds: float,
    end_seconds: float,
    fps: float,
) -> str:
    """Match the browser's half-open window on deterministic output frames."""
    start_frame, end_frame = _timed_overlay_frame_window(
        start_seconds,
        end_seconds,
        fps,
    )
    return f"gte(n,{start_frame})*lt(n,{end_frame})"


def _timed_overlay_frame_window(
    start_seconds: float,
    end_seconds: float,
    fps: float,
) -> tuple[int, int]:
    if fps <= 0:
        raise ValueError("timed overlay fps must be positive")
    if end_seconds <= start_seconds:
        raise ValueError("timed overlay end must be after start")
    # The first visible frame is the first frame whose timestamp is at or
    # after the browser boundary. Subtracting a tiny epsilon keeps exact frame
    # boundaries (for example 1.0 * 30) from rounding up due to float noise.
    start_frame = max(0, ceil(start_seconds * fps - 1e-9))
    end_frame = max(start_frame + 1, ceil(end_seconds * fps - 1e-9))
    return start_frame, end_frame


def _timed_overlay_input_filter(
    asset: EditorLayerAsset,
    *,
    input_index: int,
    output_label: str,
    fps: float,
) -> str:
    filters = [f"[{input_index}:v]setpts=PTS-STARTPTS"]
    fade_filters: list[str] = []
    is_timed = asset.start_seconds is not None and asset.end_seconds is not None
    if is_timed:
        start_frame, end_frame = _timed_overlay_frame_window(
            asset.start_seconds,
            asset.end_seconds,
            fps,
        )
        frame_count = end_frame - start_frame
        transition_frames = min(
            TIMED_OVERLAY_TRANSITION_FRAMES,
            max(0, (frame_count - 1) // 2),
        )
        if transition_frames > 0 and asset.fade_in:
            fade_filters.append(
                "fade=t=in:"
                f"start_frame={start_frame}:nb_frames={transition_frames}:alpha=1"
            )
        if transition_frames > 0 and asset.fade_out:
            fade_filters.append(
                "fade=t=out:"
                f"start_frame={end_frame - transition_frames}:"
                f"nb_frames={transition_frames}:alpha=1"
            )
    # Image inputs are intentionally opened at 1 fps. Timed overlays must be
    # normalized to the main output fps before overlay framesync evaluates an
    # n-based enable expression. Otherwise FFmpeg briefly emits only the main
    # input whenever the sparse secondary stream advances (once per second).
    if is_timed:
        filters.append(f"fps={fps:.3f}")
    filters.append("format=rgba")
    filters.extend(fade_filters)
    return ",".join(filters) + f"[{output_label}]"


class EditorDocumentRenderer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def extract_sequence(
        self,
        *,
        timeline_path: Path,
        output_path: Path,
        document: EditorDocument,
        work_dir: Path,
    ) -> Path:
        work_dir.mkdir(parents=True, exist_ok=True)
        probe = probe_media(
            timeline_path,
            timeout=min(30, self.settings.ffmpeg_timeout_seconds),
        )
        timeline_duration = media_duration(probe)
        expected_duration = (
            document.video.timeline_end_seconds
            - document.video.timeline_start_seconds
        )
        timeline_drift_tolerance = max(0.2, expected_duration * 0.01)
        if abs(timeline_duration - expected_duration) > timeline_drift_tolerance:
            raise RenderError("편집 타임라인 길이가 저장된 문서와 일치하지 않습니다.")
        has_audio = any(
            stream.get("codec_type") == "audio"
            for stream in probe.get("streams", [])
        )
        filters: list[str] = []
        concat_inputs: list[str] = []
        for index, clip in enumerate(document.video.clips):
            filters.append(
                f"[0:v]trim=start={clip.source_start_seconds:.6f}:"
                f"end={clip.source_end_seconds:.6f},setpts=PTS-STARTPTS[v{index}]"
            )
            concat_inputs.append(f"[v{index}]")
            if has_audio:
                filters.append(
                    f"[0:a]atrim=start={clip.source_start_seconds:.6f}:"
                    f"end={clip.source_end_seconds:.6f},asetpts=PTS-STARTPTS[a{index}]"
                )
                concat_inputs.append(f"[a{index}]")
        raw_video_label = "sequence_video_raw"
        raw_audio_label = "sequence_audio_raw"
        filters.append(
            "".join(concat_inputs)
            + f"concat=n={len(document.video.clips)}:v=1:a={1 if has_audio else 0}"
            + (
                f"[{raw_video_label}][{raw_audio_label}]"
                if has_audio
                else f"[{raw_video_label}]"
            )
        )
        # YouTube/container duration metadata can be a few frames longer than
        # the captured edit timeline, especially when the source selection ends
        # at the physical end of the video. The document is still authoritative
        # for editor timing, so pad only within the already accepted timeline
        # drift and trim both streams back to the exact requested duration.
        # This keeps split clips, overlays, captions, and the persisted editor
        # document on one clock instead of failing at 99% or shortening output.
        target_duration = document.video.output_duration_seconds
        timeline_fps = video_fps(probe)
        max_tail_padding = min(1.0, timeline_drift_tolerance) + (2 / timeline_fps)
        filters.append(
            f"[{raw_video_label}]"
            f"tpad=stop_mode=clone:stop_duration={max_tail_padding:.6f},"
            f"trim=duration={target_duration:.6f},setpts=PTS-STARTPTS"
            "[sequence_video]"
        )
        if has_audio:
            filters.append(
                f"[{raw_audio_label}]"
                f"apad=pad_dur={max_tail_padding:.6f},"
                f"atrim=duration={target_duration:.6f},asetpts=PTS-STARTPTS"
                "[sequence_audio]"
            )
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-y",
            "-i",
            str(timeline_path),
            "-filter_complex_threads",
            str(self.settings.ffmpeg_threads),
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[sequence_video]",
        ]
        if has_audio:
            command.extend(["-map", "[sequence_audio]"])
        command.extend([
            "-c:v",
            "libx264",
            "-threads:v",
            str(self.settings.ffmpeg_threads),
            "-preset",
            self.settings.clean_clip_preset,
            "-crf",
            str(self.settings.clean_clip_crf),
            "-pix_fmt",
            "yuv420p",
        ])
        if has_audio:
            command.extend(["-c:a", "aac", "-b:a", "128k"])
        command.extend(["-movflags", "+faststart", str(output_path)])
        result = run_command(
            command,
            timeout=self.settings.ffmpeg_timeout_seconds,
            cwd=work_dir,
        )
        if (
            result.returncode != 0
            or not output_path.is_file()
            or output_path.stat().st_size == 0
        ):
            raise RenderError("영상 조각을 이어 붙이지 못했습니다.")
        rendered_probe = probe_media(output_path, timeout=30)
        rendered_duration = media_duration(rendered_probe)
        duration_tolerance = max(0.05, (2 / video_fps(rendered_probe)) + 0.01)
        if abs(rendered_duration - target_duration) > duration_tolerance:
            output_path.unlink(missing_ok=True)
            raise RenderError("편집한 영상 조각의 길이를 검증하지 못했습니다.")
        return output_path

    def render(
        self,
        *,
        clean_path: Path,
        output_path: Path,
        document: EditorDocument,
        work_dir: Path,
        channel_thumbnail_path: Path | None,
        caption_render_spec: dict[str, object] | None = None,
    ) -> Path:
        work_dir.mkdir(parents=True, exist_ok=True)
        assets_dir = work_dir / "editor-assets"
        assets_dir.mkdir(parents=True, exist_ok=True)
        probe = probe_media(
            clean_path,
            timeout=min(30, self.settings.ffmpeg_timeout_seconds),
        )
        duration = media_duration(probe)
        if abs(duration - document.video.output_duration_seconds) > 0.12:
            raise RenderError("편집 영상 길이가 렌더링 문서와 일치하지 않습니다.")
        fps = 30.0 if document.version == 3 else min(30.0, video_fps(probe))
        has_audio = any(
            stream.get("codec_type") == "audio"
            for stream in probe.get("streams", [])
        )
        frame = editor_video_frame(document, caption_render_spec)
        background_path = create_editor_background(
            document,
            assets_dir / "background.png",
        )
        caption_style = (
            caption_render_spec.get("style")
            if isinstance(caption_render_spec, dict)
            else None
        )
        original_caption_accent = (
            str(caption_style.get("accentColor"))
            if isinstance(caption_style, dict)
            and isinstance(caption_style.get("accentColor"), str)
            else None
        )
        title_path = create_editor_title_layer(
            document,
            assets_dir / "title.png",
            title_accent_color=original_caption_accent,
            caption_render_spec=caption_render_spec,
        )
        channel_path = create_editor_channel_layer(
            document,
            assets_dir / "channel.png",
            channel_thumbnail_path,
            caption_render_spec,
        )
        comment_assets = create_editor_comment_layers(
            document,
            assets_dir,
            caption_render_spec,
        )
        render_text_specs = {
            item.id: item
            for item in (
                document.render_spec.text_overlays
                if document.render_spec
                else []
            )
        }
        text_assets = {
            f"text:{overlay.id}": [
                EditorLayerAsset(
                    path=create_editor_text_layer(
                        overlay,
                        assets_dir / f"text-{index:02d}.png",
                        render_text_specs.get(overlay.id),
                    ),
                    start_seconds=(
                        render_text_specs[overlay.id].start_frame / 30
                        if overlay.id in render_text_specs
                        else overlay.start_seconds
                    ),
                    end_seconds=(
                        render_text_specs[overlay.id].end_frame / 30
                        if overlay.id in render_text_specs
                        else overlay.end_seconds
                    ),
                    fade_in=(
                        document.render_spec is None
                        and overlay.start_seconds > 0.001
                    ),
                    fade_out=(
                        document.render_spec is None
                        and overlay.end_seconds
                        < document.video.output_duration_seconds - 0.001
                    ),
                )
            ]
            for index, overlay in enumerate(document.overlays.text_overlays)
        }
        layer_assets: dict[str, list[EditorLayerAsset]] = {
            "title": [EditorLayerAsset(title_path)]
            if document.overlays.visible["title"]
            else [],
            "comment": comment_assets,
            "channel": [EditorLayerAsset(channel_path)]
            if document.overlays.visible["channel"]
            else [],
            **text_assets,
        }
        layer_order = editor_layer_order(document)

        image_inputs: list[Path] = [background_path]
        ordered_assets: list[tuple[str, EditorLayerAsset]] = []
        for layer_name in layer_order:
            if layer_name == "video":
                continue
            for asset in layer_assets.get(layer_name, []):
                prepared_asset = _prepare_editor_layer_asset(
                    asset,
                    assets_dir / f"prepared-layer-{len(ordered_assets):02d}.png",
                )
                if prepared_asset is None:
                    continue
                image_inputs.append(prepared_asset.path)
                ordered_assets.append((layer_name, prepared_asset))
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-y",
            "-i",
            str(clean_path),
        ]
        for image_path in image_inputs:
            command.extend([
                "-loop",
                "1",
                "-framerate",
                "1",
                "-i",
                str(image_path),
            ])
        filters = [
            f"[1:v]setpts=PTS-STARTPTS,scale={CANVAS_WIDTH}:{CANVAS_HEIGHT},"
            f"fps={fps:.3f},"
            "format=rgba[scene0]",
            (
                f"[0:v]setpts=PTS-STARTPTS,fps={fps:.3f},"
                f"scale={frame.width}:{frame.height}:force_original_aspect_ratio=increase,"
                f"crop={frame.width}:{frame.height},format=rgba[video_layer]"
            ),
        ]
        current_label = "scene0"
        next_image_index = 2
        caption_fonts_dir: Path | None = None
        subtitle_path: Path | None = None
        if document.subtitles.enabled and caption_render_spec is not None:
            rendered_caption_spec = retime_editor_caption_spec(
                document,
                caption_render_spec,
            )
            if rendered_caption_spec is not None:
                subtitle_path = create_caption_ass(
                    rendered_caption_spec,
                    assets_dir / "subtitles.ass",
                )
                caption_fonts_dir = prepare_caption_fonts(
                    work_dir / "caption-fonts",
                )
        elif document.subtitles.enabled:
            subtitle_style = editor_subtitle_style(document)
            subtitle_path = create_ass_subtitles(
                retime_editor_subtitles(document),
                clip_start=0,
                clip_end=duration,
                output_path=assets_dir / "subtitles.ass",
                margin_v=subtitle_style.margin_v,
                font_size=subtitle_style.font_size,
            )
        subtitles_applied = False

        def apply_subtitles() -> None:
            nonlocal current_label, subtitles_applied
            if not subtitle_path or subtitles_applied:
                return
            next_label = f"captioned{len(filters)}"
            subtitle_filter = (
                f"[{current_label}]subtitles=filename="
                f"'{_escape_filter_path(subtitle_path)}'"
            )
            if caption_fonts_dir is not None:
                subtitle_filter += (
                    f":fontsdir='{_escape_filter_path(caption_fonts_dir)}'"
                )
            filters.append(f"{subtitle_filter}[{next_label}]")
            current_label = next_label
            subtitles_applied = True

        # The browser uses z-index 50 for subtitles. Editor layers receive
        # 10, 20, ... from their order, so the fifth and later layers cover
        # subtitles while the first four stay behind them.
        for layer_index, layer_name in enumerate(layer_order):
            if layer_index == 4:
                apply_subtitles()
            if layer_name == "video":
                next_label = f"scene{len(filters)}"
                filters.append(
                    f"[{current_label}][video_layer]overlay=x={frame.x}:y={frame.y}:"
                    f"shortest=1[{next_label}]"
                )
                current_label = next_label
                continue
            for _asset_name, asset in (
                item for item in ordered_assets if item[0] == layer_name
            ):
                prepared_label = f"asset{next_image_index}"
                filters.append(
                    _timed_overlay_input_filter(
                        asset,
                        input_index=next_image_index,
                        output_label=prepared_label,
                        fps=fps,
                    )
                )
                next_label = f"scene{len(filters)}"
                enable = ""
                if asset.start_seconds is not None and asset.end_seconds is not None:
                    timed_expression = _timed_overlay_enable_expression(
                        asset.start_seconds,
                        asset.end_seconds,
                        fps,
                    )
                    enable = f":enable='{timed_expression}'"
                filters.append(
                    f"[{current_label}][{prepared_label}]"
                    f"overlay=x={asset.x}:y={asset.y}:"
                    f"eof_action=repeat:repeatlast=1{enable}[{next_label}]"
                )
                current_label = next_label
                next_image_index += 1
        apply_subtitles()
        audio_label = None
        if has_audio:
            filters.append(
                "[0:a]asetpts=PTS-STARTPTS,"
                "loudnorm=I=-16:TP=-1.5:LRA=11[audio]"
            )
            audio_label = "audio"
        command.extend([
            "-filter_complex_threads",
            str(self.settings.ffmpeg_threads),
            "-filter_complex",
            ";".join(filters),
            "-map",
            f"[{current_label}]",
        ])
        if audio_label:
            command.extend(["-map", f"[{audio_label}]"])
        command.extend([
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-threads:v",
            str(self.settings.ffmpeg_threads),
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-r",
            f"{fps:.3f}",
        ])
        if audio_label:
            command.extend(["-c:a", "aac", "-b:a", "128k"])
        command.extend(["-movflags", "+faststart", str(output_path)])
        result = run_command(
            command,
            timeout=editor_render_timeout_seconds(
                self.settings.ffmpeg_timeout_seconds,
                duration,
            ),
            cwd=work_dir,
        )
        if (
            result.returncode != 0
            or not output_path.is_file()
            or output_path.stat().st_size == 0
        ):
            raise RenderError("통합 편집 문서를 영상으로 렌더링하지 못했습니다.")
        output_probe = probe_media(output_path, timeout=30)
        video = next(
            (
                stream
                for stream in output_probe.get("streams", [])
                if stream.get("codec_type") == "video"
            ),
            {},
        )
        if (
            int(video.get("width", 0)) != CANVAS_WIDTH
            or int(video.get("height", 0)) != CANVAS_HEIGHT
        ):
            output_path.unlink(missing_ok=True)
            raise RenderError("통합 편집 영상 해상도를 검증하지 못했습니다.")
        output_duration = media_duration(output_probe)
        if abs(output_duration - duration) > 0.12:
            output_path.unlink(missing_ok=True)
            raise RenderError("통합 편집 영상 길이를 검증하지 못했습니다.")
        return output_path
