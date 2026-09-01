from __future__ import annotations

import hashlib
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
    os.environ.pop("PROJECT_TARGET_REGISTRY_JSON", None)
    os.environ.pop("PROJECT_TARGET_REGISTRY_PATH", None)
    os.environ.pop("PROJECT_TARGET_REGISTRY_REQUIRED", None)
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


def _project_target_registry() -> dict[str, object]:
    def lane(prefix: str, release_id: str, *, scheduling: str = "fair_share"):
        return {
            "schedulingMode": scheduling,
            "current": {
                "releaseId": release_id,
                "workerSourceGitSha": "a" * 40,
                "imageUri": (
                    "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/"
                    f"shorts@sha256:{'b' * 64}"
                ),
                "jobDefinitionArn": os.environ[f"{prefix}_JOB_DEFINITION_ARN"],
                "jobQueueArn": os.environ[f"{prefix}_BATCH_QUEUE_ARN"],
            },
            "previous": None,
        }

    registry: dict[str, object] = {
        "version": 1,
        "environment": "production",
        "lanes": {
            "legacy_project": lane("LEGACY_PROJECT", "legacy-r27"),
            "source_range": lane("SOURCE_RANGE", "source-range-r1"),
            "elevenlabs_transcription": lane(
                "ELEVENLABS_TRANSCRIPTION", "elevenlabs-r1"
            ),
            "subtitle_templates": lane(
                "SUBTITLE_TEMPLATES", "subtitle-templates-r1"
            ),
            "unified_template_subtitles": lane(
                "UNIFIED_TEMPLATE_SUBTITLES",
                "unified-current-r4",
                scheduling="fifo",
            ),
        },
    }
    return registry


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
        call.args[0] != "rpc/finalize_stale_video_job_if_unchanged"
        for call in module.rest.call_args_list
    )


def test_stale_job_cleanup_finalizes_only_through_atomic_observation_rpc() -> None:
    module, batch = _load_lambda("cleanup")
    now = datetime.now(UTC)
    observed_heartbeat = (now - timedelta(hours=3)).isoformat()
    candidate = {
        "id": "job-stale",
        "aws_batch_job_id": "terminal-batch",
        "status": "extracting",
        "heartbeat_at": observed_heartbeat,
        "created_at": (now - timedelta(hours=4)).isoformat(),
        "execution_backend": "aws_batch",
        "claimed_at": now.isoformat(),
    }
    rpc_bodies: list[dict[str, object]] = []

    def rest(table: str, **kwargs):
        if table == "video_jobs":
            return [candidate]
        if table == "rpc/finalize_stale_video_job_if_unchanged":
            rpc_bodies.append(kwargs["body"])
            return [{"finalized": True, "reason": "finalized", "final_status": "failed"}]
        return []

    module.rest = MagicMock(side_effect=rest)
    module.patch = MagicMock()
    batch.describe_jobs.return_value = {"jobs": [{"status": "FAILED"}]}

    assert module.release_stale_jobs() == 1
    assert len(rpc_bodies) == 1
    assert rpc_bodies[0]["p_job_id"] == "job-stale"
    assert rpc_bodies[0]["p_observed_aws_batch_job_id"] == "terminal-batch"
    assert rpc_bodies[0]["p_observed_status"] == "extracting"
    assert rpc_bodies[0]["p_observed_heartbeat_at"] == observed_heartbeat
    assert datetime.fromisoformat(str(rpc_bodies[0]["p_created_before"])) < now
    assert datetime.fromisoformat(str(rpc_bodies[0]["p_heartbeat_before"])) < now
    module.patch.assert_not_called()


def test_stale_job_cleanup_does_not_count_a_changed_atomic_observation() -> None:
    module, batch = _load_lambda("cleanup")
    now = datetime.now(UTC)
    candidate = {
        "id": "job-recovered",
        "aws_batch_job_id": "old-terminal-batch",
        "status": "extracting",
        "heartbeat_at": (now - timedelta(hours=3)).isoformat(),
        "created_at": (now - timedelta(hours=4)).isoformat(),
        "execution_backend": "aws_batch",
        "claimed_at": now.isoformat(),
    }

    def rest(table: str, **_kwargs):
        if table == "video_jobs":
            return [candidate]
        if table == "rpc/finalize_stale_video_job_if_unchanged":
            return [{
                "finalized": False,
                "reason": "observation_changed",
                "final_status": "rendering",
            }]
        return []

    module.rest = rest
    batch.describe_jobs.return_value = {"jobs": [{"status": "FAILED"}]}

    assert module.release_stale_jobs() == 0


def test_cleanup_emits_structured_batch_dispatch_health() -> None:
    module, _ = _load_lambda("cleanup")
    module.rest = MagicMock(return_value=[{
        "actionable_queued_without_batch_id": 3,
        "oldest_actionable_at": "2026-08-26T03:00:00+00:00",
        "oldest_actionable_age_seconds": 601,
        "submission_claim_without_job_id": 0,
        "oldest_submission_claim_at": None,
        "oldest_submission_claim_age_seconds": None,
    }])
    module.log_event = MagicMock()

    assert module.report_batch_dispatch_health() == 3
    assert module.log_event.call_args_list[0].args == ("project_dispatch_health",)
    assert module.log_event.call_args_list[0].kwargs == {
        "actionableQueuedWithoutBatchId": 3,
        "oldestActionableAt": "2026-08-26T03:00:00+00:00",
        "oldestActionableAgeSeconds": 601,
        "submissionClaimWithoutJobId": 0,
        "oldestSubmissionClaimAt": None,
        "oldestSubmissionClaimAgeSeconds": None,
        "healthy": False,
    }
    assert module.log_event.call_args_list[1].args == ("queued_without_batch_id",)
    assert module.log_event.call_args_list[1].kwargs == {
        "count": 3,
        "oldest_seconds": 601,
    }


def test_cleanup_does_not_emit_dispatch_alert_when_healthy() -> None:
    module, _ = _load_lambda("cleanup")
    module.rest = MagicMock(return_value=[{
        "actionable_queued_without_batch_id": 0,
        "oldest_actionable_at": None,
        "oldest_actionable_age_seconds": None,
        "submission_claim_without_job_id": 0,
        "oldest_submission_claim_at": None,
        "oldest_submission_claim_age_seconds": None,
    }])
    module.log_event = MagicMock()

    assert module.report_batch_dispatch_health() == 0
    assert module.log_event.call_count == 1
    assert module.log_event.call_args.args == ("project_dispatch_health",)


def test_cleanup_alerts_on_a_completed_submission_missing_from_the_job() -> None:
    module, _ = _load_lambda("cleanup")
    module.rest = MagicMock(return_value=[{
        "actionable_queued_without_batch_id": 0,
        "oldest_actionable_at": None,
        "oldest_actionable_age_seconds": None,
        "submission_claim_without_job_id": 2,
        "oldest_submission_claim_at": "2026-08-26T03:00:00+00:00",
        "oldest_submission_claim_age_seconds": 701,
    }])
    module.log_event = MagicMock()

    assert module.report_batch_dispatch_health() == 0
    assert module.log_event.call_args_list[0].kwargs["healthy"] is False
    assert module.log_event.call_args_list[1].args == (
        "batch_submission_reconciliation_required",
    )
    assert module.log_event.call_args_list[1].kwargs == {
        "count": 2,
        "oldest_seconds": 701,
    }


def test_dispatch_health_failure_does_not_block_core_cleanup() -> None:
    module, _ = _load_lambda("cleanup")
    module.report_batch_dispatch_health = MagicMock(
        side_effect=RuntimeError("database unavailable")
    )
    module.enforce_deadlines = MagicMock(return_value=1)
    module.cleanup_failed_shorts = MagicMock(return_value=(2, 3))
    module.expire_shorts = MagicMock(return_value=(4, 5))
    module.release_stale_jobs = MagicMock(return_value=6)
    module.reset_stale_rerenders = MagicMock(return_value=7)
    module.log_event = MagicMock()

    assert module.handler({}, None) == {
        "expiredShorts": 4,
        "cleanedFailedShorts": 2,
        "deletedObjects": 8,
        "releasedStaleJobs": 6,
        "resetStaleRerenders": 7,
        "enforcedDeadlines": 1,
        "actionableQueuedWithoutBatchId": -1,
    }
    module.enforce_deadlines.assert_called_once_with()
    assert module.log_event.call_args_list[0].args == (
        "project_dispatch_health_check_failed",
    )
    assert module.log_event.call_args_list[0].kwargs == {
        "error_type": "RuntimeError",
    }


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


def test_project_capacity_redispatch_uses_generation_identity() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-capacity",
        "status": "retry_waiting",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "project_dispatch_generation": 3,
        "aws_batch_job_id": None,
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "preparation_finished_at": None,
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "batch_job_definition": None,
        "dispatch_priority_class": "paid",
    }])
    module._submit_once = MagicMock(return_value="project-batch-generation-3")

    result = module._submit({
        "kind": "project",
        "jobId": "job-capacity",
        "dispatchGeneration": 3,
    })

    assert result == "project-batch-generation-3"
    request, submission_key = module._submit_once.call_args.args
    assert request["jobName"] == "shorts-project-job-capacity-generation-3"
    assert submission_key == "project:job-capacity:generation:3"
    assert request["containerOverrides"]["command"][-2:] == [
        "--dispatch-generation", "3",
    ]
    assert {
        "name": "PROJECT_DISPATCH_GENERATION",
        "value": "3",
    } in request["containerOverrides"]["environment"]


def test_project_capacity_redispatch_rejects_stale_generation_payload() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-capacity",
        "status": "retry_waiting",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "project_dispatch_generation": 3,
        "aws_batch_job_id": None,
    }])
    module._submit_once = MagicMock()

    assert module._submit({
        "kind": "project",
        "jobId": "job-capacity",
        "dispatchGeneration": 2,
    }) is None
    module._submit_once.assert_not_called()


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
    assert module._submit_once.call_args.kwargs["project_binding"] == {
        "p_video_job_id": "job-heavy",
        "p_expected_batch_target_key": None,
        "p_expected_batch_target_release_id": None,
        "p_observed_job_definition": None,
        "p_observed_job_queue": None,
    }
    module.patch.assert_not_called()


