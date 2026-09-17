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


def setup_worker(tmp_path, monkeypatch, *, language, enabled=True, money=False, bad_start=-1):
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
    if money:
        worker.repository.get_job.return_value["performance_metrics"] = {
            "currencyLocalization": {"historical": True},
        }
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
        SubtitleSegment(start=i, end=i + 8, text=(
            "오류" if i == bad_start else "가격은 170만 원입니다." if money else "안녕"
        ))
        for i in range(0, 300, 10)
    ]

    def transcribe(**kwargs):
        kwargs["observation"]["languageCode"] = "kor"
        if kwargs["words_out"] is not None:
            kwargs["words_out"].extend(
                TranscriptWord(s.text, s.start, s.end, "test") for s in segments
            )
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
    worker.renderer = MagicMock()
    worker.storage = MagicMock()
    worker.storage.upload.return_value = 100
    worker.repository.add_pending_short.return_value = True
    worker._render_project_outputs = MagicMock(return_value={"succeededCount": 3})
    worker._capture_project_timelines = MagicMock(return_value={"succeededCount": 3})
    return worker, segments, compiler


@pytest.mark.parametrize("bad_start", [50, 20])
@pytest.mark.parametrize("language,enabled", [("en", True), ("ja", True), ("en", False)])
@pytest.mark.parametrize("money", [False, True])
def test_project_translation_failure_isolated_from_other_outputs(
    tmp_path, monkeypatch, bad_start, language, enabled, money,
):
    worker, segments, compiler = setup_worker(
        tmp_path, monkeypatch, language=language, enabled=enabled, money=money, bad_start=bad_start,
    )
    translated = "こんにちは。" if language == "ja" else "Hello."
    if money:
        translated = "価格は17万円です。" if language == "ja" else "It costs $1,133.33."
    def request(self, texts, *_):
        return {
            "segments": [
                {"id": i, "text": "" if text == "오류" else translated}
                for i, text in texts.items()
            ],
        }

    monkeypatch.setattr(SubtitleTranslator, "_request", request)
    network = MagicMock(side_effect=AssertionError("generation must not request exchange rates"))
    monkeypatch.setattr("httpx.Client", network)
    worker.project("job")
    network.assert_not_called()
    worker.repository.fail_open_project_attempts.assert_not_called()
    worker.repository.finalize_project_job.assert_called_once_with("job")
    stored = {
        c.kwargs["clip_index"]: c.kwargs for c in worker.repository.add_pending_short.call_args_list
    }
    assert len(stored) == 3
    if money:
        worker.repository.pin_currency_snapshot.assert_not_called()
        assert worker.repository.get_job.return_value["performance_metrics"] == {
            "currencyLocalization": {"historical": True},
        }
        selected_input = worker.selector.select.call_args.kwargs
        assert "currency_converter" not in selected_input
        assert "170만 원" in " ".join(s.text for s in selected_input["transcript"])
        assert "170만 원" in " ".join(s.text for s in segments)
        # The promoted web editor accepts exactly this translation contract.
        assert stored[2]["caption_render_spec"]["translation"] == {
            "policy": "translated-basic-v1", "sourceLanguage": "ko",
            "outputLanguage": language, "requestedTemplateId": "highlight",
        }
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
        assert outcome["status"] == "ready"
        assert outcome["partial"] is True
        assert outcome["contextLimited"] is False
        assert first["subtitles_enabled"] is enabled
        assert first["subtitles"]
        assert first["caption_render_spec"] is not None
        assert first["job"]["subtitle_template_id"] == "highlight"
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
    expected_window = (50, 90) if bad_start == 20 else (20, 120)
    assert (target.clip.start_seconds, target.clip.end_seconds) == expected_window
    assert all(
        "한국어" not in str(c.kwargs["subtitles"])
        for c in worker.repository.add_pending_short.call_args_list
    )


