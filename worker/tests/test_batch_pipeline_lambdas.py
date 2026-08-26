from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import pytest

LAMBDA_DIR = Path(__file__).parents[2] / "infra" / "aws" / "lambda"


def _load_lambda(name: str) -> tuple[ModuleType, MagicMock]:
    fake_sqs = MagicMock()
    fake_boto3 = SimpleNamespace(client=lambda service: fake_sqs)
    fake_common = ModuleType("common")
    fake_common.iso_now = lambda: "2026-07-13T12:00:00+00:00"
    fake_common.log_event = MagicMock()
    fake_common.patch = MagicMock()
    fake_common.rest = MagicMock()
    missing = object()
    previous_boto3 = sys.modules.get("boto3", missing)
    previous_common = sys.modules.get("common", missing)
    sys.modules["boto3"] = fake_boto3  # type: ignore[assignment]
    sys.modules["common"] = fake_common
    os.environ["WORK_DISPATCH_QUEUE_URL"] = "https://sqs.example/work"
    os.environ["MEDIA_BUCKET"] = "media-bucket"
    os.environ["PREPARE_BATCH_QUEUE"] = "prepare-queue"
    os.environ["PREPARE_JOB_DEFINITION"] = "prepare-definition:1"
    os.environ["RENDER_BATCH_QUEUE"] = "render-queue"
    os.environ["RENDER_JOB_DEFINITION"] = "render-definition:1"
    os.environ["PROJECT_BATCH_QUEUE"] = "project-queue"
    os.environ["PROJECT_JOB_DEFINITION"] = "project-definition:1"
    os.environ["PROJECT_HEAVY_JOB_DEFINITION"] = "project-heavy-definition:1"
    os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-project-heavy-fargate-production:27"
    )
    os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
        "shorts-mvp-project-fargate-production"
    )
    os.environ["SOURCE_RANGE_JOB_DEFINITION_ARN"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-source-range-v1-production:1"
    )
    os.environ["SOURCE_RANGE_BATCH_QUEUE_ARN"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
        "shorts-mvp-source-range-production"
    )
    os.environ["ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-elevenlabs-transcription-canary-production:1"
    )
    os.environ["ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
        "shorts-mvp-elevenlabs-transcription-canary-production"
    )
    os.environ["SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-subtitle-templates-canary-production:1"
    )
    os.environ["SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
        "shorts-mvp-elevenlabs-transcription-canary-production"
    )
    os.environ["UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-unified-template-subtitles-canary-production:1"
    )
    os.environ["UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
        "shorts-mvp-prepare-production"
    )
    os.environ.pop("SUBTITLE_TEMPLATES_PREVIOUS_JOB_DEFINITION_ARN", None)
    os.environ.pop("SUBTITLE_TEMPLATES_PREVIOUS_BATCH_QUEUE_ARN", None)
    os.environ.pop(
        "UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN", None
    )
    os.environ["RERENDER_JOB_DEFINITION"] = "rerender-definition:1"
    os.environ["EDITOR_STABLE_BATCH_QUEUE"] = "editor-stable-queue"
    os.environ["EDITOR_CANARY_BATCH_QUEUE"] = "editor-canary-queue"
    os.environ["BATCH_SUBMITTER_FUNCTION_NAME"] = "batch-submitter"
    spec = importlib.util.spec_from_file_location(
        f"test_{name}_{id(fake_sqs)}", LAMBDA_DIR / f"{name}.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    finally:
        if previous_boto3 is missing:
            sys.modules.pop("boto3", None)
        else:
            sys.modules["boto3"] = previous_boto3  # type: ignore[assignment]
        if previous_common is missing:
            sys.modules.pop("common", None)
        else:
            sys.modules["common"] = previous_common  # type: ignore[assignment]
    return module, fake_sqs


def test_state_writer_applies_stage_counts_atomically_with_v2_rpc() -> None:
    module, _ = _load_lambda("state_writer")
    module.rest = MagicMock()

    result = module.handler({"Records": [{
        "messageId": "message-a",
        "body": json.dumps({
            "type": "stage",
            "jobId": "job-a",
            "stage": "rendering",
            "progress": 72,
            "message": "렌더링 4/12",
            "stageCompletedCount": 4,
            "stageTotalCount": 12,
            "eventAt": "2026-07-22T01:00:00+00:00",
        }),
    }]}, None)

    assert result == {"batchItemFailures": []}
    table = module.rest.call_args.args[0]
    body = module.rest.call_args.kwargs["body"]
    assert table == "rpc/apply_job_state_event_v2"
    assert body["p_stage_completed_count"] == 4
    assert body["p_stage_total_count"] == 12


def test_prepare_array_child_failure_is_hidden_and_retried() -> None:
    module, sqs = _load_lambda("batch_state")

    def rest(table: str, **kwargs):
        if table == "dispatch_batches":
            return [{"id": "dispatch-a"}]
        if table == "dispatch_batch_items":
            assert "array_index=eq.1" in kwargs["query"]
            return [{"job_id": "job-b"}]
        if table == "video_jobs":
            return [{
                "id": "job-b",
                "status": "queued",
                "attempt_count": 0,
                "deadline_at": "2026-07-13T12:15:00+00:00",
                "aws_batch_job_id": "batch-parent",
            }]
        if table == "rpc/handle_prepare_batch_failure":
            assert kwargs["body"]["p_batch_job_id"] == "batch-parent"
            return [{"action": "retry", "counted_attempt": 1}]
        return []

    module.rest = rest
    result = module.handler({"detail": {
        "jobId": "batch-parent:1",
        "status": "FAILED",
        "statusReason": "container exited",
        "arrayProperties": {"index": 1},
    }}, None)

    assert result == {"retriedJobId": "job-b"}
    message = sqs.send_message.call_args.kwargs
    assert message["DelaySeconds"] == 60
    assert json.loads(message["MessageBody"]) == {
        "kind": "prepare_retry",
        "jobId": "job-b",
        "failedBatchJobId": "batch-parent",
    }


def test_array_parent_failure_does_not_retry_every_child_twice() -> None:
    module, sqs = _load_lambda("batch_state")
    module.rest = MagicMock()

    result = module.handler({"detail": {
        "jobId": "batch-parent",
        "status": "FAILED",
        "arrayProperties": {"size": 2, "statusSummary": {"FAILED": 2}},
    }}, None)

    assert result == {"ignoredArrayParent": "batch-parent"}
    module.rest.assert_not_called()
    sqs.send_message.assert_not_called()


def test_render_array_child_failure_retries_only_its_shard() -> None:
    module, sqs = _load_lambda("batch_state")
    patches: list[tuple[str, str, dict[str, object]]] = []

    def rest(table: str, **kwargs):
        if table == "dispatch_batches":
            return []
        if table == "generated_shorts" and "render_batch_job_id" in kwargs["query"]:
            return [{
                "id": "short-a",
                "job_id": "job-a",
                "render_shard_index": 2,
                "status": "rendering",
                "render_attempt_count": 1,
            }]
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "status": "rendering",
                "deadline_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
            }]
        return []

    module.rest = rest
    module.patch = lambda table, query, body: patches.append((table, query, body))
    result = module.handler({"detail": {
        "jobId": "render-parent:2",
        "status": "FAILED",
        "arrayProperties": {"index": 2},
    }}, None)

    assert result == {
        "retriedRenderJobId": "job-a",
        "shardIndex": 2,
        "failureCategory": "application",
        "retryCount": 1,
    }
    assert any(table == "generated_shorts" and "render_shard_index=eq.2" in query
               for table, query, _ in patches)
    message = json.loads(sqs.send_message.call_args.kwargs["MessageBody"])
    assert message == {
        "kind": "render_retry",
        "jobId": "job-a",
        "shardIndex": 2,
        "failedBatchJobId": "render-parent",
        "retryCount": 1,
    }


def test_render_failure_at_deadline_uses_a_render_specific_message() -> None:
    module, _ = _load_lambda("batch_state")
    patches: list[tuple[str, str, dict[str, object]]] = []

    def rest(table: str, **kwargs):
        if table == "dispatch_batches":
            return []
        if table == "generated_shorts" and "render_batch_job_id" in kwargs["query"]:
            return [{
                "id": "short-a",
                "job_id": "job-a",
                "render_shard_index": 0,
                "status": "rendering",
                "render_attempt_count": 2,
            }]
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "status": "rendering",
                "deadline_at": (datetime.now(UTC) + timedelta(seconds=30)).isoformat(),
            }]
        return []

    module.rest = rest
    module.patch = lambda table, query, body: patches.append((table, query, body))

    result = module.handler({"detail": {
        "jobId": "render-a",
        "status": "FAILED",
        "statusReason": "container exited",
    }}, None)

    assert result == {
        "failedRenderJobId": "job-a",
        "failureCategory": "application",
        "retryCount": 0,
    }
    job_patch = next(body for table, _, body in patches if table == "video_jobs")
    assert job_patch["error_code"] == "render_failed"
    assert job_patch["error_message"] == module.RENDER_FINAL_MESSAGE
    assert "가져오지" not in str(job_patch["error_message"])
    short_patch = next(body for table, _, body in patches if table == "generated_shorts")
    assert short_patch["status"] == "failed"
    assert short_patch["render_error_code"] == "render_failed"


def test_render_oom_fails_without_repeating_the_same_resource_shape() -> None:
    module, sqs = _load_lambda("batch_state")
    patches: list[tuple[str, str, dict[str, object]]] = []

    def rest(table: str, **kwargs):
        if table == "dispatch_batches":
            return []
        if table == "generated_shorts" and "render_batch_job_id" in kwargs["query"]:
            return [{
                "id": "short-a",
                "job_id": "job-a",
                "render_shard_index": 0,
                "status": "rendering",
                "render_attempt_count": 1,
            }]
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "status": "rendering",
                "deadline_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
            }]
        return []

    module.rest = rest
    module.patch = lambda table, query, body: patches.append((table, query, body))

    result = module.handler({"detail": {
        "jobId": "render-a",
        "status": "FAILED",
        "statusReason": "Essential container exited",
        "container": {"exitCode": 137, "reason": "OutOfMemoryError"},
        "parameters": {"renderRetryCount": "0"},
    }}, None)

    assert result == {
        "failedRenderJobId": "job-a",
        "failureCategory": "oom",
        "retryCount": 0,
    }
    assert next(body for table, _, body in patches if table == "video_jobs")[
        "error_code"
    ] == "render_oom"
    assert all("status=in.(rendering,rerendering)" in query
               for table, query, _ in patches if table == "generated_shorts")
    sqs.send_message.assert_not_called()


