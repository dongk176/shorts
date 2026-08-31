"""Synthetic, network-free evidence for custom background/text rendering."""

from __future__ import annotations

import hashlib
import math
import re
from copy import deepcopy
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

from .config import Settings
from .editor_renderer import EditorDocumentRenderer
from .editor_text_layout import template_text_overlay_id, wrap_editor_render_text
from .errors import RenderError
from .media import media_duration, probe_media, run_command
from .render_spec_v4 import compile_initial_editor_render_spec_v4
from .renderer import VideoRenderer
from .schemas import CustomTemplateConfig, EditorDocument, EditorFontId, TemplateId

DESIGN_WRAP_REVISION = "editor-text-v1"
PROBE_TEMPLATE_ID = "00000000-0000-4000-8000-000000000001"
PROBE_ASSET_ID = "00000000-0000-4000-8000-000000000002"


def custom_template_design_evidence(
    *,
    source_git_sha: str,
    worker_image_digest: str,
    font_manifest_sha256: str,
    verification: dict[str, object],
) -> dict[str, object]:
    """No optimistic capability bit without a complete synthetic result."""
    fonts = verification.get("fontIds")
    frames = verification.get("frames")
    expected_frames = {
        "front-initial.png", "front-rerender.png", "behind-initial.png",
        "behind-rerender.png", "deleted.png",
    }
    error = verification.get("maximumFrameMeanError")
    if (
        not re.fullmatch(r"[0-9a-f]{40}", source_git_sha)
        or not re.fullmatch(r"sha256:[0-9a-f]{64}", worker_image_digest)
        or not re.fullmatch(r"[0-9a-f]{64}", font_manifest_sha256)
        or verification.get("caseCount") != 3
        or verification.get("textOverlayCount") != 20
        or verification.get("wrapRevision") != DESIGN_WRAP_REVISION
        or verification.get("deletedTextPreserved") is not True
        or type(error) not in {int, float}
        or not math.isfinite(error)
        or not 0 <= error <= 2
        or not isinstance(fonts, list)
        or len(fonts) != 20
        or set(fonts) != {font.value for font in EditorFontId}
        or not isinstance(frames, list)
        or len(frames) != 5
        or any(not isinstance(frame, dict) for frame in frames)
        or {frame.get("file") for frame in frames} != expected_frames
        or any(not re.fullmatch(r"[0-9a-f]{64}", str(frame.get("sha256") or ""))
               for frame in frames)
        or not re.fullmatch(r"[0-9a-f]{64}", str(verification.get("backgroundSha256") or ""))
    ):
        raise RenderError("배경·템플릿 텍스트의 검증 증거가 완전하지 않습니다.")
    return {
        "version": 1, "passed": True, "sourceGitSha": source_git_sha,
        "workerImageDigest": worker_image_digest, "fontManifestSha256": font_manifest_sha256,
        "renderSpecVersion": 4, "captionRenderSpecVersion": 4,
        "wrapRevision": DESIGN_WRAP_REVISION, "verification": verification,
    }


