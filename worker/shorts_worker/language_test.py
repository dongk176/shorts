from __future__ import annotations

import os
from typing import Any

from .errors import RenderError


def verify_language_test_job(job: dict[str, Any]) -> None:
    """A dedicated worker may only process its explicitly pinned projects."""
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