def test_project_submission_reconciles_an_eventbridge_recorded_id_after_status_advance() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-reconcile",
        "status": "rendering",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": "batch-recorded",
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "preparation_finished_at": None,
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "batch_job_definition": os.environ[
            "LEGACY_PROJECT_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"],
        "batch_target_key": None,
        "batch_target_release_id": None,
    }])
    module._submit_once = MagicMock(return_value="batch-recorded")

    result = module._submit({"kind": "project", "jobId": "job-reconcile"})

    assert result == "batch-recorded"
    request, submission_key = module._submit_once.call_args.args
    assert submission_key == "project:job-reconcile:0"
    assert request["jobName"] == "shorts-project-job-reconcile-0"
    assert module._submit_once.call_args.kwargs["project_binding"] == {
        "p_video_job_id": "job-reconcile",
        "p_expected_batch_target_key": None,
        "p_expected_batch_target_release_id": None,
        "p_observed_job_definition": os.environ[
            "LEGACY_PROJECT_JOB_DEFINITION_ARN"
        ],
        "p_observed_job_queue": os.environ[
            "LEGACY_PROJECT_BATCH_QUEUE_ARN"
        ],
    }


def test_project_submission_reconciliation_rejects_a_different_batch_id() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "id": "job-reconcile-mismatch",
        "status": "rendering",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": "batch-recorded",
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "preparation_finished_at": None,
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "batch_job_definition": os.environ[
            "LEGACY_PROJECT_JOB_DEFINITION_ARN"
        ],
        "batch_job_queue": os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"],
        "batch_target_key": None,
        "batch_target_release_id": None,
    }])
    module._submit_once = MagicMock(return_value="batch-different")

    with pytest.raises(
        module.BatchTargetTrustRejected,
        match="changed during reconciliation",
    ):
        module._submit({
            "kind": "project",
            "jobId": "job-reconcile-mismatch",
        })


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


def test_logical_project_target_resolves_only_the_registered_current_release() -> None:
    module, _ = _load_lambda("batch_submitter")
    registry = _project_target_registry()
    os.environ["PROJECT_TARGET_REGISTRY_JSON"] = json.dumps(registry)
    job = {
        "planned_short_count": 2,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": True,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "batch_target_key": "source_range",
        "batch_target_release_id": "source-range-r1",
        "batch_job_definition": None,
        "batch_job_queue": None,
    }

    assert module._project_dispatch_target(job, resume=False) == (
        os.environ["SOURCE_RANGE_JOB_DEFINITION_ARN"],
        os.environ["SOURCE_RANGE_BATCH_QUEUE_ARN"],
        "source_range",
        60,
    )


def test_registry_keeps_name_only_legacy_project_rows_compatible() -> None:
    module, _ = _load_lambda("batch_submitter")
    registry = _project_target_registry()
    os.environ["PROJECT_TARGET_REGISTRY_JSON"] = json.dumps(registry)
    legacy_current = registry["lanes"]["legacy_project"]["current"]

    assert module._project_dispatch_target({
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": False,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "batch_target_key": None,
        "batch_target_release_id": None,
        "batch_job_definition": os.environ["PROJECT_JOB_DEFINITION"],
        "batch_job_queue": None,
    }, resume=False) == (
        legacy_current["jobDefinitionArn"],
        legacy_current["jobQueueArn"],
        "legacy",
        30,
    )


def test_bundled_registry_file_is_the_only_required_production_target_source(
    tmp_path: Path,
) -> None:
    module, _ = _load_lambda("batch_submitter")
    registry = _project_target_registry()
    registry_path = tmp_path / "production-project-targets.json"
    registry_path.write_text(json.dumps(registry), encoding="utf-8")
    os.environ["PROJECT_TARGET_REGISTRY_PATH"] = str(registry_path)
    os.environ["PROJECT_TARGET_REGISTRY_REQUIRED"] = "true"
    for prefix in (
        "LEGACY_PROJECT",
        "SOURCE_RANGE",
        "ELEVENLABS_TRANSCRIPTION",
        "SUBTITLE_TEMPLATES",
        "UNIFIED_TEMPLATE_SUBTITLES",
    ):
        os.environ.pop(f"{prefix}_JOB_DEFINITION_ARN", None)
        os.environ.pop(f"{prefix}_BATCH_QUEUE_ARN", None)
    os.environ.pop(
        "UNIFIED_TEMPLATE_SUBTITLES_PREVIOUS_JOB_DEFINITION_ARN",
        None,
    )

    assert module._project_dispatch_target({
        "planned_short_count": 2,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": True,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "batch_target_key": "source_range",
        "batch_target_release_id": "source-range-r1",
        "batch_job_definition": None,
        "batch_job_queue": None,
    }, resume=False) == (
        registry["lanes"]["source_range"]["current"]["jobDefinitionArn"],
        registry["lanes"]["source_range"]["current"]["jobQueueArn"],
        "source_range",
        60,
    )


def test_production_registry_rejects_missing_or_ambiguous_sources(
    tmp_path: Path,
) -> None:
    module, _ = _load_lambda("batch_submitter")
    os.environ["PROJECT_TARGET_REGISTRY_REQUIRED"] = "true"
    with pytest.raises(RuntimeError, match="registry is required"):
        module._production_project_target_registry()

    registry_path = tmp_path / "production-project-targets.json"
    registry_path.write_text(
        json.dumps(_project_target_registry()),
        encoding="utf-8",
    )
    os.environ["PROJECT_TARGET_REGISTRY_PATH"] = str(registry_path)
    os.environ["PROJECT_TARGET_REGISTRY_JSON"] = json.dumps(
        _project_target_registry()
    )
    with pytest.raises(RuntimeError, match="multiple configured sources"):
        module._production_project_target_registry()


def test_production_registry_rejects_conflicting_modes_for_a_shared_queue() -> None:
    module, _ = _load_lambda("batch_submitter")
    registry = _project_target_registry()
    lanes = registry["lanes"]
    assert isinstance(lanes, dict)
    source_range = lanes["source_range"]
    unified = lanes["unified_template_subtitles"]
    assert isinstance(source_range, dict)
    assert isinstance(unified, dict)
    source_current = source_range["current"]
    unified_current = unified["current"]
    assert isinstance(source_current, dict)
    assert isinstance(unified_current, dict)
    source_current["jobQueueArn"] = unified_current["jobQueueArn"]
    os.environ["PROJECT_TARGET_REGISTRY_JSON"] = json.dumps(registry)

    with pytest.raises(RuntimeError, match="conflicting scheduling modes"):
        module._production_project_target_registry()


def test_initial_render_v4_environment_requires_exact_release_and_lane_evidence() -> None:
    module, _ = _load_lambda("batch_submitter")
    git_sha = "a" * 40
    digest = f"sha256:{'b' * 64}"
    font_hash = "c" * 64
    definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-editor-v4-legacy-project-aaaaaaaaaaaa:1"
    )
    queue = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
        "shorts-mvp-project-fargate-production"
    )
    target = {
        "releaseId": "legacy-project-aaaaaaaaaaaa-v4",
        "workerSourceGitSha": git_sha,
        "imageUri": (
            "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/shorts@"
            f"{digest}"
        ),
        "jobDefinitionArn": definition,
        "jobQueueArn": queue,
        "renderSpecVersion": 4,
        "captionRenderSpecVersion": 4,
        "fontManifestSha256": font_hash,
    }
    module._production_project_target_registry = lambda: {
        "lanes": {
            "legacy_project": {
                "current": target,
                "previous": None,
            },
        },
    }
    release_id = "7fd1c249-6cef-40f1-97d4-e4e6c837f60a"

    def rest(table: str, **_kwargs):
        if table == "editor_releases":
            return [{
                "id": release_id,
                "status": "canary_ready",
                "git_sha": git_sha,
                "worker_image_digest": digest,
                "render_spec_version": 4,
                "caption_render_spec_version": 4,
                "font_manifest_sha256": font_hash,
                "staging_verified_at": "2026-08-26T00:00:00+00:00",
                "promoted_at": None,
            }]
        if table == "editor_release_project_targets":
            return [{
                "release_id": release_id,
                "target_key": "legacy_project",
                "batch_target_release_id": target["releaseId"],
                "worker_source_git_sha": git_sha,
                "worker_image_digest": digest,
                "job_definition_arn": definition,
                "job_queue_arn": queue,
            }]
        return []

    module.rest = rest
    assert module._initial_render_v4_environment(
        {
            "initial_render_spec_version": 4,
            "initial_caption_render_spec_version": 4,
        },
        job_definition=definition,
        job_queue=queue,
        resume=False,
    ) == [
        {"name": "EDITOR_RELEASE_GIT_SHA", "value": git_sha},
        {"name": "EDITOR_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_CAPTION_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_FONT_MANIFEST_SHA256", "value": font_hash},
    ]

    target["fontManifestSha256"] = "d" * 64
    with pytest.raises(
        module.BatchTargetTrustRejected,
        match="v4 release is not eligible",
    ):
        module._initial_render_v4_environment(
            {
                "initial_render_spec_version": 4,
                "initial_caption_render_spec_version": 4,
            },
            job_definition=definition,
            job_queue=queue,
            resume=False,
        )


def test_initial_render_v4_legacy_null_pair_emits_no_capability_environment() -> None:
    module, _ = _load_lambda("batch_submitter")
    module._production_project_target_registry = MagicMock()

    assert module._initial_render_v4_environment(
        {
            "initial_render_spec_version": None,
            "initial_caption_render_spec_version": None,
        },
        job_definition="definition",
        job_queue="queue",
        resume=False,
    ) == []
    module._production_project_target_registry.assert_not_called()


def test_registered_previous_release_uses_its_declared_hardened_submit_target() -> None:
    module, _ = _load_lambda("batch_submitter")
    registry = _project_target_registry()
    lanes = registry["lanes"]
    assert isinstance(lanes, dict)
    unified = lanes["unified_template_subtitles"]
    assert isinstance(unified, dict)
    previous_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-unified-template-subtitles-previous-production:1"
    )
    unified["previous"] = {
        "releaseId": "unified-previous-r1",
        "workerSourceGitSha": "c" * 40,
        "imageUri": (
            "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/"
            f"shorts@sha256:{'d' * 64}"
        ),
        "jobDefinitionArn": previous_definition,
        "jobQueueArn": os.environ["UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"],
        "submitAsReleaseId": "unified-current-r4",
    }
    os.environ["PROJECT_TARGET_REGISTRY_JSON"] = json.dumps(registry)
    job = {
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": True,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "highlight",
        "template_snapshot": {"config": {"schemaVersion": 5}},
        "subtitle_template_snapshot": {"origin": "unified-template-v5"},
        "batch_target_key": "unified_template_subtitles",
        "batch_target_release_id": "unified-previous-r1",
        "batch_job_definition": None,
        "batch_job_queue": None,
    }

    assert module._project_dispatch_target(job, resume=False) == (
        os.environ["UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"],
        os.environ["UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"],
        "unified_template_subtitles",
        225,
    )