@pytest.mark.parametrize("language,text", [
    ("ko", "이유로 이 십칠엔1 컬러를 골랐어요. 가격은 170만 원입니다."),
    ("ja", "この理由で27N1を選びました。価格は15000円です。"),
    ("en", "I chose shade 27N1 for this reason. It costs 150 dollars."),
])
@pytest.mark.parametrize("auto", [False, True])
@pytest.mark.parametrize("caption_template", [None, "pop"])
def test_same_language_skips_translation_and_currency_and_preserves_source(
    tmp_path, monkeypatch, language, text, auto, caption_template,
):
    worker, segments, _ = setup_worker(tmp_path, monkeypatch, language=language)
    job = worker.repository.get_job.return_value
    job.update(source_language_hint="auto" if auto else language, template_id="comment-capture",
               subtitle_template_id="pop", subtitle_template_snapshot={"subtitleTemplateId": "pop"})
    if caption_template is None:
        job.update(subtitle_template_id=None, subtitle_template_snapshot=None)
        monkeypatch.setattr(pipeline, "_unified_template_subtitle", lambda _: None)
    segments[:] = [s.model_copy(update={"text": text}) for s in segments]
    original = [s.model_dump() for s in segments]
    transcribe = worker._transcribe_source

    def detected(**kwargs):
        result = transcribe(**kwargs)
        kwargs["observation"]["languageCode"] = {"ko": "kor", "ja": "jpn", "en": "eng"}[language]
        return result

    worker._transcribe_source = detected
    worker.comment_generator = MagicMock()
    worker.comment_generator.generate.return_value = {1: [], 2: [], 3: []}
    translate = MagicMock(side_effect=AssertionError("same language must not translate"))
    fetch = MagicMock(side_effect=AssertionError("same language must not request rates"))
    monkeypatch.setattr(SubtitleTranslator, "translate_partial", translate)
    monkeypatch.setattr("httpx.Client", fetch)
    worker.project("job")
    translate.assert_not_called()
    fetch.assert_not_called()
    worker.repository.pin_currency_snapshot.assert_not_called()
    worker.repository.fail_open_project_attempts.assert_not_called()
    worker.repository.finalize_project_job.assert_called_once()
    selected = worker.selector.select.call_args.kwargs
    assert "currency_converter" not in selected
    assert [s.model_dump() for s in selected["transcript"]] == original
    assert [s.model_dump() for s in segments] == original
    worker.comment_generator.generate.assert_called_once()
    assert "currency_converter" not in worker.comment_generator.generate.call_args.kwargs
    stored = [c.kwargs for c in worker.repository.add_pending_short.call_args_list]
    assert len(stored) == 3
    for short in stored:
        assert short["job"]["subtitle_template_snapshot"] == job["subtitle_template_snapshot"]
        if caption_template is None:
            assert short["caption_render_spec"] is None
            assert short["job"]["subtitle_template_id"] is None
        else:
            assert "translation" not in short["caption_render_spec"]
            assert short["caption_render_spec"]["templateId"] == caption_template
            assert short["subtitles_enabled"] is True
        assert all(s["text"] == text for s in short["subtitles"])


def test_caption_layout_failure_keeps_video_and_source_script(tmp_path, monkeypatch):
    from shorts_worker.caption_templates import CaptionCompileError

    worker, _, compiler = setup_worker(tmp_path, monkeypatch, language="ko")
    compiler.side_effect = CaptionCompileError("caption does not fit")
    worker.project("job")
    worker.repository.fail_open_project_attempts.assert_not_called()
    worker.repository.finalize_project_job.assert_called_once()
    stored = [c.kwargs for c in worker.repository.add_pending_short.call_args_list]
    assert len(stored) == 3
    for short in stored:
        assert short["subtitles_enabled"] is False
        assert short["caption_render_spec"] is None
        assert short["subtitles"]


