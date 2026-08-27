"""Export the deterministic Stage B browser/worker parity fixture.

The browser harness consumes the exact v4 title/caption contracts produced by
the worker.  ``--worker-frame`` is only a local smoke-test convenience.  The
release gate compares the browser capture with the frame uploaded by the
isolated Linux Batch worker instead.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from math import floor
from pathlib import Path
from typing import Any

from PIL import Image
from shorts_worker.caption_templates import create_caption_ass, prepare_caption_fonts
from shorts_worker.editor_release_probe import _document, _pop_caption_render_spec
from shorts_worker.editor_renderer import retime_editor_caption_spec
from shorts_worker.overlays import TEMPLATE_STYLES
from shorts_worker.render_spec_v4 import draw_editor_title_spec_v4
from shorts_worker.schemas import VideoAspectRatio


def _active_caption(caption_spec: dict[str, Any], sample_frame: int) -> dict[str, Any]:
    for cue in caption_spec.get("cues") or []:
        for event in cue.get("events") or []:
            if int(event["startFrame"]) <= sample_frame < int(event["endFrame"]):
                return {
                    "words": [
                        {
                            "text": str(word["text"]),
                            "fontSize": float(
                                word.get("fontSize") or caption_spec["style"]["fontSize"]
                            ),
                        }
                        for word in cue["words"]
                    ],
                    "positions": event["positions"],
                    "activeWordIndex": int(event["activeWordIndex"]),
                }
    raise RuntimeError(f"No v4 caption event is active at frame {sample_frame}")


def build_fixture() -> dict[str, Any]:
    document = _document("baseline")
    if document.render_spec is None or document.render_spec.version != 4:
        raise RuntimeError("The Stage B baseline document must contain renderSpec v4")
    source_caption_spec = _pop_caption_render_spec()
    caption_spec = retime_editor_caption_spec(document, source_caption_spec)
    if caption_spec is None:
        raise RuntimeError("The Stage B baseline timeline removed every caption event")
    sample_seconds = 2.0
    sample_frame = floor(sample_seconds * int(caption_spec["fps"]) + 0.0001)
    active_caption = _active_caption(caption_spec, sample_frame)
    template_style = TEMPLATE_STYLES[document.template.id]
    title_primary = (
        template_style.accent
        if document.video.aspect_ratio is VideoAspectRatio.FULL_VERTICAL
        and document.template.id.value != "paper"
        else template_style.primary
    )
    caption_font = caption_spec["font"]
    caption_style = caption_spec["style"]
    return {
        "schemaVersion": 1,
        "canvas": {"width": 1080, "height": 1920},
        "sample": {"seconds": sample_seconds, "frame": sample_frame},
        "title": {
            "spec": document.render_spec.title.model_dump(by_alias=True),
            "sourceTitle": document.title.text,
            "textStyles": [
                style.model_dump(by_alias=True)
                for style in document.title.text_styles
            ],
            "primaryColor": title_primary,
            "accentColor": template_style.accent,
        },
        "caption": {
            **active_caption,
            "activeWordScale": 1.12,
            "layoutScale": 1,
            "offsetY": 0,
            "cssToAssScale": float(caption_font["metrics"]["cssToAssScale"]),
            "textColor": str(caption_style["textColor"]),
            "accentColor": str(caption_style["accentColor"]),
            "outlineColor": str(caption_style["outlineColor"]),
            "outlineWidth": float(caption_style["outlineWidth"]),
            "fontFamily": str(caption_font["family"]),
            "fontWeight": int(caption_font["weight"]),
            "fontId": str(caption_font["fontId"]),
            "fontFileId": str(caption_font["fileId"]),
            "safeArea": caption_spec["safeArea"],
        },
    }


def _subtitle_filter(path: Path, font_directory: Path) -> str:
    def escape(value: Path) -> str:
        return str(value).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")

    return f"subtitles=filename='{escape(path)}':fontsdir='{escape(font_directory)}'"


def render_local_reference(fixture: dict[str, Any], output_path: Path) -> None:
    """Render a local reference for developing the browser gate.

    This does not replace the Linux Batch frame used by the release workflow.
    """

    document = _document("baseline")
    source_caption_spec = _pop_caption_render_spec()
    caption_spec = retime_editor_caption_spec(document, source_caption_spec)
    if caption_spec is None:
        raise RuntimeError("The Stage B baseline timeline removed every caption event")
    if document.render_spec is None:
        raise RuntimeError("Missing v4 render specification")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="editor-v4-browser-parity-") as raw_root:
        root = Path(raw_root)
        ass_path = create_caption_ass(caption_spec, root / "caption.ass")
        font_directory = prepare_caption_fonts(root / "fonts", caption_spec)
        caption_frame = root / "caption-frame.png"
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
                "color=c=black:s=1080x1920:r=30:d=3.5",
                "-vf",
                _subtitle_filter(ass_path, font_directory),
                "-ss",
                str(fixture["sample"]["seconds"]),
                "-frames:v",
                "1",
                str(caption_frame),
            ],
            check=True,
            timeout=60,
            shell=False,
        )
        style = TEMPLATE_STYLES[document.template.id]
        title = draw_editor_title_spec_v4(
            title_spec=document.render_spec.title,
            source_title=document.title.text,
            title_text_styles=document.title.text_styles,
            primary_color=str(fixture["title"]["primaryColor"]),
            accent_color=style.accent,
        )
        with Image.open(caption_frame).convert("RGBA") as background:
            background.alpha_composite(title)
            background.convert("RGB").save(output_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--worker-frame", type=Path)
    args = parser.parse_args()
    fixture = build_fixture()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(fixture, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    if args.worker_frame is not None:
        render_local_reference(fixture, args.worker_frame)


if __name__ == "__main__":
    main()
