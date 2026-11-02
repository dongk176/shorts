"""Private midform routing. Ordinary project/editor routing stays unchanged."""
import re
import urllib.parse

QUEUE = re.compile(
    r"^arn:aws:batch:ap-northeast-2:181651591905:job-queue/"
    r"shorts-mvp-language-test-[a-z0-9-]+$"
)
DEFINITION = re.compile(
    r"^arn:aws:batch:ap-northeast-2:181651591905:job-definition/"
    r"shorts-mvp-language-test-[a-z0-9-]+:[1-9][0-9]*$"
)
EDITOR = re.compile(
    r"^arn:aws:batch:ap-northeast-2:181651591905:job-definition/"
    r"shorts-mvp-editor-release-language-test-midform-[a-f0-9]{12}:[1-9][0-9]*$"
)


def release_for_job(host, job):
    marker = str(job.get("midform_release_id") or "")
    if (not re.fullmatch(r"[a-f0-9-]{36}", marker)
            or marker != str(job.get("initial_editor_release_id"))
            or job.get("midform_request") != {"version": 1, "targetSeconds": 0}):
        raise RuntimeError("Invalid midform release binding")
    user = urllib.parse.quote(str(job.get("user_id") or ""), safe="")
    users = host.rest("app_users", query=f"select=id,is_admin&id=eq.{user}&limit=1") or []
    if not users or users[0].get("is_admin") is not True:
        raise RuntimeError("Midform administrator required")
    rows = host.rest("midform_releases", query=(
        "select=id,registry,editor_job_queue_arn,verified_at"
        f"&id=eq.{marker}&limit=1"
    )) or []
    if (not rows or not rows[0].get("verified_at")
            or not QUEUE.fullmatch(str(rows[0].get("editor_job_queue_arn")))):
        raise RuntimeError("Midform release is not verified")
    release = rows[0]
    registry = host._validate_project_target_registry(release["registry"])
    for lane in registry["lanes"].values():
        target = lane["current"]
        if (lane.get("previous") is not None or lane.get("schedulingMode") != "fifo"
                or not str(target["releaseId"]).startswith("midform-")
                or not QUEUE.fullmatch(target["jobQueueArn"])
                or not DEFINITION.fullmatch(target["jobDefinitionArn"])):
            raise RuntimeError("Midform target is not isolated")
    return release


def editor_target(host, request_id, job):
    release = release_for_job(host, job)
    request = urllib.parse.quote(str(request_id or ""), safe="")
    requests = host.rest("editor_render_requests", query=(
        "select=release_id,release_channel,user_id"
        f"&id=eq.{request}&limit=1"
    )) or []
    if (not requests or requests[0].get("release_id") != release["id"]
            or requests[0].get("release_channel") != "canary"
            or requests[0].get("user_id") != job.get("user_id")):
        raise RuntimeError("Midform editor request mismatch")
    rows = host.rest("editor_releases", query=(
        "select=id,git_sha,worker_image_digest,font_manifest_sha256,status,staging_verified_at,"
        "production_job_definition_arn,render_spec_version,caption_render_spec_version"
        f"&id=eq.{release['id']}&limit=1"
    )) or []
    row = rows[0] if rows else {}
    definition = str(row.get("production_job_definition_arn") or "")
    if (not EDITOR.fullmatch(definition) or not row.get("staging_verified_at")
            or row.get("status") not in {"canary_ready", "canary_active", "approved"}
            or row.get("render_spec_version") != 4 or row.get("caption_render_spec_version") != 4):
        raise RuntimeError("Midform editor release unavailable")
    for lane in release["registry"]["lanes"].values():
        target = lane["current"]
        if (target["workerSourceGitSha"] != row.get("git_sha")
                or target["imageUri"].split("@")[-1] != row.get("worker_image_digest")
                or target["fontManifestSha256"] != row.get("font_manifest_sha256")):
            raise RuntimeError("Midform editor provenance mismatch")
    return release["editor_job_queue_arn"], definition, row["worker_image_digest"], row["id"]