def test_registered_previous_release_executes_itself_without_explicit_remap() -> None:
    module, _ = _load_lambda("batch_submitter")
    registry = _project_target_registry()
    lanes = registry["lanes"]
    assert isinstance(lanes, dict)
    source_range = lanes["source_range"]
    assert isinstance(source_range, dict)
    previous_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-source-range-previous-production:2"
    )
    previous_queue = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
        "shorts-mvp-source-range-previous-production"
    )
    source_range["previous"] = {
        "releaseId": "source-range-previous-r2",
        "workerSourceGitSha": "c" * 40,
        "imageUri": (
            "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/"
            f"shorts@sha256:{'d' * 64}"
        ),
        "jobDefinitionArn": previous_definition,
        "jobQueueArn": previous_queue,
    }
    os.environ["PROJECT_TARGET_REGISTRY_JSON"] = json.dumps(registry)

    assert module._project_dispatch_target({
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": True,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "batch_target_key": "source_range",
        "batch_target_release_id": "source-range-previous-r2",
        "batch_job_definition": None,
        "batch_job_queue": None,
    }, resume=False) == (
        previous_definition,
        previous_queue,
        "source_range",
        30,
    )


def test_logical_target_rejects_unknown_release_and_semantic_lane_forgery() -> None:
    module, _ = _load_lambda("batch_submitter")
    os.environ["PROJECT_TARGET_REGISTRY_JSON"] = json.dumps(
        _project_target_registry()
    )
    base_job = {
        "planned_short_count": 1,
        "clip_length_option": "sec_30",
        "source_range_selection_enabled": True,
        "transcription_policy": "openai_stable",
        "subtitle_template_id": None,
        "batch_job_definition": None,
        "batch_job_queue": None,
    }
    with pytest.raises(module.UnknownBatchTargetRelease):
        module._project_dispatch_target({
            **base_job,
            "batch_target_key": "source_range",
            "batch_target_release_id": "source-range-unknown",
        }, resume=False)
    with pytest.raises(module.BatchTargetTrustRejected):
        module._project_dispatch_target({
            **base_job,
            "batch_target_key": "legacy_project",
            "batch_target_release_id": "legacy-r27",
        }, resume=False)


def test_direct_target_rejection_emits_sanitized_alarm_event() -> None:
    module, _ = _load_lambda("batch_submitter")
    module._submit = MagicMock(side_effect=module.UnknownBatchTargetRelease("secret"))
    module.log_event = MagicMock()

    with pytest.raises(module.UnknownBatchTargetRelease):
        module.handler({"kind": "project", "jobId": "job-a"}, None)

    module.log_event.assert_called_once_with(
        "project_target_release_unknown",
        kind="project",
        job_id="job-a",
        error_type="UnknownBatchTargetRelease",
        invocation="direct",
    )


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


def test_previous_unified_eventbridge_id_reconciles_with_creation_target_cas() -> None:
    module, _ = _load_lambda("batch_submitter")
    registry = _project_target_registry()
    lane = registry["lanes"]["unified_template_subtitles"]
    current = lane["current"]
    previous_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-unified-template-subtitles-previous-production:1"
    )
    previous_release = {
        "releaseId": "unified-previous-r1",
        "workerSourceGitSha": "c" * 40,
        "imageUri": (
            "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/"
            f"shorts@sha256:{'d' * 64}"
        ),
        "jobDefinitionArn": previous_definition,
        "jobQueueArn": current["jobQueueArn"],
        "submitAsReleaseId": current["releaseId"],
    }
    lane["previous"] = previous_release
    os.environ["PROJECT_TARGET_REGISTRY_JSON"] = json.dumps(registry)
    module.rest = MagicMock(return_value=[{
        "id": "job-unified-reconcile",
        "status": "rendering",
        "pipeline_version": 2,
        "project_resume_count": 0,
        "aws_batch_job_id": "batch-unified-recorded",
        "mvp_session_id": "session-a",
        "user_id": "user-a",
        "preparation_finished_at": None,
        "planned_short_count": 5,
        "clip_length_option": "sec_31_60",
        "source_range_selection_enabled": False,
        "transcription_policy": "elevenlabs_primary_openai_fallback",
        "subtitle_template_id": "highlight",
        "template_snapshot": {"config": {"schemaVersion": 5}},
        "subtitle_template_snapshot": {"origin": "unified-template-v5"},
        "batch_target_key": "unified_template_subtitles",
        "batch_target_release_id": previous_release["releaseId"],
        "batch_job_definition": previous_definition,
        "batch_job_queue": previous_release["jobQueueArn"],
    }])
    module._submit_once = MagicMock(return_value="batch-unified-recorded")

    result = module._submit({
        "kind": "project",
        "jobId": "job-unified-reconcile",
    })

    assert result == "batch-unified-recorded"
    request = module._submit_once.call_args.args[0]
    assert request["jobDefinition"] == current["jobDefinitionArn"]
    assert request["jobQueue"] == current["jobQueueArn"]
    assert module._submit_once.call_args.kwargs["project_binding"] == {
        "p_video_job_id": "job-unified-reconcile",
        "p_expected_batch_target_key": "unified_template_subtitles",
        "p_expected_batch_target_release_id": previous_release["releaseId"],
        "p_observed_job_definition": previous_definition,
        "p_observed_job_queue": previous_release["jobQueueArn"],
    }


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
    assert module._submit_once.call_args.kwargs["project_binding"] == {
        "p_video_job_id": "job-brand-color",
        "p_expected_batch_target_key": None,
        "p_expected_batch_target_release_id": None,
        "p_observed_job_definition": os.environ[
            "SUBTITLE_TEMPLATES_JOB_DEFINITION_ARN"
        ],
        "p_observed_job_queue": os.environ[
            "SUBTITLE_TEMPLATES_BATCH_QUEUE_ARN"
        ],
    }
    module.patch.assert_not_called()


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
    job_id = "9e79c781-37fd-4329-a5c4-896ce63df13a"
    definition = os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"]
    queue = os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]

    def rest(table: str, **kwargs):
        if table == "video_jobs":
            return [{
                "id": job_id,
                "status": "rendering",
                "pipeline_version": 2,
                "project_resume_count": 0,
                "preparation_finished_at": "2026-07-22T00:00:00+00:00",
                "aws_batch_job_id": "project-batch-a",
                "batch_target_key": None,
                "batch_target_release_id": None,
                "batch_job_definition": definition,
                "batch_job_queue": queue,
            }]
        if table == "batch_submission_claims":
            return [{
                "submission_key": f"project:{job_id}:0",
                "aws_batch_job_id": "project-batch-a",
                "job_definition": definition,
                "job_queue": queue,
            }]
        if table == "rpc/complete_project_batch_submission_target":
            return True
        if table == "rpc/handle_project_batch_failure":
            assert kwargs["body"]["p_batch_job_id"] == "project-batch-a"
            return [{"action": "resume", "resume_count": 1}]
        return []

    module.rest = rest
    result = module.handler({"detail": {
        "jobId": "project-batch-a",
        "jobName": f"shorts-project-{job_id}-0",
        "jobDefinition": definition,
        "jobQueue": queue,
        "status": "FAILED",
        "statusReason": "Task failed to start",
    }}, None)

    assert result == {
        "projectJobId": job_id,
        "action": "resume",
        "failureCategory": "infrastructure",
        "resumeCount": 1,
    }
    assert json.loads(sqs.send_message.call_args.kwargs["MessageBody"]) == {
        "kind": "project_resume", "jobId": job_id,
    }


def test_project_success_event_binds_claim_and_job_atomically_before_finalize() -> None:
    module, _ = _load_lambda("batch_state")
    job_id = "9e79c781-37fd-4329-a5c4-896ce63df13a"
    old_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-unified-template-subtitles-old-production:1"
    )
    definition = os.environ["UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"]
    queue = os.environ["UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"]
    calls: list[tuple[str, dict[str, object]]] = []

    def rest(table: str, **kwargs):
        calls.append((table, kwargs))
        if table == "video_jobs":
            if "aws_batch_job_id=eq" in kwargs["query"]:
                return []
            return [{
                "id": job_id,
                "status": "rendering",
                "pipeline_version": 2,
                "project_resume_count": 0,
                "preparation_finished_at": None,
                "aws_batch_job_id": None,
                "batch_target_key": "unified_template_subtitles",
                "batch_target_release_id": "unified-previous-r1",
                "batch_job_definition": old_definition,
                "batch_job_queue": queue,
            }]
        if table == "batch_submission_claims":
            return [{
                "submission_key": f"project:{job_id}:0",
                "aws_batch_job_id": None,
                "job_definition": definition,
                "job_queue": queue,
            }]
        if table == "rpc/complete_project_batch_submission_target":
            assert kwargs["body"] == {
                "p_submission_key": f"project:{job_id}:0",
                "p_video_job_id": job_id,
                "p_expected_batch_target_key": "unified_template_subtitles",
                "p_expected_batch_target_release_id": "unified-previous-r1",
                "p_observed_job_definition": old_definition,
                "p_observed_job_queue": queue,
                "p_aws_batch_job_id": "project-batch-a",
                "p_job_definition": definition,
                "p_job_queue": queue,
            }
            return True
        if table == "rpc/finalize_project_job":
            return [{"final_status": "completed"}]
        return []

    module.rest = rest
    module.patch = MagicMock()
    result = module.handler({"detail": {
        "jobId": "project-batch-a",
        "jobName": f"shorts-project-{job_id}-0",
        "jobDefinition": definition,
        "jobQueue": queue,
        "status": "SUCCEEDED",
    }}, None)

    assert result == {"reconciledProjectJobId": job_id}
    assert [table for table, _ in calls[-2:]] == [
        "rpc/complete_project_batch_submission_target",
        "rpc/finalize_project_job",
    ]
    module.patch.assert_not_called()


def test_project_terminal_event_reloads_once_after_concurrent_atomic_binding() -> None:
    module, _ = _load_lambda("batch_state")
    job_id = "9e79c781-37fd-4329-a5c4-896ce63df13a"
    old_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-unified-template-subtitles-old-production:1"
    )
    definition = os.environ["UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"]
    queue = os.environ["UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"]
    binding_completed = False
    completion_calls = 0

    def rest(table: str, **kwargs):
        nonlocal binding_completed, completion_calls
        if table == "video_jobs":
            if "aws_batch_job_id=eq" in kwargs["query"] and not binding_completed:
                return []
            return [{
                "id": job_id,
                "status": "rendering",
                "pipeline_version": 2,
                "project_resume_count": 0,
                "preparation_finished_at": None,
                "aws_batch_job_id": (
                    "project-batch-a" if binding_completed else None
                ),
                "batch_target_key": "unified_template_subtitles",
                "batch_target_release_id": "unified-previous-r1",
                "batch_job_definition": (
                    definition if binding_completed else old_definition
                ),
                "batch_job_queue": queue,
            }]
        if table == "batch_submission_claims":
            return [{
                "submission_key": f"project:{job_id}:0",
                "aws_batch_job_id": (
                    "project-batch-a" if binding_completed else None
                ),
                "job_definition": definition,
                "job_queue": queue,
            }]
        if table == "rpc/complete_project_batch_submission_target":
            completion_calls += 1
            if completion_calls == 1:
                binding_completed = True
                return False
            assert kwargs["body"]["p_observed_job_definition"] == definition
            return True
        if table == "rpc/finalize_project_job":
            return [{"final_status": "completed"}]
        return []

    module.rest = rest
    result = module.handler({"detail": {
        "jobId": "project-batch-a",
        "jobName": f"shorts-project-{job_id}-0",
        "jobDefinition": definition,
        "jobQueue": queue,
        "status": "SUCCEEDED",
    }}, None)

    assert result == {"reconciledProjectJobId": job_id}
    assert completion_calls == 2
    assert not any(
        call.args[0] == "project_batch_event_rejected"
        for call in module.log_event.call_args_list
    )