def test_render_retry_budget_is_capped_after_one_external_retry() -> None:
    module, sqs = _load_lambda("batch_state")
    module.patch = MagicMock()

    def rest(table: str, **kwargs):
        if table == "dispatch_batches":
            return []
        if table == "generated_shorts" and "render_batch_job_id" in kwargs["query"]:
            return [{
                "id": "short-a",
                "job_id": "job-a",
                "render_shard_index": 0,
                "status": "rendering",
                "render_attempt_count": 1,
            }]
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "status": "rendering",
                "deadline_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
            }]
        return []

    module.rest = rest
    result = module.handler({"detail": {
        "jobId": "render-retry-a",
        "status": "FAILED",
        "statusReason": "Essential container exited",
        "parameters": {"renderRetryCount": "1"},
    }}, None)

    assert result["failedRenderJobId"] == "job-a"
    assert result["retryCount"] == 1
    sqs.send_message.assert_not_called()


def test_final_rerender_failure_releases_v2_request_atomically_enough() -> None:
    module, _ = _load_lambda("batch_state")
    patches: list[tuple[str, str, dict[str, object]]] = []
    module.rest = MagicMock(return_value=[{
        "id": "short-a",
        "status": "rerendering",
        "render_version": 3,
        "pending_edit_request_id": "request-a",
    }])
    module.patch = lambda table, query, body: patches.append((table, query, body))

    result = module._handle_rerender_failure(
        "rerender-a",
        "renderer failed",
        {"parameters": {"rerenderAttempt": "1"}},
    )

    assert result == {
        "resetShortId": "short-a",
        "failureCategory": "application",
    }
    assert patches[0][0] == "editor_render_requests"
    assert patches[0][2]["status"] == "failed"
    assert patches[1][0] == "generated_shorts"
    assert patches[1][2]["pending_edit_snapshot"] is None
    assert patches[1][2]["pending_edit_request_id"] is None


def test_stale_rerender_cleanup_releases_v2_request_and_snapshot() -> None:
    module, _ = _load_lambda("cleanup")
    patches: list[tuple[str, str, dict[str, object]]] = []
    module.rest = MagicMock(return_value=[{
        "id": "short-a",
        "rerender_batch_job_id": None,
        "pending_edit_request_id": "request-a",
    }])
    module.patch = lambda table, query, body: patches.append((table, query, body))

    assert module.reset_stale_rerenders() == 1
    assert patches[0][0] == "editor_render_requests"
    assert patches[0][2]["failure_code"] == "rerender_stale_timeout"
    assert patches[1][0] == "generated_shorts"
    assert patches[1][2]["pending_edit_snapshot"] is None
    assert patches[1][2]["pending_edit_request_id"] is None


def test_stale_job_cleanup_preserves_a_recent_worker_heartbeat() -> None:
    module, batch = _load_lambda("cleanup")
    module.rest = MagicMock(return_value=[{
        "id": "job-active",
        "aws_batch_job_id": "old-terminal-batch",
        "status": "extracting",
        "heartbeat_at": datetime.now(UTC).isoformat(),
        "created_at": (datetime.now(UTC) - timedelta(hours=3)).isoformat(),
        "execution_backend": "aws_batch",
        "claimed_at": None,
        "pipeline_version": 2,
    }])

    assert module.release_stale_jobs() == 0
    batch.describe_jobs.assert_not_called()
    assert all(
        call.args[0] != "rpc/finalize_project_job"
        for call in module.rest.call_args_list
    )


def test_recent_heartbeat_requires_a_valid_timezone_aware_timestamp() -> None:
    module, _ = _load_lambda("cleanup")
    now = datetime.now(UTC)

    assert module._has_recent_heartbeat(
        {"heartbeat_at": (now - timedelta(minutes=14)).isoformat()}, now
    )
    assert not module._has_recent_heartbeat(
        {"heartbeat_at": (now - timedelta(minutes=16)).isoformat()}, now
    )
    assert not module._has_recent_heartbeat({"heartbeat_at": "not-a-time"}, now)
    assert not module._has_recent_heartbeat(
        {"heartbeat_at": datetime.now().replace(tzinfo=None).isoformat()}, now
    )


def test_failed_short_cleanup_deletes_versions_before_marking_deleted() -> None:
    module, _ = _load_lambda("cleanup")
    item = {
        "id": "short-a",
        "job_id": "job-a",
        "mvp_session_id": "session-a",
        "output_s3_key": None,
        "clean_clip_s3_key": "edit-sources/session-a/job-a/short-a.mp4",
        "thumbnail_s3_key": None,
    }
    module.rest = MagicMock(return_value=[item])
    module._version_keys = MagicMock(
        return_value=["outputs/session-a/job-a/short-a/v1.mp4"]
    )
    module._delete_keys = MagicMock(return_value=3)
    module.patch = MagicMock()

    cleaned, deleted = module.cleanup_failed_shorts()

    assert (cleaned, deleted) == (1, 3)
    deleted_keys = module._delete_keys.call_args.args[0]
    assert "outputs/session-a/job-a/short-a/v1.mp4" in deleted_keys
    assert "thumbnails/session-a/job-a/short-a.jpg" in deleted_keys
    module.patch.assert_called_once_with(
        "generated_shorts",
        "id=eq.short-a&status=eq.failed&deleted_at=is.null",
        {"deleted_at": "2026-07-13T12:00:00+00:00", "subtitle_segments": []},
    )


def test_prepare_retry_message_is_deduplicated_by_failed_batch_id() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-a",
        "attempt_count": 1,
        "deadline_at": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
        "status": "retry_waiting",
        "aws_batch_job_id": "newer-batch",
    }])
    module.batch = MagicMock()

    result = module._submit({
        "kind": "prepare_retry",
        "jobId": "job-a",
        "failedBatchJobId": "older-batch",
    })

    assert result is None
    module.batch.submit_job.assert_not_called()


def test_prepare_retry_returns_to_the_centrally_scheduled_outbox() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-a",
        "attempt_count": 2,
        "status": "retry_waiting",
        "aws_batch_job_id": "failed-batch",
    }])
    module.batch = MagicMock()

    result = module._submit({
        "kind": "prepare_retry",
        "jobId": "job-a",
        "failedBatchJobId": "failed-batch",
    })

    assert result is None
    assert module.rest.call_args_list[-1].args[0] == "rpc/enqueue_prepare_retry"
    assert module.rest.call_args_list[-1].kwargs["body"] == {"p_job_id": "job-a"}
    module.batch.submit_job.assert_not_called()


def test_project_submission_uses_eight_vcpu_definition_with_idempotent_key() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-a",
        "status": "queued",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "preparation_finished_at": None,
        "planned_short_count": 10,
        "clip_length_option": "sec_31_60",
        "batch_job_definition": None,
        "dispatch_priority_class": "paid",
    }])
    module._submit_once = MagicMock(return_value="project-batch-a")
    module.patch = MagicMock()

    result = module._submit({"kind": "project", "jobId": "job-a"})

    assert result == "project-batch-a"
    request, submission_key = module._submit_once.call_args.args
    assert submission_key == "project:job-a:0"
    assert list(request) == [
        "jobName",
        "jobQueue",
        "jobDefinition",
        "shareIdentifier",
        "schedulingPriorityOverride",
        "containerOverrides",
        "retryStrategy",
        "timeout",
    ]
    assert request["jobQueue"] == os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]
    assert request["jobDefinition"] == os.environ[
        "LEGACY_PROJECT_JOB_DEFINITION_ARN"
    ]
    assert request["retryStrategy"] == {"attempts": 1}
    assert request["timeout"] == {"attemptDurationSeconds": 7200}
    assert request["shareIdentifier"].startswith("paiduser")
    assert request["shareIdentifier"].isalnum()
    assert request["schedulingPriorityOverride"] == 1000
    assert request["containerOverrides"]["command"] == [
        "python", "-m", "shorts_worker", "project", "--job-id", "job-a",
    ]
    assert "arrayProperties" not in request


def test_project_submission_metrics_estimate_output_seconds() -> None:
    module, _ = _load_lambda("batch_submitter")

    assert module._estimated_output_seconds({
        "planned_short_count": 10, "clip_length_option": "sec_31_60",
    }) == 450
    assert module._estimated_output_seconds({
        "planned_short_count": 11, "clip_length_option": "sec_31_60",
    }) == 495
    assert module._estimated_output_seconds({
        "planned_short_count": 15, "clip_length_option": "sec_30",
    }) == 450
    assert module._estimated_output_seconds({
        "planned_short_count": 6, "clip_length_option": "sec_61_180",
    }) == 540


def test_heavy_project_submission_records_selected_definition() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-heavy",
        "status": "queued",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "preparation_finished_at": None,
        "planned_short_count": 12,
        "clip_length_option": "sec_31_60",
        "batch_job_definition": None,
    }])
    module._submit_once = MagicMock(return_value="project-heavy-batch")
    module.patch = MagicMock()

    result = module._submit({"kind": "project", "jobId": "job-heavy"})

    assert result == "project-heavy-batch"
    request, submission_key = module._submit_once.call_args.args
    assert submission_key == "project:job-heavy:0"
    assert request["jobDefinition"] == os.environ[
        "LEGACY_PROJECT_JOB_DEFINITION_ARN"
    ]
    module.patch.assert_called_once_with(
        "video_jobs",
        "id=eq.job-heavy&status=eq.queued",
        {
            "aws_batch_job_id": "project-heavy-batch",
            "batch_job_definition": os.environ[
                "LEGACY_PROJECT_JOB_DEFINITION_ARN"
            ],
            "batch_job_queue": os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"],
        },
    )