def design_probe_config(*, text_behind_video: bool = False) -> CustomTemplateConfig:
    overlays = [{
        "id": f"00000000-0000-4000-8000-{index + 10:012d}",
        "text": "배경\n\nAa1" if index == 0 else "한글 Aa1",
        "fontId": font.value,
        "color": "#FFFFFF",
        "effect": ("none", "outline", "shadow")[index % 3],
        "offset": {
            "x": 0 if index == 0 else -320 + (index % 3) * 320,
            "y": -135 if index == 0 else -720 + (index // 3) * 240,
        },
        "width": 300,
        "scale": 0.52,
    } for index, font in enumerate(EditorFontId)]
    text_layers = [f"text:{overlay['id']}" for overlay in overlays]
    return CustomTemplateConfig.model_validate({
        "schemaVersion": 4,
        "background": {"kind": "uploaded_image", "assetId": PROBE_ASSET_ID},
        "video": {
            "aspectRatio": "16:9", "x": 140, "y": 600,
            "width": 800, "height": 450, "fit": "cover",
        },
        "title": {
            "visible": False, "x": 540, "y": 260, "maxWidth": 900,
            "fontSize": 72, "fontId": "pretendard", "primaryColor": "#FFFFFF",
            "accentColor": "#FFD84D", "primaryBackgroundColor": None,
            "accentBackgroundColor": None,
        },
        "subtitle": {
            "visible": False, "variant": "highlight", "x": 540, "y": 1400,
            "maxWidth": 900, "fontSize": 48, "fontId": "pretendard",
            "color": "#FFFFFF", "accentColor": "#FFD84D", "backgroundColor": None,
        },
        "channel": {
            "visible": False, "x": 540, "y": 1700,
            "maxWidth": 800, "fontSize": 42, "color": "#FFFFFF", "backgroundColor": None,
        },
        "comment": {
            "visible": False, "theme": "dark", "size": "medium",
            "y": 1050, "dockedToVideo": True,
        },
        "textOverlays": overlays,
        "layerOrder": (
            [*text_layers, "video", "title", "comment", "channel"]
            if text_behind_video
            else ["video", "title", "comment", *text_layers, "channel"]
        ),
    })


def design_probe_document(
    config: CustomTemplateConfig,
    *,
    duration_seconds: float = 1,
) -> EditorDocument:
    spec = compile_initial_editor_render_spec_v4(
        title="내 배경 검증", template_id="dark-minimal", video_aspect_ratio="16:9",
        font_scale=1, custom_template_config=config,
        custom_template_id=PROBE_TEMPLATE_ID, duration_seconds=duration_seconds,
    )
    return EditorDocument.model_validate({
        "version": 3, "sourceShortId": "00000000-0000-4000-8000-000000000003",
        "baseRenderVersion": 1,
        "template": {
            "id": "dark-minimal", "customTemplateId": PROBE_TEMPLATE_ID,
            "presetVersion": 0,
            "snapshot": {
                "id": PROBE_TEMPLATE_ID, "version": 1,
                "config": config.model_dump(by_alias=True),
            },
        },
        "title": {"text": "내 배경 검증", "textStyles": [], "fontScale": 1},
        "channel": {"displayName": "검증 채널", "thumbnailUrl": None},
        "comments": [], "subtitles": {"enabled": False, "segments": []},
        "overlays": {
            "offsets": {name: {"x": 0, "y": 0} for name in (
                "video", "title", "comment", "channel",
            )},
            "commentOffsets": {}, "scales": {"video": 1, "title": 1, "channel": 1},
            "fonts": {"title": "pretendard", "channel": "pretendard"},
            "visible": {"video": True, "title": False, "comment": False, "channel": False},
            "commentTheme": None,
            "textOverlays": [{
                **overlay.model_dump(by_alias=True),
                "id": template_text_overlay_id(PROBE_TEMPLATE_ID, overlay.id),
                "startSeconds": 0, "endSeconds": duration_seconds,
            } for overlay in config.text_overlays or []],
            "layerOrder": spec["layerOrder"], "background": None,
        },
        "video": {
            "clips": [{"id": "clip-1", "sourceStartSeconds": 0,
                       "sourceEndSeconds": duration_seconds}],
            "aspectRatio": "16:9", "timelineStartSeconds": 0,
            "timelineEndSeconds": duration_seconds, "selectionStartSeconds": 0,
            "selectionEndSeconds": duration_seconds,
        },
        "renderSpec": spec,
    })


def _run_checked(command: list[str], *, root: Path, timeout: float) -> None:
    result = run_command(command, cwd=root, timeout=timeout)
    if result.returncode != 0:
        raise RenderError("사용자 배경·텍스트 합성 검증에 실패했습니다.")


def _capture_frame(video: Path, output: Path, *, root: Path) -> Image.Image:
    _run_checked([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", "0.4",
        "-i", str(video), "-frames:v", "1", str(output),
    ], root=root, timeout=30)
    with Image.open(output) as image:
        return image.convert("RGB")


def verify_custom_template_design(*, root: Path, settings: Settings) -> dict[str, object]:
    """Raise on any failure; callers may attest capability only after return."""
    root.mkdir(parents=True, exist_ok=True)
    frames_dir = root / "frames"
    frames_dir.mkdir(exist_ok=True)
    background = root / "background.webp"
    image = Image.new("RGB", (1080, 1920), (12, 25, 44))
    image.paste((38, 24, 45), (0, 960, 1080, 1920))
    image.save(background, "WEBP", quality=90)
    clean = root / "clean.mp4"
    _run_checked([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
        "color=c=0x22A020:size=640x360:rate=30", "-t", "1", "-c:v", "libx264",
        "-threads", str(settings.ffmpeg_threads), "-pix_fmt", "yuv420p", str(clean),
    ], root=root, timeout=30)
    renderer = VideoRenderer(settings)
    editor = EditorDocumentRenderer(settings)
    errors: list[float] = []
    frames: dict[str, Image.Image] = {}
    for behind in (False, True):
        name = "behind" if behind else "front"
        config = design_probe_config(text_behind_video=behind)
        document = design_probe_document(config)
        assert document.render_spec is not None
        for raw, rendered in zip(
            config.text_overlays or [], document.render_spec.text_overlays, strict=True,
        ):
            if rendered.lines != wrap_editor_render_text(raw.text, raw.width):
                raise RenderError("템플릿 텍스트의 줄바꿈 검증에 실패했습니다.")
        initial_path = renderer.render_clean_clip(
            clean_path=clean, output_path=root / f"{name}-initial.mp4",
            title=document.title.text, channel_name=document.channel.display_name,
            template_id=TemplateId.DARK_MINIMAL, transcript=[], subtitles_enabled=False,
            work_dir=root / f"{name}-initial", prefix="design",
            custom_template_config=config, initial_render_spec=document.render_spec.model_dump(
                by_alias=True,
            ), uploaded_background_path=background,
        )
        rerender_path = editor.render(
            clean_path=clean, output_path=root / f"{name}-rerender.mp4", document=document,
            work_dir=root / f"{name}-rerender", channel_thumbnail_path=None,
            uploaded_background_path=background,
        )
        initial_frame = _capture_frame(
            initial_path, frames_dir / f"{name}-initial.png", root=root,
        )
        rerender_frame = _capture_frame(
            rerender_path, frames_dir / f"{name}-rerender.png", root=root,
        )
        error = max(ImageStat.Stat(ImageChops.difference(initial_frame, rerender_frame)).mean)
        if error > 2:
            raise RenderError("템플릿 최초 렌더와 무수정 편집 결과가 다릅니다.")
        errors.append(error)
        frames[name] = initial_frame
        for video in (initial_path, rerender_path):
            probe = probe_media(video, timeout=30)
            stream = next(item for item in probe["streams"] if item["codec_type"] == "video")
            if (
                (int(stream["width"]), int(stream["height"])) != (1080, 1920)
                or abs(media_duration(probe) - 1) > 0.05
            ):
                raise RenderError("템플릿 디자인 출력 규격을 검증하지 못했습니다.")
    area = (300, 730, 780, 920)
    if ImageStat.Stat(ImageChops.difference(
        frames["front"].crop(area), frames["behind"].crop(area),
    )).mean[0] < 1:
        raise RenderError("템플릿 텍스트 앞뒤 순서가 적용되지 않았습니다.")
    # A persisted empty document wins over a template snapshot containing text.
    deleted_value = deepcopy(design_probe_document(design_probe_config()).model_dump(by_alias=True))
    deleted_value["overlays"]["textOverlays"] = []
    deleted_value["renderSpec"]["textOverlays"] = []
    for container in (deleted_value["overlays"], deleted_value["renderSpec"]):
        container["layerOrder"] = ["video", "title", "comment", "channel"]
    deleted = EditorDocument.model_validate(deleted_value)
    deleted_path = editor.render(
        clean_path=clean, output_path=root / "deleted.mp4", document=deleted,
        work_dir=root / "deleted", channel_thumbnail_path=None,
        uploaded_background_path=background,
    )
    deleted_frame = _capture_frame(deleted_path, frames_dir / "deleted.png", root=root)
    if max(ImageStat.Stat(deleted_frame.crop((0, 0, 1080, 580))).stddev) > 1:
        raise RenderError("삭제한 템플릿 텍스트가 다시 나타났습니다.")
    return {
        "caseCount": 3, "fontIds": [font.value for font in EditorFontId],
        "textOverlayCount": len(EditorFontId), "wrapRevision": DESIGN_WRAP_REVISION,
        "maximumFrameMeanError": round(max(errors), 6), "deletedTextPreserved": True,
        "backgroundSha256": hashlib.sha256(background.read_bytes()).hexdigest(),
        "frames": [{"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                   for path in sorted(frames_dir.glob("*.png"))],
    }
