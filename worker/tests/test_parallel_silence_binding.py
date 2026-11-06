from uuid import uuid4

import pytest

from shorts_worker.errors import RenderError
from shorts_worker.language_test import verify_language_test_job


@pytest.fixture
def pinned(monkeypatch):
    release = str(uuid4())
    monkeypatch.setenv("SHORTS_SILENCE_INLINE_ENABLED", "true")
    monkeypatch.setenv("SHORTS_SILENCE_INLINE_RELEASE_ID", release)
    return {
        "silence_inline_release_id": release, "initial_editor_release_id": release,
        "source_type": "youtube", "source_language_hint": "auto", "output_language": "en",
        "pipeline_version": 2, "initial_render_spec_version": 4,
        "initial_caption_render_spec_version": 4,
        "template_snapshot": {"shortsSilenceRemoval": {"version": 1, "preset": "aggressive"}},
    }


@pytest.mark.parametrize("language", ["ko", "en", "ja"])
@pytest.mark.parametrize("kind", ["standard", "custom", "sns", "community"])
def test_parallel_worker_accepts_only_pinned_multilingual_templates(pinned, language, kind):
    pinned["output_language"] = language
    if kind in {"sns", "community"}:
        pinned["template_snapshot"]["snsTemplateVersion"] = 1
    if kind == "community":
        pinned["template_snapshot"]["communityTemplateVersion"] = 1
    if kind == "custom":
        pinned["template_snapshot"]["customTemplateId"] = str(uuid4())
    verify_language_test_job(pinned)


@pytest.mark.parametrize("field,value", [
    ("initial_editor_release_id", "wrong"), ("language_test_release_id", "wrong"),
    ("silence_test_release_id", "wrong"), ("source_type", "upload"),
    ("initial_render_spec_version", 3), ("output_language", "unknown"),
    ("source_language_hint", None), ("template_snapshot", {}),
])
def test_parallel_worker_rejects_mixed_or_unbound_requests(pinned, field, value):
    pinned[field] = value
    with pytest.raises(RenderError):
        verify_language_test_job(pinned)


def test_parallel_marker_requires_explicit_matching_runtime(pinned, monkeypatch):
    monkeypatch.delenv("SHORTS_SILENCE_INLINE_RELEASE_ID")
    with pytest.raises(RenderError):
        verify_language_test_job(pinned)
    monkeypatch.setenv("SHORTS_SILENCE_INLINE_RELEASE_ID", pinned["silence_inline_release_id"])
    monkeypatch.delenv("SHORTS_SILENCE_INLINE_ENABLED")
    with pytest.raises(RenderError):
        verify_language_test_job(pinned)


@pytest.mark.parametrize("language", ["ko", "en", "ja"])
def test_parallel_upload_requires_matching_separate_language_context(pinned, language):
    pinned.update(source_type="upload", source_language_hint=None, output_language=language)
    pinned["template_snapshot"]["uploadLanguage"] = {
        "version": 1, "releaseId": pinned["silence_inline_release_id"],
        "sourceLanguage": "auto", "outputLanguage": language,
    }
    verify_language_test_job(pinned)
    pinned["template_snapshot"]["uploadLanguage"]["releaseId"] = str(uuid4())
    with pytest.raises(RenderError):
        verify_language_test_job(pinned)