def test_project_resume_preserves_original_heavy_definition() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-heavy",
        "status": "rendering",
        "pipeline_version": 2,
        "project_resume_count": 1,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "preparation_finished_at": "2026-07-22T00:00:00+00:00",
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "batch_job_definition": "project-heavy-definition:1",
    }])
    module._submit_once = MagicMock(return_value="project-heavy-resume")
    module.patch = MagicMock()

    result = module._submit({"kind": "project_resume", "jobId": "job-heavy"})

    assert result == "project-heavy-resume"
    request, submission_key = module._submit_once.call_args.args
    assert submission_key == "project:job-heavy:resume:1"
    assert request["jobDefinition"] == os.environ[
        "LEGACY_PROJECT_JOB_DEFINITION_ARN"
    ]
    assert request["jobQueue"] == os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]
    assert request["containerOverrides"]["command"][-1] == "--resume"


def test_project_resume_preserves_original_standard_definition() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-standard",
        "status": "rendering",
        "pipeline_version": 2,
        "project_resume_count": 1,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "preparation_finished_at": "2026-07-22T00:00:00+00:00",
        "planned_short_count": 10,
        "clip_length_option": "sec_31_60",
        "batch_job_definition": "project-definition:1",
    }])
    module._submit_once = MagicMock(return_value="project-standard-resume")
    module.patch = MagicMock()

    result = module._submit({"kind": "project_resume", "jobId": "job-standard"})

    assert result == "project-standard-resume"
    request, submission_key = module._submit_once.call_args.args
    assert submission_key == "project:job-standard:resume:1"
    assert request["jobDefinition"] == os.environ[
        "LEGACY_PROJECT_JOB_DEFINITION_ARN"
    ]
    assert request["jobQueue"] == os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]
    assert request["containerOverrides"]["command"][-1] == "--resume"


def test_source_range_project_and_resume_keep_the_exact_candidate_target() -> None:
    module, _ = _load_lambda("batch_submitter")
    base_job = {
        "id": "job-range",
        "pipeline_version": 2,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": True,
        "batch_job_definition": os.environ["SOURCE_RANGE_JOB_DEFINITION_ARN"],
        "batch_job_queue": os.environ["SOURCE_RANGE_BATCH_QUEUE_ARN"],
    }
    module._submit_once = MagicMock(side_effect=["range-first", "range-resume"])
    module.patch = MagicMock()
    module.rest = MagicMock(return_value=[{
        **base_job,
        "status": "queued",
        "project_resume_count": 0,
        "preparation_finished_at": None,
    }])

    assert module._submit({"kind": "project", "jobId": "job-range"}) == "range-first"
    first_request = module._submit_once.call_args_list[0].args[0]

    module.rest = MagicMock(return_value=[{
        **base_job,
        "status": "rendering",
        "project_resume_count": 1,
        "preparation_finished_at": "2026-08-05T00:00:00+00:00",
    }])
    assert module._submit({
        "kind": "project_resume", "jobId": "job-range",
    }) == "range-resume"
    resume_request = module._submit_once.call_args_list[1].args[0]

    assert first_request["jobDefinition"] == resume_request["jobDefinition"] == (
        os.environ["SOURCE_RANGE_JOB_DEFINITION_ARN"]
    )
    assert first_request["jobQueue"] == resume_request["jobQueue"] == (
        os.environ["SOURCE_RANGE_BATCH_QUEUE_ARN"]
    )
    assert first_request["timeout"] == resume_request["timeout"] == {
        "attemptDurationSeconds": 18000,
    }
    for request in (first_request, resume_request):
        assert request["shareIdentifier"].startswith("freeuser")
        assert request["schedulingPriorityOverride"] == 0


def test_project_scheduling_overrides_only_omit_for_exact_unified_queue() -> None:
    module, _ = _load_lambda("batch_submitter")
    unified_queue = os.environ[
        "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
    ]
    expected = {
        "shareIdentifier": module._priority_share_identifier(
            "paid", "admin-a", "session-a", "job-a"
        ),
        "schedulingPriorityOverride": 1000,
    }

    assert module._project_scheduling_overrides(
        unified_queue,
        "unified_template_subtitles",
        "paid",
        "admin-a",
        "session-a",
        "job-a",
    ) == {}
    assert module._project_scheduling_overrides(
        unified_queue,
        "legacy",
        "paid",
        "admin-a",
        "session-a",
        "job-a",
    ) == expected
    assert module._project_scheduling_overrides(
        os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"],
        "unified_template_subtitles",
        "paid",
        "admin-a",
        "session-a",
        "job-a",
    ) == expected


def test_elevenlabs_project_and_resume_keep_the_exact_candidate_target() -> None:
    module, _ = _load_lambda("batch_submitter")
    base_job = {
        "id": "job-elevenlabs",
        "pipeline_version": 2,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "admin-a",
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "batch_job_definition": os.environ[
            "ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN"
        ],
    }
    module._submit_once = MagicMock(side_effect=["elevenlabs-first", "elevenlabs-resume"])
    module.patch = MagicMock()
    module.rest = MagicMock(return_value=[{
        **base_job,
        "status": "queued",
        "project_resume_count": 0,
        "preparation_finished_at": None,
    }])

    assert module._submit({
        "kind": "project", "jobId": "job-elevenlabs",
    }) == "elevenlabs-first"
    first_request = module._submit_once.call_args_list[0].args[0]

    module.rest = MagicMock(return_value=[{
        **base_job,
        "status": "rendering",
        "project_resume_count": 1,
        "preparation_finished_at": "2026-08-06T00:00:00+00:00",
    }])
    assert module._submit({
        "kind": "project_resume", "jobId": "job-elevenlabs",
    }) == "elevenlabs-resume"
    resume_request = module._submit_once.call_args_list[1].args[0]

    assert first_request["jobDefinition"] == resume_request["jobDefinition"] == (
        os.environ["ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN"]
    )
    assert first_request["jobQueue"] == resume_request["jobQueue"] == (
        os.environ["ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN"]
    )
    assert first_request["timeout"] == resume_request["timeout"] == {
        "attemptDurationSeconds": 18000,
    }
    for request in (first_request, resume_request):
        assert request["shareIdentifier"].startswith("freeuser")
        assert request["schedulingPriorityOverride"] == 0


def test_subtitle_template_project_and_resume_keep_the_exact_candidate_target() -> None:
    module, _ = _load_lambda("batch_submitter")
    base_job = {
        "id": "job-subtitle",
        "pipeline_version": 2,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "admin-a",
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "highlight",
        "batch_job_definition": os.environ[
            "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"
        ],
    }
    module._submit_once = MagicMock(
        side_effect=["subtitle-first", "subtitle-resume"]
    )
    module.patch = MagicMock()
    module.rest = MagicMock(return_value=[{
        **base_job,
        "status": "queued",
        "project_resume_count": 0,
        "preparation_finished_at": None,
    }])

    assert module._submit({
        "kind": "project", "jobId": "job-subtitle",
    }) == "subtitle-first"
    first_request = module._submit_once.call_args_list[0].args[0]

    module.rest = MagicMock(return_value=[{
        **base_job,
        "status": "rendering",
        "project_resume_count": 1,
        "preparation_finished_at": "2026-08-08T00:00:00+00:00",
    }])
    assert module._submit({
        "kind": "project_resume", "jobId": "job-subtitle",
    }) == "subtitle-resume"
    resume_request = module._submit_once.call_args_list[1].args[0]

    assert first_request["jobDefinition"] == resume_request["jobDefinition"] == (
        os.environ["SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"]
    )
    assert first_request["jobQueue"] == resume_request["jobQueue"] == (
        os.environ["SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"]
    )
    assert first_request["timeout"] == resume_request["timeout"] == {
        "attemptDurationSeconds": 18000,
    }
    for request in (first_request, resume_request):
        assert request["shareIdentifier"].startswith("freeuser")
        assert request["schedulingPriorityOverride"] == 0


def test_unified_template_project_and_resume_keep_the_exact_candidate_target() -> None:
    module, _ = _load_lambda("batch_submitter")
    base_job = {
        "id": "job-unified-template",
        "pipeline_version": 2,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "admin-a",
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "pop",
        "template_snapshot": {
            "id": "template-v5",
            "config": {"schemaVersion": 5},
            "version": 1,
        },
        "subtitle_template_snapshot": {
            "schemaVersion": 4,
            "origin": "unified-template-v5",
        },
        "batch_job_definition": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
        ],
    }
    module._submit_once = MagicMock(
        side_effect=["unified-first", "unified-resume"]
    )
    module.patch = MagicMock()
    module.rest = MagicMock(return_value=[{
        **base_job,
        "status": "queued",
        "project_resume_count": 0,
        "preparation_finished_at": None,
    }])

    assert module._submit({
        "kind": "project", "jobId": "job-unified-template",
    }) == "unified-first"
    first_request = module._submit_once.call_args_list[0].args[0]

    module.rest = MagicMock(return_value=[{
        **base_job,
        "status": "rendering",
        "project_resume_count": 1,
        "preparation_finished_at": "2026-08-24T00:00:00+00:00",
    }])
    assert module._submit({
        "kind": "project_resume", "jobId": "job-unified-template",
    }) == "unified-resume"
    resume_request = module._submit_once.call_args_list[1].args[0]

    assert first_request["jobDefinition"] == resume_request["jobDefinition"] == (
        os.environ["UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"]
    )
    assert first_request["jobQueue"] == resume_request["jobQueue"] == (
        os.environ["UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"]
    )
    assert first_request["timeout"] == resume_request["timeout"] == {
        "attemptDurationSeconds": 18000,
    }
    for request in (first_request, resume_request):
        assert "shareIdentifier" not in request
        assert "schedulingPriorityOverride" not in request


def test_previous_unified_definition_is_remapped_to_hardened_primary() -> None:
    module, _ = _load_lambda("batch_submitter")
    previous_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-unified-template-subtitles-previous-production:1"
    )
    os.environ[
        "UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN"
    ] = previous_definition
    job = {
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": True,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "highlight",
        "template_snapshot": {
            "id": "template-v5",
            "config": {"schemaVersion": 5},
            "version": 1,
        },
        "subtitle_template_snapshot": {
            "schemaVersion": 4,
            "origin": "unified-template-v5",
        },
        "batch_job_definition": previous_definition,
        "batch_job_queue": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
        ],
    }

    assert module._project_dispatch_target(job, resume=False) == (
        os.environ["UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"],
        os.environ["UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"],
        "unified_template_subtitles",
        225,
    )


