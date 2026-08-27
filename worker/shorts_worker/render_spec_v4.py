from __future__ import annotations

import io
from collections.abc import Sequence
from math import floor
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .errors import RenderError
from .font_manifest import editor_font_manifest_entry, normalized_editor_font_bytes
from .overlays import (
    _title_line_character_indices,
    _title_style_runs,
    wrap_korean_title,
)
from .schemas import (
    EDITOR_FONT_FILE_IDS,
    EDITOR_FONT_METRICS_REVISION,
    EDITOR_FONT_STATIC_WEIGHTS,
    EDITOR_FONT_VARIABLE_IDS,
    CommentOverlay,
    CustomTemplateConfig,
    EditorFontId,
    EditorRenderSpec,
    EditorRenderTitleSpec,
    EditorResolvedFontFace,
    TemplateId,
    TitleTextStyle,
    VideoAspectRatio,
)

CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920
EDITOR_FONT_DIRECTORY = Path(__file__).parent / "assets" / "editor_fonts"

EDITOR_FONT_RENDER_FAMILIES = {
    EditorFontId.PRETENDARD: '"Editor V4 Pretendard"',
    EditorFontId.NOTO_SANS_KR: '"Editor V4 Noto Sans KR"',
    EditorFontId.DO_HYEON: '"Editor V4 Do Hyeon"',
    EditorFontId.JUA: '"Editor V4 Jua"',
    EditorFontId.JALNAN_2: '"Editor V4 Jalnan 2"',
    EditorFontId.CAFE24_ANEMONE: '"Editor V4 Cafe24 Anemone"',
    EditorFontId.CAFE24_PRO_UP: '"Editor V4 Cafe24 Pro Up"',
    EditorFontId.SANDBOX_AGGRO: '"Editor V4 Sandbox Aggro"',
    EditorFontId.GALMURI_9: '"Editor V4 Galmuri 9"',
    EditorFontId.BLACK_HAN_SANS: '"Editor V4 Black Han Sans"',
    EditorFontId.GODO: '"Editor V4 Godo"',
    EditorFontId.PAPERLOGY: '"Editor V4 Paperlogy"',
    EditorFontId.GMARKET_SANS: '"Editor V4 Gmarket Sans"',
    EditorFontId.NANUM_SQUARE_NEO: '"Editor V4 Nanum Square Neo"',
    EditorFontId.S_CORE_DREAM: '"Editor V4 S-Core Dream"',
    EditorFontId.SUIT: '"Editor V4 SUIT"',
    EditorFontId.SPOQA_HAN_SANS_NEO: '"Editor V4 Spoqa Han Sans Neo"',
    EditorFontId.NOTO_SERIF_KR: '"Editor V4 Noto Serif KR"',
    EditorFontId.NANUM_MYEONGJO: '"Editor V4 Nanum Myeongjo"',
    EditorFontId.RIDI_BATANG: '"Editor V4 Ridi Batang"',
}


def canonical_px_v4(value: float) -> float:
    """Match Math.round(value * 1000) / 1000 for fixed-point geometry."""
    return floor(float(value) * 1000 + 0.5) / 1000


def editor_font_path_v4(font_id: EditorFontId) -> Path:
    path = EDITOR_FONT_DIRECTORY / EDITOR_FONT_FILE_IDS[font_id]
    if not path.is_file():
        raise RenderError(f"편집기 폰트 파일을 찾지 못했습니다: {font_id.value}")
    return path


def editor_font_face_v4(
    font_id: EditorFontId,
    *,
    requested_weight: int,
) -> dict[str, object]:
    path = editor_font_path_v4(font_id)
    manifest_entry = editor_font_manifest_entry(font_id)
    variable_weight = requested_weight if font_id in EDITOR_FONT_VARIABLE_IDS else None
    resolved_weight = (
        requested_weight
        if variable_weight is not None
        else EDITOR_FONT_STATIC_WEIGHTS[font_id]
    )
    return {
        "fontId": font_id.value,
        "fileId": path.name,
        "family": EDITOR_FONT_RENDER_FAMILIES[font_id],
        "requestedWeight": requested_weight,
        "resolvedWeight": resolved_weight,
        "variableWeight": variable_weight,
        "sha256": manifest_entry["sha256"],
        "metrics": {"revision": EDITOR_FONT_METRICS_REVISION},
    }


