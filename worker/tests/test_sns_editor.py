import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from PIL import Image

from shorts_worker.config import Settings
from shorts_worker.editor_renderer import EditorDocumentRenderer
from shorts_worker.errors import RenderError
from shorts_worker.media import probe_media, run_command
from shorts_worker.schemas import EditorDocument
from shorts_worker.sns_editor import (
    SNS_EDITOR_RELEASE_ID,
    SNS_GENERATION_RELEASE_IDS,
    validate_sns_editor_document,
    verify_sns_editor_binding,
)
from shorts_worker.sns_template import sns_layout


def document(ratio="9:16", language="ko"):
    value = json.loads(
        (Path(__file__).parents[2] / "test-fixtures/editor-document-v2.json").read_text()
    )
    title, body, tags = {
        "ko": ("수정한 제목", "본문 수정 완료", ["#영상", "#장면", "#수정"]),
        "en": ("Edited title", "Editing works", ["#Video", "#Scene", "#Edit"]),
        "ja": ("編集したタイトル", "本文も編集完了", ["#動画", "#場面", "#編集"]),
    }[language]
    layout = sns_layout(ratio)
    value["template"] = {
        "id": "white-yellow",
        "customTemplateId": None,
        "presetVersion": 4,
        "snapshot": {
            "presetVersion": 4,
            "snsTemplateVersion": 1,
            "snsLanguage": language,
            "brandColor": "#E32626",
            "snsContent": {
                "title": title,
                "body": [body] * layout.body_lines,
                "hashtags": tags if layout.hashtags else [],
                "source": "edited",
            },
        },
    }
    value["title"]["text"] = title
    value["subtitles"] = {"enabled": False, "segments": []}
    value["video"].update(
        aspectRatio=ratio,
        timelineStartSeconds=0,
        timelineEndSeconds=1,
        selectionStartSeconds=0,
        selectionEndSeconds=1,
        clips=[{"id": "sns", "sourceStartSeconds": 0, "sourceEndSeconds": 1}],
    )
    return EditorDocument.model_validate(value)


@pytest.mark.parametrize("ratio", ["16:9", "5:4", "1:1", "4:5", "9:16"])
@pytest.mark.parametrize("language", ["ko", "en", "ja"])
def test_sns_editor_copy_and_layout_contract(ratio, language):
    validate_sns_editor_document(document(ratio, language))


@pytest.mark.parametrize("change", ["release", "generation", "request", "proof", "ordinary"])
def test_editor_identity_rejects_mixed_releases(monkeypatch, change):
    from shorts_worker import sns_editor

    generation = next(iter(SNS_GENERATION_RELEASE_IDS))
    item = {
        "language_test_release_id": generation,
        "pending_edit_request_id": "request",
        "pending_edit_snapshot": document().model_dump(by_alias=True),
    }
    binding = {
        "release_id": SNS_EDITOR_RELEASE_ID,
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
        "sourceGitSha": binding["git_sha"],
        "imageDigest": binding["worker_image_digest"],
        "fontManifestSha256": binding["font_manifest_sha256"],
    }
    monkeypatch.setenv("EASYCUT_SNS_EDITOR_RELEASE_ID", SNS_EDITOR_RELEASE_ID)
    runtime = MagicMock()
    monkeypatch.setattr(sns_editor, "verify_initial_render_v4_runtime", runtime)
    verify_sns_editor_binding(item, binding)
    runtime.assert_called_once()
    runtime.reset_mock()
    if change == "release":
        binding["release_id"] = generation
    elif change == "generation":
        item["language_test_release_id"] = "ordinary"
    elif change == "request":
        binding["request_id"] = "other"
    elif change == "proof":
        binding["details"]["imageDigest"] = "sha256:" + "d" * 64
    else:
        monkeypatch.delenv("EASYCUT_SNS_EDITOR_RELEASE_ID")
    with pytest.raises(RenderError, match="릴리스"):
        verify_sns_editor_binding(item, binding)
    runtime.assert_not_called()


@pytest.mark.render
@pytest.mark.parametrize("ratio", ["16:9", "5:4", "1:1", "4:5", "9:16"])
def test_actual_editor_render_keeps_sns_content_ratio_audio(tmp_path, ratio):
    source, output = tmp_path / "clean.mp4", tmp_path / "edited.mp4"
    run_command(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=blue:s=320x180:r=10:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
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
    doc = document(ratio)
    EditorDocumentRenderer(Settings(ffmpeg_threads=2)).render(
        clean_path=source,
        output_path=output,
        document=doc,
        work_dir=tmp_path,
        channel_thumbnail_path=None,
    )
    streams = probe_media(output, timeout=20)["streams"]
    assert any(s["codec_type"] == "audio" for s in streams)
    assert any(s.get("width") == 1080 and s.get("height") == 1920 for s in streams)
    with Image.open(tmp_path / "sns-overlay.png") as overlay:
        assert overlay.getpixel((80, 210))[:3] == (227, 38, 38)
        x, y, width, height = sns_layout(ratio).video
        assert overlay.getpixel((x + width // 2, y + height // 2))[3] == 0
        assert overlay.getpixel((x + width - 53, y + height - 53))[3] > 0
        # Text changed from the generated content and is painted in the body region.
        pixels = overlay.crop((x, 495, x + width, 560)).convert("RGB")
        assert min(sum(p) for p in pixels.getdata()) < 150
