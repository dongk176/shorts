import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from PIL import Image

from shorts_worker.config import Settings
from shorts_worker.editor_renderer import EditorDocumentRenderer, create_editor_background
from shorts_worker.errors import RenderError
from shorts_worker.media import probe_media, run_command
from shorts_worker.schemas import EditorDocument
from shorts_worker.sns_editor import (
    SNS_EDITOR_RELEASE_ID,
    SNS_GENERATION_RELEASE_IDS,
    UNIFIED_SNS_EDITOR_RELEASE_ID,
    validate_sns_editor_document,
    verify_sns_editor_binding,
)


def browser_document():
    return json.loads(
        (Path(__file__).parents[2] / "test-fixtures/unified-social-editor-v4.json").read_text()
    )


def test_shared_layers_require_the_new_worker_and_exact_compatibility_proof(monkeypatch):
    from shorts_worker import sns_editor

    generation = next(iter(SNS_GENERATION_RELEASE_IDS))
    item = {
        "template_snapshot": browser_document()["template"]["snapshot"],
        "language_test_release_id": generation,
        "pending_edit_request_id": "request",
        "pending_edit_snapshot": browser_document(),
    }
    binding = {
        "release_id": UNIFIED_SNS_EDITOR_RELEASE_ID,
        "release_channel": "canary",
        "request_id": "request",
        "language_test_release_id": generation,
        "initial_editor_release_id": generation,
        "git_sha": "a" * 40,
        "worker_image_digest": "sha256:" + "b" * 64,
        "font_manifest_sha256": "c" * 64,
        "render_spec_version": 4,
        "caption_render_spec_version": 4,
    }
    binding["details"] = {
        "generationReleaseIds": list(SNS_GENERATION_RELEASE_IDS),
        "unifiedTemplateEditorVersion": 1,
        "sourceGitSha": binding["git_sha"],
        "imageDigest": binding["worker_image_digest"],
        "fontManifestSha256": binding["font_manifest_sha256"],
    }
    runtime = MagicMock()
    monkeypatch.setattr(sns_editor, "verify_initial_render_v4_runtime", runtime)
    monkeypatch.setenv("EASYCUT_SNS_EDITOR_RELEASE_ID", UNIFIED_SNS_EDITOR_RELEASE_ID)
    verify_sns_editor_binding(item, binding)
    runtime.assert_called_once()
    runtime.reset_mock()
    for incompatible in (SNS_EDITOR_RELEASE_ID, generation):
        monkeypatch.setenv("EASYCUT_SNS_EDITOR_RELEASE_ID", incompatible)
        with pytest.raises(RenderError):
            verify_sns_editor_binding(item, binding)
    monkeypatch.setenv("EASYCUT_SNS_EDITOR_RELEASE_ID", UNIFIED_SNS_EDITOR_RELEASE_ID)
    binding["details"].pop("unifiedTemplateEditorVersion")
    with pytest.raises(RenderError):
        verify_sns_editor_binding(item, binding)
    runtime.assert_not_called()


@pytest.mark.parametrize("community", [False, True])
def test_social_decoration_keeps_uploaded_background(tmp_path, community):
    value = browser_document()
    if community:
        value["template"]["snapshot"]["communityTemplateVersion"] = 1
    value["overlays"]["background"] = {
        "kind": "uploaded_image",
        "assetId": "11111111-1111-4111-8111-111111111111",
    }
    photo = tmp_path / "photo.png"
    Image.new("RGB", (80, 80), "#123456").save(photo)
    output = create_editor_background(
        EditorDocument.model_validate(value), tmp_path / "background.png", photo
    )
    with Image.open(output) as image:
        assert image.getpixel((10, 1900)) == (18, 52, 86)
        assert image.getpixel((80, 150 if community else 350)) == (37, 99, 235)


@pytest.mark.render
def test_browser_document_renders_cuts_photos_and_timed_text(tmp_path):
    source = tmp_path / "source.mp4"
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
        cwd=tmp_path,
    )
    value = browser_document()
    value["video"]["clips"] = [
        {"id": "a", "sourceStartSeconds": 0, "sourceEndSeconds": 1},
        {"id": "b", "sourceStartSeconds": 2, "sourceEndSeconds": 3},
    ]
    value["video"]["selectionEndSeconds"] = 3
    for overlay in value["overlays"]["textOverlays"]:
        overlay["endSeconds"] = 2
    for overlay in value["renderSpec"]["textOverlays"]:
        overlay["endFrame"] = 60
    # First body ends after one second; the independent second body stays visible.
    value["overlays"]["textOverlays"][0]["endSeconds"] = 1
    value["renderSpec"]["textOverlays"][0]["endFrame"] = 30
    value["overlays"]["background"] = {
        "kind": "uploaded_image",
        "assetId": "11111111-1111-4111-8111-111111111111",
    }
    photo = tmp_path / "background-photo.png"
    avatar = tmp_path / "channel-photo.png"
    Image.new("RGB", (80, 80), "#123456").save(photo)
    Image.new("RGB", (80, 80), "#FF0000").save(avatar)
    document = EditorDocument.model_validate(value)
    validate_sns_editor_document(document)
    renderer = EditorDocumentRenderer(Settings(ffmpeg_threads=2))
    clean = renderer.extract_sequence(
        timeline_path=source,
        output_path=tmp_path / "clean.mp4",
        document=document,
        work_dir=tmp_path / "sequence",
    )
    output = renderer.render(
        clean_path=clean,
        output_path=tmp_path / "edited.mp4",
        document=document,
        work_dir=tmp_path / "render",
        channel_thumbnail_path=avatar,
        uploaded_background_path=photo,
    )
    probe = probe_media(output, timeout=20)
    assert abs(float(probe["format"]["duration"]) - 2) < 0.12
    assert any(s["codec_type"] == "audio" for s in probe["streams"])
    assert any(s.get("width") == 1080 and s.get("height") == 1920 for s in probe["streams"])
    colors = []
    for time in (0.5, 1.5):
        frame = tmp_path / f"frame-{time}.png"
        run_command(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-ss",
                str(time),
                "-i",
                str(output),
                "-frames:v",
                "1",
                str(frame),
            ],
            timeout=20,
            cwd=tmp_path,
        )
        with Image.open(frame) as image:
            colors.append(
                sum(
                    r > 200 and 60 < g < 160 and b < 150
                    for r, g, b in image.convert("RGB").crop((100, 610, 980, 725)).getdata()
                )
            )
    assert colors[0] > 500
    assert colors[1] < 20