def verify_editor_font_face_v4(face: EditorResolvedFontFace) -> Path:
    path = editor_font_path_v4(face.font_id)
    expected = editor_font_face_v4(
        face.font_id,
        requested_weight=face.requested_weight,
    )
    actual = face.model_dump(by_alias=True)
    if any(actual.get(key) != expected[key] for key in expected):
        raise RenderError(
            f"편집기 v4 폰트 정보가 승인된 파일과 다릅니다: {face.font_id.value}"
        )
    return path


def _load_font(face: EditorResolvedFontFace, size: float) -> ImageFont.FreeTypeFont:
    verify_editor_font_face_v4(face)
    try:
        font = ImageFont.truetype(
            io.BytesIO(normalized_editor_font_bytes(face.font_id)),
            size=max(1, round(size)),
        )
        if face.font_id in EDITOR_FONT_VARIABLE_IDS:
            font.set_variation_by_axes([face.resolved_weight])
        return font
    except OSError as exc:
        raise RenderError(
            f"편집기 v4 폰트를 불러오지 못했습니다: {face.font_id.value}"
        ) from exc


def _merged_background_runs(
    line: str,
    line_indices: list[int | None],
    title_text_styles: Sequence[TitleTextStyle],
    default_background: str | None,
) -> list[dict[str, object]]:
    runs: list[dict[str, object]] = []
    for start, end, _color, background in _title_style_runs(
        line,
        line_indices,
        list(title_text_styles),
    ):
        resolved = background or default_background
        if not resolved:
            continue
        if runs and runs[-1]["end"] == start and runs[-1]["color"] == resolved:
            runs[-1]["end"] = end
        else:
            runs.append({"start": start, "end": end, "color": resolved})
    return runs


