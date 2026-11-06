from __future__ import annotations

import os
from typing import Any

from .errors import RenderError


def verify_language_test_job(job: dict[str, Any]) -> None:
    """A dedicated worker may only process its explicitly pinned projects."""
    if job.get("midform_request") is not None:
        marker = job.get("midform_release_id")
        if (os.getenv("MIDFORM_ENABLED") != "true" or not marker
                or str(marker) != os.getenv("MIDFORM_RELEASE_ID")
                or marker != job.get("initial_editor_release_id")
                or job.get("source_type", "youtube") not in {"youtube", "upload"}
                or job.get("pipeline_version") != 2
                or job.get("initial_render_spec_version") != 4
                or job.get("initial_caption_render_spec_version") != 4):
            raise RenderError("중폼 프로젝트와 워커 연결이 일치하지 않습니다.")
        return
    inline = job.get("silence_inline_release_id")
    if inline:
        upload = job.get("source_type") == "upload"
        upload_context = (job.get("template_snapshot") or {}).get("uploadLanguage") or {}
        language_bound = (
            isinstance(upload_context, dict)
            and upload_context.get("version") == 1
            and str(upload_context.get("releaseId")) == str(inline)
            and upload_context.get("outputLanguage") == job.get("output_language")
            and upload_context.get("sourceLanguage") in {"auto", "ko", "en", "ja"}
            and job.get("source_language_hint") in {None, upload_context.get("sourceLanguage")}
        ) if upload else job.get("source_language_hint") in {"auto", "ko", "en", "ja"}
        # Set by the pinned production submitter, never by a client option.
        # Runtime source/image/font verification follows this admission check.
        if (os.getenv("SHORTS_SILENCE_INLINE_ENABLED") != "true"
                or str(inline) != os.getenv("SHORTS_SILENCE_INLINE_RELEASE_ID")
                or inline != job.get("initial_editor_release_id")
                or job.get("language_test_release_id") is not None
                or job.get("silence_test_release_id") is not None
                or job.get("source_type") not in {"youtube", "upload"}
                or job.get("output_language") not in {"ko", "en", "ja"}
                or not language_bound
                or job.get("pipeline_version") != 2
                or job.get("initial_render_spec_version") != 4
                or job.get("initial_caption_render_spec_version") != 4
                or (job.get("template_snapshot") or {}).get("shortsSilenceRemoval")
                != {"version": 1, "preset": "aggressive"}):
            raise RenderError("무음 편집 프로젝트와 워커 연결이 일치하지 않습니다.")
        return
    private = job.get("silence_test_release_id")
    if private:
        # This opt-in is supplied only by the owner-bound, bounded QA submitter.
        # The caller also verifies the running image against the immutable release.
        if (os.getenv("SHORTS_SILENCE_INLINE_ADMIN_ENABLED") != "true"
                or str(private) != os.getenv("EASYCUT_SILENCE_TEST_RELEASE_ID")
                or private != job.get("initial_editor_release_id")
                or job.get("language_test_release_id") is not None
                or job.get("source_type", "youtube") != "youtube"
                or job.get("output_language") not in {"ko", "en", "ja"}
                or job.get("source_language_hint") not in {None, "auto", "ko", "en", "ja"}
                or job.get("pipeline_version") != 2
                or job.get("initial_render_spec_version") != 4
                or job.get("initial_caption_render_spec_version") != 4):
            raise RenderError("무음 검증 프로젝트와 워커 연결이 일치하지 않습니다.")
        return
    from .sns_template import sns_snapshot
    sns = sns_snapshot(job) is not None
    sns_worker = os.environ.get("EASYCUT_SNS_TEMPLATE_WORKER") == "true"
    if sns != sns_worker:
        raise RenderError("SNS 템플릿 전용 워커 연결이 일치하지 않습니다.")
    community = (job.get("template_snapshot") or {}).get("communityTemplateVersion") == 1
    if community != (os.environ.get("EASYCUT_COMMUNITY_TEMPLATE_WORKER") == "true"):
        raise RenderError("커뮤니티 템플릿 전용 워커 연결이 일치하지 않습니다.")
    marker = job.get("language_test_release_id")
    enabled = os.environ.get("EASYCUT_LANGUAGE_TEST_WORKER") == "true"
    if marker is None and not enabled:
        return
    if (
        not enabled
        or marker is None
        or str(marker) != os.environ.get("EASYCUT_LANGUAGE_TEST_RELEASE_ID")
        or str(marker) != str(job.get("initial_editor_release_id"))
        or job.get("source_language_hint") not in {"auto", "ko", "en", "ja"}
        or job.get("output_language") not in {"ko", "en", "ja"}
        or job.get("source_type", "youtube") != "youtube"
        or job.get("pipeline_version") != 2
        or job.get("initial_render_spec_version") != 4
        or job.get("initial_caption_render_spec_version") != 4
    ):
        raise RenderError("언어 테스트 프로젝트와 워커 연결이 일치하지 않습니다.")
