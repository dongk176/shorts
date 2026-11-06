from __future__ import annotations

import copy
import json
import subprocess
from pathlib import Path
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from shorts_worker.config import Settings
from shorts_worker.editor_renderer import EditorDocumentRenderer, retime_editor_subtitles
from shorts_worker.media import media_duration, probe_media
from shorts_worker.render_spec_v4 import compile_initial_editor_render_spec_v4
from shorts_worker.shorts_silence import analyze, editor_snapshot, kept_ranges, plan


def item():
    return dict(
        id="11111111-1111-4111-8111-111111111111",
        job_id="job-a",
        mvp_session_id="session-a",
        clean_clip_s3_key="edit-sources/clean.mp4",
        template_id="dark-red",
        template_snapshot={"presetVersion": 3},
        start_seconds=100,
        end_seconds=104,
        hook_title="Test",
        channel_display_name="Channel",
        subtitles_enabled=False,
        title_font_scale=1,
        video_aspect_ratio="1:1",
        subtitle_segments=[dict(start=0, end=1, text="before"), dict(start=3, end=4, text="after")],
        initial_render_spec=compile_initial_editor_render_spec_v4(
            title="Test",
            template_id="dark-red",
            video_aspect_ratio="1:1",
            font_scale=1,
            duration_seconds=4,
        ),
    )


def test_source_coordinates_survive_cuts_and_can_expand():
    source = item()
    before = copy.deepcopy(source)
    doc = plan(source, [[1, 3]])
    assert doc is not None
    assert source == before
    assert doc.video.timeline_start_seconds == 100
    assert doc.video.output_duration_seconds == pytest.approx(2.2)
    assert doc.video.clips[1].source_start_seconds == pytest.approx(2.9)
    assert retime_editor_subtitles(doc)[1].start == pytest.approx(1.2)
    # Expanding the first clip restores genuine retained source, not black frames.
    restored = doc.model_dump(by_alias=True)
    restored["video"]["clips"] = [dict(id="restored", sourceStartSeconds=0, sourceEndSeconds=4)]
    from shorts_worker.schemas import EditorDocument

    assert EditorDocument.model_validate(restored).video.output_duration_seconds == 4


def test_threshold_handles_and_no_cut_preserve_original():
    assert plan(item(), [[1, 1.29]]) is None
    assert kept_ranges(4, [[1, 1.3]]) == [(0, 1.1), (1.2, 4)]
    assert plan(item(), [[0, 4]]) is None
    with pytest.raises(ValueError):
        kept_ranges(float("nan"), [])


def test_admin_inline_renders_once_and_commits_map(tmp_path, monkeypatch):
    from test_retry_pipeline import _initial_render_worker

    from shorts_worker import shorts_silence

    worker = _initial_render_worker(tmp_path, True)
    worker.editor_renderer = MagicMock()
    worker.repository.inline_silence_admin_allowed.return_value = True
    background = tmp_path / "owned-background.png"
    worker._background_render_arguments = MagicMock(
        return_value={"uploaded_background_path": background})
    monkeypatch.setenv("SHORTS_SILENCE_INLINE_ADMIN_ENABLED", "true")
    monkeypatch.setattr(shorts_silence, "analyze", lambda *_: [[1, 3]])
    assert worker._render_initial_short(item()) is not None
    worker.renderer.render_clean_clip.assert_not_called()
    worker.editor_renderer.render.assert_called_once()
    assert worker.editor_renderer.render.call_args.kwargs["uploaded_background_path"] == background
    result = worker.repository.complete_initial_render.call_args.kwargs["silence_result"]
    assert result["cut_count"] == 1
    assert result["removed_seconds"] == pytest.approx(1.8)
    assert result["document"]["video"]["timelineStartSeconds"] == 100


@pytest.mark.parametrize("enabled,allowed", [(False, True), (True, False)])
def test_normal_generation_unchanged(tmp_path, monkeypatch, enabled, allowed):
    from test_retry_pipeline import _initial_render_worker

    worker = _initial_render_worker(tmp_path, True)
    worker.repository.inline_silence_admin_allowed.return_value = allowed
    monkeypatch.setenv("SHORTS_SILENCE_INLINE_ADMIN_ENABLED", str(enabled).lower())
    worker._render_initial_short(item())
    worker.renderer.render_clean_clip.assert_called_once()
    assert worker.repository.complete_initial_render.call_args.kwargs == {}


@pytest.mark.render
def test_ffmpeg_cut_and_restored_source_duration(tmp_path):
    source = tmp_path / "original.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x90:r=30:d=4",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=4:sample_rate=48000",
            "-af",
            "volume=enable='between(t,1,3)':volume=0",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
            "-y",
            str(source),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    doc = plan(item(), analyze(source, 4))
    assert doc is not None
    renderer = EditorDocumentRenderer(Settings(temp_dir=tmp_path))
    output = renderer.extract_sequence(
        timeline_path=source,
        output_path=tmp_path / "cut.mp4",
        document=doc,
        work_dir=tmp_path / "work",
    )
    assert abs(media_duration(probe_media(output)) - doc.video.output_duration_seconds) < 0.12
    assert abs(media_duration(probe_media(source)) - 4) < 0.05


