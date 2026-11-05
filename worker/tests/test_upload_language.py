import pytest

from shorts_worker.errors import RenderError
from shorts_worker.upload_language import with_upload_language


def upload(language="ja"):
    return {
        "source_type": "upload", "pipeline_version": 2,
        "initial_render_spec_version": 4, "initial_caption_render_spec_version": 4,
        "initial_editor_release_id": "verified-release", "output_language": language,
        "template_snapshot": {"uploadLanguage": {
            "version": 1, "sourceLanguage": language, "outputLanguage": language,
            "releaseId": "verified-release",
        }},
    }


def test_legacy_job_is_unchanged():
    job = {"source_type": "upload", "output_language": "ko"}
    assert with_upload_language(job, runtime_verified=False) is job


@pytest.mark.parametrize("language", ["ko", "en", "ja"])
def test_verified_context_is_in_memory_only(language):
    job = upload(language)
    result = with_upload_language(job, runtime_verified=True)
    assert result["source_language_hint"] == language
    assert "source_language_hint" not in job
    assert result["template_snapshot"] == job["template_snapshot"]


@pytest.mark.parametrize("changes", [
    {"source_type": "youtube"}, {"language_test_release_id": "test"},
    {"source_language_hint": "ko"}, {"initial_editor_release_id": "other"},
    {"output_language": "en"}, {"initial_render_spec_version": 3},
])
def test_rejects_mismatched_binding(changes):
    with pytest.raises(RenderError):
        with_upload_language({**upload(), **changes}, runtime_verified=True)


@pytest.mark.parametrize("field,value", [
    ("version", 2), ("sourceLanguage", "unknown"), ("sourceLanguage", []),
    ("outputLanguage", "unknown"), ("releaseId", None),
])
def test_rejects_invalid_context(field, value):
    job = upload()
    job["template_snapshot"]["uploadLanguage"][field] = value
    with pytest.raises(RenderError):
        with_upload_language(job, runtime_verified=True)


def test_runtime_identity_required():
    with pytest.raises(RenderError):
        with_upload_language(upload(), runtime_verified=False)