def compile_editor_title_spec_v4(
    *,
    title: str,
    template_id: TemplateId | str,
    video_aspect_ratio: VideoAspectRatio | str,
    font_id: EditorFontId | str,
    font_scale: float,
    title_text_styles: Sequence[TitleTextStyle] | None = None,
    custom_template_config: CustomTemplateConfig | dict[str, object] | None = None,
    visible: bool = True,
    offset_x: float = 0,
    offset_y: float = 0,
) -> dict[str, object]:
    """Compile the one authoritative title layout used by both render paths.

    All fitting and canvas-bound correction happens here. Consumers must draw
    the stored line boxes verbatim; they must never fit, center, clamp or wrap
    this layout again.
    """
    try:
        resolved_template_id = TemplateId(str(template_id))
        resolved_aspect_ratio = VideoAspectRatio(str(video_aspect_ratio))
        resolved_font_id = EditorFontId(str(font_id))
    except ValueError as exc:
        raise RenderError("v4 제목 템플릿 또는 폰트가 올바르지 않습니다.") from exc
    config = (
        custom_template_config
        if isinstance(custom_template_config, CustomTemplateConfig)
        else CustomTemplateConfig.model_validate(custom_template_config)
        if isinstance(custom_template_config, dict)
        else None
    )
    if not 0.5 <= float(font_scale) <= 2:
        raise RenderError("v4 제목 글자 크기 배율이 올바르지 않습니다.")

    if config is not None and config.title.font_id is not None:
        resolved_font_id = config.title.font_id
    elif config is not None and config.schema_version == 5:
        raise RenderError("v5 템플릿의 v4 제목 폰트를 찾지 못했습니다.")

    face_value = editor_font_face_v4(resolved_font_id, requested_weight=700)
    face = EditorResolvedFontFace.model_validate(face_value)
    lines = wrap_korean_title(
        title,
        max_chars=20,
        max_lines=2,
    )
    if not lines:
        raise RenderError("v4 제목 텍스트가 비어 있습니다.")

    custom_title = config.title if config is not None else None
    preferred_size = custom_title.font_size if custom_title is not None else 84
    maximum_width = custom_title.max_width if custom_title is not None else 930
    font_size = max(18, min(200, floor(preferred_size * font_scale + 0.5)))

    def title_spacing(size: int) -> tuple[int, int, int]:
        if custom_title is not None:
            return (
                max(6, floor(size * 0.18 + 0.5)),
                max(10, floor(size * 0.28 + 0.5)),
                max(6, floor(size * 0.14 + 0.5)),
            )
        return (
            18,
            max(1, floor(size * 0.34 + 0.5)),
            max(1, floor(size * 0.14 + 0.5)),
        )

    while True:
        font = _load_font(face, font_size)
        line_gap, line_padding_x, line_padding_y = title_spacing(font_size)
        if (
            max(float(font.getlength(line)) + line_padding_x * 2 for line in lines)
            <= maximum_width
            or font_size <= 18
        ):
            break
        font_size -= 1

    line_widths: list[float] = []
    line_heights: list[float] = []
    line_ascent_descent: list[tuple[float, float]] = []
    for line in lines:
        _left, top, _right, bottom = font.getbbox(line, anchor="ls")
        ascent = max(0.0, float(-top))
        descent = max(0.0, float(bottom))
        if ascent + descent <= 0:
            raise RenderError("v4 제목 글꼴 메트릭을 측정하지 못했습니다.")
        line_widths.append(
            canonical_px_v4(float(font.getlength(line)) + line_padding_x * 2)
        )
        line_heights.append(
            canonical_px_v4(ascent + descent + line_padding_y * 2)
        )
        line_ascent_descent.append((ascent, descent))
    content_height = sum(line_heights) + line_gap * max(0, len(lines) - 1)
    widest = max(line_widths)
    desired_center_x = (
        float(custom_title.x) if custom_title is not None else CANVAS_WIDTH / 2
    ) + float(offset_x)
    if custom_title is not None:
        desired_center_y = float(custom_title.y) + float(offset_y)
    else:
        aspect_ratio = resolved_aspect_ratio
        if (
            resolved_template_id is TemplateId.COMMENT_CAPTURE
            and aspect_ratio is VideoAspectRatio.FULL_VERTICAL
        ):
            aspect_ratio = VideoAspectRatio.PORTRAIT
        video_heights = {
            VideoAspectRatio.LANDSCAPE: 608,
            VideoAspectRatio.LANDSCAPE_FIVE_FOUR: 864,
            VideoAspectRatio.SQUARE: 1080,
            VideoAspectRatio.PORTRAIT: 1350,
            VideoAspectRatio.FULL_VERTICAL: 1920,
        }
        if aspect_ratio is VideoAspectRatio.FULL_VERTICAL:
            panel_height = 360
            panel_top = 96
        else:
            panel_height = round((CANVAS_HEIGHT - video_heights[aspect_ratio]) / 2)
            if (
                resolved_template_id is TemplateId.COMMENT_CAPTURE
                and aspect_ratio is VideoAspectRatio.LANDSCAPE
            ):
                panel_height -= 160
            panel_top = 0
        bottom_margin = (
            12
            if panel_height == 285
            else min(44, max(24, floor(panel_height * 0.105 + 0.5)))
        )
        desired_center_y = (
            panel_top
            + panel_height
            - bottom_margin
            - content_height / 2
            + float(offset_y)
        )

    center_x = min(
        CANVAS_WIDTH - widest / 2,
        max(widest / 2, desired_center_x),
    )
    center_y = min(
        CANVAS_HEIGHT - content_height / 2,
        max(content_height / 2, desired_center_y),
    )
    center_x = canonical_px_v4(center_x)
    center_y = canonical_px_v4(center_y)

    styles = list(title_text_styles or [])
    line_indices = _title_line_character_indices(title, lines)
    boxes: list[dict[str, object]] = []
    cursor_y = center_y - content_height / 2
    for index, line in enumerate(lines):
        line_height = line_heights[index]
        line_center_y = canonical_px_v4(cursor_y + line_height / 2)
        ascent, descent = line_ascent_descent[index]
        baseline_y = canonical_px_v4(line_center_y + (ascent - descent) / 2)
        default_background = (
            custom_title.accent_background_color
            if index > 0
            else custom_title.primary_background_color
        ) if custom_title is not None else None
        background_runs = _merged_background_runs(
            line,
            line_indices[index],
            styles,
            default_background,
        )
        advance_width = line_widths[index] - line_padding_x * 2
        line_left = center_x - advance_width / 2
        # Use the configured em box for title backgrounds. Glyph ink bounds
        # differ slightly between browser Canvas and Pillow even with the same
        # bundled font; the em box is deterministic across both compilers.
        background_height = canonical_px_v4(font_size + line_padding_y * 2)
        background_top = line_center_y - background_height / 2
        radius = max(6, floor(font_size * 0.14 + 0.5))
        for background in background_runs:
            run_left = line_left + float(
                font.getlength(line[: int(background["start"])])
            )
            run_right = line_left + float(
                font.getlength(line[: int(background["end"])])
            )
            background.update({
                "x": canonical_px_v4(run_left - line_padding_x),
                "y": canonical_px_v4(background_top),
                "width": canonical_px_v4(
                    run_right - run_left + line_padding_x * 2
                ),
                "height": background_height,
                "radius": canonical_px_v4(radius),
            })
        boxes.append({
            "text": line,
            "centerX": center_x,
            "centerY": line_center_y,
            "width": line_widths[index],
            "height": line_height,
            "baselineY": baseline_y,
            "backgroundRuns": background_runs,
        })
        cursor_y += line_height + line_gap

    return {
        "lines": lines,
        "centerX": center_x,
        "centerY": center_y,
        "offsetY": canonical_px_v4(offset_y),
        "fontSize": canonical_px_v4(font_size),
        "scale": 1,
        "visible": custom_title.visible if custom_title is not None else visible,
        "lineGap": canonical_px_v4(line_gap),
        "linePaddingX": canonical_px_v4(line_padding_x),
        "linePaddingY": canonical_px_v4(line_padding_y),
        "clamp": {
            "minX": 0,
            "maxX": CANVAS_WIDTH,
            "minY": 0,
            "maxY": CANVAS_HEIGHT,
        },
        "lineBoxes": boxes,
        "font": face_value,
    }