def test_ordinary_project_cannot_use_previous_unified_definition() -> None:
    module, _ = _load_lambda("batch_submitter")
    previous_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-unified-template-subtitles-previous-production:1"
    )
    os.environ[
        "UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN"
    ] = previous_definition
    job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "template_snapshot": {"presetVersion": 3},
        "batch_job_definition": previous_definition,
        "batch_job_queue": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
        ],
    }

    with pytest.raises(RuntimeError, match="not trusted"):
        module._project_dispatch_target(job, resume=False)


@pytest.mark.parametrize(
    "previous_definition",
    [
        "not-an-arn",
        (
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
            "missing-revision"
        ),
    ],
)
def test_previous_unified_definition_must_be_an_exact_arn(
    previous_definition: str,
) -> None:
    module, _ = _load_lambda("batch_submitter")
    os.environ[
        "UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN"
    ] = previous_definition
    job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "pop",
        "template_snapshot": {"config": {"schemaVersion": 5}},
        "subtitle_template_snapshot": {"origin": "unified-template-v5"},
        "batch_job_definition": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
        ],
    }

    with pytest.raises(
        RuntimeError,
        match=(
            "UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN is invalid"
        ),
    ):
        module._project_dispatch_target(job, resume=False)


def test_previous_unified_definition_must_not_match_primary() -> None:
    module, _ = _load_lambda("batch_submitter")
    os.environ[
        "UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN"
    ] = os.environ["UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"]
    job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "pop",
        "template_snapshot": {"config": {"schemaVersion": 5}},
        "subtitle_template_snapshot": {"origin": "unified-template-v5"},
        "batch_job_definition": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
        ],
    }

    with pytest.raises(RuntimeError, match="must differ from the primary"):
        module._project_dispatch_target(job, resume=False)


@pytest.mark.parametrize(
    "template_snapshot",
    [
        None,
        {"config": {"schemaVersion": 4}},
        {"config": {"schemaVersion": "5"}},
        {"config": {"version": 5}},
    ],
)
def test_unified_target_rejects_jobs_without_the_canonical_v5_marker(
    template_snapshot: dict[str, object] | None,
) -> None:
    module, _ = _load_lambda("batch_submitter")
    job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "pop",
        "template_snapshot": template_snapshot,
        "subtitle_template_snapshot": {"origin": "unified-template-v5"},
        "batch_job_definition": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
        ],
    }

    with pytest.raises(RuntimeError, match="not trusted"):
        module._project_dispatch_target(job, resume=False)


@pytest.mark.parametrize(
    "subtitle_snapshot",
    [
        {},
        {"origin": "legacy-caption"},
    ],
)
def test_unified_target_rejects_a_missing_or_mismatched_origin_marker(
    subtitle_snapshot: dict[str, object],
) -> None:
    module, _ = _load_lambda("batch_submitter")
    job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "pop",
        "template_snapshot": {"config": {"schemaVersion": 5}},
        "subtitle_template_snapshot": subtitle_snapshot,
        "batch_job_definition": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
        ],
    }

    with pytest.raises(RuntimeError, match="origin is invalid"):
        module._project_dispatch_target(job, resume=False)


def test_unified_target_rejects_a_missing_subtitle_snapshot() -> None:
    module, _ = _load_lambda("batch_submitter")
    job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "pop",
        "template_snapshot": {"config": {"schemaVersion": 5}},
        "subtitle_template_snapshot": None,
        "batch_job_definition": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
        ],
    }

    with pytest.raises(TypeError, match="subtitle snapshot is invalid"):
        module._project_dispatch_target(job, resume=False)


@pytest.mark.parametrize(
    "legacy_job",
    [
        {
            "transcription_policy": "openai_stable",
            "subtitle_template_id": None,
            "template_snapshot": {"presetVersion": 3},
        },
        {
            "transcription_policy": "elevenlabs_primary_openai_fallback",
            "subtitle_template_id": "highlight",
            "template_snapshot": {"presetVersion": 3},
        },
    ],
)
def test_ordinary_and_legacy_caption_jobs_cannot_forge_the_unified_target(
    legacy_job: dict[str, object],
) -> None:
    module, _ = _load_lambda("batch_submitter")
    job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        **legacy_job,
        "batch_job_definition": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
        ],
    }

    with pytest.raises(RuntimeError, match="not trusted"):
        module._project_dispatch_target(job, resume=False)


@pytest.mark.parametrize("target_prefix", ["LEGACY_PROJECT", "SUBTITLE_TEMPLATES"])
def test_v5_jobs_cannot_forge_an_ordinary_or_legacy_caption_target(
    target_prefix: str,
) -> None:
    module, _ = _load_lambda("batch_submitter")
    job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "highlight",
        "template_snapshot": {"config": {"schemaVersion": 5}},
        "subtitle_template_snapshot": {"origin": "unified-template-v5"},
        "batch_job_definition": os.environ[
            f"{target_prefix}_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[f"{target_prefix}_BATCH_QUEUE_ARN"],
    }

    with pytest.raises(RuntimeError, match="exact immutable Batch target"):
        module._project_dispatch_target(job, resume=False)


def test_invalid_unified_target_is_ignored_for_an_ordinary_job_but_blocks_v5() -> None:
    module, _ = _load_lambda("batch_submitter")
    stored_unified_definition = os.environ[
        "UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"
    ]
    stored_unified_queue = os.environ[
        "UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"
    ]
    os.environ["UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"] = "not-an-arn"
    os.environ["UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"] = ""
    ordinary_job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "batch_job_definition": os.environ[
            "LEGACY_PROJECT_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"],
    }

    assert module._project_dispatch_target(ordinary_job, resume=False) == (
        os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"],
        os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"],
        "legacy",
        30,
    )

    unified_job = {
        **ordinary_job,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "pop",
        "template_snapshot": {"config": {"schemaVersion": 5}},
        "subtitle_template_snapshot": {"origin": "unified-template-v5"},
        "batch_job_definition": stored_unified_definition,
        "batch_job_queue": stored_unified_queue,
    }
    with pytest.raises(RuntimeError, match="UNIFIED_TEMPLATE_SUBTITLES project"):
        module._project_dispatch_target(unified_job, resume=False)


def test_subtitle_template_previous_definition_stays_allowed_on_primary_queue() -> None:
    module, _ = _load_lambda("batch_submitter")
    previous_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-subtitle-templates-previous-production:1"
    )
    os.environ[
        "SUBTITLE_TEMPLATES_PREVIOUS_JOB_DEFINITION_ARN"
    ] = previous_definition
    os.environ["SUBTITLE_TEMPLATES_PREVIOUS_BATCH_QUEUE_ARN"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
        "must-never-be-used"
    )
    job = {
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "highlight",
        "batch_job_definition": previous_definition,
        "batch_job_queue": os.environ[
            "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"
        ],
    }

    assert module._project_dispatch_target(job, resume=True) == (
        previous_definition,
        os.environ["SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"],
        "subtitle_templates",
        225,
    )


@pytest.mark.parametrize(
    "previous_definition",
    [
        "not-an-arn",
        (
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
            "missing-revision"
        ),
    ],
)
def test_subtitle_template_previous_definition_must_be_an_exact_arn(
    previous_definition: str,
) -> None:
    module, _ = _load_lambda("batch_submitter")
    os.environ[
        "SUBTITLE_TEMPLATES_PREVIOUS_JOB_DEFINITION_ARN"
    ] = previous_definition
    job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "basic",
        "batch_job_definition": os.environ[
            "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"
        ],
    }

    with pytest.raises(
        RuntimeError,
        match="SUBTITLE_TEMPLATES_PREVIOUS_JOB_DEFINITION_ARN is invalid",
    ):
        module._project_dispatch_target(job, resume=False)


def test_subtitle_template_previous_definition_must_not_match_primary() -> None:
    module, _ = _load_lambda("batch_submitter")
    os.environ[
        "SUBTITLE_TEMPLATES_PREVIOUS_JOB_DEFINITION_ARN"
    ] = os.environ["SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"]
    job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "pop",
        "batch_job_definition": os.environ[
            "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"
        ],
    }

    with pytest.raises(RuntimeError, match="must differ from the primary"):
        module._project_dispatch_target(job, resume=False)


def test_ordinary_project_cannot_use_previous_subtitle_definition() -> None:
    module, _ = _load_lambda("batch_submitter")
    previous_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-subtitle-templates-previous-production:1"
    )
    os.environ[
        "SUBTITLE_TEMPLATES_PREVIOUS_JOB_DEFINITION_ARN"
    ] = previous_definition
    ordinary_job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "batch_job_definition": previous_definition,
        "batch_job_queue": os.environ[
            "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"
        ],
    }

    with pytest.raises(RuntimeError, match="Stored project Batch target is not trusted"):
        module._project_dispatch_target(ordinary_job, resume=False)


def test_invalid_previous_subtitle_definition_does_not_affect_ordinary_job() -> None:
    module, _ = _load_lambda("batch_submitter")
    os.environ[
        "SUBTITLE_TEMPLATES_PREVIOUS_JOB_DEFINITION_ARN"
    ] = "not-an-arn"
    ordinary_job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "batch_job_definition": os.environ[
            "LEGACY_PROJECT_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "LEGACY_PROJECT_BATCH_QUEUE_ARN"
        ],
    }

    assert module._project_dispatch_target(ordinary_job, resume=False) == (
        os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"],
        os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"],
        "legacy",
        30,
    )


def test_regular_brand_color_project_uses_the_isolated_admin_target() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-brand-color",
        "status": "queued",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "admin-a",
        "preparation_finished_at": None,
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": None,
        "template_snapshot": {"presetVersion": 3, "brandColor": "#FF715E"},
        "batch_job_definition": os.environ[
            "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"
        ],
    }])
    module._submit_once = MagicMock(return_value="brand-color-batch")
    module.patch = MagicMock()

    assert module._submit({
        "kind": "project", "jobId": "job-brand-color",
    }) == "brand-color-batch"
    request = module._submit_once.call_args.args[0]
    assert request["jobDefinition"] == os.environ[
        "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"
    ]
    assert request["jobQueue"] == os.environ[
        "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"
    ]


