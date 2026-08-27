from __future__ import annotations

import hashlib
import json
import subprocess
from math import floor
from pathlib import Path
from typing import Any

from PIL import Image

from .caption_templates import (
    compile_caption_render_spec,
    create_caption_ass,
    prepare_caption_fonts,
)
from .overlays import TEMPLATE_STYLES
from .render_spec_v4 import (
    compile_editor_title_spec_v4,
    draw_editor_title_spec_v4,
)
from .schemas import (
    EditorFontId,
    EditorRenderTitleSpec,
    TitleTextStyle,
    VideoAspectRatio,
)
from .subtitles import TranscriptWord

CANVAS_WIDTH = 1_080
CANVAS_HEIGHT = 1_920
SAMPLE_SECONDS = 1.5


def _sha256(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def _custom_template(
    *,
    title_x: int,
    title_y: int,
    title_width: int,
    primary_background: str | None,
    accent_background: str | None,
    font_id: EditorFontId = EditorFontId.GMARKET_SANS,
) -> dict[str, object]:
    return {
        "schemaVersion": 5,
        "background": {"kind": "color", "color": "#000000"},
        "video": {
            "aspectRatio": "16:9",
            "x": 120,
            "y": 550,
            "width": 840,
            "height": 472,
            "fit": "cover",
        },
        "title": {
            "visible": True,
            "x": title_x,
            "y": title_y,
            "maxWidth": title_width,
            "fontSize": 84,
            "fontId": font_id.value,
            "primaryColor": "#FFFFFF",
            "accentColor": "#35E6E3",
            "primaryBackgroundColor": primary_background,
            "accentBackgroundColor": accent_background,
        },
        "subtitle": {
            "visible": True,
            "variant": "pop",
            "x": 540,
            "y": 736,
            "maxWidth": 840,
            "fontId": "paperlogy",
            "fontSize": 92,
            "color": "#FFFFFF",
            "accentColor": "#35E6E3",
        },
        "channel": {
            "visible": True,
            "x": 540,
            "y": 1720,
            "maxWidth": 720,
            "fontSize": 42,
            "color": "#FFFFFF",
            "backgroundColor": None,
        },
        "comment": {
            "visible": True,
            "theme": "dark",
            "size": "medium",
            "y": 1340,
            "dockedToVideo": False,
        },
    }


def _title_fixture(
    *,
    title: str,
    text_styles: list[TitleTextStyle],
    custom_template: dict[str, object] | None,
    font_id: EditorFontId,
) -> tuple[dict[str, Any], Image.Image]:
    style = TEMPLATE_STYLES["dark-minimal"]
    spec_value = compile_editor_title_spec_v4(
        title=title,
        template_id="dark-minimal",
        video_aspect_ratio="16:9",
        font_id=font_id.value,
        font_scale=1,
        title_text_styles=text_styles,
        custom_template_config=custom_template,
        offset_x=0,
        offset_y=0,
    )
    spec = EditorRenderTitleSpec.model_validate(spec_value)
    layer = draw_editor_title_spec_v4(
        title_spec=spec,
        source_title=title,
        title_text_styles=text_styles,
        primary_color=style.primary,
        accent_color=style.accent,
    )
    fixture = {
        "schemaVersion": 1,
        "canvas": {"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT},
        "title": {
            "spec": spec.model_dump(by_alias=True),
            "compilerInput": {
                "templateId": "dark-minimal",
                "title": title,
                "templateConfig": custom_template,
                "videoAspectRatio": "16:9",
                "textStyles": [
                    text_style.model_dump(by_alias=True)
                    for text_style in text_styles
                ],
                "fontId": font_id.value,
            },
            "sourceTitle": title,
            "textStyles": [style.model_dump(by_alias=True) for style in text_styles],
            "primaryColor": style.primary,
            "accentColor": style.accent,
        },
    }
    return fixture, layer


def _active_caption(
    caption_spec: dict[str, Any],
    sample_frame: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    for cue in caption_spec.get("cues") or []:
        for event in cue.get("events") or []:
            if int(event["startFrame"]) <= sample_frame < int(event["endFrame"]):
                return cue, event
    raise RuntimeError(f"No browser parity caption is active at frame {sample_frame}")


def _caption_fixture(
    caption_spec: dict[str, Any],
    *,
    sample_seconds: float,
) -> dict[str, Any]:
    sample_frame = floor(sample_seconds * int(caption_spec["fps"]) + 0.0001)
    cue, event = _active_caption(caption_spec, sample_frame)
    font = caption_spec["font"]
    style = caption_spec["style"]
    mode = (
        "positioned-pop"
        if caption_spec["templateId"] == "pop"
        else "flow-highlight"
    )
    caption: dict[str, Any] = {
        "mode": mode,
        "words": [
            {
                "text": str(word["text"]),
                "fontSize": float(word.get("fontSize") or style["fontSize"]),
                "spaceBefore": bool(word.get("spaceBefore")),
            }
            for word in cue["words"]
        ],
        "activeWordIndex": int(event["activeWordIndex"]),
        "activeWordScale": 1.12,
        "layoutScale": 1,
        "offsetY": 0,
        "cssToAssScale": float(font["metrics"]["cssToAssScale"]),
        "cssToAssBaselineOffsetEm": float(
            font["metrics"]["cssToAssBaselineOffsetEm"]
        ),
        "textColor": str(style["textColor"]),
        "accentColor": str(style["accentColor"]),
        "outlineColor": str(style["outlineColor"]),
        "outlineWidth": float(style["outlineWidth"]),
        "fontFamily": str(font["family"]),
        "fontWeight": int(font["weight"]),
        "fontId": str(font["fontId"]),
        "fontFileId": str(font["fileId"]),
        "safeArea": caption_spec["safeArea"],
        "compilerInput": {
            "subtitle": {
                "visible": True,
                "variant": caption_spec["templateId"],
                "x": int(
                    float(caption_spec["safeArea"]["x"])
                    + float(caption_spec["safeArea"]["width"]) / 2
                ),
                "y": int(
                    float(caption_spec["safeArea"]["y"])
                    + float(caption_spec["safeArea"]["height"]) / 2
                ),
                "maxWidth": int(float(caption_spec["safeArea"]["width"])),
                "fontId": str(font["fontId"]),
                "fontSize": int(float(style["fontSize"])),
                "color": str(style["textColor"]),
                "accentColor": str(style["accentColor"]),
            },
            "previewWords": [
                {
                    "text": str(word["text"]),
                    "active": word_index == int(event["activeWordIndex"]),
                    "spaceBefore": bool(word.get("spaceBefore")),
                }
                for word_index, word in enumerate(cue["words"])
            ],
        },
    }
    if mode == "positioned-pop":
        caption["positions"] = event["positions"]
    else:
        caption.update({
            "centerX": float(cue.get("centerX") or 540),
            "centerY": float(
                cue.get("centerY")
                or (
                    float(caption_spec["safeArea"]["y"])
                    + float(caption_spec["safeArea"]["height"]) / 2
                )
            ),
            "fontSize": float(cue.get("fontSize") or style["fontSize"]),
            "scaleX": float(cue.get("scaleX") or 100) / 100,
            "lines": cue.get("lines") or [list(range(len(cue["words"])))],
            "wordSeparator": str(cue.get("wordSeparator") or " "),
            "separatorAdvanceWidth": float(cue["separatorAdvanceWidth"]),
        })
    return {
        "schemaVersion": 1,
        "canvas": {"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT},
        "sample": {"seconds": sample_seconds, "frame": sample_frame},
        "caption": caption,
    }


def _subtitle_filter(path: Path, font_directory: Path) -> str:
    def escape(value: Path) -> str:
        return str(value).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")

    return f"subtitles=filename='{escape(path)}':fontsdir='{escape(font_directory)}'"


def _render_caption(
    caption_spec: dict[str, Any],
    *,
    sample_seconds: float,
    root: Path,
    output_path: Path,
) -> None:
    ass_path = create_caption_ass(caption_spec, root / "caption.ass")
    font_directory = prepare_caption_fonts(root / "fonts", caption_spec)
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=black:s={CANVAS_WIDTH}x{CANVAS_HEIGHT}:r=30:d=3",
            "-vf",
            _subtitle_filter(ass_path, font_directory),
            "-ss",
            str(sample_seconds),
            "-frames:v",
            "1",
            str(output_path),
        ],
        check=True,
        timeout=60,
        shell=False,
    )


def _caption_spec(
    *,
    font_id: EditorFontId,
    template_id: str,
    language: str = "mixed",
) -> dict[str, Any]:
    tokens = {
        "mixed": ("한", "A", "글"),
        "korean": ("한", "글", "자"),
        "english": ("A", "B", "C"),
    }.get(language)
    if tokens is None:
        raise ValueError(f"Unsupported browser parity caption language: {language}")
    words = [
        TranscriptWord(text=tokens[0], start=0.55, end=0.95, provider="probe"),
        TranscriptWord(
            text=tokens[1],
            start=1.05,
            end=1.45,
            provider="probe",
            space_before=True,
        ),
        TranscriptWord(
            text=tokens[2],
            start=1.55,
            end=1.95,
            provider="probe",
            space_before=template_id != "pop",
        ),
    ]
    return compile_caption_render_spec(
        words,
        template_id=template_id,
        clip_start=0,
        clip_end=3,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        caption_placement="center",
        font_id=font_id,
        schema_version=4,
    )


def build_browser_parity_matrix(
    root: Path,
    *,
    runtime_identity: dict[str, str],
) -> dict[str, Any]:
    """Render the browser contract matrix inside the isolated Linux worker."""
    root.mkdir(parents=True, exist_ok=True)
    frames = root / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    cases: list[dict[str, Any]] = []

    title_cases = [
        (
            "title-long-hangul-transparent",
            "아주 긴 한글 후킹 제목도\n미리보기와 똑같이 줄어듭니다",
            [],
            None,
            ["long-korean-title", "transparent-title-background"],
            EditorFontId.GMARKET_SANS,
        ),
        (
            "title-colored-background",
            "색상 배경 제목\n부분 강조 배경",
            [],
            _custom_template(
                title_x=540,
                title_y=260,
                title_width=820,
                primary_background="#16A34A",
                accent_background="#2563EB",
                font_id=EditorFontId.NOTO_SERIF_KR,
            ),
            ["colored-title-background"],
            EditorFontId.NOTO_SERIF_KR,
        ),
        (
            "title-left-edge",
            "왼쪽 가장자리\n제목 위치",
            [],
            _custom_template(
                title_x=0,
                title_y=210,
                title_width=420,
                primary_background=None,
                accent_background=None,
                font_id=EditorFontId.PAPERLOGY,
            ),
            ["non-centered-title", "edge-clamped-title"],
            EditorFontId.PAPERLOGY,
        ),
        (
            "title-right-edge",
            "오른쪽 가장자리\n제목 위치",
            [],
            _custom_template(
                title_x=1080,
                title_y=300,
                title_width=420,
                primary_background=None,
                accent_background=None,
                font_id=EditorFontId.GALMURI_9,
            ),
            ["non-centered-title", "edge-clamped-title"],
            EditorFontId.GALMURI_9,
        ),
    ]
    for (
        case_id,
        title,
        styles,
        custom_template,
        coverage,
        font_id,
    ) in title_cases:
        fixture, layer = _title_fixture(
            title=title,
            text_styles=styles,
            custom_template=custom_template,
            font_id=font_id,
        )
        fixture["caseId"] = case_id
        fixture["coverage"] = coverage
        fixture["fontId"] = font_id.value
        frame_path = frames / f"{case_id}.png"
        background = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), "#000000")
        background.alpha_composite(layer)
        background.convert("RGB").save(frame_path)
        cases.append({
            "id": case_id,
            "coverage": coverage,
            "fontId": font_id.value,
            "fixture": fixture,
            "workerFrameName": f"frames/{case_id}.png",
            "workerFrameSha256": _sha256(frame_path),
        })

    for font_id in EditorFontId:
        case_id = f"title-font-{font_id.value}"
        custom_template = _custom_template(
            title_x=540,
            title_y=250,
            title_width=820,
            primary_background=None,
            accent_background=None,
            font_id=font_id,
        )
        fixture, layer = _title_fixture(
            title="한글 A Title\n폰트 정확도",
            text_styles=[],
            custom_template=custom_template,
            font_id=font_id,
        )
        coverage = ["title-font-matrix", "mixed-language-title"]
        fixture.update({
            "caseId": case_id,
            "coverage": coverage,
            "fontId": font_id.value,
        })
        frame_path = frames / f"{case_id}.png"
        background = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), "#000000")
        background.alpha_composite(layer)
        background.convert("RGB").save(frame_path)
        cases.append({
            "id": case_id,
            "coverage": coverage,
            "fontId": font_id.value,
            "templateId": "title",
            "fixture": fixture,
            "workerFrameName": f"frames/{case_id}.png",
            "workerFrameSha256": _sha256(frame_path),
        })

    for font_id in EditorFontId:
        for template_id in ("pop", "highlight"):
            case_id = f"font-{template_id}-{font_id.value}"
            case_root = root / case_id
            case_root.mkdir(parents=True, exist_ok=True)
            spec = _caption_spec(font_id=font_id, template_id=template_id)
            frame_path = frames / f"{case_id}.png"
            _render_caption(
                spec,
                sample_seconds=SAMPLE_SECONDS,
                root=case_root,
                output_path=frame_path,
            )
            fixture = _caption_fixture(spec, sample_seconds=SAMPLE_SECONDS)
            coverage = [
                f"{template_id}-caption",
                "mixed-language-caption",
                "font-template-mode-matrix",
            ]
            fixture.update({
                "caseId": case_id,
                "coverage": coverage,
                "fontId": font_id.value,
            })
            cases.append({
                "id": case_id,
                "coverage": coverage,
                "fontId": font_id.value,
                "templateId": template_id,
                "fixture": fixture,
                "workerFrameName": f"frames/{case_id}.png",
                "workerFrameSha256": _sha256(frame_path),
            })

    for language, coverage_name in (
        ("korean", "pure-korean-caption"),
        ("english", "pure-english-caption"),
    ):
        case_id = f"caption-pop-{language}"
        case_root = root / case_id
        case_root.mkdir(parents=True, exist_ok=True)
        spec = _caption_spec(
            font_id=EditorFontId.PAPERLOGY,
            template_id="pop",
            language=language,
        )
        frame_path = frames / f"{case_id}.png"
        _render_caption(
            spec,
            sample_seconds=SAMPLE_SECONDS,
            root=case_root,
            output_path=frame_path,
        )
        fixture = _caption_fixture(spec, sample_seconds=SAMPLE_SECONDS)
        coverage = ["pop-caption", coverage_name]
        fixture.update({
            "caseId": case_id,
            "coverage": coverage,
            "fontId": EditorFontId.PAPERLOGY.value,
        })
        cases.append({
            "id": case_id,
            "coverage": coverage,
            "fontId": EditorFontId.PAPERLOGY.value,
            "templateId": "pop",
            "fixture": fixture,
            "workerFrameName": f"frames/{case_id}.png",
            "workerFrameSha256": _sha256(frame_path),
        })

    matrix = {
        "schemaVersion": 1,
        "renderer": "isolated-linux-worker-v4",
        "runtimeIdentity": runtime_identity,
        "caseCount": len(cases),
        "fontIds": [font_id.value for font_id in EditorFontId],
        "cases": cases,
    }
    (root / "matrix.json").write_text(
        json.dumps(matrix, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return matrix
