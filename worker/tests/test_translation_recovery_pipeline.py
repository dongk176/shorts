from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from shorts_worker import worker_pipeline as pipeline
from shorts_worker.config import Settings
from shorts_worker.schemas import HighlightClip, SubtitleSegment, TemplateSubtitleLayer
from shorts_worker.subtitle_translation import SubtitleTranslator
from shorts_worker.subtitles import ELEVENLABS_FALLBACK_POLICY, TranscriptWord
from shorts_worker.worker_pipeline import BatchWorker


@pytest.mark.parametrize("bad_start", [50, 20])
@pytest.mark.parametrize("language,enabled", [("en", True), ("ja", True), ("en", False)])
def test_project_translation_failure_isolated_from_other_outputs(
    tmp_path, monkeypatch, bad_start, language, enabled,
):
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_WORKER", "true")
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_RELEASE_ID", "release")
    monkeypatch.setattr(pipeline, "verify_initial_render_v4_runtime", lambda _: {})
    worker = BatchWorker.__new__(BatchWorker)
    worker.settings = Settings(
        temp_dir=tmp_path,
        openai_api_key="test",
        gemini_api_key="test",
        gemini_paid_data_processing_confirmed=True,
        edit_timeline_capture_enabled=True,
    )
    worker.repository = MagicMock()
    worker.repository.get_job.return_value = {
        "id": "job",
        "mvp_session_id": "session",
        "pipeline_version": 2,
        "source_type": "youtube",
        "youtube_video_id": "fixture0000",
        "youtube_url": "https://www.youtube.com/watch?v=fixture0000",
        "ingestion_route_id": "route",
        "language_test_release_id": "release",
        "initial_editor_release_id": "release",
        "initial_render_spec_version": 4,
        "initial_caption_render_spec_version": 4,
        "source_duration_seconds": 300,
        "source_range_selection_enabled": True,
        "range_start_seconds": 0,
        "range_end_seconds": 300,
        "video_title": "영상",
        "planned_short_count": 3,
        "output_language": language,
        "source_language_hint": "ko",
        "template_id": "dark-minimal",
        "subtitle_template_id": "highlight",
        "subtitle_template_snapshot": {},
        "transcription_policy": ELEVENLABS_FALLBACK_POLICY,
        "video_aspect_ratio": "16:9",
        "channel_name": "channel",
        "retention_days": 7,
    }
    worker.repository.claim_project_run.return_value = {"attempt_count": 1}
    worker.repository.fail_unselected_project_attempts.return_value = 0
    worker.repository.mark_project_preparation_finished.return_value = True
    worker.repository.finalize_project_job.return_value = {"final_status": "completed"}
    worker.heartbeat = lambda *_: nullcontext()
    source = tmp_path / "source.mp4"
    source.write_bytes(b"fixture")
    worker.ingestion = MagicMock()
    worker._download_with_inline_route_rotation = MagicMock(
        return_value=(SimpleNamespace(video_path=source, metadata=SimpleNamespace(
            video_id="fixture0000", duration_seconds=300,
        )), "route"),
    )
    monkeypatch.setattr(pipeline, "probe_media", lambda _: {})
    monkeypatch.setattr(pipeline, "media_duration", lambda _: 300)
    segments = [
        SubtitleSegment(start=i, end=i + 8, text="오류" if i == bad_start else "안녕")
        for i in range(0, 300, 10)
    ]

    def transcribe(**kwargs):
        kwargs["observation"]["languageCode"] = "kor"
        kwargs["words_out"].extend(TranscriptWord(s.text, s.start, s.end, "test") for s in segments)
        return segments

    worker._transcribe_source = transcribe
    worker.selector = MagicMock()
    worker.selector.select.return_value = [
        HighlightClip(start_seconds=start, end_seconds=start + 40, hook_title="A video")
        for start in [50, 150, 230]
    ]
    subtitle = TemplateSubtitleLayer(
        visible=enabled, variant="pop", y=300, max_width=760, font_size=48,
        font_id="pretendard", color="#F3F0E9", accent_color="#FFD84D",
    )
    monkeypatch.setattr(pipeline, "_unified_template_subtitle", lambda _: subtitle)
    compiler = MagicMock(wraps=pipeline.compile_caption_render_spec)
    monkeypatch.setattr(pipeline, "compile_caption_render_spec", compiler)
    translated = "こんにちは。" if language == "ja" else "Hello."
    monkeypatch.setattr(
        SubtitleTranslator,
        "_request",
        lambda self, texts, *_: {
            "segments": [
                {"id": i, "text": "한국어" if text == "오류" else translated}
                for i, text in texts.items()
            ],
        },
    )
    worker.renderer = MagicMock()
    worker.storage = MagicMock()
    worker.storage.upload.return_value = 100
    worker.repository.add_pending_short.return_value = True
    worker._render_project_outputs = MagicMock(return_value={"succeededCount": 3})
    worker._capture_project_timelines = MagicMock(return_value={"succeededCount": 3})
    worker.project("job")
    worker.repository.fail_open_project_attempts.assert_not_called()
    worker.repository.finalize_project_job.assert_called_once_with("job")
    stored = {
        c.kwargs["clip_index"]: c.kwargs for c in worker.repository.add_pending_short.call_args_list
    }
    assert len(stored) == 3
    for index in [2, 3]:
        assert stored[index]["caption_render_spec"]["templateId"] == "basic"
        assert stored[index]["subtitles_enabled"] is enabled
        assert stored[index]["subtitles"]
    # First render and padded editing timeline must use the same chosen style,
    # including when subtitles start hidden but remain available for later edits.
    assert compiler.call_count >= 4
    styles = [{k: v for k, v in call.kwargs.items() if k not in {"clip_start", "clip_end"}}
              for call in compiler.call_args_list]
    assert all(style == styles[0] for style in styles)
    assert styles[0]["font_id"] == ("noto-sans-jp" if language == "ja" else "pretendard")
    assert styles[0]["caption_center_y"] == 300
    assert styles[0]["text_color"] == "#F3F0E9"
    first = stored[1]
    outcome = first["job"]["subtitle_template_snapshot"]["translationOutcome"]
    if bad_start == 50:
        assert outcome["status"] == "unavailable"
        assert first["subtitles_enabled"] is False
        assert first["subtitles"] == []
        assert first["caption_render_spec"] is None
        assert first["job"]["subtitle_template_id"] is None
    else:
        assert outcome == {
            "policy": "translated-basic-v1",
            "status": "ready",
            "contextLimited": True,
        }
        assert first["subtitles_enabled"] is enabled
    target = next(
        t
        for t in worker._capture_project_timelines.call_args.kwargs["targets"]
        if t.slot_index == 1
    )
    assert (target.clip.start_seconds, target.clip.end_seconds) == (50, 90)
    assert all(
        "한국어" not in str(c.kwargs["subtitles"])
        for c in worker.repository.add_pending_short.call_args_list
    )