def test_subtitle_template_requires_word_timed_policy_and_dedicated_target() -> None:
    module, _ = _load_lambda("batch_submitter")
    base_job = {
        "id": "job-subtitle-invalid",
        "status": "queued",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "admin-a",
        "preparation_finished_at": None,
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "subtitle_template_id": "basic",
        "batch_job_definition": os.environ[
            "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"
        ],
    }
    module._submit_once = MagicMock()
    module.rest = MagicMock(return_value=[{
        **base_job,
        "transcription_policy": "openai_stable",
    }])

    with pytest.raises(RuntimeError, match="word-timed transcription policy"):
        module._submit({"kind": "project", "jobId": base_job["id"]})

    module.rest = MagicMock(return_value=[{
        **base_job,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": None,
    }])
    with pytest.raises(RuntimeError, match="not trusted"):
        module._submit({"kind": "project", "jobId": base_job["id"]})

    module._submit_once.assert_not_called()


@pytest.mark.parametrize("source_range", [False, True])
@pytest.mark.parametrize(
    ("definition", "queue"),
    [
        ("not-an-arn", ""),
        (
            "",
            "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
            "shorts-mvp-elevenlabs-transcription-canary-production",
        ),
        (
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
            "shorts-mvp-subtitle-templates-canary-production:1",
            "not-an-arn",
        ),
    ],
)
def test_invalid_subtitle_target_never_blocks_an_ordinary_project(
    source_range: bool,
    definition: str,
    queue: str,
) -> None:
    module, _ = _load_lambda("batch_submitter")
    os.environ["SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"] = definition
    os.environ["SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"] = queue
    definition_prefix = "SOURCE_RANGE" if source_range else "LEGACY_PROJECT"
    module.rest = MagicMock(return_value=[{
        "id": f"job-ordinary-{source_range}",
        "status": "queued",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "preparation_finished_at": None,
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": source_range,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "batch_job_definition": os.environ[
            f"{definition_prefix}_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[f"{definition_prefix}_BATCH_QUEUE_ARN"],
    }])
    module._submit_once = MagicMock(return_value="ordinary-batch")
    module.patch = MagicMock()

    assert module._submit({
        "kind": "project", "jobId": f"job-ordinary-{source_range}",
    }) == "ordinary-batch"
    request = module._submit_once.call_args.args[0]
    assert request["jobDefinition"] == os.environ[
        f"{definition_prefix}_JOB_DEFINITION_ARN"
    ]
    assert request["jobQueue"] == os.environ[
        f"{definition_prefix}_BATCH_QUEUE_ARN"
    ]


@pytest.mark.parametrize(
    ("definition", "queue"),
    [
        ("not-an-arn", ""),
        (
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
            "shorts-mvp-subtitle-templates-canary-production:1",
            "",
        ),
        (
            "",
            "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
            "shorts-mvp-elevenlabs-transcription-canary-production",
        ),
        (
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
            "shorts-mvp-subtitle-templates-canary-production:1",
            "not-an-arn",
        ),
        ("", ""),
    ],
)
def test_invalid_subtitle_target_fails_closed_only_for_caption_jobs(
    definition: str,
    queue: str,
) -> None:
    module, _ = _load_lambda("batch_submitter")
    stored_definition = os.environ["SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"]
    stored_queue = os.environ["SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"]
    os.environ["SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"] = definition
    os.environ["SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"] = queue
    module.rest = MagicMock(return_value=[{
        "id": "job-caption-invalid-env",
        "status": "queued",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "admin-a",
        "preparation_finished_at": None,
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "basic",
        "batch_job_definition": stored_definition,
        "batch_job_queue": stored_queue,
    }])
    module._submit_once = MagicMock()

    with pytest.raises(
        RuntimeError,
        match="SUBTITLE_TEMPLATES project|not trusted",
    ):
        module._submit({"kind": "project", "jobId": "job-caption-invalid-env"})

    module._submit_once.assert_not_called()


def test_stable_transcription_rejects_elevenlabs_candidate_target() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-wrong-policy",
        "status": "queued",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "preparation_finished_at": None,
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "transcription_policy": "openai_stable",
        "batch_job_definition": os.environ[
            "ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN"
        ],
    }])
    module._submit_once = MagicMock()

    with pytest.raises(RuntimeError, match="Stable transcription job"):
        module._submit({"kind": "project", "jobId": "job-wrong-policy"})

    module._submit_once.assert_not_called()


def test_elevenlabs_target_must_not_reuse_a_stable_target() -> None:
    module, _ = _load_lambda("batch_submitter")
    os.environ["ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN"] = os.environ[
        "LEGACY_PROJECT_JOB_DEFINITION_ARN"
    ]
    os.environ["ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN"] = os.environ[
        "LEGACY_PROJECT_BATCH_QUEUE_ARN"
    ]
    module.rest = MagicMock(return_value=[{
        "id": "job-colliding-target",
        "status": "queued",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "admin-a",
        "preparation_finished_at": None,
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "batch_job_definition": os.environ[
            "ELEVENLABS_TRANSCRIPTION_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ[
            "ELEVENLABS_TRANSCRIPTION_BATCH_QUEUE_ARN"
        ],
    }])
    module._submit_once = MagicMock()

    with pytest.raises(RuntimeError, match="must be isolated"):
        module._submit({"kind": "project", "jobId": "job-colliding-target"})

    module._submit_once.assert_not_called()


def test_project_submission_rejects_untrusted_stored_target() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-untrusted",
        "status": "queued",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "preparation_finished_at": None,
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "batch_job_definition": os.environ["SOURCE_RANGE_JOB_DEFINITION_ARN"],
        "batch_job_queue": os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"],
    }])
    module._submit_once = MagicMock()

    with pytest.raises(RuntimeError, match="not trusted"):
        module._submit({"kind": "project", "jobId": "job-untrusted"})

    module._submit_once.assert_not_called()


def test_project_failure_after_checkpoint_submits_one_resume() -> None:
    module, sqs = _load_lambda("batch_state")

    def rest(table: str, **kwargs):
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "status": "rendering",
                "pipeline_version": 2,
                "project_resume_count": 0,
                "preparation_finished_at": "2026-07-22T00:00:00+00:00",
            }]
        if table == "rpc/handle_project_batch_failure":
            assert kwargs["body"]["p_batch_job_id"] == "project-batch-a"
            return [{"action": "resume", "resume_count": 1}]
        return []

    module.rest = rest
    result = module.handler({"detail": {
        "jobId": "project-batch-a",
        "status": "FAILED",
        "statusReason": "Task failed to start",
    }}, None)

    assert result == {
        "projectJobId": "job-a",
        "action": "resume",
        "failureCategory": "infrastructure",
        "resumeCount": 1,
    }
    assert json.loads(sqs.send_message.call_args.kwargs["MessageBody"]) == {
        "kind": "project_resume", "jobId": "job-a",
    }


def test_rerender_uses_fargate_and_batch_never_retries_itself() -> None:
    module, _ = _load_lambda("batch_submitter")

    def rest(table: str, **_kwargs):
        if table == "generated_shorts":
            return [{
                "id": "short-a",
                "job_id": "job-a",
                "status": "rerendering",
                "render_version": 3,
                "rerender_batch_job_id": None,
                "pending_render_hash": "legacy-snapshot-a",
                "updated_at": "2026-07-31T05:00:00+00:00",
                "mvp_session_id": "session-a",
            }]
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "mvp_session_id": "session-a",
                "user_id": "user-a",
                "dispatch_priority_class": "paid",
            }]
        return []

    module.rest = rest
    module._submit_once = MagicMock(return_value="rerender-batch-a")
    module.patch = MagicMock()

    result = module._submit({"kind": "rerender", "shortId": "short-a"})

    assert result == "rerender-batch-a"
    request, submission_key = module._submit_once.call_args.args
    legacy_identity = module.hashlib.sha256(
        b"legacy-snapshot-a:2026-07-31T05:00:00+00:00"
    ).hexdigest()[:12]
    assert submission_key == f"rerender:short-a:4:0:legacy:{legacy_identity}"
    assert request["jobName"] == (
        f"shorts-rerender-short-a-v4-a0-l{legacy_identity}"
    )
    assert request["jobQueue"] == "project-queue"
    assert request["jobDefinition"] == "rerender-definition:1"
    assert request["retryStrategy"] == {"attempts": 1}
    assert request["parameters"] == {"rerenderAttempt": "0"}
    assert request["shareIdentifier"].startswith("paiduser")
    assert request["schedulingPriorityOverride"] == 1000


def test_v2_rerender_request_gets_a_fresh_batch_identity() -> None:
    module, _ = _load_lambda("batch_submitter")
    request_id = "a4f71dc3-1ffd-4670-b6d2-d4704461edc0"

    def rest(table: str, **_kwargs):
        if table == "generated_shorts":
            return [{
                "id": "short-a",
                "job_id": "job-a",
                "status": "rerendering",
                "render_version": 3,
                "rerender_batch_job_id": None,
                "pending_edit_request_id": request_id,
                "mvp_session_id": "session-a",
            }]
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "mvp_session_id": "session-a",
                "user_id": "user-a",
                "dispatch_priority_class": "paid",
            }]
        return []

    module.rest = rest
    module._submit_once = MagicMock(return_value="rerender-batch-v2")
    module.patch = MagicMock()

    result = module._submit({"kind": "rerender", "shortId": "short-a"})

    assert result == "rerender-batch-v2"
    request, submission_key = module._submit_once.call_args.args
    assert submission_key == f"rerender:short-a:4:0:{request_id}"
    assert request["jobName"] == (
        "shorts-rerender-short-a-v4-a0-ra4f71dc31ffd"
    )
    assert module.patch.call_args.args[1] == (
        "id=eq.short-a&status=eq.rerendering"
        f"&pending_edit_request_id=eq.{request_id}"
    )


