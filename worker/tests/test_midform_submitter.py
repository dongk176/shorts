import ast
import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

spec = importlib.util.spec_from_file_location(
    "midform_submitter", Path(__file__).parents[2] / "infra/aws/lambda/midform_submitter.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
RID = "11111111-1111-4111-8111-111111111111"
SHA = "a" * 40
DIGEST = "sha256:" + "b" * 64
QUEUE = "arn:aws:batch:ap-northeast-2:181651591905:job-queue/shorts-mvp-language-test-production"
TARGET = {
    "releaseId": "midform-test", "workerSourceGitSha": SHA,
    "imageUri": "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/test@" + DIGEST,
    "fontManifestSha256": "c" * 64, "jobQueueArn": QUEUE,
    "jobDefinitionArn": QUEUE.replace("job-queue/", "job-definition/") + ":1",
}


def fixture():
    job = {"user_id": "owner", "midform_release_id": RID, "initial_editor_release_id": RID,
           "midform_request": {"version": 1, "targetSeconds": 0}}
    records = {
        "app_users": [{"id": "owner", "is_admin": True}],
        "midform_releases": [{"id": RID, "verified_at": "verified",
                              "editor_job_queue_arn": QUEUE,
                              "registry": {"lanes": {"legacy_project": {
                                  "current": copy.deepcopy(TARGET), "previous": None,
                                  "schedulingMode": "fifo"}}}}],
        "editor_render_requests": [{"release_id": RID, "release_channel": "canary",
                                    "user_id": "owner"}],
        "editor_releases": [{"id": RID, "git_sha": SHA, "worker_image_digest": DIGEST,
                             "font_manifest_sha256": "c" * 64, "status": "canary_ready",
                             "staging_verified_at": "verified", "render_spec_version": 4,
                             "caption_render_spec_version": 4,
                             "production_job_definition_arn": (
                                 "arn:aws:batch:ap-northeast-2:181651591905:job-definition/"
                                 "shorts-mvp-editor-release-language-test-midform-aaaaaaaaaaaa:1"
                             )}],
    }
    host = SimpleNamespace(rest=lambda table, **_: records[table],
                           _validate_project_target_registry=lambda value: value)
    return host, job, records


def test_exact_admin_release_routes_to_pinned_editor():
    host, job, _ = fixture()
    result = module.editor_target(host, "request", job)
    assert result[0] == QUEUE
    assert result[2:] == (DIGEST, RID)


@pytest.mark.parametrize("change", ["revoked", "missing_user", "unverified", "wrong_binding",
                                    "fixed_length", "public_queue", "foreign_request",
                                    "unverified_editor", "wrong_image", "wrong_source"])
def test_invalid_admission_never_returns_an_editor_target(change):
    host, job, records = fixture()
    if change == "revoked":
        records["app_users"][0]["is_admin"] = False
    elif change == "missing_user":
        records["app_users"] = []
    elif change == "unverified":
        records["midform_releases"][0]["verified_at"] = None
    elif change == "wrong_binding":
        job["initial_editor_release_id"] = "other"
    elif change == "fixed_length":
        job["midform_request"]["targetSeconds"] = 120
    elif change == "public_queue":
        records["midform_releases"][0]["editor_job_queue_arn"] = QUEUE.replace(
            "language-test", "production"
        )
    elif change == "foreign_request":
        records["editor_render_requests"][0]["user_id"] = "stranger"
    elif change == "unverified_editor":
        records["editor_releases"][0]["staging_verified_at"] = None
    elif change == "wrong_image":
        records["editor_releases"][0]["worker_image_digest"] = "sha256:" + "d" * 64
    elif change == "wrong_source":
        records["editor_releases"][0]["git_sha"] = "d" * 40
    with pytest.raises(RuntimeError):
        module.editor_target(host, "request", job)


def test_runtime_switches_only_come_from_a_verified_midform_binding():
    request = {"containerOverrides": {"environment": [{"name": "EXISTING", "value": "kept"}]}}
    unchanged = copy.deepcopy(request)
    module.bind_runtime(request, {"user_id": "ordinary"})
    assert request == unchanged
    _, job, _ = fixture()
    module.bind_runtime(request, job)
    assert request["containerOverrides"]["environment"] == [
        {"name": "EXISTING", "value": "kept"},
        {"name": "MIDFORM_ENABLED", "value": "true"},
        {"name": "MIDFORM_RELEASE_ID", "value": RID},
        *({"name": key, "value": "false"} for key in sorted(module.LANGUAGE_SWITCHES)),
    ]
    with pytest.raises(RuntimeError, match="Duplicate"):
        module.bind_runtime(request, job)


def test_attested_standard_editor_definition_is_supported():
    host, job, records = fixture()
    records["editor_releases"][0]["production_job_definition_arn"] = (
        "arn:aws:batch:ap-northeast-2:181651591905:job-definition/"
        "shorts-mvp-editor-release-aaaaaaaaaaaa-4vcpu:1"
    )
    assert module.editor_target(host, "request", job)[3] == RID


def initial_fixture():
    host, job, records = fixture()
    job.update(id="job", batch_target_key="legacy_project",
               batch_target_release_id=TARGET["releaseId"],
               batch_job_definition=TARGET["jobDefinitionArn"], batch_job_queue=QUEUE,
               initial_render_spec_version=4, initial_caption_render_spec_version=4)
    canonical_arn = (
        "arn:aws:batch:ap-northeast-2:181651591905:job-definition/"
        "shorts-mvp-editor-v4-legacy-project-aaaaaaaaaaaa:1"
    )
    records["editor_release_project_targets"] = [{
        "release_id": RID, "target_key": "legacy_project",
        "worker_source_git_sha": SHA, "worker_image_digest": DIGEST,
        "job_definition_arn": canonical_arn,
    }]
    canonical = {
        "jobDefinitionArn": canonical_arn, "jobDefinitionName": "canonical", "revision": 1,
        "status": "ACTIVE", "type": "container", "platformCapabilities": ["FARGATE"],
        "containerProperties": {
            "image": TARGET["imageUri"], "command": ["python", "-m", "shorts_worker"],
            "jobRoleArn": "arn:aws:iam::181651591905:role/existing-worker",
            "environment": [{"name": "UNCHANGED", "value": "yes"}],
            "secrets": [{"name": "DATABASE_URL", "valueFrom": "existing-secret-reference"}],
            "resourceRequirements": [{"type": "VCPU", "value": "8"}],
        },
    }
    alias = copy.deepcopy(canonical)
    alias.update(jobDefinitionArn=TARGET["jobDefinitionArn"], jobDefinitionName="private",
                 timeout={"attemptDurationSeconds": 18000}, propagateTags=False)
    alias["containerProperties"]["command"].append("project")
    alias["containerProperties"]["environment"].extend(
        {"name": key, "value": "true"} for key in module.LANGUAGE_SWITCHES
    )
    definitions = [canonical, alias]
    host.batch = SimpleNamespace(
        describe_job_definitions=lambda **_: {"jobDefinitions": definitions},
    )
    return host, job, records, definitions


def initial_call(host, job):
    return module.initial_render_environment(
        host, job, job_definition=job["batch_job_definition"],
        job_queue=job["batch_job_queue"], resume=False,
    )


def test_private_target_requires_actual_aws_equivalence_to_immutable_attestation():
    host, job, _, _ = initial_fixture()
    assert initial_call(host, job) == [
        {"name": "EDITOR_RELEASE_GIT_SHA", "value": SHA},
        {"name": "EDITOR_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_CAPTION_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_FONT_MANIFEST_SHA256", "value": "c" * 64},
    ]


@pytest.mark.parametrize("change", ["role", "secret", "resource", "environment", "image",
                                    "inactive", "missing_definition", "missing_attestation",
                                    "wrong_source", "wrong_release", "wrong_binding", "revoked"])
def test_private_target_execution_drift_fails_closed(change):
    host, job, records, definitions = initial_fixture()
    container = definitions[1]["containerProperties"]
    if change == "role":
        container["jobRoleArn"] = "other-role"
    elif change == "secret":
        container["secrets"][0]["valueFrom"] = "other-secret-reference"
    elif change == "resource":
        container["resourceRequirements"][0]["value"] = "16"
    elif change == "environment":
        container["environment"][0]["value"] = "changed"
    elif change == "image":
        container["image"] = "other-image"
    elif change == "inactive":
        definitions[1]["status"] = "INACTIVE"
    elif change == "missing_definition":
        definitions.pop()
    elif change == "missing_attestation":
        records["editor_release_project_targets"] = []
    elif change == "wrong_source":
        records["editor_release_project_targets"][0]["worker_source_git_sha"] = "d" * 40
    elif change == "wrong_release":
        records["editor_releases"][0]["id"] = "other"
    elif change == "wrong_binding":
        job["batch_target_release_id"] = "other"
    elif change == "revoked":
        records["app_users"][0]["is_admin"] = False
    with pytest.raises(RuntimeError):
        initial_call(host, job)


def test_initial_render_overlay_preserves_every_ordinary_statement():
    root = Path(__file__).parents[2]
    overlay_spec = importlib.util.spec_from_file_location(
        "midform_package", root / "scripts/package-midform-submitters.py",
    )
    overlay = importlib.util.module_from_spec(overlay_spec)
    overlay_spec.loader.exec_module(overlay)
    source = (root / "infra/aws/lambda/batch_submitter.py").read_text()
    patched = overlay.overlay_initial_render(source)
    before, after = ast.parse(source), ast.parse(patched)
    original = next(node for node in before.body if isinstance(node, ast.FunctionDef)
                    and node.name == "_initial_render_v4_environment")
    modified = next(node for node in after.body if isinstance(node, ast.FunctionDef)
                    and node.name == original.name)
    assert isinstance(modified.body[0], ast.If)
    assert ast.unparse(modified.body[0].test) == "job.get('midform_release_id')"
    modified.body.pop(0)
    assert ast.dump(before) == ast.dump(after)