def test_project_terminal_event_rejects_unproven_target_before_finalize() -> None:
    module, _ = _load_lambda("batch_state")
    job_id = "9e79c781-37fd-4329-a5c4-896ce63df13a"
    definition = os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"]
    queue = os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]
    forged_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "forged-project-target:1"
    )
    calls: list[str] = []

    def rest(table: str, **kwargs):
        calls.append(table)
        if table == "video_jobs":
            if "aws_batch_job_id=eq" in kwargs["query"]:
                return []
            return [{
                "id": job_id,
                "status": "rendering",
                "pipeline_version": 2,
                "project_resume_count": 0,
                "preparation_finished_at": None,
                "aws_batch_job_id": None,
                "batch_target_key": None,
                "batch_target_release_id": None,
                "batch_job_definition": definition,
                "batch_job_queue": queue,
            }]
        if table == "batch_submission_claims":
            return [{
                "submission_key": f"project:{job_id}:0",
                "aws_batch_job_id": None,
                "job_definition": definition,
                "job_queue": queue,
            }]
        return []

    module.rest = rest
    result = module.handler({"detail": {
        "jobId": "forged-batch-a",
        "jobName": f"shorts-project-{job_id}-0",
        "jobDefinition": forged_definition,
        "jobQueue": queue,
        "status": "SUCCEEDED",
    }}, None)

    assert result == {"ignored": True}
    assert "rpc/complete_project_batch_submission_target" not in calls
    assert "rpc/finalize_project_job" not in calls
    assert any(
        call.args[0] == "project_batch_event_rejected"
        and call.kwargs["error_type"] == "ClaimTargetMismatch"
        for call in module.log_event.call_args_list
    )


def test_project_terminal_event_rejects_a_predecessor_dispatch_generation() -> None:
    module, _ = _load_lambda("batch_state")
    job_id = "9e79c781-37fd-4329-a5c4-896ce63df13a"
    definition = os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"]
    queue = os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]
    calls: list[str] = []

    def rest(table: str, **_kwargs):
        calls.append(table)
        if table == "video_jobs":
            return [{
                "id": job_id,
                "status": "retry_waiting",
                "pipeline_version": 2,
                "project_resume_count": 0,
                "project_dispatch_generation": 2,
                "preparation_finished_at": None,
                "aws_batch_job_id": None,
                "batch_target_key": None,
                "batch_target_release_id": None,
                "batch_job_definition": definition,
                "batch_job_queue": queue,
            }]
        return []

    module.rest = rest
    result = module.handler({"detail": {
        "jobId": "old-batch-generation-1",
        "jobName": f"shorts-project-{job_id}-generation-1",
        "jobDefinition": definition,
        "jobQueue": queue,
        "status": "SUCCEEDED",
    }}, None)

    assert result == {"ignored": True}
    assert "batch_submission_claims" not in calls
    assert "rpc/finalize_project_job" not in calls
    assert any(
        call.args[0] == "project_batch_event_rejected"
        and call.kwargs["error_type"] == "InitialIdentityMismatch"
        for call in module.log_event.call_args_list
    )


def test_project_terminal_event_requires_atomic_binding_success() -> None:
    module, _ = _load_lambda("batch_state")
    job_id = "9e79c781-37fd-4329-a5c4-896ce63df13a"
    definition = os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"]
    queue = os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]
    calls: list[str] = []

    def rest(table: str, **kwargs):
        calls.append(table)
        if table == "video_jobs":
            return [{
                "id": job_id,
                "status": "rendering",
                "pipeline_version": 2,
                "project_resume_count": 0,
                "preparation_finished_at": None,
                "aws_batch_job_id": "project-batch-a",
                "batch_target_key": None,
                "batch_target_release_id": None,
                "batch_job_definition": definition,
                "batch_job_queue": queue,
            }]
        if table == "batch_submission_claims":
            return [{
                "submission_key": f"project:{job_id}:0",
                "aws_batch_job_id": "project-batch-a",
                "job_definition": definition,
                "job_queue": queue,
            }]
        if table == "rpc/complete_project_batch_submission_target":
            return False
        return []

    module.rest = rest
    result = module.handler({"detail": {
        "jobId": "project-batch-a",
        "jobName": f"shorts-project-{job_id}-0",
        "jobDefinition": definition,
        "jobQueue": queue,
        "status": "SUCCEEDED",
    }}, None)

    assert result == {"ignored": True}
    assert "rpc/finalize_project_job" not in calls
    assert any(
        call.args[0] == "project_batch_event_rejected"
        and call.kwargs["error_type"] == "AtomicBindingRejected"
        for call in module.log_event.call_args_list
    )


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


