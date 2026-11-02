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