@pytest.mark.render
def test_final_render_and_editor_restore_use_same_source(tmp_path):
    from shorts_worker.caption_templates import compile_caption_render_spec
    from shorts_worker.schemas import EditorDocument
    from shorts_worker.subtitles import TranscriptWord

    source = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x90:r=30:d=4",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=4:sample_rate=48000",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
            "-y",
            str(source),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    original = item()
    caption = compile_caption_render_spec(
        [
            TranscriptWord(text="처음", start=0.1, end=0.8, provider="elevenlabs"),
            TranscriptWord(text="마지막", start=3.1, end=3.8, provider="elevenlabs"),
        ],
        template_id="pop",
        clip_start=0,
        clip_end=4,
        video_aspect_ratio="1:1",
        schema_version=4,
    )
    original["subtitles_enabled"] = True
    original["initial_render_spec"] = compile_initial_editor_render_spec_v4(
        title="Test",
        template_id="dark-red",
        video_aspect_ratio="1:1",
        font_scale=1,
        duration_seconds=4,
        caption_render_spec=caption,
    )
    doc = plan(original, [[1, 3]])
    assert doc is not None
    renderer = EditorDocumentRenderer(
        Settings(
            temp_dir=tmp_path,
            ffmpeg_timeout_seconds=120,
            ffmpeg_threads=2,
            clean_clip_preset="ultrafast",
            clean_clip_crf=28,
        )
    )
    saved = EditorDocument.model_validate_json(doc.model_dump_json(by_alias=True))
    restored = saved.model_dump(by_alias=True)
    restored["video"]["clips"] = [dict(id="restore", sourceStartSeconds=0, sourceEndSeconds=4)]
    for name, document in [
        ("initial", doc),
        ("saved", saved),
        ("restored", EditorDocument.model_validate(restored)),
    ]:
        folder = tmp_path / name
        sequence = renderer.extract_sequence(
            timeline_path=source,
            output_path=folder / "sequence.mp4",
            document=document,
            work_dir=folder,
        )
        output = renderer.render(
            clean_path=sequence,
            output_path=folder / "output.mp4",
            document=document,
            work_dir=folder,
            channel_thumbnail_path=None,
            caption_render_spec=caption,
            caption_composition_spec=caption,
        )
        probe = probe_media(output)
        assert abs(media_duration(probe) - document.video.output_duration_seconds) < 0.12
        assert {s["codec_type"] for s in probe["streams"]} == {"audio", "video"}
    initial_ass = (tmp_path / "initial/editor-assets/subtitles.ass").read_text()
    assert initial_ass == (tmp_path / "saved/editor-assets/subtitles.ass").read_text()
    assert initial_ass != (tmp_path / "restored/editor-assets/subtitles.ass").read_text()
    assert abs(media_duration(probe_media(source)) - 4) < 0.05


def test_browser_fixture_matches_worker_document():
    fixture = Path(__file__).parents[2] / "test-fixtures/shorts-silence-inline.json"
    document = plan(item(), [[1, 3]])
    assert editor_snapshot(document) == json.loads(fixture.read_text())


def test_comment_timing_moves_with_cut_without_changing_source():
    source = item()
    comment = dict(
        id="c1",
        startSeconds=3.1,
        endSeconds=3.9,
        text="반응",
        initial="A",
        avatarColor="#123456",
        nickname="tester",
        likeCount=10,
        ageLabel="지금",
    )
    source["comment_overlays"] = [comment]
    document = plan(source, [[1, 3]])
    assert document.comments[0].start_seconds == pytest.approx(1.3)
    assert document.comments[0].end_seconds == pytest.approx(2.1)
    assert document.render_spec.comments[0].start_frame == 39
    assert source["comment_overlays"][0]["startSeconds"] == 3.1


@pytest.mark.parametrize("failure", [ValueError("invalid plan"), OSError("ffmpeg missing"),
                                     subprocess.TimeoutExpired("ffmpeg", 90)])
def test_analysis_failure_preserves_generation(tmp_path, monkeypatch, failure):
    from test_retry_pipeline import _initial_render_worker

    from shorts_worker import shorts_silence

    worker = _initial_render_worker(tmp_path, True)
    worker.editor_renderer = MagicMock()
    worker.repository.inline_silence_admin_allowed.return_value = True
    monkeypatch.setenv("SHORTS_SILENCE_INLINE_ADMIN_ENABLED", "true")

    def fail(*_):
        raise failure

    monkeypatch.setattr(shorts_silence, "analyze", fail)
    assert worker._render_initial_short(item()) is not None
    worker.renderer.render_clean_clip.assert_called_once()
    worker.editor_renderer.render.assert_not_called()
    result = worker.repository.complete_initial_render.call_args.kwargs["silence_result"]
    assert result["document"] is None
    assert result["error_code"] == "SILENCE_INLINE_ANALYSIS_FAILED"
    assert result["removed_seconds"] == 0


@pytest.mark.parametrize("id_type", [str, UUID])
def test_custom_text_and_comment_positions_survive_inline_cuts(id_type):
    fixture = json.loads((Path(__file__).parents[2] /
                          "test-fixtures/unified-social-editor-v4.json").read_text())
    source = item()
    source["custom_template_id"] = id_type("22222222-2222-4222-8222-222222222222")
    layer = copy.deepcopy(fixture["renderSpec"]["textOverlays"][0])
    source["initial_render_spec"]["textOverlays"] = [
        dict(layer, id="whole", startFrame=0, endFrame=120),
        dict(layer, id="removed", startFrame=45, endFrame=60),
    ]
    source["initial_render_spec"]["layerOrder"] = [
        "video", "title", "comment", "text:whole", "text:removed", "channel"]
    source["template_snapshot"]["config"] = {"textOverlays": [
        {"id": "whole", "text": "사용자가 작성한 글"}]}
    before = copy.deepcopy(source)
    doc = plan(source, [[1, 3]])
    assert source == before
    assert doc.template.custom_template_id == str(source["custom_template_id"])
    assert len(doc.overlays.text_overlays) == 1
    assert doc.overlays.text_overlays[0].text == "사용자가 작성한 글"
    assert doc.overlays.text_overlays[0].end_seconds == pytest.approx(2.2)
    assert "text:removed" not in doc.render_spec.layer_order