def _editor_release_v4_manifest(module: ModuleType) -> dict[str, object]:
    entries = [{
        "fontId": font_id,
        "sha256": "c" * 64,
        "postscriptName": f"PostScript-{font_id}",
        "resolvedPath": f"{module._EDITOR_FONT_ROOT}/{file_name}",
        "cssToAssScale": 0.84,
        "cssToAssBaselineOffsetEm": 0.0,
        "titleBaselineOffsetEm": 0.3,
        "wordSpaceAdvanceEm": 0.25,
    } for font_id, file_name in sorted(module._REQUIRED_FONT_FILES.items())]
    unsigned_font_manifest = {
        "fallbackDetected": False,
        "entries": entries,
    }
    canonical = json.dumps(
        unsigned_font_manifest,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    font_manifest_sha256 = hashlib.sha256(canonical).hexdigest()
    manifest = _editor_release_manifest(document_version=3)
    manifest.update({
        "schemaVersion": 2,
        "renderSpecVersion": 4,
        "captionRenderSpecVersion": 4,
        "fontManifestSha256": font_manifest_sha256,
        "runtimeIdentity": {
            "sourceGitSha": "a" * 40,
            "imageDigest": f"sha256:{'b' * 64}",
            "renderSpecVersion": "4",
            "captionRenderSpecVersion": "4",
            "fontManifestSha256": font_manifest_sha256,
        },
        "fontManifest": {
            "sha256": font_manifest_sha256,
            **unsigned_font_manifest,
        },
    })
    manifest["checks"].update({
        "runtime-identity": True,
        "render-spec-v4": True,
        "caption-render-spec-v4": True,
        "worker-title-compositor-parity": True,
        "worker-caption-noop-parity": True,
        "font-manifest": True,
        "font-fallback": True,
        "browser-parity-worker-matrix": True,
    })
    return manifest


def _editor_browser_parity_matrix(
    module: ModuleType,
    manifest: dict[str, object],
) -> dict[str, object]:
    fonts = sorted(module._REQUIRED_FONTS)
    cases: list[dict[str, object]] = []

    def add_case(
        case_id: str,
        *,
        font_id: str,
        coverage: list[str],
        template_id: str | None = None,
        title: str | None = None,
    ) -> None:
        fixture: dict[str, object] = {
            "caseId": case_id,
            "coverage": coverage,
            "fontId": font_id,
        }
        if template_id:
            fixture["caption"] = {
                "mode": (
                    "positioned-pop"
                    if template_id == "pop"
                    else "flow-highlight"
                ),
            }
        if title:
            fixture["title"] = {
                "compilerInput": {
                    "fontId": font_id,
                    "title": title,
                },
            }
        cases.append({
            "id": case_id,
            "fontId": font_id,
            "coverage": coverage,
            "templateId": template_id,
            "fixture": fixture,
            "workerFrameName": f"frames/{case_id}.png",
            "workerFrameSha256": hashlib.sha256(case_id.encode()).hexdigest(),
        })

    edge_cases = [
        (
            "title-long-korean",
            ["long-korean-title", "transparent-title-background"],
        ),
        (
            "title-colored-background",
            ["colored-title-background"],
        ),
        (
            "title-non-centered",
            ["non-centered-title"],
        ),
        (
            "title-edge-clamped",
            ["edge-clamped-title"],
        ),
    ]
    for case_id, coverage in edge_cases:
        add_case(
            case_id,
            font_id="pretendard",
            coverage=coverage,
            title="긴 한글 제목 preview",
        )
    for font_id in fonts:
        add_case(
            f"title-font-{font_id}",
            font_id=font_id,
            coverage=["title-font-matrix", "mixed-language-title"],
            title="한글 English 제목",
        )
        for template_id in ("pop", "highlight"):
            add_case(
                f"font-{template_id}-{font_id}",
                font_id=font_id,
                coverage=[
                    "font-template-mode-matrix",
                    f"{template_id}-caption",
                    "mixed-language-caption",
                ],
                template_id=template_id,
            )
    add_case(
        "caption-pure-korean",
        font_id="pretendard",
        coverage=["pure-korean-caption", "pop-caption"],
        template_id="pop",
    )
    add_case(
        "caption-pure-english",
        font_id="pretendard",
        coverage=["pure-english-caption", "highlight-caption"],
        template_id="highlight",
    )
    return {
        "schemaVersion": 1,
        "renderer": "isolated-linux-worker-v4",
        "runtimeIdentity": manifest["runtimeIdentity"],
        "caseCount": len(cases),
        "fontIds": fonts,
        "cases": cases,
    }


def _editor_browser_parity_report(
    module: ModuleType,
    manifest: dict[str, object],
    *,
    manifest_sha256: str,
    matrix: dict[str, object],
    matrix_sha256: str,
    matrix_uri: str,
) -> dict[str, object]:
    cases = [{
        "caseId": item["id"],
        "coverage": item["coverage"],
        "fontId": item["fontId"],
        "workerFrameSha256": item["workerFrameSha256"],
        "workerFrameSource": (
            matrix_uri.removesuffix("matrix.json") + item["workerFrameName"]
        ),
        "browserScreenshotSha256": hashlib.sha256(
            f"browser-{item['id']}".encode()
        ).hexdigest(),
        "maximumDomErrorPixels": 0.25,
        "maximumPixelErrorPixels": 1,
        "checks": {
            "browser-worker-visual-parity": True,
            "browserTemplateCompilerParity": True,
            "storedSpecConsumerParity": True,
        },
    } for item in matrix["cases"]]
    return {
        "schemaVersion": 2,
        "gitSha": manifest["gitSha"],
        "workerImageDigest": manifest["workerImageDigest"],
        "fontManifestSha256": manifest["fontManifestSha256"],
        "runtimeIdentity": manifest["runtimeIdentity"],
        "workerManifestSha256": manifest_sha256,
        "workerMatrixSha256": matrix_sha256,
        "workerMatrixSource": matrix_uri,
        "maximumAllowedErrorPixels": 2,
        "maximumDomErrorPixels": 0.25,
        "maximumPixelErrorPixels": 1,
        "caseCount": len(cases),
        "fontIds": sorted(module._REQUIRED_FONTS),
        "coverage": sorted(module._BROWSER_PARITY_REQUIRED_COVERAGE),
        "browsers": ["Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36"],
        "checks": {
            name: True for name in module._BROWSER_PARITY_REQUIRED_CHECKS
        },
        "cases": cases,
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


def test_editor_release_registrar_recomputes_the_exact_v4_font_manifest() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    manifest = _editor_release_v4_manifest(module)
    manifest_sha256 = str(manifest["fontManifestSha256"])

    module._verify_manifest(
        manifest,
        git_sha="a" * 40,
        digest=f"sha256:{'b' * 64}",
        document_version=3,
        subtitle_editing_capable=True,
        render_spec_version=4,
        caption_render_spec_version=4,
        font_manifest_sha256=manifest_sha256,
    )

    tampered = deepcopy(manifest)
    tampered["fontManifest"]["entries"][0]["cssToAssScale"] = 0.85
    with pytest.raises(RuntimeError, match="font manifest hash does not match"):
        module._verify_manifest(
            tampered,
            git_sha="a" * 40,
            digest=f"sha256:{'b' * 64}",
            document_version=3,
            subtitle_editing_capable=True,
            render_spec_version=4,
            caption_render_spec_version=4,
            font_manifest_sha256=manifest_sha256,
        )

    invalid_path = deepcopy(manifest)
    invalid_path["fontManifest"]["entries"][0]["resolvedPath"] = (
        f"{module._EDITOR_FONT_ROOT}/../outside.ttf"
    )
    with pytest.raises(RuntimeError, match="font manifest is invalid"):
        module._verify_manifest(
            invalid_path,
            git_sha="a" * 40,
            digest=f"sha256:{'b' * 64}",
            document_version=3,
            subtitle_editing_capable=True,
            render_spec_version=4,
            caption_render_spec_version=4,
            font_manifest_sha256=manifest_sha256,
        )

    forged_runtime = deepcopy(manifest)
    forged_runtime["runtimeIdentity"]["imageDigest"] = f"sha256:{'d' * 64}"
    with pytest.raises(RuntimeError, match="runtime identity evidence"):
        module._verify_manifest(
            forged_runtime,
            git_sha="a" * 40,
            digest=f"sha256:{'b' * 64}",
            document_version=3,
            subtitle_editing_capable=True,
            render_spec_version=4,
            caption_render_spec_version=4,
            font_manifest_sha256=manifest_sha256,
        )


def test_editor_v4_registrar_requires_the_exact_browser_parity_artifact() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    manifest = _editor_release_v4_manifest(module)
    matrix = _editor_browser_parity_matrix(module, manifest)
    assert matrix["caseCount"] == 66
    matrix_payload = json.dumps(matrix, separators=(",", ":")).encode()
    matrix_sha256 = hashlib.sha256(matrix_payload).hexdigest()
    manifest["browserParityMatrix"] = {
        "schemaVersion": 1,
        "caseCount": 66,
        "fontIds": sorted(module._REQUIRED_FONTS),
        "sha256": matrix_sha256,
    }
    manifest_payload = json.dumps(manifest).encode()
    manifest_sha256 = hashlib.sha256(manifest_payload).hexdigest()
    report = _editor_browser_parity_report(
        module,
        manifest,
        manifest_sha256=manifest_sha256,
        matrix=matrix,
        matrix_sha256=matrix_sha256,
        matrix_uri=(
            "s3://isolated-editor-test/editor-release-probes/"
            f"{'a' * 40}/{'b' * 12}/browser-parity/matrix.json"
        ),
    )
    report_payload = json.dumps(report, separators=(",", ":")).encode()
    report_sha256 = hashlib.sha256(report_payload).hexdigest()
    artifact_uri = (
        "s3://isolated-editor-test/editor-release-probes/"
        f"{'a' * 40}/{'b' * 12}/manifest.json"
    )
    os.environ["EDITOR_TEST_BUCKET_NAME"] = "isolated-editor-test"
    module.s3 = MagicMock()
    module.s3.get_object.return_value = {"Body": io.BytesIO(matrix_payload)}

    observed_matrix, observed_sha256, matrix_uri = (
        module._read_browser_parity_matrix(
            artifact_uri=artifact_uri,
            manifest=manifest,
        )
    )
    observed_report = module._read_inline_browser_parity_report(
        report_payload.decode(),
        report_sha256,
    )
    module._verify_browser_parity_report(
        observed_report,
        matrix=observed_matrix,
        matrix_uri=matrix_uri,
        matrix_sha256=observed_sha256,
        manifest_sha256=manifest_sha256,
        git_sha="a" * 40,
        digest=f"sha256:{'b' * 64}",
        font_manifest_sha256=str(manifest["fontManifestSha256"]),
    )
    module.s3.get_object.assert_called_once_with(
        Bucket="isolated-editor-test",
        Key=(
            "editor-release-probes/"
            f"{'a' * 40}/{'b' * 12}/browser-parity/matrix.json"
        ),
    )

    with pytest.raises(RuntimeError, match="Inline browser/worker parity report hash"):
        module._read_inline_browser_parity_report(
            report_payload.decode(),
            "f" * 64,
        )

    forged = deepcopy(report)
    forged["runtimeIdentity"]["imageDigest"] = f"sha256:{'f' * 64}"
    with pytest.raises(RuntimeError, match="identity or checks"):
        module._verify_browser_parity_report(
            forged,
            matrix=observed_matrix,
            matrix_uri=matrix_uri,
            matrix_sha256=observed_sha256,
            manifest_sha256=manifest_sha256,
            git_sha="a" * 40,
            digest=f"sha256:{'b' * 64}",
            font_manifest_sha256=str(manifest["fontManifestSha256"]),
        )

    tampered_matrix = deepcopy(observed_matrix)
    tampered_matrix["cases"] = tampered_matrix["cases"][:-1]
    with pytest.raises(RuntimeError, match="matrix identity"):
        module._verify_browser_parity_report(
            observed_report,
            matrix=tampered_matrix,
            matrix_uri=matrix_uri,
            matrix_sha256=observed_sha256,
            manifest_sha256=manifest_sha256,
            git_sha="a" * 40,
            digest=f"sha256:{'b' * 64}",
            font_manifest_sha256=str(manifest["fontManifestSha256"]),
        )


def test_editor_v4_registrar_rejects_direct_invocation_without_browser_report() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    manifest = _editor_release_v4_manifest(module)
    event = _editor_release_registration_event(document_version=3)
    event.update({
        "uiVersion": 4,
        "renderSpecVersion": 4,
        "captionRenderSpecVersion": 4,
        "fontManifestSha256": manifest["fontManifestSha256"],
    })

    with pytest.raises(ValueError, match="browserParityReportJson is required"):
        module.handler(event, None)


def test_editor_v4_release_records_browser_worker_parity_as_required_check() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    manifest = _editor_release_v4_manifest(module)
    matrix = _editor_browser_parity_matrix(module, manifest)
    matrix_payload = json.dumps(matrix, separators=(",", ":")).encode()
    matrix_sha256 = hashlib.sha256(matrix_payload).hexdigest()
    matrix_uri = (
        "s3://isolated-editor-test/editor-release-probes/"
        f"{'a' * 40}/{'b' * 12}/browser-parity/matrix.json"
    )
    manifest_sha256 = hashlib.sha256(json.dumps(manifest).encode()).hexdigest()
    report = _editor_browser_parity_report(
        module,
        manifest,
        manifest_sha256=manifest_sha256,
        matrix=matrix,
        matrix_sha256=matrix_sha256,
        matrix_uri=matrix_uri,
    )
    event = _editor_release_registration_event(document_version=3)
    event.update({
        "uiVersion": 4,
        "renderSpecVersion": 4,
        "captionRenderSpecVersion": 4,
        "fontManifestSha256": manifest["fontManifestSha256"],
    })
    release_id = "7fd1c249-6cef-40f1-97d4-e4e6c837f60a"
    project_targets = {
        lane: {
            "batchTargetReleaseId": f"{lane}-aaaaaaaaaaaa-v4",
            "workerSourceGitSha": "a" * 40,
            "workerImageDigest": f"sha256:{'b' * 64}",
            "jobDefinitionArn": f"definition-{lane}",
            "jobQueueArn": f"queue-{lane}",
        }
        for lane in module._PROJECT_TARGET_LANES
    }
    calls: list[tuple[str, dict[str, object]]] = []

    def rest(table: str, **kwargs):
        calls.append((table, kwargs))
        if table == "editor_releases" and kwargs.get("method") is None:
            return []
        if table == "editor_releases" and kwargs.get("method") == "POST":
            return [{"id": release_id}]
        if table == "editor_release_project_targets":
            return []
        if table == "editor_release_state" and kwargs.get("method") is None:
            return [{"candidate_release_id": None, "canary_enabled": False}]
        return None

    module.rest = rest
    result = module._record_release(
        event,
        git_sha="a" * 40,
        digest=f"sha256:{'b' * 64}",
        production_definition_arn=str(event["productionJobDefinitionArn"]),
        artifact_uri=str(event["artifactUri"]),
        manifest=manifest,
        subtitle_editing_capable=True,
        render_spec_version=4,
        caption_render_spec_version=4,
        font_manifest_sha256=str(manifest["fontManifestSha256"]),
        project_targets=project_targets,
        browser_parity_matrix_uri=matrix_uri,
        browser_parity_report_sha256="f" * 64,
        browser_parity_report=report,
        workflow_run_url="https://github.com/dongk176/shorts/actions/runs/1/attempts/1",
    )

    assert result == release_id
    browser_check = next(
        kwargs["body"]
        for table, kwargs in calls
        if table == "editor_release_checks"
        and kwargs.get("method") == "POST"
        and kwargs["body"]["check_name"] == "browser-worker-visual-parity"
    )
    assert browser_check["artifact_uri"] == matrix_uri
    assert browser_check["details"]["source"] == (
        "actual-chromium-vs-isolated-linux-worker"
    )
    assert browser_check["details"]["workflowRunUrl"].endswith(
        "/actions/runs/1/attempts/1"
    )
    assert browser_check["details"]["reportSha256"] == "f" * 64
    assert browser_check["details"]["caseCount"] == 66
    assert browser_check["details"]["report"] == report


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


def test_editor_release_registrar_can_clone_a_prior_v4_definition() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    previous_sha = "9" * 40
    candidate_sha = "a" * 40
    previous_hash = "8" * 64
    candidate_hash = "c" * 64
    trusted = _editor_release_job_definition(
        "shorts-mvp-editor-v4-legacy-project-999999999999",
        image="registry.example/shorts@sha256:" + "7" * 64,
        vcpus="4",
    )
    trusted["containerProperties"]["environment"].extend([
        {"name": "EDITOR_RELEASE_GIT_SHA", "value": previous_sha},
        {"name": "EDITOR_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_CAPTION_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_FONT_MANIFEST_SHA256", "value": previous_hash},
    ])
    candidate = deepcopy(trusted)
    candidate["jobDefinitionName"] = (
        "shorts-mvp-editor-v4-legacy-project-aaaaaaaaaaaa"
    )
    candidate["containerProperties"]["image"] = (
        "registry.example/shorts@sha256:" + "b" * 64
    )
    candidate["containerProperties"]["environment"] = [
        item
        for item in candidate["containerProperties"]["environment"]
        if item["name"] not in module._V4_DEFINITION_ENVIRONMENT
    ] + [
        {"name": "EDITOR_RELEASE_GIT_SHA", "value": candidate_sha},
        {"name": "EDITOR_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_CAPTION_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_FONT_MANIFEST_SHA256", "value": candidate_hash},
    ]

    module._verify_definition_contract(
        candidate,
        trusted,
        git_sha=candidate_sha,
        render_spec_version=4,
        caption_render_spec_version=4,
        font_manifest_sha256=candidate_hash,
    )


def _v4_probe_identity() -> dict[str, str]:
    return {
        "repository": "dongk176/shorts",
        "repositoryId": "12345",
        "repositoryOwnerId": "67890",
        "environment": "editor-v4-release-approval",
        "ref": "refs/tags/editor-v4-render-parity-20260826",
        "sha": "a" * 40,
        "workflowRef": (
            "dongk176/shorts/.github/workflows/editor-release.yml@"
            "refs/tags/editor-v4-render-parity-20260826"
        ),
        "workflow": "Editor render release",
        "runId": "112233",
        "runAttempt": "1",
        "workflowRunUrl": (
            "https://github.com/dongk176/shorts/actions/runs/112233/attempts/1"
        ),
    }


def _reserved_v4_probe() -> dict[str, object]:
    return {
        "id": "7fd1c249-6cef-40f1-97d4-e4e6c837f60a",
        "nonce": "c" * 32,
        "state": "reserved",
        "git_sha": "a" * 40,
        "worker_image_digest": f"sha256:{'b' * 64}",
        "font_manifest_sha256": "d" * 64,
        "github_repository": "dongk176/shorts",
        "github_repository_id": 12345,
        "github_repository_owner_id": 67890,
        "github_workflow_ref": (
            "dongk176/shorts/.github/workflows/editor-release.yml@"
            "refs/tags/editor-v4-render-parity-20260826"
        ),
        "github_workflow_name": "Editor render release",
        "github_release_ref": "refs/tags/editor-v4-render-parity-20260826",
        "github_environment": "editor-v4-release-approval",
        "github_workflow_run_id": 112233,
        "github_workflow_run_attempt": 1,
    }


def test_editor_v4_registrar_creates_the_probe_job_from_trusted_server_state() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    probe = _reserved_v4_probe()
    job_id = "8fd1c249-6cef-40f1-97d4-e4e6c837f60b"
    queue_arn = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
        "shorts-mvp-editor-test"
    )
    definition_arn = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        f"shorts-mvp-editor-test-release-{'a' * 12}-{'c' * 8}-4vcpu:3"
    )
    os.environ.update({
        "EDITOR_TEST_TEMPLATE_JOB_DEFINITION": "trusted-isolated-template",
        "EDITOR_TEST_TASK_ROLE_ARN": (
            "arn:aws:iam::123456789012:role/shorts-mvp-editor-test-task"
        ),
        "EDITOR_TEST_EXECUTION_ROLE_ARN": (
            "arn:aws:iam::123456789012:role/shorts-mvp-editor-test-execution"
        ),
        "EDITOR_TEST_JOB_QUEUE_ARN": queue_arn,
    })
    module._v4_request_identity = MagicMock(return_value=(
        "a" * 40,
        f"sha256:{'b' * 64}",
        "d" * 64,
        _v4_probe_identity(),
    ))
    module._reserve_probe = MagicMock(return_value=probe)
    module._repository_identity = MagicMock(return_value=(
        "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/shorts",
        "shorts",
    ))
    trusted = _editor_release_job_definition(
        "trusted-isolated-template",
        image="registry.example/old@sha256:" + "9" * 64,
        vcpus="2",
    )
    module._latest_job_definition = MagicMock(return_value=trusted)
    payload = {"jobDefinitionName": "server-selected-definition"}
    module._registration_payload = MagicMock(return_value=payload)
    module._register_exact_definition = MagicMock(return_value=definition_arn)
    module._job_definition = MagicMock(return_value=trusted)
    module._verify_definition_contract = MagicMock()
    module.batch = MagicMock()
    module.batch.list_jobs.return_value = {"jobSummaryList": []}
    module.batch.submit_job.return_value = {"jobId": job_id}
    attached = {
        **probe,
        "state": "job_submitted",
        "isolated_job_name": f"editor-release-{'a' * 12}-{'c' * 8}",
        "isolated_job_definition_arn": definition_arn,
        "isolated_batch_job_id": job_id,
    }
    module._rpc = MagicMock(return_value=attached)
    module._probe_artifact_uri = MagicMock(return_value="s3://exact/manifest.json")

    result = module._start_v4_probe({
        "jobQueue": "attacker-queue",
        "jobDefinition": "attacker-definition",
        "command": ["attacker"],
    })

    assert result["isolatedBatchJobId"] == job_id
    assert result["artifactUri"] == "s3://exact/manifest.json"
    submitted = module.batch.submit_job.call_args.kwargs
    assert submitted["jobQueue"] == queue_arn
    assert submitted["jobDefinition"] == definition_arn
    assert submitted["containerOverrides"]["command"] == [
        "python", "-m", "shorts_worker", "editor-release-probe",
    ]
    environment = {
        item["name"]: item["value"]
        for item in submitted["containerOverrides"]["environment"]
    }
    assert environment["EDITOR_RELEASE_PROBE_NONCE"] == "c" * 32
    assert environment["EDITOR_RELEASE_PROBE_RUN_ID"] == str(probe["id"])
    module._registration_payload.assert_called_once()
    assert module._registration_payload.call_args.kwargs["forced_task_role_arn"].endswith(
        "shorts-mvp-editor-test-task"
    )