def test_canary_rerender_uses_the_release_digest_and_isolated_queue() -> None:
    module, _ = _load_lambda("batch_submitter")
    request_id = "a4f71dc3-1ffd-4670-b6d2-d4704461edc0"
    release_id = "f0c49c16-3efd-4478-9e69-b0c41f2f3eb0"
    digest = f"sha256:{'a' * 64}"
    definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-editor-release-abcdef123456:7"
    )

    def rest(table: str, **_kwargs):
        if table == "generated_shorts":
            return [{
                "id": "short-a",
                "job_id": "job-a",
                "status": "rerendering",
                "render_version": 3,
                "rerender_batch_job_id": None,
                "pending_edit_request_id": request_id,
                "mvp_session_id": "session-a",
            }]
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "mvp_session_id": "session-a",
                "user_id": "user-a",
                "dispatch_priority_class": "paid",
            }]
        if table == "editor_render_requests":
            return [{"release_id": release_id, "release_channel": "canary"}]
        if table == "editor_releases":
            return [{
                "id": release_id,
                "worker_image_digest": digest,
                "production_job_definition_arn": definition,
            }]
        return []

    module.rest = rest
    module._submit_once = MagicMock(return_value="canary-batch-a")
    module.patch = MagicMock()

    assert module._submit({"kind": "rerender", "shortId": "short-a"}) == (
        "canary-batch-a"
    )

    request, submission_key = module._submit_once.call_args.args
    assert request["jobQueue"] == "editor-canary-queue"
    assert request["jobDefinition"] == definition
    assert "shareIdentifier" not in request
    assert "schedulingPriorityOverride" not in request
    assert submission_key.endswith(f":release:{release_id}")
    request_patch = next(
        call for call in module.patch.call_args_list
        if call.args[0] == "editor_render_requests"
    )
    assert request_patch.args[2] == {
        "status": "rendering",
        "worker_image_digest": digest,
        "batch_job_id": "canary-batch-a",
        "updated_at": "2026-07-13T12:00:00+00:00",
    }


def test_final_canary_submit_failure_releases_pending_edit() -> None:
    module, _ = _load_lambda("batch_submitter")
    request_id = "a4f71dc3-1ffd-4670-b6d2-d4704461edc0"
    short_id = "8cf39a2c-4c34-4f78-9a1d-9bdf015a4b9e"
    module._submit = MagicMock(side_effect=RuntimeError("submit failed"))
    module.patch = MagicMock()

    result = module.handler({"Records": [{
        "messageId": "message-a",
        "body": json.dumps({
            "kind": "rerender",
            "shortId": short_id,
            "requestId": request_id,
        }),
        "attributes": {"ApproximateReceiveCount": "5"},
    }]}, None)

    assert result == {"batchItemFailures": []}
    request_patch = next(
        call for call in module.patch.call_args_list
        if call.args[0] == "editor_render_requests"
    )
    assert request_patch.args[2]["status"] == "failed"
    assert request_patch.args[2]["failure_code"] == "editor_batch_submit_failed"
    short_patch = next(
        call for call in module.patch.call_args_list
        if call.args[0] == "generated_shorts"
    )
    assert short_patch.args[2]["status"] == "ready"
    assert short_patch.args[2]["pending_edit_snapshot"] is None
    outbox_patch = next(
        call for call in module.patch.call_args_list
        if call.args[0] == "editor_render_outbox"
    )
    assert outbox_patch.args[2]["status"] == "failed"


def test_transient_canary_submit_failure_is_retried_without_releasing_edit() -> None:
    module, _ = _load_lambda("batch_submitter")
    module._submit = MagicMock(side_effect=RuntimeError("submit failed"))
    module.patch = MagicMock()

    result = module.handler({"Records": [{
        "messageId": "message-a",
        "body": json.dumps({
            "kind": "rerender",
            "shortId": "8cf39a2c-4c34-4f78-9a1d-9bdf015a4b9e",
            "requestId": "a4f71dc3-1ffd-4670-b6d2-d4704461edc0",
        }),
        "attributes": {"ApproximateReceiveCount": "4"},
    }]}, None)

    assert result == {"batchItemFailures": [{"itemIdentifier": "message-a"}]}
    module.patch.assert_not_called()


def test_stable_rerender_reuses_the_promoted_canary_job_definition() -> None:
    module, _ = _load_lambda("batch_submitter")
    release_id = "f0c49c16-3efd-4478-9e69-b0c41f2f3eb0"
    definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-editor-release-abcdef123456:7"
    )

    def rest(table: str, **_kwargs):
        if table == "editor_render_requests":
            return [{"release_id": release_id, "release_channel": "stable"}]
        if table == "editor_releases":
            return [{
                "id": release_id,
                "worker_image_digest": f"sha256:{'b' * 64}",
                "production_job_definition_arn": definition,
            }]
        return []

    module.rest = rest

    assert module._editor_release_target("request-a") == (
        "editor-stable-queue",
        definition,
        f"sha256:{'b' * 64}",
        release_id,
    )


def test_editor_release_infrastructure_retry_keeps_release_and_uses_new_batch_job() -> None:
    module, _ = _load_lambda("batch_submitter")
    request_id = "a4f71dc3-1ffd-4670-b6d2-d4704461edc0"
    release_id = "f0c49c16-3efd-4478-9e69-b0c41f2f3eb0"
    digest = f"sha256:{'d' * 64}"
    definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-editor-release-abcdef123456:7"
    )

    def rest(table: str, **_kwargs):
        if table == "generated_shorts":
            return [{
                "id": "short-a",
                "job_id": "job-a",
                "status": "rerendering",
                "render_version": 3,
                "rerender_batch_job_id": None,
                "pending_edit_request_id": request_id,
                "mvp_session_id": "session-a",
            }]
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "mvp_session_id": "session-a",
                "user_id": "user-a",
                "dispatch_priority_class": "paid",
            }]
        return []

    module.rest = rest
    module._editor_release_target = MagicMock(return_value=(
        "editor-canary-queue",
        definition,
        digest,
        release_id,
    ))
    module._submit_once = MagicMock(return_value="retry-batch-new")
    module.patch = MagicMock()

    result = module._submit({
        "kind": "rerender",
        "shortId": "short-a",
        "attempt": 1,
    })

    assert result == "retry-batch-new"
    request, submission_key = module._submit_once.call_args.args
    assert request["jobName"].startswith("shorts-rerender-short-a-v4-a1-")
    assert request["jobQueue"] == "editor-canary-queue"
    assert request["jobDefinition"] == definition
    assert request["parameters"] == {"rerenderAttempt": "1"}
    assert submission_key == (
        f"rerender:short-a:4:1:{request_id}:release:{release_id}"
    )
    request_patch = next(
        call for call in module.patch.call_args_list
        if call.args[0] == "editor_render_requests"
    )
    assert request_patch.args[2]["worker_image_digest"] == digest
    assert request_patch.args[2]["batch_job_id"] == "retry-batch-new"


def test_editor_release_target_rejects_an_untrusted_job_definition() -> None:
    module, _ = _load_lambda("batch_submitter")

    def rest(table: str, **_kwargs):
        if table == "editor_render_requests":
            return [{"release_id": "release-a", "release_channel": "canary"}]
        if table == "editor_releases":
            return [{
                "id": "release-a",
                "worker_image_digest": f"sha256:{'c' * 64}",
                "production_job_definition_arn": "rerender-definition:99",
            }]
        return []

    module.rest = rest

    try:
        module._editor_release_target("request-a")
    except RuntimeError as error:
        assert str(error) == "Editor release job definition is not trusted"
    else:
        raise AssertionError("untrusted release definition was accepted")


def _editor_release_registration_event(
    document_version: int = 2,
) -> dict[str, object]:
    return {
        "gitSha": "a" * 40,
        "uiVersion": 2,
        "documentVersion": document_version,
        "subtitleEditingCapable": True,
        "imageDigest": f"sha256:{'b' * 64}",
        "productionJobDefinitionArn": (
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
            "shorts-mvp-editor-release-aaaaaaaaaaaa-4vcpu:3"
        ),
        "isolatedJobDefinitionArn": (
            "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
            "shorts-mvp-editor-test-release-aaaaaaaaaaaa-4vcpu:2"
        ),
        "isolatedBatchJobId": "isolated-job-a",
        "artifactUri": (
            "s3://isolated-editor-test/editor-release-probes/"
            f"{'a' * 40}/{'b' * 12}/manifest.json"
        ),
        "workflowRunUrl": "https://github.example/actions/runs/1",
    }


def _editor_release_manifest(document_version: int = 2) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "gitSha": "a" * 40,
        "workerImageDigest": f"sha256:{'b' * 64}",
        "documentVersion": document_version,
        "checks": {
            "worker-image": True,
            "legacy-no-timeline": True,
            "captured-timeline": True,
            "editor-v2": True,
            "ffprobe": True,
            "frame-parity": True,
        },
        "checkSources": {},
        "media": {
            "width": 1080,
            "height": 1920,
            "videoCodec": "h264",
            "audioCodec": "aac",
        },
        "geometry": {"maximumErrorPixels": 2},
        "fonts": [
            "pretendard",
            "noto-sans-kr",
            "do-hyeon",
            "jua",
            "jalnan-2",
            "cafe24-anemone",
            "cafe24-pro-up",
            "sandbox-aggro",
            "galmuri-9",
            "black-han-sans",
            "godo",
            "gmarket-sans",
            "nanum-square-neo",
            "s-core-dream",
            "suit",
            "spoqa-han-sans-neo",
            "noto-serif-kr",
            "nanum-myeongjo",
            "ridi-batang",
            "paperlogy",
        ],
        "capabilities": {"subtitleEditing": True},
    }


def _editor_release_job_definition(
    name: str,
    *,
    image: str | None,
    vcpus: str,
) -> dict[str, object]:
    container: dict[str, object] = {
        "jobRoleArn": "arn:aws:iam::123456789012:role/trusted",
        "command": ["python", "-m", "shorts_worker", "rerender"],
        "environment": [
            {"name": "TASK_VCPUS", "value": vcpus},
            {"name": "FFMPEG_THREADS", "value": vcpus},
        ],
        "resourceRequirements": [
            {"type": "MEMORY", "value": "16384"},
            {"type": "VCPU", "value": vcpus},
        ],
    }
    if image is not None:
        container["image"] = image
    return {
        "status": "ACTIVE",
        "revision": 1,
        "jobDefinitionName": name,
        "type": "container",
        "containerProperties": container,
        "platformCapabilities": ["FARGATE"],
    }


