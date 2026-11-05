from __future__ import annotations

from typing import Any

from .errors import RenderError


def with_upload_language(job: dict[str, Any], *, runtime_verified: bool) -> dict[str, Any]:
    """Project verified upload context into memory; keep YouTube DB binding intact."""
    context = (job.get("template_snapshot") or {}).get("uploadLanguage")
    if context is None:
        return job
    if (
        not isinstance(context, dict)
        or context.get("version") != 1
        or not runtime_verified
        or job.get("source_type") != "upload"
        or job.get("language_test_release_id") is not None
        or job.get("source_language_hint") is not None
        or job.get("pipeline_version") != 2
        or job.get("initial_render_spec_version") != 4
        or job.get("initial_caption_render_spec_version") != 4
        or not context.get("releaseId")
        or str(context["releaseId"]) != str(job.get("initial_editor_release_id"))
        or context.get("sourceLanguage") not in ("auto", "ko", "en", "ja")
        or context.get("outputLanguage") not in ("ko", "en", "ja")
        or context.get("outputLanguage") != job.get("output_language")
    ):
        raise RenderError("업로드 언어 설정과 검증된 워커 연결이 일치하지 않습니다.")
    return {**job, "source_language_hint": context["sourceLanguage"]}
