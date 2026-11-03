"""Private midform routing. Ordinary project/editor routing stays unchanged."""
import copy
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
    r"shorts-mvp-editor-release-(?:language-test-midform-[a-f0-9]{12}|[a-f0-9]{12}-4vcpu):[1-9][0-9]*$"
)
LANGUAGE_SWITCHES = {
    "EASYCUT_LANGUAGE_TEST_WORKER", "EASYCUT_LANGUAGE_TEST_RELEASE_ID",
    "EASYCUT_LANGUAGE_TEST_COMMENT_PROFILE",
}


def _execution_contract(definition):
    """Compare effective settings; the trusted submitter replaces command/timeout."""
    contract = copy.deepcopy(definition)
    for key in ("jobDefinitionArn", "jobDefinitionName", "revision", "status", "tags", "timeout"):
        contract.pop(key, None)
    contract["propagateTags"] = bool(contract.get("propagateTags", False))
    container = contract["containerProperties"]
    container.pop("command", None)
    environment = container.get("environment", [])
    if len({entry["name"] for entry in environment}) != len(environment):
        raise RuntimeError("Duplicate midform target environment")
    container["environment"] = sorted(
        (entry for entry in environment if entry["name"] not in LANGUAGE_SWITCHES),
        key=lambda entry: entry["name"],
    )
    return contract


def initial_render_environment(host, job, *, job_definition, job_queue, resume):
    """Verify a private alias against the registrar's actual immutable target.

    The source/image/font and complete execution configuration must match the
    attested target. Private queue/name aliases do not create attestation rows.
    Language-test switches are explicitly disabled by bind_runtime below.
    """
    if (job.get("initial_render_spec_version") != 4
            or job.get("initial_caption_render_spec_version") != 4):
        raise RuntimeError("Invalid midform render versions")
    release = release_for_job(host, job)
    key = job.get("batch_target_key")
    lane = release["registry"]["lanes"].get(key)
    target = (lane or {}).get("current", {})
    if (target.get("jobDefinitionArn") != job_definition
            or target.get("jobQueueArn") != job_queue
            or job.get("batch_target_release_id") != target.get("releaseId")
            or job.get("batch_job_definition") != job_definition
            or job.get("batch_job_queue") != job_queue):
        raise RuntimeError("Midform immutable target mismatch")
    rows = host.rest("editor_releases", query=(
        "select=id,status,git_sha,worker_image_digest,font_manifest_sha256,"
        "staging_verified_at,render_spec_version,caption_render_spec_version"
        f"&id=eq.{release['id']}&limit=2"
    )) or []
    if len(rows) != 1:
        raise RuntimeError("Midform attested release missing")
    row = rows[0]
    if (row.get("id") != release["id"]
            or row.get("status") not in {"canary_ready", "canary_active", "approved"}
            or not row.get("staging_verified_at")
            or row.get("render_spec_version") != 4
            or row.get("caption_render_spec_version") != 4
            or target.get("workerSourceGitSha") != row.get("git_sha")
            or target.get("imageUri", "").rsplit("@", 1)[-1] != row.get("worker_image_digest")
            or target.get("fontManifestSha256") != row.get("font_manifest_sha256")):
        raise RuntimeError("Midform attested release identity mismatch")
    targets = host.rest("editor_release_project_targets", query=(
        "select=release_id,target_key,batch_target_release_id,worker_source_git_sha,"
        "worker_image_digest,job_definition_arn,job_queue_arn"
        f"&release_id=eq.{release['id']}&target_key=eq.{key}&limit=2"
    )) or []
    if (len(targets) != 1 or targets[0].get("release_id") != row["id"]
            or targets[0].get("target_key") != key
            or targets[0].get("worker_source_git_sha") != row["git_sha"]
            or targets[0].get("worker_image_digest") != row["worker_image_digest"]):
        raise RuntimeError("Midform canonical target evidence missing")
    canonical_arn = targets[0]["job_definition_arn"]
    definitions = host.batch.describe_job_definitions(
        jobDefinitions=list(dict.fromkeys([canonical_arn, job_definition])),
    ).get("jobDefinitions", [])
    by_arn = {definition["jobDefinitionArn"]: definition for definition in definitions}
    if len(by_arn) != len(definitions) or set(by_arn) != {canonical_arn, job_definition}:
        raise RuntimeError("Midform exact AWS definitions unavailable")
    canonical, alias = by_arn[canonical_arn], by_arn[job_definition]
    for definition in (canonical, alias):
        if (definition.get("status") != "ACTIVE"
                or definition["containerProperties"].get("image") != target["imageUri"]):
            raise RuntimeError("Midform AWS target identity mismatch")
    canonical_env = canonical["containerProperties"].get("environment", [])
    if any(entry["name"] in LANGUAGE_SWITCHES and entry.get("value") for entry in canonical_env):
        raise RuntimeError("Midform canonical target enables language-test execution")
    if _execution_contract(canonical) != _execution_contract(alias):
        raise RuntimeError("Midform alias execution contract differs from attested target")
    return [
        {"name": "EDITOR_RELEASE_GIT_SHA", "value": row["git_sha"]},
        {"name": "EDITOR_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_CAPTION_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_FONT_MANIFEST_SHA256", "value": row["font_manifest_sha256"]},
    ]


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


def bind_runtime(request, job):
    """Set private runtime switches from a previously verified DB binding."""
    marker = job.get("midform_release_id")
    if not marker:
        return
    if (marker != job.get("initial_editor_release_id")
            or job.get("midform_request") != {"version": 1, "targetSeconds": 0}):
        raise RuntimeError("Invalid midform runtime binding")
    environment = request["containerOverrides"].setdefault("environment", [])
    if any(item["name"] in {"MIDFORM_ENABLED", "MIDFORM_RELEASE_ID", *LANGUAGE_SWITCHES} for item in environment):
        raise RuntimeError("Duplicate midform runtime switch")
    environment.extend([
        {"name": "MIDFORM_ENABLED", "value": "true"},
        {"name": "MIDFORM_RELEASE_ID", "value": marker},
        # Batch omits empty override values; use an explicit disabled value.
        *({"name": key, "value": "false"} for key in sorted(LANGUAGE_SWITCHES)),
    ])