@pytest.mark.parametrize("document_version", [2, 3])
def test_editor_release_registrar_verifies_evidence_before_creating_candidate(
    document_version: int,
) -> None:
    module, _ = _load_lambda("editor_release_registrar")
    event = _editor_release_registration_event(document_version)
    digest = event["imageDigest"]
    image = f"123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/shorts@{digest}"
    module.batch = MagicMock()
    module.batch.describe_jobs.return_value = {"jobs": [{
        "status": "SUCCEEDED",
        "jobDefinition": event["isolatedJobDefinitionArn"],
        "stoppedAt": int(datetime.now(UTC).timestamp() * 1000),
    }]}
    module.batch.describe_job_definitions.side_effect = [
        {"jobDefinitions": [_editor_release_job_definition(
            "shorts-mvp-editor-release-aaaaaaaaaaaa-4vcpu",
            image=image,
            vcpus="4",
        )]},
        {"jobDefinitions": [_editor_release_job_definition(
            "shorts-mvp-editor-test-release-aaaaaaaaaaaa-4vcpu",
            image=image,
            vcpus="4",
        )]},
        {"jobDefinitions": [_editor_release_job_definition(
            "trusted-production-template",
            image=None,
            vcpus="2",
        )]},
        {"jobDefinitions": [_editor_release_job_definition(
            "trusted-isolated-template",
            image=None,
            vcpus="2",
        )]},
    ]
    module.ecr = MagicMock()
    module.ecr.describe_image_scan_findings.return_value = {
        "imageScanStatus": {"status": "COMPLETE"},
        "imageScanFindings": {"findingSeverityCounts": {"CRITICAL": 0}},
    }
    module.s3 = MagicMock()
    module.s3.get_object.return_value = {
        "Body": io.BytesIO(
            json.dumps(_editor_release_manifest(document_version)).encode()
        )
    }
    os.environ["EDITOR_TEST_BUCKET_NAME"] = "isolated-editor-test"
    os.environ["RERENDER_JOB_DEFINITION"] = "trusted-production-template"
    os.environ["EDITOR_TEST_TEMPLATE_JOB_DEFINITION"] = "trusted-isolated-template"
    release_id = "7fd1c249-6cef-40f1-97d4-e4e6c837f60a"
    calls: list[tuple[str, dict[str, object]]] = []

    def rest(table: str, **kwargs):
        calls.append((table, kwargs))
        if table == "editor_releases" and kwargs.get("method") is None:
            return []
        if table == "editor_releases" and kwargs.get("method") == "POST":
            return [{"id": release_id}]
        if table == "editor_release_state" and kwargs.get("method") is None:
            return [{"candidate_release_id": None, "canary_enabled": False}]
        return None

    module.rest = rest

    result = module.handler(event, None)

    assert result == {"releaseId": release_id, "status": "canary_ready"}
    check_calls = [
        kwargs for table, kwargs in calls
        if table == "editor_release_checks" and kwargs.get("method") == "POST"
    ]
    assert {call["body"]["check_name"] for call in check_calls} == {
        "worker-image",
        "legacy-no-timeline",
        "captured-timeline",
        "editor-v2",
        "ffprobe",
        "frame-parity",
    }
    release_post = next(
        kwargs for table, kwargs in calls
        if table == "editor_releases" and kwargs.get("method") == "POST"
    )
    assert release_post["body"]["subtitle_editing_capable"] is True
    state_patch = next(
        kwargs for table, kwargs in calls
        if table == "editor_release_state" and kwargs.get("method") == "PATCH"
    )
    assert state_patch["body"] == {
        "candidate_release_id": release_id,
        "canary_enabled": False,
    }


def test_editor_release_registrar_rejects_critical_ecr_findings() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    module.ecr = MagicMock()
    module.ecr.describe_image_scan_findings.return_value = {
        "imageScanStatus": {"status": "COMPLETE"},
        "imageScanFindings": {"findingSeverityCounts": {"CRITICAL": 1}},
    }

    try:
        module._verify_ecr_scan(
            "registry.example/shorts@" + f"sha256:{'b' * 64}",
            f"sha256:{'b' * 64}",
        )
    except RuntimeError as error:
        assert str(error) == "ECR image has a critical vulnerability"
    else:
        raise AssertionError("critical image was accepted")


def test_editor_release_registrar_requires_declared_subtitle_editing_capability() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    event = _editor_release_registration_event()
    event.pop("subtitleEditingCapable")

    with pytest.raises(
        ValueError,
        match="must declare subtitle editing capability",
    ):
        module.handler(event, None)


def test_editor_release_registrar_rejects_incomplete_subtitle_evidence() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    manifest = _editor_release_manifest()
    manifest["fonts"] = list(manifest["fonts"])[:-1]

    with pytest.raises(RuntimeError, match="verify every bundled font"):
        module._verify_manifest(
            manifest,
            git_sha="a" * 40,
            digest=f"sha256:{'b' * 64}",
            document_version=2,
            subtitle_editing_capable=True,
        )

    manifest = _editor_release_manifest()
    manifest["capabilities"] = {"subtitleEditing": False}
    with pytest.raises(RuntimeError, match="subtitle editing capability"):
        module._verify_manifest(
            manifest,
            git_sha="a" * 40,
            digest=f"sha256:{'b' * 64}",
            document_version=2,
            subtitle_editing_capable=True,
        )


def test_editor_release_registrar_rejects_definition_contract_drift() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    trusted = {
        "type": "container",
        "containerProperties": {
            "jobRoleArn": "arn:aws:iam::123456789012:role/trusted",
            "command": ["python", "-m", "shorts_worker", "rerender"],
            "environment": [{"name": "TASK_VCPUS", "value": "2"}],
        },
        "platformCapabilities": ["FARGATE"],
    }
    candidate = deepcopy(trusted)
    candidate["containerProperties"]["jobRoleArn"] = (
        "arn:aws:iam::123456789012:role/untrusted"
    )

    try:
        module._verify_definition_contract(candidate, trusted)
    except RuntimeError as error:
        assert str(error) == (
            "Editor release job definition differs from its trusted template"
        )
    else:
        raise AssertionError("definition role drift was accepted")


def test_editor_release_registrar_allows_only_the_4_vcpu_candidate_delta() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    trusted = _editor_release_job_definition(
        "trusted-template",
        image=None,
        vcpus="2",
    )
    candidate = _editor_release_job_definition(
        "shorts-mvp-editor-release-aaaaaaaaaaaa-4vcpu",
        image="registry.example/shorts@sha256:" + "b" * 64,
        vcpus="4",
    )

    module._verify_definition_contract(
        candidate,
        trusted,
        allow_candidate_resources=True,
    )

    invalid = deepcopy(candidate)
    invalid["containerProperties"]["resourceRequirements"][1]["value"] = "8"
    with pytest.raises(RuntimeError, match="exactly 4 vCPU"):
        module._verify_definition_contract(
            invalid,
            trusted,
            allow_candidate_resources=True,
        )


def test_editor_release_registration_retry_never_pauses_an_active_canary() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    event = _editor_release_registration_event()
    release_id = "7fd1c249-6cef-40f1-97d4-e4e6c837f60a"
    calls: list[tuple[str, dict[str, object]]] = []

    def rest(table: str, **kwargs):
        calls.append((table, kwargs))
        if table == "editor_releases" and kwargs.get("method") is None:
            return [{
                "id": release_id,
                "status": "canary_ready",
                "ui_version": 2,
                "document_version": 2,
                "production_job_definition_arn": (
                    event["productionJobDefinitionArn"]
                ),
                "subtitle_editing_capable": True,
            }]
        if table == "editor_release_state" and kwargs.get("method") is None:
            return [{
                "candidate_release_id": release_id,
                "canary_enabled": True,
            }]
        return None

    module.rest = rest

    result = module._record_release(
        event,
        git_sha=str(event["gitSha"]),
        digest=str(event["imageDigest"]),
        production_definition_arn=str(event["productionJobDefinitionArn"]),
        artifact_uri=str(event["artifactUri"]),
        manifest=_editor_release_manifest(),
        subtitle_editing_capable=True,
    )

    assert result == release_id
    assert not any(
        table == "editor_release_state" and kwargs.get("method") == "PATCH"
        for table, kwargs in calls
    )


def test_existing_release_cannot_gain_subtitle_capability_after_registration() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    event = _editor_release_registration_event()

    def rest(table: str, **kwargs):
        if table == "editor_releases" and kwargs.get("method") is None:
            return [{
                "id": "7fd1c249-6cef-40f1-97d4-e4e6c837f60a",
                "status": "canary_ready",
                "ui_version": 2,
                "document_version": 2,
                "production_job_definition_arn": (
                    event["productionJobDefinitionArn"]
                ),
                "subtitle_editing_capable": False,
            }]
        return None

    module.rest = rest

    with pytest.raises(RuntimeError, match="different immutable data"):
        module._record_release(
            event,
            git_sha=str(event["gitSha"]),
            digest=str(event["imageDigest"]),
            production_definition_arn=str(event["productionJobDefinitionArn"]),
            artifact_uri=str(event["artifactUri"]),
            manifest=_editor_release_manifest(),
            subtitle_editing_capable=True,
        )


def test_legacy_rerender_new_save_never_reuses_a_failed_batch_identity() -> None:
    module, _ = _load_lambda("batch_submitter")
    short = {
        "id": "short-a",
        "job_id": "job-a",
        "status": "rerendering",
        "render_version": 3,
        "rerender_batch_job_id": None,
        "pending_render_hash": "same-edited-content",
        "updated_at": "2026-07-31T05:00:00+00:00",
        "mvp_session_id": "session-a",
    }

    def rest(table: str, **_kwargs):
        if table == "generated_shorts":
            return [short]
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "mvp_session_id": "session-a",
                "user_id": "user-a",
                "dispatch_priority_class": "paid",
            }]
        return []

    module.rest = rest
    module._submit_once = MagicMock(side_effect=["batch-first", "batch-second"])
    module.patch = MagicMock()

    assert module._submit({
        "kind": "rerender", "shortId": "short-a",
    }) == "batch-first"
    first_request, first_key = module._submit_once.call_args.args

    short["updated_at"] = "2026-07-31T05:01:00+00:00"
    assert module._submit({
        "kind": "rerender", "shortId": "short-a",
    }) == "batch-second"
    second_request, second_key = module._submit_once.call_args.args

    assert first_key != second_key
    assert first_request["jobName"] != second_request["jobName"]