@pytest.mark.parametrize("source_language,output_language", [
    ("ko", "en"), ("ko", "ja"), ("en", "ko"),
    ("en", "ja"), ("ja", "ko"), ("ja", "en"),
])
@pytest.mark.parametrize("ratio", ["16:9", "5:4", "1:1"])
@pytest.mark.parametrize("template_id", [
    "comment-capture", "dark-minimal", "paper", "dark-red", "white-yellow",
])
def test_translated_builtin_preset_keeps_script_without_adding_caption_layer(
    tmp_path, monkeypatch, source_language, output_language, ratio, template_id,
):
    worker, _, compiler = setup_worker(tmp_path, monkeypatch, language=output_language)
    job = worker.repository.get_job.return_value
    job.update(
        source_language_hint=source_language, template_id=template_id,
        subtitle_template_id=None, subtitle_template_snapshot=None,
        template_snapshot={"presetVersion": 3}, video_aspect_ratio=ratio,
    )
    monkeypatch.setattr(pipeline, "_unified_template_subtitle", lambda _: None)
    translated = {"ko": "안녕하세요.", "en": "Hello.", "ja": "こんにちは。"}[output_language]
    request = MagicMock(side_effect=lambda texts, *_: {
        "segments": [{"id": i, "text": translated} for i in texts],
    })
    monkeypatch.setattr(SubtitleTranslator, "_request", request)
    worker.comment_generator = MagicMock()
    comments = [{
        "id": "comment-1", "text": translated, "nickname": "Viewer",
        "initial": "V", "ageLabel": "1 day ago", "likeCount": 20,
        "avatarColor": "#2674C8", "startSeconds": 0, "endSeconds": 40,
    }]
    worker.comment_generator.generate.return_value = {i: comments for i in [1, 2, 3]}

    worker.project("job")

    assert request.called
    compiler.assert_not_called()
    worker.repository.fail_open_project_attempts.assert_not_called()
    worker.repository.finalize_project_job.assert_called_once()
    if template_id == "comment-capture":
        worker.comment_generator.generate.assert_called_once()
        assert all(item.output_language == output_language
                   for item in worker.comment_generator.generate.call_args.args[0])
    else:
        worker.comment_generator.generate.assert_not_called()
    stored = [call.kwargs for call in worker.repository.add_pending_short.call_args_list]
    assert len(stored) == 3
    for short in stored:
        assert short["subtitles"]
        assert all(segment["text"] == translated for segment in short["subtitles"])
        assert short["subtitles_enabled"] is False
        assert short["caption_render_spec"] is None
        assert short["job"]["subtitle_template_id"] is None
        assert short["job"]["template_snapshot"] == {"presetVersion": 3}
        assert short["initial_render_spec"].get("subtitles") is None
        assert short["comment_overlays"] == (comments if template_id == "comment-capture" else [])
        assert "subtitles" not in short["initial_render_spec"]["layerOrder"]
        if template_id == "comment-capture":
            assert short["initial_render_spec"]["layerOrder"] == [
                "video", "title", "comment", "channel",
            ]
        assert short["initial_render_spec"]["channel"]["visible"] is True
    for target in worker._capture_project_timelines.call_args.kwargs["targets"]:
        assert target.caption_editor_source is None
        assert target.subtitles
        assert all(segment.text == translated for segment in target.subtitles)


@pytest.mark.parametrize("language", ["en", "ja"])
@pytest.mark.parametrize("caption_template", ["basic", "pop", "highlight"])
def test_selected_subtitle_template_uses_basic_translation_in_render_and_editor(
    tmp_path, monkeypatch, language, caption_template,
):
    worker, _, compiler = setup_worker(tmp_path, monkeypatch, language=language)
    job = worker.repository.get_job.return_value
    job.update(
        subtitle_template_id=caption_template,
        subtitle_template_snapshot={"subtitleTemplateId": caption_template},
    )
    monkeypatch.setattr(pipeline, "_unified_template_subtitle", lambda _: None)
    translated = "Hello." if language == "en" else "こんにちは。"
    monkeypatch.setattr(SubtitleTranslator, "_request", lambda self, texts, *_: {
        "segments": [{"id": i, "text": translated} for i in texts],
    })

    worker.project("job")

    assert compiler.called
    worker.repository.fail_open_project_attempts.assert_not_called()
    worker.repository.finalize_project_job.assert_called_once()
    stored = [call.kwargs for call in worker.repository.add_pending_short.call_args_list]
    assert len(stored) == 3
    for short in stored:
        assert short["subtitles_enabled"] is True
        assert short["caption_render_spec"]["templateId"] == "basic"
        translation = short["caption_render_spec"]["translation"]
        assert translation["requestedTemplateId"] == caption_template
        assert short["job"]["subtitle_template_id"] == caption_template
    for target in worker._capture_project_timelines.call_args.kwargs["targets"]:
        assert target.caption_editor_source["spec"]["templateId"] == "basic"
