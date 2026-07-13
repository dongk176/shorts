from __future__ import annotations

import importlib.util
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

LAMBDA_DIR = Path(__file__).parents[2] / "infra" / "aws" / "lambda"


def _load_lambda(name: str) -> tuple[ModuleType, MagicMock]:
    fake_sqs = MagicMock()
    fake_boto3 = SimpleNamespace(client=lambda service: fake_sqs)
    fake_common = ModuleType("common")
    fake_common.iso_now = lambda: "2026-07-13T12:00:00+00:00"
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

    assert result == {"retriedRenderJobId": "job-a", "shardIndex": 2}
    assert any(table == "generated_shorts" and "render_shard_index=eq.2" in query
               for table, query, _ in patches)
    message = json.loads(sqs.send_message.call_args.kwargs["MessageBody"])
    assert message == {
        "kind": "render_retry",
        "jobId": "job-a",
        "shardIndex": 2,
        "failedBatchJobId": "render-parent",
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

    assert result == {"failedRenderJobId": "job-a"}
    job_patch = next(body for table, _, body in patches if table == "video_jobs")
    assert job_patch["error_code"] == "render_failed"
    assert job_patch["error_message"] == module.RENDER_FINAL_MESSAGE
    assert "가져오지" not in str(job_patch["error_message"])


def test_prepare_retry_message_is_deduplicated_by_failed_batch_id() -> None:
    module, _ = _load_lambda("batch_submitter")
    module._prepare_gate = MagicMock(return_value="open")
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


def test_prepare_retry_reserves_the_next_attempt_for_prestart_failures() -> None:
    module, _ = _load_lambda("batch_submitter")
    module._prepare_gate = MagicMock(return_value="open")
    module.rest = MagicMock(return_value=[{
        "id": "job-a",
        "attempt_count": 2,
        "deadline_at": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
        "status": "retry_waiting",
        "aws_batch_job_id": "failed-batch",
    }])
    module.batch = MagicMock()
    module._submit_once = MagicMock(return_value="retry-batch")
    module.patch = MagicMock()

    result = module._submit({
        "kind": "prepare_retry",
        "jobId": "job-a",
        "failedBatchJobId": "failed-batch",
    })

    assert result == "retry-batch"
    request, submission_key = module._submit_once.call_args.args
    command = request["containerOverrides"]["command"]
    assert command[-2:] == ["--attempt", "3"]
    assert submission_key == "prepare-retry:job-a:3"
    module.patch.assert_called_once_with(
        "video_jobs",
        "id=eq.job-a&aws_batch_job_id=eq.failed-batch",
        {
            "aws_batch_job_id": "retry-batch",
            "dispatch_batch_id": None,
            "attempt_count": 3,
            "next_attempt_at": None,
        },
    )


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


def test_circuit_probe_has_a_distinct_minute_scoped_submission() -> None:
    module, _ = _load_lambda("batch_submitter")
    module.rest = MagicMock(return_value=[{
        "status": "queued",
        "aws_batch_job_id": None,
    }])
    module._prepare_gate = MagicMock(return_value="probe")
    module._submit_once = MagicMock(return_value="probe-batch")
    module._delay = MagicMock()

    result = module._submit({
        "kind": "prepare_batch",
        "dispatchBatchId": "dispatch-abcdef",
        "itemCount": 20,
    })

    assert result == "probe-batch"
    request, submission_key = module._submit_once.call_args.args
    assert request["jobName"].startswith("shorts-probe-dispatch-abcdef-")
    assert "arrayProperties" not in request
    assert submission_key.startswith("prepare-probe:dispatch-abcdef:")
    module._delay.assert_called_once()


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
    assert "deleted_at=coalesce(deleted_at, now())" in sql


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
