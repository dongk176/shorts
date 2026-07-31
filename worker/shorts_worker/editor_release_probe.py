from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import boto3
from PIL import Image

from .config import Settings
from .editor_renderer import (
    EditorDocumentRenderer,
    editor_video_frame,
    verify_editor_fonts,
)
from .schemas import EditorDocument

FONT_IDS = (
    "pretendard",
    "black-han-sans",
    "gmarket-sans",
    "do-hyeon",
    "noto-serif-kr",
    "nanum-myeongjo",
    "suit",
    "spoqa-han-sans-neo",
)


def _run(command: list[str], *, timeout: float = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout,
        shell=False,
    )


def _document() -> EditorDocument:
    text_overlays = [
        {
            "id": f"font-{index}",
            "text": f"한글 폰트 {index + 1}",
            "fontId": font_id,
            "color": "#FFFFFF" if index % 2 == 0 else "#FFD84D",
            "effect": ("none", "outline", "shadow")[index % 3],
            "offset": {"x": -270 + (index % 2) * 540, "y": -700 + index * 170},
            "width": 360,
            "scale": 0.7,
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
    return EditorDocument.model_validate({
        "version": 2,
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
    })


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
    if os.environ.get("EDITOR_RELEASE_SUITE_VERIFIED", "").strip().lower() != "true":
        raise RuntimeError(
            "EDITOR_RELEASE_SUITE_VERIFIED must confirm the legacy and timeline test suite"
        )

    settings = Settings(
        database_url=None,
        openai_api_key=None,
        gemini_api_key=None,
        ffmpeg_timeout_seconds=180,
        ffmpeg_threads=2,
        clean_clip_preset="ultrafast",
        clean_clip_crf=28,
    )
    verify_editor_fonts()
    document = _document()
    with tempfile.TemporaryDirectory(
        prefix="editor-release-probe-",
        dir=settings.temp_dir if settings.temp_dir.is_dir() else None,
    ) as temporary:
        root = Path(temporary)
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
        )
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
        _run([
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            "2",
            "-i",
            str(output),
            "-frames:v",
            "1",
            str(frame_path),
        ])
        expected_frame = editor_video_frame(document)
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
        manifest = {
            "schemaVersion": 1,
            "gitSha": git_sha,
            "workerImageDigest": image_digest,
            "documentVersion": document.version,
            "checks": {
                "worker-image": True,
                "legacy-no-timeline": True,
                "captured-timeline": True,
                "editor-v2": True,
                "ffprobe": True,
                "frame-parity": True,
            },
            "checkSources": {
                "worker-image": "immutable-runtime-digest",
                "legacy-no-timeline": "make-verify",
                "captured-timeline": "make-verify",
                "editor-v2": "synthetic-render",
                "ffprobe": "synthetic-render",
                "frame-parity": "synthetic-render",
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
                "expectedVideoBounds": expected,
                "observedVideoBounds": observed,
                "maximumErrorPixels": geometry_error,
            },
            "fonts": list(FONT_IDS),
        }
        bucket = settings.s3_bucket
        if not bucket:
            raise RuntimeError("AWS_S3_OUTPUT_BUCKET is required for release evidence")
        prefix = f"editor-release-probes/{git_sha}/{image_digest[7:19]}"
        client = boto3.client("s3", region_name=settings.aws_region)
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
        }
        print(json.dumps({"event": "editor_release_probe_passed", **result}))
        return result
