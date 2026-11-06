from __future__ import annotations

import copy
import json
import subprocess
from pathlib import Path

import pytest
from test_shorts_silence import item

from shorts_worker.config import Settings
from shorts_worker.editor_renderer import EditorDocumentRenderer
from shorts_worker.media import media_duration, probe_media
from shorts_worker.shorts_silence import plan
from shorts_worker.sns_editor import validate_sns_editor_document


@pytest.mark.parametrize("language", ["ko", "en", "ja"])
@pytest.mark.parametrize("ratio", ["16:9", "5:4", "1:1", "4:5", "9:16"])
@pytest.mark.parametrize("community", [False, True])
def test_social_cut_keeps_editable_copy_and_layout(language, ratio, community):
    source = item()
    source.update(template_id="white-yellow", video_aspect_ratio=ratio)
    source["template_snapshot"] = dict(
        presetVersion=4, snsTemplateVersion=1, snsLanguage=language, brandColor="#35E6E3",
        snsContent=dict(title="Test", body=["원래 문장 Original 日本語"], hashtags=["#video"]),
        **({"communityTemplateVersion": 1} if community else {}),
    )
    before = copy.deepcopy(source)
    document = plan(source, [[1, 3]])
    assert document is not None
    validate_sns_editor_document(document)
    assert source == before
    assert document.video.output_duration_seconds == pytest.approx(2.2)
    assert document.template.custom_template_id is None
    assert (document.template.snapshot["snsContent"]["body"]
            == before["template_snapshot"]["snsContent"]["body"])
    body = next(layer for layer in document.overlays.text_overlays if layer.id == "sns-body-0")
    assert body.text == "원래 문장 Original 日本語"
    assert body.end_seconds <= document.video.output_duration_seconds + 1e-6
    expected_font = "noto-sans-jp" if language == "ja" else "pretendard"
    assert document.render_spec.title.font.font_id.value == expected_font
    assert document.template.snapshot["config"]["video"]["aspectRatio"] == ratio


@pytest.mark.render
@pytest.mark.parametrize("community", [False, True])
def test_social_initial_and_saved_document_render_same_frames(tmp_path, community):
    from shorts_worker.schemas import EditorDocument

    source = tmp_path / "source.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30:d=4",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=4:sample_rate=48000",
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(source),
    ], check=True, capture_output=True, timeout=30)
    original = item()
    original.update(template_id="white-yellow", video_aspect_ratio="16:9",
                    hook_title="日本語の動画")
    original["template_snapshot"] = dict(
        presetVersion=4, snsTemplateVersion=1, snsLanguage="ja", brandColor="#35E6E3",
        snsContent=dict(title="日本語の動画", body=["映像と文字を確認します"], hashtags=["#動画"]),
        **({"communityTemplateVersion": 1} if community else {}),
    )
    doc = plan(original, [[1, 3]])
    saved = EditorDocument.model_validate_json(doc.model_dump_json(by_alias=True))
    renderer = EditorDocumentRenderer(Settings(
        temp_dir=tmp_path, ffmpeg_threads=2, ffmpeg_timeout_seconds=120,
        clean_clip_preset="ultrafast", clean_clip_crf=28,
    ))
    hashes = []
    for name, document in [("initial", doc), ("saved", saved)]:
        folder = tmp_path / name
        sequence = renderer.extract_sequence(timeline_path=source,
            output_path=folder / "sequence.mp4", document=document, work_dir=folder)
        output = renderer.render(clean_path=sequence, output_path=folder / "output.mp4",
            document=document, work_dir=folder, channel_thumbnail_path=None,
            comment_output_language="ja")
        probe = probe_media(output)
        assert abs(media_duration(probe) - 2.2) < .12
        assert {s["codec_type"] for s in probe["streams"]} == {"audio", "video"}
        hashes.append(subprocess.run([
            "ffmpeg", "-v", "error", "-i", str(output), "-map", "0:v", "-f", "framemd5", "-",
        ], check=True, capture_output=True, timeout=30).stdout)
    assert hashes[0] == hashes[1]


def test_browser_social_fixtures_are_actual_worker_documents():
    from shorts_worker.shorts_silence import editor_snapshot

    fixtures = json.loads((Path(__file__).parents[2]
                           / "test-fixtures/shorts-silence-social-inline.json").read_text())
    for fixture in fixtures:
        source = item()
        source.update(template_id="white-yellow",
                      video_aspect_ratio=fixture["input"]["videoAspectRatio"],
                      hook_title="日本語の動画",
                      template_snapshot=fixture["input"]["templateSnapshot"])
        assert editor_snapshot(plan(source, [[1, 3]])) == fixture["document"]
