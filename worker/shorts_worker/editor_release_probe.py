from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import tempfile
from math import floor
from pathlib import Path
from typing import Any

import boto3
from PIL import Image, ImageChops

from .browser_parity_probe import build_browser_parity_matrix
from .caption_templates import (
    caption_font_spec,
    compile_caption_render_spec,
    create_caption_ass,
    prepare_caption_fonts,
    verify_caption_font_selection_v4,
)
from .config import Settings
from .editor_renderer import (
    EditorDocumentRenderer,
    create_editor_title_layer,
    editor_video_frame,
    retime_editor_caption_spec,
    verify_editor_fonts,
)
from .font_manifest import canonical_editor_font_manifest
from .overlays import TEMPLATE_STYLES
from .release_identity import verify_initial_render_v4_runtime
from .render_spec_v4 import (
    compile_editor_title_spec_v4,
    draw_editor_title_spec_v4,
    editor_font_face_v4,
)
from .schemas import EditorDocument, EditorFontId, TitleTextStyle, VideoAspectRatio
from .subtitles import TranscriptWord

FONT_IDS = (
    "pretendard",
    "noto-sans-kr",
    "do-hyeon",
    "jua",
    "jalnan-2",
    "cafe24-anemone",
    "cafe24-pro-up",
    "sandbox-aggro",
    "galmuri-9",
    "black-han-sans",
    "godo",
    "gmarket-sans",
    "nanum-square-neo",
    "s-core-dream",
    "suit",
    "spoqa-han-sans-neo",
    "noto-serif-kr",
    "nanum-myeongjo",
    "ridi-batang",
    "paperlogy",
)

PROBE_SCENARIOS = (
    "baseline",
    "ripple-cut",
    "comment-gaps",
    "text-effects",
    "background-template",
    "channel-layer-order",
)


def _put_versioned_evidence(
    client: Any,
    *,
    bucket: str,
    key: str,
    payload: bytes,
    content_type: str,
) -> dict[str, str]:
    digest = hashlib.sha256(payload).hexdigest()
    checksum = base64.b64encode(bytes.fromhex(digest)).decode("ascii")
    response = client.put_object(
        Bucket=bucket,
        Key=key,
        Body=payload,
        ContentType=content_type,
        ChecksumSHA256=checksum,
    )
    version_id = str(response.get("VersionId") or "")
    if not version_id or len(version_id) > 1024:
        raise RuntimeError("Editor release evidence bucket must have versioning enabled")
    return {
        "versionId": version_id,
        "sha256": digest,
        "checksumSHA256": checksum,
        "etag": str(response.get("ETag") or "").strip('"'),
    }


def _font_face(font_id: str, *, text: bool) -> dict[str, object]:
    return editor_font_face_v4(
        EditorFontId(font_id),
        requested_weight=800 if text else 700,
    )


def _render_spec(value: dict[str, Any]) -> dict[str, object]:
    overlays = value["overlays"]
    title = value["title"]
    comments = value["comments"]
    text_overlays = overlays["textOverlays"]
    title_spec = compile_editor_title_spec_v4(
        title=str(title["text"]),
        template_id=str(value["template"]["id"]),
        video_aspect_ratio=str(value["video"]["aspectRatio"]),
        font_id=str(overlays["fonts"]["title"]),
        font_scale=float(title["fontScale"]),
        title_text_styles=[
            TitleTextStyle.model_validate(style)
            for style in title.get("textStyles") or []
        ],
        visible=bool(overlays["visible"]["title"]),
        offset_x=float(overlays["offsets"]["title"]["x"]),
        offset_y=float(overlays["offsets"]["title"]["y"]),
    )
    return {
        "version": 4,
        "canvas": {"width": 1080, "height": 1920},
        "fps": 30,
        "layerOrder": list(overlays["layerOrder"]),
        "title": title_spec,
        "channel": {
            "offsetX": overlays["offsets"]["channel"]["x"],
            "offsetY": overlays["offsets"]["channel"]["y"],
            "scale": overlays["scales"]["channel"],
            "visible": bool(overlays["visible"]["channel"]),
            "font": _font_face(overlays["fonts"]["channel"], text=False),
        },
        "comments": [
            {
                "id": comment["id"],
                "offsetY": overlays["commentOffsets"].get(
                    comment["id"], overlays["offsets"]["comment"]
                )["y"],
                "startFrame": floor(float(comment["startSeconds"]) * 30 + 0.5),
                "endFrame": floor(float(comment["endSeconds"]) * 30 + 0.5),
            }
            for comment in comments
        ],
        "textOverlays": [
            {
                "id": overlay["id"],
                "lines": str(overlay["text"]).splitlines() or [" "],
                "centerX": 540 + overlay["offset"]["x"],
                "centerY": 960 + overlay["offset"]["y"],
                "width": overlay["width"],
                "fontSize": 72,
                "lineHeight": 86,
                "scale": overlay["scale"],
                "color": overlay["color"],
                "effect": overlay["effect"],
                "outlineWidth": 10 if overlay["effect"] == "outline" else 0,
                "shadowBlur": 13 if overlay["effect"] == "shadow" else 0,
                "startFrame": floor(float(overlay["startSeconds"]) * 30 + 0.5),
                "endFrame": floor(float(overlay["endSeconds"]) * 30 + 0.5),
                "font": _font_face(overlay["fontId"], text=True),
            }
            for overlay in text_overlays
        ],
        "video": {
            "offsetX": overlays["offsets"]["video"]["x"],
            "offsetY": overlays["offsets"]["video"]["y"],
            "scale": overlays["scales"]["video"],
        },
        "subtitles": {
            "centerX": 540,
            "visible": True,
            "captionSpecVersion": 4,
            "offsetY": 0,
            "scale": 1,
            "fontId": "paperlogy",
            "fontSize": 92,
            "color": "#FFFFFF",
            "accentColor": "#35E6E3",
            "cueEdits": [],
        },
    }


