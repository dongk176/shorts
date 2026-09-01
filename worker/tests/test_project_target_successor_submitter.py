from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from test_batch_pipeline_lambdas import _load_lambda

BATCH = "arn:aws:batch:ap-northeast-2:123456789012:"
REPO = "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/shorts"
FONT = "c" * 64
AWS_ID = "55555555-5555-4555-8555-555555555555"
RELEASE = "11111111-1111-4111-8111-111111111111"


@pytest.fixture
def successor_job():
    module, batch = _load_lambda("batch_submitter")

    def target(new):
        sha = ("d" if new else "a") * 40
        return {
            "releaseId": f"legacy-{sha[:12]}-v4",
            "workerSourceGitSha": sha,
            "imageUri": f"{REPO}@sha256:{('e' if new else 'b') * 64}",
            "jobDefinitionArn": BATCH + f"job-definition/legacy-{sha[:12]}:1",
            "jobQueueArn": BATCH + "job-queue/original",
            "renderSpecVersion": 4,
            "captionRenderSpecVersion": 4,
            "fontManifestSha256": FONT,
        }

    old, new = target(False), target(True)
    old["submitAsReleaseId"] = old["releaseId"]
    registry = {"lanes": {"legacy_project": {
        "current": new, "previous": old, "schedulingMode": "fair_share",
    }}}
    module._production_project_target_registry = lambda: registry
    job = {
        "id": "44444444-4444-4444-8444-444444444444",
        "user_id": "33333333-3333-4333-8333-333333333333",
        "pipeline_version": 2,
        "status": "rendering",
        "planned_short_count": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": AWS_ID,
        "batch_target_key": "legacy_project",
        "batch_target_release_id": old["releaseId"],
        "batch_job_definition": old["jobDefinitionArn"],
        "batch_job_queue": old["jobQueueArn"],
        "initial_render_spec_version": 4,
        "initial_caption_render_spec_version": 4,
        "initial_editor_release_id": RELEASE,
    }
    actual = {
        "jobId": AWS_ID, "jobDefinition": old["jobDefinitionArn"],
        "jobQueue": old["jobQueueArn"], "status": "RUNNING",
        "container": {"image": old["imageUri"]},
    }
    batch.describe_jobs.return_value = {"jobs": [actual]}

    def rest(table, **kwargs):
        if table == "video_jobs":
            return [deepcopy(job)]
        if table == "editor_releases":
            return [{
                "id": RELEASE, "status": "stable",
                "git_sha": old["workerSourceGitSha"],
                "worker_image_digest": old["imageUri"].split("@")[1],
                "render_spec_version": 4, "caption_render_spec_version": 4,
                "font_manifest_sha256": FONT,
                "staging_verified_at": "2026-08-30T00:00:00Z",
                "promoted_at": "2026-08-30T00:00:00Z",
            }]
        if table == "editor_release_project_targets":
            return [{
                "release_id": RELEASE, "target_key": "legacy_project",
                "batch_target_release_id": old["releaseId"],
                "worker_source_git_sha": old["workerSourceGitSha"],
                "worker_image_digest": old["imageUri"].split("@")[1],
                "job_definition_arn": old["jobDefinitionArn"],
                "job_queue_arn": old["jobQueueArn"],
            }]
        if table == "rpc/complete_project_batch_submission_target":
            assert kwargs["method"] == "POST"
            return True
        raise AssertionError(f"Unexpected mutation/query: {table}")

    module.rest = MagicMock(side_effect=rest)
    module._submit_once = MagicMock(side_effect=AssertionError("new submission is forbidden"))
    return SimpleNamespace(module=module, batch=batch, job=job, actual=actual, old=old, new=new)