def test_editor_v4_registrar_reconciles_retry_and_rejects_duplicate_probe_jobs() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    queue = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-queue/"
        "shorts-mvp-editor-test"
    )
    definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-editor-test-release-aaaaaaaaaaaa-cccccccc-4vcpu:3"
    )
    module.batch = MagicMock()
    module.batch.list_jobs.return_value = {"jobSummaryList": [
        {"jobName": "exact-probe", "jobId": "job-a"},
        {"jobName": "exact-probe", "jobId": "job-b"},
    ]}
    with pytest.raises(RuntimeError, match="Multiple isolated probe jobs"):
        module._reconcile_probe_job(
            job_name="exact-probe",
            queue_arn=queue,
            definition_arn=definition,
        )

    module.batch.list_jobs.return_value = {"jobSummaryList": [
        {"jobName": "exact-probe", "jobId": "job-a"},
    ]}
    module.batch.describe_jobs.return_value = {"jobs": [{
        "jobName": "exact-probe",
        "jobId": "job-a",
        "jobQueue": queue,
        "jobDefinition": definition,
    }]}
    assert module._reconcile_probe_job(
        job_name="exact-probe",
        queue_arn=queue,
        definition_arn=definition,
    ) == "job-a"


def test_editor_v4_registrar_verifies_the_exact_completed_batch_identity() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    probe = {
        **_reserved_v4_probe(),
        "state": "job_submitted",
        "isolated_job_name": "exact-probe",
        "isolated_job_queue_arn": "exact-queue",
        "isolated_job_definition_arn": "exact-definition",
        "isolated_batch_job_id": "8fd1c249-6cef-40f1-97d4-e4e6c837f60b",
    }
    exact_job = {
        "status": "SUCCEEDED",
        "jobName": "exact-probe",
        "jobQueue": "exact-queue",
        "jobDefinition": "exact-definition",
        "stoppedAt": int(datetime.now(UTC).timestamp() * 1000),
        "container": {
            "command": ["python", "-m", "shorts_worker", "editor-release-probe"],
            "environment": [
                {"name": "EDITOR_RELEASE_PROBE_NONCE", "value": probe["nonce"]},
                {"name": "EDITOR_RELEASE_PROBE_RUN_ID", "value": probe["id"]},
                {"name": "EDITOR_RELEASE_GIT_SHA", "value": probe["git_sha"]},
            ],
        },
        "attempts": [{"container": {"exitCode": 0}}],
    }
    module.batch = MagicMock()
    module.batch.describe_jobs.return_value = {"jobs": [exact_job]}

    assert module._verify_isolated_v4_job(probe) == exact_job

    forged = deepcopy(exact_job)
    forged["container"]["environment"][0]["value"] = "f" * 32
    module.batch.describe_jobs.return_value = {"jobs": [forged]}
    with pytest.raises(RuntimeError, match="identity or result differs"):
        module._verify_isolated_v4_job(probe)


