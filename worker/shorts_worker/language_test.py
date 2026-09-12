from __future__ import annotations

import os
from typing import Any

from .errors import RenderError


def verify_language_test_job(job: dict[str, Any]) -> None:
    """A dedicated worker may only process its explicitly pinned projects."""
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