def compile_initial_editor_render_spec_v4(
    *,
    title: str,
    template_id: TemplateId | str,
    video_aspect_ratio: VideoAspectRatio | str,
    font_scale: float,
    title_text_styles: Sequence[TitleTextStyle] | None = None,
    custom_template_config: CustomTemplateConfig | dict[str, object] | None = None,
    comments: Sequence[CommentOverlay | dict[str, object]] = (),
    caption_render_spec: dict[str, object] | None = None,
) -> dict[str, object]:
    """Compile the complete authoritative v4 spec before the first render.

    The initial worker and the browser both start from the editor's default
    overlay layout.  Persisting this complete object before rendering makes a
    no-op editor save consume the same title geometry and caption identity as
    the first render instead of silently recompiling either one.
    """
    config = (
        custom_template_config
        if isinstance(custom_template_config, CustomTemplateConfig)
        else CustomTemplateConfig.model_validate(custom_template_config)
        if isinstance(custom_template_config, dict)
        else None
    )
    title_font_id = (
        config.title.font_id
        if config is not None and config.title.font_id is not None
        else EditorFontId.PRETENDARD
    )
    title_spec = compile_editor_title_spec_v4(
        title=title,
        template_id=template_id,
        video_aspect_ratio=video_aspect_ratio,
        font_id=title_font_id,
        font_scale=font_scale,
        title_text_styles=title_text_styles,
        custom_template_config=config,
        visible=True,
    )
    parsed_comments = [
        value
        if isinstance(value, CommentOverlay)
        else CommentOverlay.model_validate(value)
        for value in comments
    ]
    comment_specs = [
        {
            "id": comment.id,
            "offsetY": 0,
            "startFrame": max(0, floor(comment.start_seconds * 30 + 0.5)),
            "endFrame": max(1, floor(comment.end_seconds * 30 + 0.5)),
        }
        for comment in parsed_comments
    ]
    subtitles: dict[str, object] | None = None
    if caption_render_spec is not None:
        if (
            caption_render_spec.get("schemaVersion") != 4
            or caption_render_spec.get("layoutMode")
            != "absolute-word-positions-v1"
        ):
            raise RenderError(
                "v4 최초 렌더에는 v4 자막 명세만 사용할 수 있습니다."
            )
        caption_font = caption_render_spec.get("font")
        caption_style = caption_render_spec.get("style")
        if not isinstance(caption_font, dict) or not isinstance(caption_style, dict):
            raise RenderError("v4 최초 렌더 자막 스타일이 올바르지 않습니다.")
        subtitles = {
            "centerX": 540,
            "visible": True,
            "captionSpecVersion": 4,
            "offsetY": 0,
            "scale": 1,
            "fontId": str(caption_font.get("fontId") or ""),
            "fontSize": caption_style.get("fontSize"),
            "color": caption_style.get("textColor"),
            "accentColor": caption_style.get("accentColor"),
            "cueEdits": [],
        }
    value: dict[str, object] = {
        "version": 4,
        "canvas": {"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT},
        "fps": 30,
        "layerOrder": ["video", "title", "comment", "channel"],
        "title": title_spec,
        "channel": {
            "offsetX": 0,
            "offsetY": 0,
            "scale": 1,
            "visible": config.channel.visible if config is not None else True,
            "font": editor_font_face_v4(
                EditorFontId.PRETENDARD,
                requested_weight=700,
            ),
        },
        "comments": comment_specs,
        "textOverlays": [],
        "video": {"offsetX": 0, "offsetY": 0, "scale": 1},
        **({"subtitles": subtitles} if subtitles is not None else {}),
    }
    # Validate before persistence; callers must never store a partially
    # compiled object and let the first renderer guess at missing values.
    persisted = EditorRenderSpec.model_validate(value).model_dump(by_alias=True)
    if persisted.get("subtitles") is None:
        persisted.pop("subtitles")
    return persisted


def draw_editor_title_spec_v4(
    *,
    title_spec: EditorRenderTitleSpec,
    source_title: str,
    title_text_styles: Sequence[TitleTextStyle],
    primary_color: str,
    accent_color: str,
) -> Image.Image:
    """Draw v4 title boxes exactly, without layout fallback or correction."""
    canvas = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
    if title_spec.visible is not True:
        return canvas
    if title_spec.line_boxes is None or title_spec.line_padding_x is None:
        raise RenderError("v4 제목 라인 박스를 찾지 못했습니다.")
    font = _load_font(title_spec.font, title_spec.font_size)
    draw = ImageDraw.Draw(canvas)
    indices = _title_line_character_indices(source_title, title_spec.lines)
    style_runs = [
        _title_style_runs(
            line,
            indices[index],
            list(title_text_styles),
        )
        for index, line in enumerate(title_spec.lines)
    ]
    padding_x = float(title_spec.line_padding_x)

    for line_index, box in enumerate(title_spec.line_boxes):
        stored_advance_width = float(box.width) - padding_x * 2
        natural_advance_width = float(font.getlength(box.text))
        if stored_advance_width <= 0 or natural_advance_width <= 0:
            raise RenderError("v4 제목 라인 너비가 올바르지 않습니다.")
        horizontal_scale = stored_advance_width / natural_advance_width
        line_left = float(box.center_x) - stored_advance_width / 2
        line_top = float(box.center_y) - float(box.height) / 2
        line_bottom = float(box.center_y) + float(box.height) / 2
        for background in box.background_runs:
            if all(
                value is not None
                for value in (
                    background.x,
                    background.y,
                    background.width,
                    background.height,
                    background.radius,
                )
            ):
                bounds = (
                    float(background.x),
                    float(background.y),
                    # Stored rectangles use the browser/CSS half-open extent
                    # [x, x + width). Pillow's rectangle endpoint is inclusive,
                    # so subtract one device pixel to draw that same extent.
                    float(background.x + background.width - 1),
                    float(background.y + background.height - 1),
                )
                background_radius = float(background.radius)
            else:
                run_left = line_left + (
                    float(font.getlength(box.text[:background.start]))
                    * horizontal_scale
                )
                run_right = line_left + (
                    float(font.getlength(box.text[:background.end]))
                    * horizontal_scale
                )
                bounds = (
                    run_left - padding_x,
                    line_top,
                    run_right + padding_x,
                    line_bottom,
                )
                background_radius = max(
                    6,
                    floor(float(title_spec.font_size) * 0.14 + 0.5),
                )
            draw.rounded_rectangle(
                bounds,
                radius=background_radius,
                fill=background.color,
            )

        default_color = accent_color if line_index > 0 else primary_color
        natural_left = float(box.center_x) - natural_advance_width / 2
        glyph_layer = Image.new(
            "RGBA",
            (CANVAS_WIDTH, CANVAS_HEIGHT),
            (0, 0, 0, 0),
        )
        glyph_draw = ImageDraw.Draw(glyph_layer)
        for start, end, run_color, _background in style_runs[line_index]:
            run_left = natural_left + float(font.getlength(box.text[:start]))
            glyph_draw.text(
                (run_left, float(box.baseline_y)),
                box.text[start:end],
                font=font,
                fill=run_color or default_color,
                anchor="ls",
            )
        if abs(horizontal_scale - 1) > 0.000_001:
            inverse_scale = 1 / horizontal_scale
            center_x = float(box.center_x)
            glyph_layer = glyph_layer.transform(
                glyph_layer.size,
                Image.Transform.AFFINE,
                (
                    inverse_scale,
                    0,
                    center_x * (1 - inverse_scale),
                    0,
                    1,
                    0,
                ),
                resample=Image.Resampling.BICUBIC,
            )
        canvas.alpha_composite(glyph_layer)
    return canvas
