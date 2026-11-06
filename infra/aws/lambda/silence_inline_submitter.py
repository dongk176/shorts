"""Owner-bound parallel routing; never modifies the stable target registry."""

import os
import re

UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
KEYS = {
    "legacy_project",
    "source_range",
    "elevenlabs_transcription",
    "subtitle_templates",
    "unified_template_subtitles",
}
PREFIX = "arn:aws:batch:ap-northeast-2:181651591905:"


def release_for_job(host, job):
    marker = str(job.get("silence_inline_release_id") or "")
    if not UUID.fullmatch(marker) or marker != job.get("initial_editor_release_id"):
        raise RuntimeError("Invalid parallel silence release")
    if not UUID.fullmatch(str(job.get("id") or "")):
        raise RuntimeError("Invalid parallel silence job")
    # The database rechecks the immutable stored job and registered proof. The
    # current rollout percentage is deliberately not consulted for queued work.
    result = host.rest(
        "rpc/shorts_silence_route_for_job", method="POST", body={"p_job_id": job["id"]}
    )
    if (
        not isinstance(result, dict)
        or result.get("id") != marker
        or result.get("userId") != job.get("user_id")
    ):
        raise RuntimeError("Parallel silence owner or release mismatch")
    registry = result.get("registry") or {}
    lanes = registry.get("lanes") or {}
    release = result.get("release") or {}
    if (
        registry.get("version") != 1
        or registry.get("environment") != "production"
        or set(lanes) != KEYS
    ):
        raise RuntimeError("Incomplete parallel silence registry")
    for key, lane in lanes.items():
        t = lane.get("current") or {}
        queue = str(t.get("jobQueueArn") or "")
        if (
            lane.get("previous") is not None
            or lane.get("schedulingMode")
            != ("fifo" if key == "unified_template_subtitles" else "fair_share")
            or t.get("workerSourceGitSha") != release.get("git_sha")
            or not re.fullmatch(r"[a-f0-9]{40}", str(release.get("git_sha") or ""))
            or not re.fullmatch(
                r"sha256:[a-f0-9]{64}", str(release.get("worker_image_digest") or "")
            )
            or t.get("imageUri")
            != (
                "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/"
                "shorts-mvp-editor-releases-production@"
            )
            + release["worker_image_digest"]
            or t.get("renderSpecVersion") != 4
            or t.get("captionRenderSpecVersion") != 4
            or t.get("fontManifestSha256") != release.get("font_manifest_sha256")
            or not re.fullmatch(r"[a-f0-9]{64}", str(release.get("font_manifest_sha256") or ""))
            or not re.fullmatch(
                PREFIX + r"job-definition/shorts-mvp-editor-v4-[a-z0-9-]+:[1-9][0-9]*",
                str(t.get("jobDefinitionArn") or ""),
            )
            or not re.fullmatch(PREFIX + r"job-queue/shorts-mvp-[a-z0-9-]+", queue)
            or queue.endswith("shorts-mvp-editor-test")
        ):
            raise RuntimeError("Parallel silence target proof mismatch")
    return result


def initial_render_environment(host, job, *, job_definition, job_queue, resume):
    result = release_for_job(host, job)
    target = result["registry"]["lanes"].get(job.get("batch_target_key"), {}).get("current")
    if (
        not target
        or job_definition != target["jobDefinitionArn"]
        or job_queue != target["jobQueueArn"]
        or job.get("batch_job_definition") != job_definition
        or job.get("batch_job_queue") != job_queue
        or job.get("batch_target_release_id") != target["releaseId"]
        or job.get("initial_render_spec_version") != 4
        or job.get("initial_caption_render_spec_version") != 4
    ):
        raise RuntimeError("Parallel silence immutable target mismatch")
    release = result["release"]
    return [
        {"name": "SHORTS_SILENCE_INLINE_ENABLED", "value": "true"},
        {"name": "SHORTS_SILENCE_INLINE_RELEASE_ID", "value": result["id"]},
        {"name": "EDITOR_RELEASE_GIT_SHA", "value": release["git_sha"]},
        {"name": "EDITOR_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_CAPTION_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_FONT_MANIFEST_SHA256", "value": release["font_manifest_sha256"]},
    ]


def editor_target(host, job, request_id):
    result = release_for_job(host, job)
    if not UUID.fullmatch(str(request_id or "")):
        raise RuntimeError("Parallel silence pinned edit request required")
    rows = (
        host.rest(
            "editor_render_requests",
            query=f"select=release_id,release_channel,user_id&id=eq.{request_id}&limit=2",
        )
        or []
    )
    if (
        len(rows) != 1
        or rows[0].get("release_id") != result["id"]
        or rows[0].get("release_channel") != "canary"
        or rows[0].get("user_id") != job.get("user_id")
    ):
        raise RuntimeError("Parallel silence editor owner mismatch")
    definition = str(result["release"].get("production_job_definition_arn") or "")
    if not re.fullmatch(
        PREFIX + r"job-definition/shorts-mvp-editor-release-[a-f0-9]{12}-4vcpu:[1-9][0-9]*",
        definition,
    ):
        raise RuntimeError("Parallel silence editor definition invalid")
    queue = os.environ.get("EDITOR_STABLE_BATCH_QUEUE") or os.environ.get("PROJECT_BATCH_QUEUE", "")
    if not re.fullmatch(PREFIX + r"job-queue/shorts-mvp-[a-z0-9-]+", queue) or queue.endswith(
        "shorts-mvp-editor-test"
    ):
        raise RuntimeError("Parallel silence production editor queue required")
    return queue, definition, result["release"]["worker_image_digest"], result["id"]
