"""Bounded administrator QA routing using canonical attested definitions."""

import re
from datetime import datetime, timezone

QUEUE = "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-editor-test"
KEYS = {
    "legacy_project",
    "source_range",
    "elevenlabs_transcription",
    "subtitle_templates",
    "unified_template_subtitles",
}
IMAGE_REPOSITORY = (
    "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/"
    "shorts-mvp-editor-releases-production"
)


def _one(host, table, query):
    rows = host.rest(table, query=query) or []
    if len(rows) != 1:
        raise RuntimeError("Silence test binding unavailable")
    return rows[0]


def release_for_job(host, job, *, editing=False):
    marker = str(job.get("silence_test_release_id") or "")
    user = str(job.get("user_id") or "")
    if (
        not re.fullmatch(r"[a-f0-9-]{36}", marker)
        or not re.fullmatch(r"[a-f0-9-]{36}", user)
        or marker != job.get("initial_editor_release_id")
    ):
        raise RuntimeError("Invalid silence test identity")
    account = _one(host, "app_users", f"select=id,is_admin&id=eq.{user}&limit=2")
    if account.get("is_admin") is not True:
        raise RuntimeError("Silence test administrator required")
    private = _one(host, "silence_test_releases", f"select=*&id=eq.{marker}&limit=2")
    if (
        private.get("administrator_id") != user
        or not private.get("verified_at")
        or private.get("job_queue_arn") != QUEUE
    ):
        raise RuntimeError("Silence test private target unavailable")
    if not editing and (
        private.get("enabled") is not True
        or datetime.fromisoformat(private["expires_at"].replace("Z", "+00:00"))
        <= datetime.now(timezone.utc)
    ):
        raise RuntimeError("Silence test creation window ended")
    state = _one(host, "editor_release_state", "select=*&singleton=eq.true&limit=2")
    lease = state.get("render_v4_infra_lease_expires_at")
    if state.get("render_v4_kill_switch") is not False or (
        state.get("render_v4_infra_lease_id")
        and lease
        and datetime.fromisoformat(lease.replace("Z", "+00:00"))
        > datetime.now(timezone.utc)
    ):
        raise RuntimeError("Silence test rendering stopped")
    for flag in ("editor_rendering_v2", "admin_shorts_silence"):
        if (
            _one(
                host,
                "runtime_feature_flags",
                f"select=enabled&flag_key=eq.{flag}&limit=2",
            ).get("enabled")
            is not True
        ):
            raise RuntimeError("Silence test rendering disabled")
    release = _one(host, "editor_releases", f"select=*&id=eq.{marker}&limit=2")
    if (
        release.get("status") not in {"canary_ready", "canary_active", "approved"}
        or not release.get("staging_verified_at")
        or release.get("render_spec_version") != 4
        or release.get("caption_render_spec_version") != 4
    ):
        raise RuntimeError("Silence test release not verified")
    targets = (
        host.rest(
            "editor_release_project_targets",
            query=f"select=*&release_id=eq.{marker}&limit=6",
        )
        or []
    )
    if len(targets) != 5 or {t.get("target_key") for t in targets} != KEYS:
        raise RuntimeError("Silence test attestation incomplete")
    lanes = {}
    for t in targets:
        if (
            t.get("worker_source_git_sha") != release.get("git_sha")
            or t.get("worker_image_digest") != release.get("worker_image_digest")
            or not re.fullmatch(
                r"arn:aws:batch:ap-northeast-2:181651591905:job-definition/"
                r"shorts-mvp-editor-v4-[a-z0-9-]+:[1-9][0-9]*",
                str(t.get("job_definition_arn") or ""),
            )
        ):
            raise RuntimeError("Silence test target provenance mismatch")
        lanes[t["target_key"]] = {
            "previous": None,
            "schedulingMode": "fifo",
            "current": {
                "releaseId": t["batch_target_release_id"],
                "workerSourceGitSha": release["git_sha"],
                "imageUri": IMAGE_REPOSITORY + "@" + release["worker_image_digest"],
                "jobDefinitionArn": t["job_definition_arn"],
                "jobQueueArn": QUEUE,
                "renderSpecVersion": 4,
                "captionRenderSpecVersion": 4,
                "fontManifestSha256": release["font_manifest_sha256"],
            },
        }
    registry = {"version": 1, "environment": "production", "lanes": lanes}
    return {"id": marker, "registry": registry, "release": release}


def initial_render_environment(host, job, *, job_definition, job_queue, resume):
    result = release_for_job(host, job)
    target = (
        result["registry"]["lanes"].get(job.get("batch_target_key"), {}).get("current")
    )
    if (
        not target
        or job_definition != target["jobDefinitionArn"]
        or job_queue != QUEUE
        or job.get("batch_job_definition") != job_definition
        or job.get("batch_job_queue") != QUEUE
        or job.get("batch_target_release_id") != target["releaseId"]
        or job.get("initial_render_spec_version") != 4
        or job.get("initial_caption_render_spec_version") != 4
    ):
        raise RuntimeError("Silence test immutable target mismatch")
    # No alias or revision lookup: this is the exact immutable definition from
    # the registrar's attestation. Activation separately verifies AWS evidence;
    # the submitter needs no new cloud permissions or mutable-name resolution.
    release = result["release"]
    return [
        {"name": "EDITOR_RELEASE_GIT_SHA", "value": release["git_sha"]},
        {"name": "EDITOR_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_CAPTION_RENDER_SPEC_VERSION", "value": "4"},
        {
            "name": "EDITOR_FONT_MANIFEST_SHA256",
            "value": release["font_manifest_sha256"],
        },
    ]


def editor_target(host, request_id, job):
    result = release_for_job(host, job, editing=True)
    if not re.fullmatch(r"[a-f0-9-]{36}", str(request_id or "")):
        raise RuntimeError("Silence test editor request invalid")
    request = _one(
        host,
        "editor_render_requests",
        f"select=release_id,release_channel,user_id&id=eq.{request_id}&limit=2",
    )
    if (
        request.get("release_id") != result["id"]
        or request.get("release_channel") != "canary"
        or request.get("user_id") != job.get("user_id")
    ):
        raise RuntimeError("Silence test editor owner mismatch")
    release = result["release"]
    definition = str(release.get("production_job_definition_arn") or "")
    if not re.fullmatch(
        r"arn:aws:batch:ap-northeast-2:181651591905:job-definition/"
        r"shorts-mvp-editor-release-[a-f0-9]{12}-4vcpu:[1-9][0-9]*",
        definition,
    ):
        raise RuntimeError("Silence test editor target invalid")
    return QUEUE, definition, release["worker_image_digest"], result["id"]
