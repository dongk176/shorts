"""Bounded exact-image social-editor and existing custom-design verification."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

import boto3
from PIL import Image

from .config import Settings
from .custom_template_design_probe import (
    custom_template_design_evidence,
    verify_custom_template_design,
)
from .editor_renderer import EditorDocumentRenderer
from .font_manifest import canonical_editor_font_manifest
from .media import probe_media, run_command
from .release_identity import _embedded_worker_source_git_sha, _running_container_image_digest
from .schemas import EditorDocument
from .sns_editor import validate_sns_editor_document


def main() -> None:
    sha = _embedded_worker_source_git_sha()
    digest = _running_container_image_digest()
    font = canonical_editor_font_manifest()["sha256"]
    assert sha == os.environ["EDITOR_RELEASE_GIT_SHA"]
    assert digest == os.environ["WORKER_IMAGE_DIGEST"]
    assert font == os.environ["EDITOR_FONT_MANIFEST_SHA256"]
    settings = Settings(
        database_url=None,
        openai_api_key=None,
        gemini_api_key=None,
        ffmpeg_threads=2,
        ffmpeg_timeout_seconds=180,
        clean_clip_preset="ultrafast",
    )
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source = root / "source.mp4"
        run_command(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=blue:s=320x180:r=30:d=4",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=4",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                "-shortest",
                str(source),
            ],
            timeout=30,
            cwd=root,
        )
        background, avatar = root / "background.png", root / "avatar.png"
        Image.new("RGB", (100, 100), "#123456").save(background)
        Image.new("RGB", (100, 100), "#FF0000").save(avatar)
        cases = []
        for kind in ("sns", "community"):
            raw = json.loads(
                (Path(__file__).parent / f"assets/unified_{kind}_probe.json").read_text()
            )
            raw["overlays"]["background"] = {
                "kind": "uploaded_image",
                "assetId": "11111111-1111-4111-8111-111111111111",
            }
            document = EditorDocument.model_validate(raw)
            validate_sns_editor_document(document)
            renderer = EditorDocumentRenderer(settings)
            clean = renderer.extract_sequence(
                timeline_path=source,
                output_path=root / f"{kind}-clean.mp4",
                document=document,
                work_dir=root / f"{kind}-cut",
            )
            output = renderer.render(
                clean_path=clean,
                output_path=root / f"{kind}.mp4",
                document=document,
                work_dir=root / f"{kind}-render",
                channel_thumbnail_path=avatar,
                uploaded_background_path=background,
            )
            probe = probe_media(output, timeout=30)
            video = next(s for s in probe["streams"] if s["codec_type"] == "video")
            assert (video["width"], video["height"]) == (1080, 1920)
            assert any(s["codec_type"] == "audio" for s in probe["streams"])
            assert (
                abs(float(probe["format"]["duration"]) - document.video.output_duration_seconds)
                < 0.15
            )
            run_command(
                ["ffmpeg", "-v", "error", "-i", str(output), "-f", "null", "-"],
                timeout=90,
                cwd=root,
            )
            frame = root / f"{kind}.png"
            run_command(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-y",
                    "-ss",
                    "0.6",
                    "-i",
                    str(output),
                    "-frames:v",
                    "1",
                    str(frame),
                ],
                timeout=30,
                cwd=root,
            )
            with Image.open(frame) as image:
                assert (
                    sum(
                        abs(a - b)
                        for a, b in zip(
                            image.convert("RGB").getpixel((10, 1900)), (18, 52, 86), strict=True
                        )
                    )
                    < 20
                )
            cases.append(
                {
                    "kind": kind,
                    "duration": float(probe["format"]["duration"]),
                    "subtitles": document.subtitles.enabled,
                    "frameSha256": hashlib.sha256(frame.read_bytes()).hexdigest(),
                }
            )
        design = custom_template_design_evidence(
            source_git_sha=sha,
            worker_image_digest=digest,
            font_manifest_sha256=font,
            verification=verify_custom_template_design(root=root / "design", settings=settings),
        )
        result = {
            "version": 1,
            "sourceGitSha": sha,
            "imageDigest": digest,
            "fontManifestSha256": font,
            "runtimeIdentityVerified": True,
            "batchJobId": os.environ["AWS_BATCH_JOB_ID"],
            "cases": cases,
            "customTemplateDesign": design,
        }
        bucket = settings.s3_bucket
        assert bucket
        prefix = f"outputs/unified-social-verification/{sha}/{digest[7:19]}/{result['batchJobId']}"
        s3 = boto3.client("s3", region_name=settings.aws_region)
        for kind in ("sns", "community"):
            s3.upload_file(str(root / f"{kind}.png"), bucket, f"{prefix}/{kind}.png")
        payload = json.dumps(result, ensure_ascii=False, sort_keys=True).encode()
        response = s3.put_object(
            Bucket=bucket,
            Key=f"{prefix}/manifest.json",
            Body=payload,
            ContentType="application/json",
        )
        print(
            json.dumps(
                {
                    "artifactUri": f"s3://{bucket}/{prefix}/manifest.json",
                    "manifestSha256": hashlib.sha256(payload).hexdigest(),
                    "versionId": response.get("VersionId"),
                    **result,
                }
            )
        )


if __name__ == "__main__":
    main()
