"""Exact compatibility for the already registered Japanese editor revision."""

JAPANESE_EDITOR_IDENTITY = {
    "id": "3c559307-a495-4082-9ac8-d5d9147452b9",
    "git_sha": "4b6dd0078e5cfb32da77bab53466c31cf451d4a5",
    "worker_image_digest": "sha256:db1544afdf211b0bb7ccaf0c4afd30f4c43290aaa9e2d28fa6b7da4e6908a5d7",
    "font_manifest_sha256": "1da578de91943f1299bb48e33649264dc748f89356879702817ceab38668beff",
    "production_job_definition_arn": "arn:aws:batch:ap-northeast-2:181651591905:job-definition/shorts-mvp-editor-release-ja-language-4b6dd0078e5c:3",
    "render_spec_version": 4,
    "caption_render_spec_version": 4,
}


def is_registered_japanese_editor(release: dict) -> bool:
    return (
        all(release.get(key) == value for key, value in JAPANESE_EDITOR_IDENTITY.items())
        and release.get("status") in {"canary_ready", "canary_active", "approved"}
        and bool(release.get("staging_verified_at"))
    )