def test_editor_v4_registrar_finalization_uses_only_attested_evidence_and_atomic_rpc() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    probe = {
        **_reserved_v4_probe(),
        "state": "job_submitted",
        "isolated_job_name": "exact-probe",
        "isolated_job_queue_arn": "exact-queue",
        "isolated_job_definition_arn": "exact-definition",
        "isolated_batch_job_id": "8fd1c249-6cef-40f1-97d4-e4e6c837f60b",
    }
    artifact_uri = "s3://isolated/editor-release-probes/exact/manifest.json"
    matrix_uri = "s3://isolated/editor-release-probes/exact/browser-parity/matrix.json"
    manifest = {
        "probeIdentity": {
            "nonce": probe["nonce"],
            "batchJobId": probe["isolated_batch_job_id"],
            "probeRunId": str(probe["id"]),
        },
        "checkSources": {},
    }
    module._v4_request_identity = MagicMock(return_value=(
        "a" * 40,
        f"sha256:{'b' * 64}",
        "d" * 64,
        _v4_probe_identity(),
    ))
    module._load_probe = MagicMock(return_value=probe)
    module._verify_probe_request_identity = MagicMock()
    module._verify_isolated_v4_job = MagicMock(return_value={"status": "SUCCEEDED"})
    module._probe_artifact_uri = MagicMock(return_value=artifact_uri)
    module._read_versioned_json = MagicMock(return_value=(
        manifest,
        "e" * 64,
        "manifest-version",
    ))
    module._verify_manifest = MagicMock()
    module._artifact_contract = MagicMock(return_value={
        "versionId": "matrix-version",
        "sha256": "f" * 64,
    })
    module._read_browser_parity_matrix = MagicMock(return_value=(
        {"caseCount": 66},
        "f" * 64,
        matrix_uri,
    ))
    verified_probe = {
        **probe,
        "state": "evidence_verified",
        "artifact_uri": artifact_uri,
        "manifest_s3_version_id": "manifest-version",
        "manifest_sha256": "e" * 64,
        "matrix_uri": matrix_uri,
        "matrix_s3_version_id": "matrix-version",
        "matrix_sha256": "f" * 64,
    }
    rpc_calls: list[tuple[str, dict[str, object]]] = []

    def rpc(name: str, body: dict[str, object]):
        rpc_calls.append((name, body))
        if name == "attach_editor_release_probe_evidence_v4":
            return verified_probe
        if name == "finalize_editor_render_v4_release":
            return {"releaseId": "9fd1c249-6cef-40f1-97d4-e4e6c837f60c", "status": "canary_ready"}
        raise AssertionError(name)

    module._rpc = rpc
    module._read_inline_browser_parity_report = MagicMock(return_value={
        "caseCount": 66,
        "maximumDomErrorPixels": 1.5,
        "maximumPixelErrorPixels": 2,
    })
    module._verify_browser_parity_report = MagicMock()
    production_arn = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-editor-release-aaaaaaaaaaaa-4vcpu:7"
    )
    targets = {
        lane: {
            "batchTargetReleaseId": f"{lane}-aaaaaaaaaaaa-v4",
            "workerSourceGitSha": "a" * 40,
            "workerImageDigest": f"sha256:{'b' * 64}",
            "jobDefinitionArn": f"exact-{lane}",
            "jobQueueArn": f"queue-{lane}",
            "renderSpecVersion": 4,
        }
        for lane in module._PROJECT_TARGET_LANES
    }
    module._register_v4_production_definitions = MagicMock(return_value=(
        production_arn,
        targets,
    ))
    module.rest = MagicMock(side_effect=AssertionError("direct table mutation"))
    report_json = json.dumps({"attested": True})
    report_sha = hashlib.sha256(report_json.encode()).hexdigest()

    result = module._finalize_v4_release({
        "probeRunId": str(probe["id"]),
        "browserParityReportJson": report_json,
        "browserParityReportSha256": report_sha,
        "productionJobDefinitionArn": "attacker-definition",
        "projectTargets": {"attacker": True},
    })

    assert result["productionJobDefinitionArn"] == production_arn
    assert result["projectTargets"] == targets
    assert module.rest.call_count == 0
    assert [name for name, _body in rpc_calls] == [
        "attach_editor_release_probe_evidence_v4",
        "finalize_editor_render_v4_release",
    ]
    final_body = rpc_calls[-1][1]
    assert final_body["p_production_job_definition_arn"] == production_arn
    assert final_body["p_project_targets"] == targets
    assert len(final_body["p_release_checks"]) == 15
    assert {item["checkName"] for item in final_body["p_release_checks"]} == (
        module._REQUIRED_CHECKS
        | module._V4_REQUIRED_CHECKS
        | {module._BROWSER_PARITY_CHECK}
    )
    release_identity = module._verify_browser_parity_report.call_args.kwargs[
        "release_identity"
    ]
    assert release_identity["probeRunId"] == str(probe["id"])
    assert release_identity["nonce"] == probe["nonce"]
    assert release_identity["batchJobId"] == probe["isolated_batch_job_id"]


def test_editor_v4_job_definition_retry_uses_a_normalized_exact_contract() -> None:
    module, _ = _load_lambda("editor_release_registrar")
    payload = {
        "jobDefinitionName": "exact-definition",
        "type": "container",
        "containerProperties": {
            "image": "registry/repo@sha256:" + "b" * 64,
            "environment": [
                {"name": "B", "value": "2"},
                {"name": "A", "value": "1"},
            ],
            "resourceRequirements": [
                {"type": "VCPU", "value": "4"},
                {"type": "MEMORY", "value": "16384"},
            ],
        },
        "platformCapabilities": ["FARGATE"],
        "tags": {"B": "2", "A": "1"},
    }
    existing = deepcopy(payload)
    existing["jobDefinitionArn"] = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "exact-definition:3"
    )
    existing["parameters"] = {}
    existing["retryStrategy"] = {}
    existing["timeout"] = {}
    existing["propagateTags"] = False
    existing["containerProperties"]["environment"].reverse()
    existing["containerProperties"]["resourceRequirements"].reverse()
    module.batch = MagicMock()
    module.batch.describe_job_definitions.return_value = {
        "jobDefinitions": [existing],
    }

    assert module._register_exact_definition(payload) == existing["jobDefinitionArn"]
    module.batch.register_job_definition.assert_not_called()


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
    definition = os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"]
    queue = os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]
    module.rest = MagicMock(return_value=[{
        "action": "existing",
        "aws_batch_job_id": "batch-existing",
        "job_definition": definition,
        "job_queue": queue,
    }])
    module.batch = MagicMock()

    result = module._submit_once({
        "jobName": "shorts-prepare-abcd1234",
        "jobQueue": queue,
        "jobDefinition": definition,
    }, "prepare:dispatch-a")

    assert result == "batch-existing"
    module.batch.list_jobs.assert_not_called()
    module.batch.submit_job.assert_not_called()


def test_batch_submission_claim_pins_target_before_submit_and_completion() -> None:
    module, _ = _load_lambda("batch_submitter")
    definition = os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"]
    queue = os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]
    module.rest = MagicMock(side_effect=[
        [{
            "action": "claimed",
            "aws_batch_job_id": None,
            "job_definition": definition,
            "job_queue": queue,
        }],
        True,
    ])
    module.batch = MagicMock()
    module.batch.list_jobs.return_value = {"jobSummaryList": []}
    module.batch.submit_job.return_value = {"jobId": "batch-new"}

    result = module._submit_once({
        "jobName": "shorts-project-job-a-0",
        "jobQueue": queue,
        "jobDefinition": definition,
    }, "project:job-a:0")

    assert result == "batch-new"
    claim = module.rest.call_args_list[0]
    assert claim.args[0] == "rpc/claim_batch_submission_target"
    assert claim.kwargs["body"]["p_job_definition"] == definition
    assert claim.kwargs["body"]["p_job_queue"] == queue
    complete = module.rest.call_args_list[1]
    assert complete.args[0] == "rpc/complete_batch_submission_target"
    assert complete.kwargs["body"]["p_aws_batch_job_id"] == "batch-new"


def test_project_submission_completes_claim_and_job_binding_atomically() -> None:
    module, _ = _load_lambda("batch_submitter")
    definition = os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"]
    queue = os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]
    module.rest = MagicMock(side_effect=[
        [{
            "action": "claimed",
            "aws_batch_job_id": None,
            "job_definition": definition,
            "job_queue": queue,
        }],
        True,
    ])
    module.batch = MagicMock()
    module.batch.list_jobs.return_value = {"jobSummaryList": []}
    module.batch.submit_job.return_value = {"jobId": "batch-project"}
    binding = {
        "p_video_job_id": "9e79c781-37fd-4329-a5c4-896ce63df13a",
        "p_expected_batch_target_key": "legacy_project",
        "p_expected_batch_target_release_id": "legacy-v1",
        "p_observed_job_definition": definition,
        "p_observed_job_queue": queue,
    }

    result = module._submit_once({
        "jobName": "shorts-project-9e79c781-37fd-4329-a5c4-896ce63df13a-0",
        "jobQueue": queue,
        "jobDefinition": definition,
    }, "project:9e79c781-37fd-4329-a5c4-896ce63df13a:0", project_binding=binding)

    assert result == "batch-project"
    complete = module.rest.call_args_list[1]
    assert complete.args[0] == "rpc/complete_project_batch_submission_target"
    assert complete.kwargs["body"] == {
        "p_submission_key": (
            "project:9e79c781-37fd-4329-a5c4-896ce63df13a:0"
        ),
        "p_aws_batch_job_id": "batch-project",
        "p_job_definition": definition,
        "p_job_queue": queue,
        **binding,
    }


def test_batch_submission_rejects_mutable_target_names() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock()

    with pytest.raises(
        module.BatchTargetTrustRejected,
        match="revision-pinned ARN",
    ):
        module._submit_once({
            "jobName": "shorts-prepare-abcd1234",
            "jobQueue": os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"],
            "jobDefinition": "shorts-mvp-prepare-production",
        }, "prepare:dispatch-a")

    module.rest.assert_not_called()


def test_batch_submission_claim_rejects_a_rotated_target_for_existing_id() -> None:
    module, _ = _load_lambda("batch_submitter")
    definition = os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"]
    queue = os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]
    module.rest = MagicMock(return_value=[{
        "action": "target_mismatch",
        "aws_batch_job_id": "batch-existing",
        "job_definition": "old-definition",
        "job_queue": queue,
    }])
    module.batch = MagicMock()

    with pytest.raises(module.BatchTargetTrustRejected):
        module._submit_once({
            "jobName": "shorts-project-job-a-0",
            "jobQueue": queue,
            "jobDefinition": definition,
        }, "project:job-a:0")

    module.batch.submit_job.assert_not_called()


