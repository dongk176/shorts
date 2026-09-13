from __future__ import annotations

from copy import deepcopy
from unittest.mock import MagicMock

import pytest
from test_batch_pipeline_lambdas import _load_lambda

from shorts_worker.errors import RenderError
from shorts_worker.language_test import verify_language_test_job

ID = "f083a5ef-400e-43f5-af27-ac9d417ca6a2"
BATCH = "arn:aws:batch:ap-northeast-2:181651591905:"


def registration():
    keys = [
        "legacy_project",
        "source_range",
        "elevenlabs_transcription",
        "subtitle_templates",
        "unified_template_subtitles",
    ]
    return {
        "id": ID,
        "verified_at": "2026-09-12T00:00:00Z",
        "editor_job_queue_arn": BATCH + "job-queue/shorts-mvp-language-test-production",
        "registry": {
            "version": 1,
            "environment": "production",
            "lanes": {
                key: {
                    "previous": None,
                    "schedulingMode": "fifo",
                    "current": {
                        "releaseId": "test-" + key,
                        "workerSourceGitSha": "a" * 40,
                        "imageUri": "181651591905.dkr.ecr.ap-northeast-2.amazonaws.com/test@sha256:"
                        + "b" * 64,
                        "jobDefinitionArn": BATCH
                        + "job-definition/shorts-mvp-language-test-"
                        + key.replace("_", "-")
                        + ":1",
                        "jobQueueArn": BATCH + "job-queue/shorts-mvp-language-test-production",
                        "renderSpecVersion": 4,
                        "captionRenderSpecVersion": 4,
                        "fontManifestSha256": "c" * 64,
                    },
                }
                for key in keys
            },
        },
    }


def test_regular_submission_never_reads_language_settings_or_registry():
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(side_effect=AssertionError("unexpected experiment query"))
    module._production_project_target_registry = MagicMock(return_value={"ordinary": True})
    assert module._project_registry_for_job({}) == {"ordinary": True}
    module.rest.assert_not_called()
    module._production_project_target_registry.assert_called_once()


def test_saved_test_target_survives_admission_off_without_public_registry(monkeypatch):
    module, _ = _load_lambda("batch_submitter")
    record = registration()
    module.rest = MagicMock(return_value=[record])
    module._production_project_target_registry = MagicMock(side_effect=AssertionError("public"))
    target = record["registry"]["lanes"]["legacy_project"]["current"]
    job = {
        "language_test_release_id": ID,
        "initial_editor_release_id": ID,
        "batch_target_key": "legacy_project",
        "batch_target_release_id": target["releaseId"],
        "batch_job_definition": target["jobDefinitionArn"],
        "batch_job_queue": target["jobQueueArn"],
        "transcription_policy": "openai_stable",
    }
    result = module._project_dispatch_target(job, resume=False)
    assert result[:2] == (target["jobDefinitionArn"], target["jobQueueArn"])
    assert module._project_scheduling_overrides(result[1], result[2], "paid", "user") == {}
    assert all(call.args[0] == "language_test_releases" for call in module.rest.call_args_list)
    # Neither malformed registration nor another project's target falls back.
    for mutation in ["unverified", "lab", "public_queue", "unbound"]:
        broken = deepcopy(record)
        changed_job = dict(job)
        if mutation == "unverified":
            broken["verified_at"] = None
        elif mutation == "lab":
            broken["registry"]["environment"] = "lab"
        elif mutation == "public_queue":
            broken["registry"]["lanes"]["legacy_project"]["current"]["jobQueueArn"] = (
                BATCH + "job-queue/shorts-mvp-project-fargate-production"
            )
        else:
            changed_job["initial_editor_release_id"] = "another"
        module.rest.return_value = [broken]
        with pytest.raises(RuntimeError):
            module._project_dispatch_target(changed_job, resume=False)
    module._production_project_target_registry.assert_not_called()


def test_worker_rejects_crossed_or_upload_jobs(monkeypatch):
    verify_language_test_job({})
    job = {
        "language_test_release_id": ID,
        "initial_editor_release_id": ID,
        "source_language_hint": "auto",
        "output_language": "ja",
        "source_type": "youtube",
        "pipeline_version": 2,
        "initial_render_spec_version": 4,
        "initial_caption_render_spec_version": 4,
    }
    with pytest.raises(RenderError):
        verify_language_test_job(job)
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_WORKER", "true")
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_RELEASE_ID", ID)
    verify_language_test_job(job)
    for change in [
        {"source_type": "upload"},
        {"initial_editor_release_id": "other"},
        {"source_language_hint": None},
        {"output_language": "de"},
        {"initial_render_spec_version": None},
        {"language_test_release_id": None},
    ]:
        with pytest.raises(RenderError):
            verify_language_test_job({**job, **change})


def test_culture_release_uses_existing_submitter_registry_protocol():
    module, _ = _load_lambda("batch_submitter")
    record = registration()
    for key, lane in record["registry"]["lanes"].items():
        target = lane["current"]
        target["releaseId"] = (
            f"language-culture-flash-v1-{key.replace('_', '-')}-"
            + target["workerSourceGitSha"][:12]
        )
    module.rest = MagicMock(return_value=[record])
    assert module._language_test_release({
        "language_test_release_id": ID, "initial_editor_release_id": ID,
    }) == record