def _run(command: list[str], *, timeout: float = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
        shell=False,
    )


def _document(scenario: str = "baseline") -> EditorDocument:
    text_overlays = [
        {
            "id": f"font-{index}",
            "text": f"한글 폰트 {index + 1}",
            "fontId": font_id,
            "color": "#FFFFFF" if index % 2 == 0 else "#FFD84D",
            "effect": ("none", "outline", "shadow")[index % 3],
            # Keep every approved font visible in the synthetic evidence.
            # Nineteen overlays fit in a three-column, seven-row grid without
            # crossing the 1080x1920 canvas bounds.
            "offset": {
                "x": -320 + (index % 3) * 320,
                "y": -720 + (index // 3) * 240,
            },
            "width": 300,
            "scale": 0.52,
            "startSeconds": 0,
            "endSeconds": 3.5,
        }
        for index, font_id in enumerate(FONT_IDS)
    ]
    layer_order = [
        "video",
        "comment",
        *[f"text:font-{index}" for index in range(len(FONT_IDS))],
        "title",
        "channel",
    ]
    value: dict[str, Any] = {
        "version": 3,
        "sourceShortId": "00000000-0000-4000-8000-000000000001",
        "baseRenderVersion": 1,
        "template": {
            "id": "dark-minimal",
            "customTemplateId": None,
            "presetVersion": 3,
            "snapshot": {"presetVersion": 3},
        },
        "title": {
            "text": "격리 렌더 검증",
            "textStyles": [{"start": 3, "end": 5, "color": "#FFD84D"}],
            "fontScale": 1.1,
        },
        "channel": {
            "displayName": "내부 카나리",
            "thumbnailUrl": None,
            "thumbnailAssetKey": (
                "edit-sources/00000000-0000-4000-8000-000000000001/"
                "editor-assets/channel.png"
            ),
        },
        "comments": [
            {
                "id": "comment-first",
                "startSeconds": 0,
                "endSeconds": 1.25,
                "text": "첫 댓글",
                "initial": "첫",
                "avatarColor": "#2674C8",
                "nickname": "검증자",
                "likeCount": 12,
                "ageLabel": "방금 전",
            },
            {
                "id": "comment-last",
                "startSeconds": 2.25,
                "endSeconds": 3.5,
                "text": "빈 구간 뒤 댓글",
                "initial": "뒤",
                "avatarColor": "#D3446F",
                "nickname": "검증자",
                "likeCount": 34,
                "ageLabel": "방금 전",
            },
        ],
        "subtitles": {
            "enabled": True,
            "segments": [
                {"start": 1, "end": 2.5, "text": "첫 번째 조각"},
                {"start": 4, "end": 6, "text": "두 번째 조각"},
            ],
        },
        "overlays": {
            "offsets": {
                "video": {"x": 0, "y": -20},
                "title": {"x": 0, "y": 16},
                "comment": {"x": 0, "y": 10},
                "channel": {"x": 0, "y": -12},
            },
            "commentOffsets": {
                "comment-first": {"x": 0, "y": -8},
                "comment-last": {"x": 0, "y": 14},
            },
            "scales": {"video": 1.2, "title": 1.05, "channel": 1.1},
            "fonts": {"title": "gmarket-sans", "channel": "suit"},
            "visible": {
                "video": True,
                "title": True,
                "comment": True,
                "channel": True,
            },
            "commentTheme": "dark",
            "textOverlays": text_overlays,
            "layerOrder": layer_order,
            "background": {"kind": "color", "color": "#111111"},
        },
        "video": {
            "clips": [
                {
                    "id": "clip-first",
                    "sourceStartSeconds": 1,
                    "sourceEndSeconds": 2.5,
                },
                {
                    "id": "clip-last",
                    "sourceStartSeconds": 4,
                    "sourceEndSeconds": 6,
                },
            ],
            "aspectRatio": "16:9",
            "timelineStartSeconds": 10,
            "timelineEndSeconds": 20,
            "selectionStartSeconds": 11,
            "selectionEndSeconds": 16,
        },
    }
    if scenario == "baseline":
        pass
    elif scenario == "ripple-cut":
        value["title"] = {
            "text": "세 조각 리플 편집",
            "textStyles": [{"start": 3, "end": 5, "color": "#FF715E"}],
            "fontScale": 1.05,
        }
        value["comments"] = [
            {
                "id": "ripple-first",
                "startSeconds": 0,
                "endSeconds": 0.9,
                "text": "첫 조각 댓글",
                "initial": "첫",
                "avatarColor": "#2674C8",
                "nickname": "리플검증",
                "likeCount": 101,
                "ageLabel": "방금 전",
            },
            {
                "id": "ripple-last",
                "startSeconds": 2.4,
                "endSeconds": 3.5,
                "text": "삭제 구간 뒤 댓글",
                "initial": "뒤",
                "avatarColor": "#D3446F",
                "nickname": "리플검증",
                "likeCount": 202,
                "ageLabel": "방금 전",
            },
        ]
        value["subtitles"]["segments"] = [
            {"start": 0.5, "end": 1.375, "text": "첫 원본 구간"},
            {"start": 2, "end": 3, "text": "가운데 원본 구간"},
            {"start": 6, "end": 7.625, "text": "마지막 원본 구간"},
        ]
        value["overlays"]["commentOffsets"] = {
            "ripple-first": {"x": 0, "y": -20},
            "ripple-last": {"x": 0, "y": 24},
        }
        value["overlays"]["textOverlays"] = []
        value["overlays"]["layerOrder"] = [
            "video",
            "comment",
            "title",
            "channel",
        ]
        value["video"]["clips"] = [
            {
                "id": "ripple-1",
                "sourceStartSeconds": 0.5,
                "sourceEndSeconds": 1.375,
            },
            {
                "id": "ripple-2",
                "sourceStartSeconds": 2,
                "sourceEndSeconds": 3,
            },
            {
                "id": "ripple-3",
                "sourceStartSeconds": 6,
                "sourceEndSeconds": 7.625,
            },
        ]
        value["video"]["selectionStartSeconds"] = 10.5
        value["video"]["selectionEndSeconds"] = 17.625
    elif scenario == "comment-gaps":
        value["template"]["id"] = "comment-capture"
        value["title"] = {
            "text": "댓글 빈 구간 검증",
            "textStyles": [],
            "fontScale": 1,
        }
        value["comments"] = [
            {
                "id": "gap-1",
                "startSeconds": 0,
                "endSeconds": 0.75,
                "text": "처음에만 보이는 댓글",
                "initial": "처",
                "avatarColor": "#16A34A",
                "nickname": "댓글검증",
                "likeCount": 110,
                "ageLabel": "1분 전",
            },
            {
                "id": "gap-2",
                "startSeconds": 1.5,
                "endSeconds": 2.2,
                "text": "빈 구간 뒤 두 번째 댓글",
                "initial": "두",
                "avatarColor": "#3B82F6",
                "nickname": "댓글검증",
                "likeCount": 220,
                "ageLabel": "2분 전",
            },
            {
                "id": "gap-3",
                "startSeconds": 3,
                "endSeconds": 3.5,
                "text": "끝 구간 댓글",
                "initial": "끝",
                "avatarColor": "#DB2777",
                "nickname": "댓글검증",
                "likeCount": 330,
                "ageLabel": "3분 전",
            },
        ]
        value["overlays"]["commentOffsets"] = {
            "gap-1": {"x": 0, "y": -36},
            "gap-2": {"x": 0, "y": 0},
            "gap-3": {"x": 0, "y": 38},
        }
        value["overlays"]["commentTheme"] = "light"
        value["overlays"]["textOverlays"] = []
        value["overlays"]["layerOrder"] = [
            "video",
            "comment",
            "title",
            "channel",
        ]
        value["overlays"]["background"] = {
            "kind": "image",
            "assetId": "white-grid",
        }
    elif scenario == "text-effects":
        value["title"] = {
            "text": "텍스트 시간과 효과",
            "textStyles": [],
            "fontScale": 1,
        }
        value["comments"] = []
        value["overlays"]["commentOffsets"] = {}
        value["overlays"]["visible"]["comment"] = False
        value["overlays"]["textOverlays"] = [
            {
                "id": "outline-red",
                "text": "굵은 테두리",
                "fontId": "black-han-sans",
                "color": "#FF4D4F",
                "effect": "outline",
                "offset": {"x": -210, "y": -260},
                "width": 300,
                "scale": 1.15,
                "startSeconds": 0.5,
                "endSeconds": 1.25,
            },
            {
                "id": "shadow-yellow",
                "text": "그림자와 줄바꿈을 확인하는 긴 문구",
                "fontId": "do-hyeon",
                "color": "#FFD84D",
                "effect": "shadow",
                "offset": {"x": 180, "y": 0},
                "width": 260,
                "scale": 0.9,
                "startSeconds": 1.25,
                "endSeconds": 2.5,
            },
            {
                "id": "plain-blue",
                "text": "효과 없음",
                "fontId": "noto-serif-kr",
                "color": "#3B82F6",
                "effect": "none",
                "offset": {"x": 0, "y": 300},
                "width": 520,
                "scale": 1.3,
                "startSeconds": 2.5,
                "endSeconds": 3.5,
            },
        ]
        value["overlays"]["layerOrder"] = [
            "video",
            "text:outline-red",
            "text:shadow-yellow",
            "text:plain-blue",
            "title",
            "comment",
            "channel",
        ]
        value["overlays"]["background"] = {"kind": "color", "color": "#040404"}
    elif scenario == "background-template":
        value["template"]["id"] = "paper"
        value["title"] = {
            "text": "한지 배경\n정사각 영상",
            "textStyles": [
                {"start": 6, "end": 12, "color": "#E32626", "backgroundColor": "#FFD84D"}
            ],
            "fontScale": 0.95,
        }
        value["video"]["aspectRatio"] = "1:1"
        value["overlays"]["background"] = {
            "kind": "image",
            "assetId": "white-hanji",
        }
        value["overlays"]["commentTheme"] = "light"
        value["overlays"]["fonts"] = {
            "title": "nanum-myeongjo",
            "channel": "spoqa-han-sans-neo",
        }
        value["overlays"]["textOverlays"] = []
        value["overlays"]["layerOrder"] = [
            "video",
            "comment",
            "title",
            "channel",
        ]
    elif scenario == "channel-layer-order":
        value["title"] = {
            "text": "레이어 순서 검증",
            "textStyles": [
                {"start": 0, "end": 3, "color": "#35E6E3"},
                {"start": 4, "end": 6, "color": "#FF715E"},
            ],
            "fontScale": 1.2,
        }
        value["channel"]["displayName"] = "교체한 채널 프로필"
        value["overlays"]["offsets"]["channel"] = {"x": 150, "y": -120}
        value["overlays"]["scales"]["channel"] = 1.45
        value["overlays"]["fonts"] = {
            "title": "gmarket-sans",
            "channel": "black-han-sans",
        }
        value["overlays"]["textOverlays"] = [
            {
                "id": "top-layer",
                "text": "가장 위 텍스트",
                "fontId": "suit",
                "color": "#FFFFFF",
                "effect": "outline",
                "offset": {"x": 130, "y": 650},
                "width": 460,
                "scale": 1.1,
                "startSeconds": 0,
                "endSeconds": 3.5,
            }
        ]
        value["overlays"]["layerOrder"] = [
            "video",
            "title",
            "comment",
            "channel",
            "text:top-layer",
        ]
        value["overlays"]["background"] = {
            "kind": "image",
            "assetId": "news-red-globe",
        }
    else:
        raise RuntimeError(f"Unsupported editor release scenario: {scenario}")
    value["renderSpec"] = _render_spec(value)
    return EditorDocument.model_validate(value)


def _pop_caption_render_spec() -> dict[str, object]:
    """Build immutable source-timeline pop captions spanning every probe cut."""
    words = [
        TranscriptWord(text="Paperlogy", start=0.55, end=0.95, provider="probe"),
        TranscriptWord(
            text="자막", start=1.05, end=1.45, provider="probe", space_before=True
        ),
        TranscriptWord(
            text="위치", start=2.05, end=2.55, provider="probe", space_before=True
        ),
        TranscriptWord(
            text="크기", start=4.10, end=4.45, provider="probe", space_before=True
        ),
        TranscriptWord(
            text="간격", start=4.50, end=4.85, provider="probe", space_before=True
        ),
        TranscriptWord(
            text="JOIN", start=4.90, end=5.25, provider="probe", space_before=False
        ),
        TranscriptWord(
            text="렌더", start=6.05, end=6.55, provider="probe", space_before=True
        ),
        TranscriptWord(
            text="검증", start=7.00, end=7.45, provider="probe", space_before=True
        ),
    ]
    return compile_caption_render_spec(
        words,
        template_id="pop",
        clip_start=0,
        clip_end=10,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        caption_placement="center",
        font_id=EditorFontId.PAPERLOGY,
        schema_version=4,
    )


def _green_video_bounds(frame_path: Path) -> tuple[int, int, int, int]:
    with Image.open(frame_path).convert("RGB") as image:
        pixels = image.load()
        left, top = image.width, image.height
        right = bottom = -1
        for y in range(image.height):
            for x in range(image.width):
                red, green, blue = pixels[x, y]
                if green >= 150 and red <= 90 and blue <= 90:
                    left = min(left, x)
                    top = min(top, y)
                    right = max(right, x)
                    bottom = max(bottom, y)
    if right < 0 or bottom < 0:
        raise RuntimeError("Rendered probe frame does not contain the video layer")
    return left, top, right + 1, bottom + 1


def _caption_accent_pixel_count(
    frame_path: Path,
    safe_area: dict[str, object],
) -> int:
    left = max(0, floor(float(safe_area["x"]) - 40))
    top = max(0, floor(float(safe_area["y"]) - 40))
    right = min(1080, floor(float(safe_area["x"]) + float(safe_area["width"]) + 40))
    bottom = min(1920, floor(float(safe_area["y"]) + float(safe_area["height"]) + 40))
    count = 0
    with Image.open(frame_path).convert("RGB") as image:
        pixels = image.load()
        for y in range(top, bottom):
            for x in range(left, right):
                red, green, blue = pixels[x, y]
                if red <= 150 and green >= 150 and blue >= 150 and abs(green - blue) <= 80:
                    count += 1
    return count


def _caption_event_active_at(
    caption_render_spec: dict[str, object],
    frame: int,
) -> bool:
    for cue in caption_render_spec.get("cues") or []:
        if not isinstance(cue, dict):
            continue
        for event in cue.get("events") or []:
            if (
                isinstance(event, dict)
                and int(event.get("startFrame") or 0) <= frame
                and int(event.get("endFrame") or 0) > frame
            ):
                return True
    return False


def _verify_v4_initial_editor_parity(
    document: EditorDocument,
    *,
    root: Path,
) -> None:
    if document.render_spec is None or document.render_spec.version != 4:
        raise RuntimeError("Probe document does not contain renderSpec v4")
    style = TEMPLATE_STYLES[document.template.id]
    initial = draw_editor_title_spec_v4(
        title_spec=document.render_spec.title,
        source_title=document.title.text,
        title_text_styles=document.title.text_styles,
        primary_color=(
            style.accent
            if document.video.aspect_ratio is VideoAspectRatio.FULL_VERTICAL
            and document.template.id.value != "paper"
            else style.primary
        ),
        accent_color=style.accent,
    )
    rerender_path = create_editor_title_layer(
        document,
        root / "rerender-title.png",
    )
    with Image.open(rerender_path).convert("RGBA") as rerender:
        if ImageChops.difference(initial, rerender).getbbox() is not None:
            raise RuntimeError("Initial and editor v4 title pixels are not identical")


def _verify_v4_noop_caption_parity(*, root: Path) -> None:
    value = _document("baseline").model_dump(mode="json", by_alias=True)
    value["video"]["clips"] = [{
        "id": "parity-full",
        "sourceStartSeconds": 0,
        "sourceEndSeconds": 3.5,
    }]
    value["video"]["timelineStartSeconds"] = 0
    value["video"]["timelineEndSeconds"] = 3.5
    value["video"]["selectionStartSeconds"] = 0
    value["video"]["selectionEndSeconds"] = 3.5
    value["subtitles"]["segments"] = [
        {"start": 0.5, "end": 1.5, "text": "Paperlogy 자막"},
    ]
    document = EditorDocument.model_validate(value)
    source = compile_caption_render_spec(
        [
            TranscriptWord(text="Paperlogy", start=0.5, end=1.0, provider="probe"),
            TranscriptWord(
                text="자막",
                start=1.0,
                end=1.5,
                provider="probe",
                space_before=True,
            ),
        ],
        template_id="pop",
        clip_start=0,
        clip_end=3.5,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        caption_placement="center",
        font_id=EditorFontId.PAPERLOGY,
        schema_version=4,
    )
    retimed = retime_editor_caption_spec(document, source)
    if retimed != source:
        raise RuntimeError("No-op v4 caption retiming changed authoritative positions")
    initial_ass = create_caption_ass(source, root / "initial-caption.ass")
    rerender_ass = create_caption_ass(retimed, root / "rerender-caption.ass")
    if initial_ass.read_bytes() != rerender_ass.read_bytes():
        raise RuntimeError("No-op v4 caption ASS is not byte-identical")


def _verify_all_v4_caption_font_selections(*, root: Path) -> tuple[str, ...]:
    """Require libass to select each bundled editor face without fallback."""
    expected_font_ids = {font_id.value for font_id in EditorFontId}
    if len(FONT_IDS) != len(expected_font_ids) or set(FONT_IDS) != expected_font_ids:
        raise RuntimeError("Editor font fallback probe does not cover every font")

    font_directory = root / "caption-fonts"
    verified: list[str] = []
    for font_value in FONT_IDS:
        font_id = EditorFontId(font_value)
        spec: dict[str, object] = {
            "schemaVersion": 4,
            "font": caption_font_spec(font_id, schema_version=4),
        }
        prepare_caption_fonts(font_directory, spec)
        verify_caption_font_selection_v4(
            font_directory=font_directory,
            spec=spec,
            timeout=30,
        )
        verified.append(font_value)

    if tuple(verified) != FONT_IDS:
        raise RuntimeError("Editor font fallback probe did not verify every font")
    return tuple(verified)


def run_editor_release_probe() -> dict[str, Any]:
    git_sha = os.environ.get("EDITOR_RELEASE_GIT_SHA", "").strip().lower()
    image_digest = os.environ.get("WORKER_IMAGE_DIGEST", "").strip().lower()
    if len(git_sha) != 40 or any(character not in "0123456789abcdef" for character in git_sha):
        raise RuntimeError("EDITOR_RELEASE_GIT_SHA must be a 40-character commit SHA")
    if (
        not image_digest.startswith("sha256:")
        or len(image_digest) != 71
        or any(character not in "0123456789abcdef" for character in image_digest[7:])
    ):
        raise RuntimeError("WORKER_IMAGE_DIGEST must contain the immutable image digest")
    runtime_identity = verify_initial_render_v4_runtime({
        "initial_render_spec_version": 4,
        "initial_caption_render_spec_version": 4,
    })
    if (
        runtime_identity is None
        or runtime_identity.get("sourceGitSha") != git_sha
        or runtime_identity.get("imageDigest") != image_digest
        or runtime_identity.get("renderSpecVersion") != "4"
        or runtime_identity.get("captionRenderSpecVersion") != "4"
    ):
        raise RuntimeError("Worker v4 runtime identity evidence is incomplete")
    if os.environ.get("EDITOR_RELEASE_SUITE_VERIFIED", "").strip().lower() != "true":
        raise RuntimeError(
            "EDITOR_RELEASE_SUITE_VERIFIED must confirm the legacy and timeline test suite"
        )
    expected_font_manifest_sha = os.environ.get(
        "EDITOR_FONT_MANIFEST_SHA256",
        "",
    ).strip().lower()
    font_manifest = canonical_editor_font_manifest()
    if (
        len(expected_font_manifest_sha) != 64
        or any(
            character not in "0123456789abcdef"
            for character in expected_font_manifest_sha
        )
        or expected_font_manifest_sha != font_manifest["sha256"]
    ):
        raise RuntimeError(
            "EDITOR_FONT_MANIFEST_SHA256 does not match this worker image"
        )
    if runtime_identity.get("fontManifestSha256") != expected_font_manifest_sha:
        raise RuntimeError("Worker v4 runtime font identity evidence is incomplete")
    manifest_font_ids = {
        str(entry.get("fontId"))
        for entry in font_manifest["entries"]
        if isinstance(entry, dict)
    }
    if (
        font_manifest.get("fallbackDetected") is not False
        or len(font_manifest["entries"]) != len(FONT_IDS)
        or manifest_font_ids != set(FONT_IDS)
    ):
        raise RuntimeError("Worker v4 font manifest is incomplete")

    scenario = os.environ.get("EDITOR_RELEASE_SCENARIO", "baseline").strip().lower()
    if scenario not in PROBE_SCENARIOS:
        raise RuntimeError(f"Unsupported EDITOR_RELEASE_SCENARIO: {scenario}")

    settings = Settings(
        database_url=None,
        openai_api_key=None,
        gemini_api_key=None,
        ffmpeg_timeout_seconds=180,
        ffmpeg_threads=max(1, int(os.environ.get("FFMPEG_THREADS", "2"))),
        clean_clip_preset="ultrafast",
        clean_clip_crf=28,
    )
    verify_editor_fonts()
    document = _document(scenario)
    caption_render_spec = _pop_caption_render_spec()
    if (
        document.render_spec is None
        or document.render_spec.version != 4
        or caption_render_spec.get("schemaVersion") != 4
    ):
        raise RuntimeError("Probe did not compile v4 render specifications")
    rendered_caption_spec = retime_editor_caption_spec(
        document,
        caption_render_spec,
    )
    if rendered_caption_spec is None:
        raise RuntimeError("Pop caption probe has no events after timeline retiming")
    with tempfile.TemporaryDirectory(
        prefix="editor-release-probe-",
        dir=settings.temp_dir if settings.temp_dir.is_dir() else None,
    ) as temporary:
        root = Path(temporary)
        _verify_v4_initial_editor_parity(document, root=root)
        _verify_v4_noop_caption_parity(root=root)
        verified_font_ids = _verify_all_v4_caption_font_selections(root=root)
        if verified_font_ids != FONT_IDS:
            raise RuntimeError("Worker v4 font selection evidence is incomplete")
        timeline = root / "timeline.mp4"
        _run([
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x00ff00:size=640x360:rate=8",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=16000",
            "-t",
            "10",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(timeline),
        ])
        renderer = EditorDocumentRenderer(settings)
        clean = renderer.extract_sequence(
            timeline_path=timeline,
            output_path=root / "clean.mp4",
            document=document,
            work_dir=root / "cut-work",
        )
        thumbnail = root / "channel.png"
        Image.new("RGB", (96, 96), "#2563EB").save(thumbnail)
        output = renderer.render(
            clean_path=clean,
            output_path=root / "output.mp4",
            document=document,
            work_dir=root / "render-work",
            channel_thumbnail_path=thumbnail,
            caption_render_spec=caption_render_spec,
        )
        subtitle_ass = (
            root / "render-work" / "editor-assets" / "subtitles.ass"
        ).read_text(encoding="utf-8")
        caption_font = caption_render_spec.get("font")
        if not isinstance(caption_font, dict):
            raise RuntimeError("Probe v4 caption font identity is missing")
        expected_ass_family = str(caption_font.get("family") or "").strip('"')
        if (
            not expected_ass_family
            or f"\\fn{expected_ass_family}" not in subtitle_ass
            or r"\pos(" not in subtitle_ass
            or r"\fscx112\fscy112" not in subtitle_ass
            or r"\t(" in subtitle_ass
            or "Noto Sans CJK KR" in subtitle_ass
        ):
            raise RuntimeError("Probe did not render the trusted pop caption template")
        if not (
            root / "render-work" / "caption-fonts" / "Paperlogy-7Bold.ttf"
        ).is_file():
            raise RuntimeError("Probe did not materialize the approved caption font")
        probe = json.loads(_run([
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(output),
        ]).stdout)
        video = next(
            stream for stream in probe["streams"] if stream["codec_type"] == "video"
        )
        audio = next(
            stream for stream in probe["streams"] if stream["codec_type"] == "audio"
        )
        duration = float(probe["format"]["duration"])
        fps_parts = str(video["avg_frame_rate"]).split("/", maxsplit=1)
        fps = float(fps_parts[0]) / max(1.0, float(fps_parts[1]))
        if (int(video["width"]), int(video["height"])) != (1080, 1920):
            raise RuntimeError("Probe output is not 1080x1920")
        if video["codec_name"] != "h264" or audio["codec_name"] != "aac":
            raise RuntimeError("Probe output codecs do not match H.264/AAC")
        if abs(duration - document.video.output_duration_seconds) > (1 / fps + 0.01):
            raise RuntimeError("Probe duration exceeds one frame of tolerance")

        frame_path = root / "frame.png"
        geometry_sample_seconds = 1.0 if scenario == "comment-gaps" else 2.0
        caption_sample_frame = floor(geometry_sample_seconds * 30 + 0.5)
        if not _caption_event_active_at(rendered_caption_spec, caption_sample_frame):
            raise RuntimeError("Pop caption probe sample does not contain an active event")
        _run([
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{geometry_sample_seconds:.3f}",
            "-i",
            str(output),
            "-frames:v",
            "1",
            str(frame_path),
        ])
        expected_frame = editor_video_frame(document, caption_render_spec)
        observed = _green_video_bounds(frame_path)
        expected = (
            max(0, expected_frame.x),
            max(0, expected_frame.y),
            min(1080, expected_frame.x + expected_frame.width),
            min(1920, expected_frame.y + expected_frame.height),
        )
        geometry_error = max(
            abs(actual - target)
            for actual, target in zip(observed, expected, strict=True)
        )
        if geometry_error > 2:
            raise RuntimeError(
                f"Probe geometry drifted by {geometry_error}px (allowed: 2px)"
            )
        safe_area = rendered_caption_spec.get("safeArea")
        if not isinstance(safe_area, dict):
            raise RuntimeError("Pop caption probe safe area is missing")
        accent_pixels = _caption_accent_pixel_count(frame_path, safe_area)
        if accent_pixels < 25:
            raise RuntimeError("Rendered probe frame does not contain the pop caption accent")
        browser_parity_root: Path | None = None
        browser_parity_matrix: dict[str, Any] | None = None
        if scenario == "baseline":
            browser_parity_root = root / "browser-parity"
            browser_parity_matrix = build_browser_parity_matrix(
                browser_parity_root,
                runtime_identity=runtime_identity,
            )
            if (
                browser_parity_matrix.get("caseCount") != len(
                    browser_parity_matrix.get("cases") or []
                )
                or set(browser_parity_matrix.get("fontIds") or []) != set(FONT_IDS)
            ):
                raise RuntimeError("Browser parity worker matrix is incomplete")
        manifest = {
            "schemaVersion": 2,
            "scenario": scenario,
            "gitSha": git_sha,
            "workerImageDigest": image_digest,
            "documentVersion": document.version,
            "renderSpecVersion": document.render_spec.version,
            "captionRenderSpecVersion": caption_render_spec["schemaVersion"],
            "fontManifestSha256": expected_font_manifest_sha,
            "fontManifest": font_manifest,
            "runtimeIdentity": runtime_identity,
            "checks": {
                "worker-image": True,
                "runtime-identity": True,
                "legacy-no-timeline": True,
                "captured-timeline": True,
                "editor-v2": True,
                "subtitle-layout": True,
                "caption-template-pop": True,
                "ffprobe": True,
                "frame-parity": True,
                "render-spec-v4": True,
                "caption-render-spec-v4": True,
                "worker-title-compositor-parity": True,
                "worker-caption-noop-parity": True,
                "font-manifest": True,
                "font-fallback": True,
                **({"browser-parity-worker-matrix": True}
                   if browser_parity_matrix is not None else {}),
            },
            "checkSources": {
                "worker-image": "ecs-metadata-v4-image-id",
                "runtime-identity": (
                    "verify-initial-render-v4-runtime:"
                    "ecs-metadata-v4+embedded-source-sha"
                ),
                "legacy-no-timeline": "make-verify",
                "captured-timeline": "make-verify",
                "editor-v2": "synthetic-render",
                "subtitle-layout": "synthetic-render-ass",
                "caption-template-pop": "synthetic-render-frame",
                "ffprobe": "synthetic-render",
                "frame-parity": "synthetic-render",
                "render-spec-v4": "validated-editor-document",
                "caption-render-spec-v4": "validated-pop-ass",
                "worker-title-compositor-parity": (
                    "worker-pillow-initial-vs-rerender-pixels"
                ),
                "worker-caption-noop-parity": "worker-caption-ass-byte-parity",
                "font-manifest": "immutable-image-font-manifest",
                "font-fallback": "ffmpeg-libass-fontselect",
                **({
                    "browser-parity-worker-matrix": (
                        "isolated-linux-worker-rendered-png-matrix"
                    ),
                } if browser_parity_matrix is not None else {}),
            },
            "media": {
                "width": int(video["width"]),
                "height": int(video["height"]),
                "videoCodec": video["codec_name"],
                "audioCodec": audio["codec_name"],
                "durationSeconds": duration,
                "fps": fps,
            },
            "geometry": {
                "sampleSeconds": geometry_sample_seconds,
                "expectedVideoBounds": expected,
                "observedVideoBounds": observed,
                "maximumErrorPixels": geometry_error,
            },
            "captionTemplate": {
                "templateId": "pop",
                "accentPixels": accent_pixels,
                "safeArea": safe_area,
            },
            "fonts": list(FONT_IDS),
            "capabilities": {"subtitleEditing": True},
            "browserParityMatrix": ({
                "schemaVersion": browser_parity_matrix["schemaVersion"],
                "caseCount": browser_parity_matrix["caseCount"],
                "fontIds": browser_parity_matrix["fontIds"],
                "sha256": hashlib.sha256(
                    (browser_parity_root / "matrix.json").read_bytes()
                ).hexdigest(),
            } if browser_parity_matrix is not None and browser_parity_root else None),
            "features": {
                "clipCount": len(document.video.clips),
                "commentCount": len(document.comments),
                "textOverlayCount": len(document.overlays.text_overlays),
                "background": document.overlays.background.model_dump(
                    mode="json",
                    by_alias=True,
                )
                if document.overlays.background is not None
                else None,
                "template": document.template.id.value,
                "layerOrder": document.overlays.layer_order,
                "subtitleLayout": document.render_spec.subtitles.model_dump(
                    mode="json",
                    by_alias=True,
                )
                if document.render_spec and document.render_spec.subtitles
                else None,
            },
        }
        bucket = settings.s3_bucket
        if not bucket:
            raise RuntimeError("AWS_S3_OUTPUT_BUCKET is required for release evidence")
        if scenario == "baseline":
            release_nonce = os.environ.get(
                "EDITOR_RELEASE_PROBE_NONCE",
                "",
            ).strip().lower()
            probe_run_id = os.environ.get(
                "EDITOR_RELEASE_PROBE_RUN_ID",
                "",
            ).strip().lower()
            batch_job_id = os.environ.get("AWS_BATCH_JOB_ID", "").strip().lower()
            if not re.fullmatch(r"[0-9a-f]{32}", release_nonce):
                raise RuntimeError("EDITOR_RELEASE_PROBE_NONCE is invalid")
            if not re.fullmatch(
                r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-"
                r"[89ab][0-9a-f]{3}-[0-9a-f]{12}",
                probe_run_id,
            ):
                raise RuntimeError("EDITOR_RELEASE_PROBE_RUN_ID is invalid")
            if not re.fullmatch(
                r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-"
                r"[89ab][0-9a-f]{3}-[0-9a-f]{12}",
                batch_job_id,
            ):
                raise RuntimeError("AWS_BATCH_JOB_ID is invalid")
            manifest["probeIdentity"] = {
                "nonce": release_nonce,
                "batchJobId": batch_job_id,
                "probeRunId": probe_run_id,
            }
            prefix = (
                f"editor-release-probes/{git_sha}/{image_digest[7:19]}/"
                f"{release_nonce}/{batch_job_id}"
            )
        else:
            prefix = (
                f"editor-release-scenarios/{git_sha}/{image_digest[7:19]}/"
                f"{scenario}"
            )
        client = boto3.client("s3", region_name=settings.aws_region)
        manifest_version_id: str | None = None
        manifest_payload_sha256: str | None = None
        if scenario == "baseline":
            files: list[tuple[str, Path, str]] = [
                ("output.mp4", output, "video/mp4"),
                ("frame.png", frame_path, "image/png"),
            ]
            if browser_parity_root is not None:
                files.append((
                    "browser-parity/matrix.json",
                    browser_parity_root / "matrix.json",
                    "application/json",
                ))
                files.extend(
                    (
                        f"browser-parity/frames/{parity_frame.name}",
                        parity_frame,
                        "image/png",
                    )
                    for parity_frame in sorted(
                        (browser_parity_root / "frames").glob("*.png")
                    )
                )
            artifacts: list[dict[str, str]] = []
            for relative_name, file_path, content_type in files:
                evidence = _put_versioned_evidence(
                    client,
                    bucket=bucket,
                    key=f"{prefix}/{relative_name}",
                    payload=file_path.read_bytes(),
                    content_type=content_type,
                )
                artifacts.append({"relativeName": relative_name, **evidence})
            manifest["artifacts"] = artifacts
            manifest_payload = json.dumps(
                manifest,
                separators=(",", ":"),
            ).encode()
            manifest_evidence = _put_versioned_evidence(
                client,
                bucket=bucket,
                key=f"{prefix}/manifest.json",
                payload=manifest_payload,
                content_type="application/json",
            )
            manifest_version_id = manifest_evidence["versionId"]
            manifest_payload_sha256 = manifest_evidence["sha256"]
        else:
            client.upload_file(str(output), bucket, f"{prefix}/output.mp4")
            client.upload_file(str(frame_path), bucket, f"{prefix}/frame.png")
            client.put_object(
                Bucket=bucket,
                Key=f"{prefix}/manifest.json",
                Body=json.dumps(manifest, separators=(",", ":")).encode(),
                ContentType="application/json",
            )
        result = {
            **manifest,
            "artifactUri": f"s3://{bucket}/{prefix}/manifest.json",
            "manifestVersionId": manifest_version_id,
            "manifestSha256": manifest_payload_sha256,
        }
        print(json.dumps({"event": "editor_release_probe_passed", **result}))
        return result