def test_batch_submission_claim_reuses_an_already_recorded_job() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "action": "existing",
        "aws_batch_job_id": "batch-existing",
    }])
    module.batch = MagicMock()

    result = module._submit_once({
        "jobName": "shorts-prepare-abcd1234",
        "jobQueue": "prepare-queue",
    }, "prepare:dispatch-a")

    assert result == "batch-existing"
    module.batch.list_jobs.assert_not_called()
    module.batch.submit_job.assert_not_called()


def test_prepare_batch_submits_without_a_global_circuit_delay() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "status": "queued",
        "aws_batch_job_id": None,
    }])
    module._submit_once = MagicMock(return_value="batch-a")

    result = module._submit({
        "kind": "prepare_batch",
        "dispatchBatchId": "dispatch-abcdef",
        "itemCount": 20,
    })

    assert result == "batch-a"
    request, submission_key = module._submit_once.call_args.args
    assert request["jobName"] == "shorts-prepare-dispatch-abcdef"
    assert request["arrayProperties"] == {"size": 20}
    assert submission_key == "prepare:dispatch-abcdef"
    source = (LAMBDA_DIR / "batch_submitter.py").read_text(encoding="utf-8")
    assert "claim_ingestion_gate" not in source
    assert "DelaySeconds=60" not in source


def test_render_submission_uses_fair_share_and_one_batch_attempt() -> None:
    module, _ = _load_lambda("batch_submitter")

    def rest(table: str, **kwargs):
        if table == "generated_shorts":
            return [{"id": "short-a", "render_batch_job_id": None}]
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "status": "rendering",
                "deadline_at": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
                "mvp_session_id": "session-a",
                "user_id": "user-a",
                "dispatch_priority_class": "free",
            }]
        return []

    module.rest = rest
    module._submit_once = MagicMock(return_value="render-parent")
    module.patch = MagicMock()

    result = module._submit({
        "kind": "render",
        "jobId": "job-a",
        "shardCount": 4,
    })

    assert result == "render-parent"
    request, submission_key = module._submit_once.call_args.args
    assert submission_key == "render:job-a"
    assert request["arrayProperties"] == {"size": 4}
    assert request["retryStrategy"] == {"attempts": 1}
    assert request["schedulingPriorityOverride"] == 0
    assert request["parameters"] == {"renderRetryCount": "0"}
    assert request["shareIdentifier"].startswith("freeuser")
    assert request["shareIdentifier"].isalnum()
    assert request["containerOverrides"]["environment"][0]["name"] == (
        "RENDER_SUBMITTED_AT"
    )


def test_render_retry_preserves_share_and_increments_retry_parameter() -> None:
    module, _ = _load_lambda("batch_submitter")

    def rest(table: str, **kwargs):
        if table == "generated_shorts":
            return [{"id": "short-a"}]
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "status": "rendering",
                "deadline_at": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
                "mvp_session_id": "session-a",
                "user_id": "user-a",
                "dispatch_priority_class": "paid",
            }]
        return []

    module.rest = rest
    module._submit_once = MagicMock(return_value="render-retry")
    module.patch = MagicMock()

    result = module._submit({
        "kind": "render_retry",
        "jobId": "job-a",
        "shardIndex": 2,
        "failedBatchJobId": "render-parent",
        "retryCount": 1,
    })

    assert result == "render-retry"
    request, _ = module._submit_once.call_args.args
    assert request["parameters"] == {"renderRetryCount": "1"}
    assert request["retryStrategy"] == {"attempts": 1}
    assert request["schedulingPriorityOverride"] == 1000
    assert request["shareIdentifier"].startswith("paiduser")
    assert request["jobName"].endswith("-2-1")


def test_outbox_dispatcher_forwards_paid_priority_snapshot() -> None:
    module, aws_client = _load_lambda("outbox_dispatcher")
    aws_client.invoke.return_value = {
        "Payload": io.BytesIO(b'{"batchJobId":"project-batch-a"}')
    }

    def rest(table: str, **_kwargs):
        if table == "rpc/claim_project_job_outbox":
            return [{
                "outbox_id": "outbox-a",
                "job_id": "job-a",
                "route_id": "route-a",
                "priority_class": "paid",
            }]
        if table in {"rpc/claim_job_outbox", "rpc/claim_short_outbox"}:
            return []
        return []

    module.rest = rest

    result = module.handler({}, None)

    assert result["dispatchedProjects"] == 1
    assert result["failedProjects"] == 0
    invocation = aws_client.invoke.call_args.kwargs
    assert json.loads(invocation["Payload"]) == {
        "kind": "project",
        "jobId": "job-a",
        "priorityClass": "paid",
    }


def test_outbox_dispatcher_submits_prepare_directly_without_sqs() -> None:
    module, aws_client = _load_lambda("outbox_dispatcher")
    aws_client.invoke.return_value = {
        "Payload": io.BytesIO(b'{"batchJobId":"batch-a"}')
    }

    def rest(table: str, **_kwargs):
        if table == "rpc/claim_job_outbox":
            return [{"dispatch_batch_id": "dispatch-a", "item_count": 1}]
        if table == "rpc/claim_short_outbox":
            return []
        return []

    module.rest = rest

    result = module.handler({}, None)

    assert result == {
        "dispatchedProjects": 0,
        "failedProjects": 0,
        "dispatchedBatches": 1,
        "dispatchedJobs": 1,
        "failedBatches": 0,
        "dispatchedRerenders": 0,
        "failedRerenders": 0,
    }
    invocation = aws_client.invoke.call_args.kwargs
    assert invocation["FunctionName"] == "batch-submitter"
    assert invocation["InvocationType"] == "RequestResponse"
    assert json.loads(invocation["Payload"]) == {
        "kind": "prepare_batch",
        "dispatchBatchId": "dispatch-a",
        "itemCount": 1,
    }
    aws_client.send_message.assert_not_called()


def test_outbox_dispatcher_continues_after_one_project_submit_failure() -> None:
    module, aws_client = _load_lambda("outbox_dispatcher")
    aws_client.invoke.side_effect = [
        {
            "FunctionError": "Unhandled",
            "Payload": io.BytesIO(b'{"errorMessage":"untrusted target"}'),
        },
        {"Payload": io.BytesIO(b'{"batchJobId":"project-batch-b"}')},
    ]

    def rest(table: str, **_kwargs):
        if table == "rpc/claim_project_job_outbox":
            return [
                {
                    "outbox_id": "outbox-a",
                    "job_id": "job-a",
                    "route_id": "route-a",
                    "priority_class": "paid",
                },
                {
                    "outbox_id": "outbox-b",
                    "job_id": "job-b",
                    "route_id": "route-b",
                    "priority_class": "free",
                },
            ]
        if table == "video_jobs":
            return []
        if table == "batch_submission_claims":
            return []
        if table in {"rpc/claim_job_outbox", "rpc/claim_short_outbox"}:
            return []
        if table == "rpc/release_ingestion_route":
            return [{"released": True}]
        return []

    module.rest = rest
    module.patch = MagicMock()

    result = module.handler({}, None)

    assert result["dispatchedProjects"] == 1
    assert result["failedProjects"] == 1
    assert aws_client.invoke.call_count == 2
    failed_patch = next(
        call for call in module.patch.call_args_list
        if call.args[0] == "project_job_outbox"
    )
    assert failed_patch.args[1] == "id=eq.outbox-a"
    assert failed_patch.args[2]["status"] == "pending"


def test_paid_job_priority_migration_is_aged_and_non_preemptive() -> None:
    sql = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607290003_paid_job_priority.sql"
    ).read_text(encoding="utf-8")

    assert "dispatch_priority_class in ('paid','free')" in sql
    assert "subscription.status in ('active','trialing')" in sql
    assert "subscription.billing_cycle in ('monthly','yearly')" in sql
    assert "interval '15 minutes'" in sql
    assert "for update of o skip locked" in sql
    assert "status not in ('completed','failed','expired','deleted')" in sql
    assert "set status='failed'" not in sql


def test_completion_migration_never_revives_terminal_or_late_jobs() -> None:
    sql = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607130008_pipeline_failure_recovery.sql"
    ).read_text(encoding="utf-8")

    assert "status not in ('completed','failed','expired','deleted')" in sql
    assert "deadline_at > clock_timestamp()" in sql
    assert "handle_prepare_batch_failure" in sql
    assert "claim_batch_submission" in sql
    assert "claim_ingestion_gate" in sql
    assert "fail_video_job_at_deadline" in sql
    assert "set status='failed', render_progress=0" in sql
    assert "deleted_at=coalesce(deleted_at, now())" not in sql


def test_deadline_cleanup_claims_the_job_before_stopping_workers() -> None:
    module, _ = _load_lambda("cleanup")
    order: list[str] = []

    def rest(table: str, **_kwargs):
        if table == "video_jobs":
            return [{
                "id": "job-a",
                "aws_batch_job_id": "prepare-a",
                "status": "rendering",
                "dispatch_batch_id": None,
            }]
        if table == "rpc/fail_video_job_at_deadline":
            order.append("claim")
            return [{"failed": True}]
        if table == "generated_shorts":
            return [{
                "id": "short-a",
                "render_batch_job_id": "render-a",
                "output_s3_key": "outputs/a.mp4",
                "clean_clip_s3_key": "edit-sources/a.mp4",
                "thumbnail_s3_key": "thumbnails/a.jpg",
            }]
        return []

    module.rest = rest
    module.batch = MagicMock()
    module.batch.terminate_job.side_effect = lambda **_kwargs: order.append("terminate")
    module._delete_keys = MagicMock()

    assert module.enforce_deadlines() == 1
    assert order[0] == "claim"
    assert order.count("terminate") == 2
    module._delete_keys.assert_called_once()