def test_project_cutover_adopts_only_a_proven_existing_old_target_job() -> None:
    module, _ = _load_lambda("batch_submitter")
    current_definition = os.environ["UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"]
    queue = os.environ["UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"]
    old_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-unified-template-subtitles-old-production:1"
    )
    job_id = "9e79c781-37fd-4329-a5c4-896ce63df13a"
    binding = {
        "p_video_job_id": job_id,
        "p_expected_batch_target_key": "unified_template_subtitles",
        "p_expected_batch_target_release_id": "unified-previous-r1",
        "p_observed_job_definition": old_definition,
        "p_observed_job_queue": queue,
    }
    module.rest = MagicMock(side_effect=[
        [{
            "action": "target_mismatch",
            "aws_batch_job_id": None,
            "job_definition": old_definition,
            "job_queue": queue,
        }],
        True,
    ])
    module.batch = MagicMock()
    module.batch.list_jobs.return_value = {"jobSummaryList": [{
        "jobId": "batch-old-existing",
        "jobName": f"shorts-project-{job_id}-0",
    }]}
    module.batch.describe_jobs.return_value = {"jobs": [{
        "jobId": "batch-old-existing",
        "jobDefinition": old_definition,
        "jobQueue": queue,
    }]}

    result = module._submit_once({
        "jobName": f"shorts-project-{job_id}-0",
        "jobQueue": queue,
        "jobDefinition": current_definition,
    }, f"project:{job_id}:0", project_binding=binding)

    assert result == "batch-old-existing"
    module.batch.submit_job.assert_not_called()
    completed = module.rest.call_args_list[1]
    assert completed.args[0] == "rpc/complete_project_batch_submission_target"
    assert completed.kwargs["body"] == {
        "p_submission_key": f"project:{job_id}:0",
        "p_aws_batch_job_id": "batch-old-existing",
        "p_job_definition": old_definition,
        "p_job_queue": queue,
        **binding,
    }


def test_project_cutover_never_executes_or_retargets_an_unsubmitted_old_claim() -> None:
    module, _ = _load_lambda("batch_submitter")
    current_definition = os.environ["UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN"]
    queue = os.environ["UNIFIED_TEMPLATE_SUBTITLES_BATCH_QUEUE_ARN"]
    old_definition = (
        "arn:aws:batch:ap-northeast-2:123456789012:job-definition/"
        "shorts-mvp-unified-template-subtitles-old-production:1"
    )
    job_id = "9e79c781-37fd-4329-a5c4-896ce63df13a"
    module.rest = MagicMock(return_value=[{
        "action": "target_mismatch",
        "aws_batch_job_id": None,
        "job_definition": old_definition,
        "job_queue": queue,
    }])
    module.batch = MagicMock()
    module.batch.list_jobs.return_value = {"jobSummaryList": []}

    with pytest.raises(
        module.UnsubmittedBatchTargetCutoverBlocked,
        match="cannot be retargeted",
    ):
        module._submit_once({
            "jobName": f"shorts-project-{job_id}-0",
            "jobQueue": queue,
            "jobDefinition": current_definition,
        }, f"project:{job_id}:0", project_binding={
            "p_video_job_id": job_id,
            "p_expected_batch_target_key": "unified_template_subtitles",
            "p_expected_batch_target_release_id": "unified-previous-r1",
            "p_observed_job_definition": old_definition,
            "p_observed_job_queue": queue,
        })

    module.batch.submit_job.assert_not_called()
    assert module.rest.call_count == 1


def test_legacy_submission_claim_backfills_only_after_aws_target_proof() -> None:
    module, _ = _load_lambda("batch_submitter")
    definition = os.environ["LEGACY_PROJECT_JOB_DEFINITION_ARN"]
    queue = os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"]
    module.rest = MagicMock(side_effect=[
        [{
            "action": "existing",
            "aws_batch_job_id": "batch-existing",
            "job_definition": None,
            "job_queue": None,
        }],
        True,
    ])
    module.batch = MagicMock()
    module.batch.describe_jobs.return_value = {"jobs": [{
        "jobId": "batch-existing",
        "jobDefinition": definition,
        "jobQueue": queue,
    }]}

    result = module._submit_once({
        "jobName": "shorts-project-job-a-0",
        "jobQueue": queue,
        "jobDefinition": definition,
    }, "project:job-a:0")

    assert result == "batch-existing"
    assert module.rest.call_args_list[1].args[0] == (
        "rpc/complete_batch_submission_target"
    )


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
        "dispatchGeneration": 0,
    }


def test_outbox_dispatcher_forwards_the_claimed_dispatch_generation() -> None:
    module, aws_client = _load_lambda("outbox_dispatcher")
    aws_client.invoke.return_value = {
        "Payload": io.BytesIO(b'{"batchJobId":"project-batch-generation-4"}')
    }

    def rest(table: str, **_kwargs):
        if table == "rpc/claim_project_job_outbox":
            return [{
                "outbox_id": "outbox-a",
                "job_id": "job-a",
                "route_id": "route-a",
                "priority_class": "free",
                "dispatch_generation": 4,
            }]
        if table in {"rpc/claim_job_outbox", "rpc/claim_short_outbox"}:
            return []
        return []

    module.rest = rest

    result = module.handler({}, None)

    assert result["dispatchedProjects"] == 1
    assert json.loads(aws_client.invoke.call_args.kwargs["Payload"]) == {
        "kind": "project",
        "jobId": "job-a",
        "priorityClass": "free",
        "dispatchGeneration": 4,
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


def test_outbox_dispatcher_reconciles_claim_through_submitter_without_id_only_patch() -> None:
    module, aws_client = _load_lambda("outbox_dispatcher")
    aws_client.invoke.side_effect = [
        {
            "FunctionError": "Unhandled",
            "Payload": io.BytesIO(b'{"errorMessage":"response lost"}'),
        },
        {"Payload": io.BytesIO(b'{"batchJobId":"project-batch-a"}')},
    ]

    def rest(table: str, **_kwargs):
        if table == "rpc/claim_project_job_outbox":
            return [{
                "outbox_id": "outbox-a",
                "job_id": "job-a",
                "route_id": "route-a",
                "priority_class": "paid",
            }]
        if table == "video_jobs":
            return [{"aws_batch_job_id": None}]
        if table == "batch_submission_claims":
            return [{"aws_batch_job_id": "project-batch-a"}]
        if table in {"rpc/claim_job_outbox", "rpc/claim_short_outbox"}:
            return []
        return []

    module.rest = rest
    module.patch = MagicMock()

    result = module.handler({}, None)

    assert result["dispatchedProjects"] == 1
    assert result["failedProjects"] == 0
    assert aws_client.invoke.call_count == 2
    assert not any(
        call.args[0] == "video_jobs"
        for call in module.patch.call_args_list
    )
    assert not any(
        call.args[0] == "project_job_outbox"
        for call in module.patch.call_args_list
    )


def test_outbox_dispatcher_schedules_reconciliation_after_the_claim_lease() -> None:
    module, aws_client = _load_lambda("outbox_dispatcher")
    aws_client.invoke.side_effect = [
        {
            "FunctionError": "Unhandled",
            "Payload": io.BytesIO(b'{"errorMessage":"response lost"}'),
        },
        {
            "FunctionError": "Unhandled",
            "Payload": io.BytesIO(b'{"errorMessage":"still unavailable"}'),
        },
    ]

    def rest(table: str, **_kwargs):
        if table == "rpc/claim_project_job_outbox":
            return [{
                "outbox_id": "outbox-a",
                "job_id": "job-a",
                "route_id": "route-a",
                "priority_class": "paid",
            }]
        if table == "video_jobs":
            return [{"aws_batch_job_id": None}]
        if table == "batch_submission_claims":
            return [{"aws_batch_job_id": "project-batch-a"}]
        if table in {"rpc/claim_job_outbox", "rpc/claim_short_outbox"}:
            return []
        return []

    module.rest = rest
    module.patch = MagicMock()

    result = module.handler({}, None)

    assert result["dispatchedProjects"] == 1
    assert result["failedProjects"] == 0
    assert not any(
        call.args[0] in {"video_jobs", "project_job_outbox"}
        for call in module.patch.call_args_list
    )
    assert aws_client.send_message.call_args.kwargs == {
        "QueueUrl": "https://sqs.example/work",
        "MessageBody": json.dumps({
            "kind": "project",
            "jobId": "job-a",
            "priorityClass": "paid",
            "dispatchGeneration": 0,
        }, separators=(",", ":")),
        "DelaySeconds": 120,
    }
    assert any(
        call.args[0] == "batch_submission_reconciliation_scheduled"
        for call in module.log_event.call_args_list
    )


def test_outbox_dispatcher_keeps_route_when_target_claim_has_no_id_yet() -> None:
    module, aws_client = _load_lambda("outbox_dispatcher")
    aws_client.invoke.return_value = {
        "FunctionError": "Unhandled",
        "Payload": io.BytesIO(b'{"errorMessage":"completion failed"}'),
    }

    def rest(table: str, **_kwargs):
        if table == "rpc/claim_project_job_outbox":
            return [{
                "outbox_id": "outbox-a",
                "job_id": "job-a",
                "route_id": "route-a",
                "priority_class": "paid",
            }]
        if table == "video_jobs":
            return [{"aws_batch_job_id": None}]
        if table == "batch_submission_claims":
            return [{
                "aws_batch_job_id": None,
                "job_definition": os.environ[
                    "LEGACY_PROJECT_JOB_DEFINITION_ARN"
                ],
                "job_queue": os.environ["LEGACY_PROJECT_BATCH_QUEUE_ARN"],
            }]
        if table in {"rpc/claim_job_outbox", "rpc/claim_short_outbox"}:
            return []
        return []

    module.rest = MagicMock(side_effect=rest)
    module.patch = MagicMock()

    result = module.handler({}, None)

    assert result["dispatchedProjects"] == 0
    assert result["failedProjects"] == 1
    assert aws_client.invoke.call_count == 1
    assert aws_client.send_message.call_args.kwargs["DelaySeconds"] == 120
    assert not any(
        call.args[0] in {"video_jobs", "project_job_outbox"}
        for call in module.patch.call_args_list
    )
    assert not any(
        call.args[0] == "rpc/release_ingestion_route"
        for call in module.rest.call_args_list
        if isinstance(call.args[0], str)
    )


def test_outbox_dispatcher_rejects_conflicting_job_and_claim_ids() -> None:
    module, aws_client = _load_lambda("outbox_dispatcher")
    aws_client.invoke.return_value = {
        "FunctionError": "Unhandled",
        "Payload": io.BytesIO(b'{"errorMessage":"response lost"}'),
    }

    def rest(table: str, **_kwargs):
        if table == "rpc/claim_project_job_outbox":
            return [{
                "outbox_id": "outbox-a",
                "job_id": "job-a",
                "route_id": "route-a",
                "priority_class": "paid",
            }]
        if table == "video_jobs":
            return [{"aws_batch_job_id": "batch-from-job"}]
        if table == "batch_submission_claims":
            return [{"aws_batch_job_id": "batch-from-claim"}]
        if table in {"rpc/claim_job_outbox", "rpc/claim_short_outbox"}:
            return []
        return []

    module.rest = rest
    module.patch = MagicMock()

    result = module.handler({}, None)

    assert result["dispatchedProjects"] == 0
    assert result["failedProjects"] == 1
    assert aws_client.invoke.call_count == 1
    aws_client.send_message.assert_not_called()
    assert any(
        call.args[0] == "batch_submission_reconciliation_required"
        for call in module.log_event.call_args_list
    )


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