@pytest.mark.parametrize("status", ["rendering", "completed", "failed"])
def test_late_old_initial_duplicate_only_reconciles_its_exact_recorded_aws_job(
    successor_job, status,
):
    f = successor_job
    f.job["status"] = status
    before = deepcopy(f.job)
    assert f.module._submit({"kind": "project", "jobId": f.job["id"]}) == AWS_ID
    assert f.job == before
    f.module._submit_once.assert_not_called()
    f.batch.submit_job.assert_not_called()
    f.batch.list_jobs.assert_not_called()
    writes = [call for call in f.module.rest.call_args_list if call.kwargs.get("method")]
    assert len(writes) == 1
    assert writes[0].args[0] == "rpc/complete_project_batch_submission_target"
    assert writes[0].kwargs["body"] == {
        "p_submission_key": f"project:{f.job['id']}:0",
        "p_aws_batch_job_id": AWS_ID,
        "p_job_definition": f.old["jobDefinitionArn"],
        "p_job_queue": f.old["jobQueueArn"],
        "p_video_job_id": f.job["id"],
        "p_expected_batch_target_key": "legacy_project",
        "p_expected_batch_target_release_id": f.old["releaseId"],
        "p_observed_job_definition": f.old["jobDefinitionArn"],
        "p_observed_job_queue": f.old["jobQueueArn"],
    }
    assert all(call.kwargs == {"jobs": [AWS_ID]} for call in f.batch.describe_jobs.call_args_list)


@pytest.mark.parametrize(
    "field", ["jobId", "jobDefinition", "jobQueue", "image", "missing", "duplicate"],
)
def test_old_duplicate_cannot_reconcile_unproven_aws_identity(successor_job, field):
    f = successor_job
    if field == "image":
        f.actual["container"]["image"] = f.new["imageUri"]
    elif field == "missing":
        f.batch.describe_jobs.return_value = {"jobs": []}
    elif field == "duplicate":
        f.batch.describe_jobs.return_value = {"jobs": [f.actual, f.actual]}
    else:
        f.actual[field] = "different"
    with pytest.raises(f.module.BatchTargetTrustRejected, match="AWS job identity"):
        f.module._submit({"kind": "project", "jobId": f.job["id"]})
    f.module._submit_once.assert_not_called()
    f.batch.submit_job.assert_not_called()
    assert not any(call.kwargs.get("method") for call in f.module.rest.call_args_list)


def test_verified_previous_unsubmitted_initial_claim_is_submitted(successor_job):
    f = successor_job
    f.job.update(aws_batch_job_id=None, status="queued")
    f.module._submit_once = MagicMock(return_value="predecessor-job")

    assert (
        f.module._submit({"kind": "project", "jobId": f.job["id"]})
        == "predecessor-job"
    )
    f.batch.describe_jobs.assert_not_called()
    request, key = f.module._submit_once.call_args.args
    assert request["jobDefinition"] == f.old["jobDefinitionArn"]
    assert request["jobQueue"] == f.old["jobQueueArn"]
    assert key == f"project:{f.job['id']}:0"
    assert not any(call.kwargs.get("method") for call in f.module.rest.call_args_list)


def test_previous_unsubmitted_initial_claim_requires_exact_stable_release(successor_job):
    f = successor_job
    f.job.update(
        aws_batch_job_id=None,
        status="queued",
        initial_editor_release_id="22222222-2222-4222-8222-222222222222",
    )
    with pytest.raises(
        f.module.BatchTargetTrustRejected,
        match="exact stable release binding",
    ):
        f.module._submit({"kind": "project", "jobId": f.job["id"]})
    f.batch.describe_jobs.assert_not_called()
    f.module._submit_once.assert_not_called()
    assert not any(call.kwargs.get("method") for call in f.module.rest.call_args_list)


def test_original_previous_resume_behavior_retains_exact_target(successor_job):
    f = successor_job
    f.job.update(
        aws_batch_job_id=None, project_resume_count=1,
        preparation_finished_at="2026-08-31T00:00:00Z",
    )
    f.module._submit_once = MagicMock(return_value="resume-job")
    assert f.module._submit({"kind": "project_resume", "jobId": f.job["id"]}) == "resume-job"
    f.batch.describe_jobs.assert_not_called()
    request, key = f.module._submit_once.call_args.args
    assert request["jobDefinition"] == f.old["jobDefinitionArn"]
    assert request["jobQueue"] == f.old["jobQueueArn"]
    assert key == f"project:{f.job['id']}:resume:1"
    assert request["containerOverrides"]["command"][-1] == "--resume"


def test_recorded_job_with_changed_raw_binding_cannot_enter_previous_reconciliation(successor_job):
    f = successor_job
    f.job["batch_job_definition"] = f.new["jobDefinitionArn"]
    with pytest.raises(f.module.BatchTargetTrustRejected, match="exact recorded AWS target"):
        f.module._submit({"kind": "project", "jobId": f.job["id"]})
    f.batch.describe_jobs.assert_not_called()
    f.module._submit_once.assert_not_called()
