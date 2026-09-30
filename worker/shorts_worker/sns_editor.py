"""Explicit SNS editor compatibility; public generation/release routing is unchanged."""

from __future__ import annotations

import os
from typing import Any

from .community_template import COMMUNITY_EDITOR_RELEASE_ID, COMMUNITY_GENERATION_RELEASE_IDS
from .errors import RenderError
from .release_identity import verify_initial_render_v4_runtime
from .schemas import EditorDocument
from .sns_template import validate_copy

SNS_EDITOR_RELEASE_ID = "4fbfeeaa-e210-4143-aece-c17029d962a0"
SNS_GENERATION_RELEASE_IDS = {
    "b871796a-f83a-4aed-8d56-bf039de1cdbf",
    "8dc98fc0-a5bb-411f-9cc6-0e8dc28648ca",
    "8af2c7e6-5421-4e93-9671-b0e8bb41de8a",
}


def validate_sns_editor_document(document: EditorDocument) -> None:
    snapshot = document.template.snapshot or {}
    content = snapshot.get("snsContent") or {}
    if (
        snapshot.get("snsTemplateVersion") != 1
        or snapshot.get("presetVersion") != 4
        or snapshot.get("snsLanguage") not in {"ko", "en", "ja"}
        or document.template.id != "white-yellow"
        or document.template.custom_template_id
        or document.subtitles.enabled
        or document.comments
        or document.overlays.text_overlays
        or content.get("source") != "edited"
        or content.get("title") != document.title.text
    ):
        raise RenderError("SNS 편집 문서가 올바르지 않습니다.")
    if "boardName" in content:
        from .community_copy import validate_board_name
        if snapshot.get("communityTemplateVersion") != 1:
            raise RenderError("게시판 이름은 커뮤니티 템플릿에서만 사용할 수 있습니다.")
        validate_board_name(content["boardName"], snapshot["snsLanguage"])
    validate_copy(
        {key: content.get(key) for key in ("title", "body", "hashtags")},
        "4:5" if snapshot.get("communityTemplateVersion") == 1 else document.video.aspect_ratio,
        snapshot["snsLanguage"],
    )


def verify_sns_editor_binding(item: dict[str, Any], binding: dict[str, Any] | None) -> None:
    community = (item.get("template_snapshot") or {}).get("communityTemplateVersion") == 1
    editor_id = COMMUNITY_EDITOR_RELEASE_ID if community else SNS_EDITOR_RELEASE_ID
    generation_ids = COMMUNITY_GENERATION_RELEASE_IDS if community else SNS_GENERATION_RELEASE_IDS
    generation_id = item.get("language_test_release_id")
    details = (binding or {}).get("details") or {}
    if (
        not binding
        or generation_id not in generation_ids
        or os.environ.get("EASYCUT_SNS_EDITOR_RELEASE_ID") != editor_id
        or str(binding.get("release_id")) != editor_id
        or binding.get("release_channel") != "canary"
        or str(binding.get("request_id")) != str(item.get("pending_edit_request_id"))
        or str(binding.get("language_test_release_id")) != generation_id
        or str(binding.get("initial_editor_release_id")) != generation_id
        or generation_id not in details.get("generationReleaseIds", [])
        or details.get("sourceGitSha") != binding.get("git_sha")
        or details.get("imageDigest") != binding.get("worker_image_digest")
        or details.get("fontManifestSha256") != binding.get("font_manifest_sha256")
    ):
        raise RenderError("SNS 편집 워커와 저장 요청의 릴리스가 일치하지 않습니다.")
    document = EditorDocument.model_validate(item.get("pending_edit_snapshot"))
    if ((document.template.snapshot or {}).get("communityTemplateVersion") == 1) != community:
        raise RenderError("편집 중 템플릿 종류를 변경할 수 없습니다.")
    validate_sns_editor_document(document)
    # Reuse the exact embedded source/ECS digest/font attestation, binding it
    # to this editor request rather than the immutable generation release.
    verify_initial_render_v4_runtime(
        {
            "initial_render_spec_version": binding["render_spec_version"],
            "initial_caption_render_spec_version": binding["caption_render_spec_version"],
            "initial_editor_release_id": binding["release_id"],
            **{
                f"initial_editor_release_{key}": binding[key]
                for key in (
                    "git_sha",
                    "worker_image_digest",
                    "font_manifest_sha256",
                    "render_spec_version",
                    "caption_render_spec_version",
                )
            },
        }
    )
