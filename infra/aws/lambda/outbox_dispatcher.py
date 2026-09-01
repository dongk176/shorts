from __future__ import annotations

import json
import os
import urllib.parse
from typing import Any

import boto3
from common import log_event, patch, rest

sqs = boto3.client("sqs")
lambda_client = boto3.client("lambda")
queue_url = os.environ["WORK_DISPATCH_QUEUE_URL"]
batch_submitter_function = os.environ["BATCH_SUBMITTER_FUNCTION_NAME"]


def _submit_prepare_batch(dispatch_batch_id: str, item_count: int) -> str:
    response = lambda_client.invoke(
        FunctionName=batch_submitter_function,
        InvocationType="RequestResponse",
        Payload=json.dumps({
            "kind": "prepare_batch",
            "dispatchBatchId": dispatch_batch_id,
            "itemCount": item_count,
        }, separators=(",", ":")).encode(),
    )
    payload = json.loads(response["Payload"].read() or b"{}")
    if response.get("FunctionError"):
        raise RuntimeError("Direct Batch submission Lambda failed")
    batch_job_id = str(payload.get("batchJobId") or "").strip()
    if not batch_job_id:
        raise RuntimeError("Direct Batch submission returned no job id")
    return batch_job_id


def _submit_project(
    job_id: str,
    priority_class: str,
    dispatch_generation: int = 0,
) -> str:
    response = lambda_client.invoke(
        FunctionName=batch_submitter_function,
        InvocationType="RequestResponse",
        Payload=json.dumps({
            "kind": "project",
            "jobId": job_id,
            "priorityClass": priority_class,
            "dispatchGeneration": max(0, dispatch_generation),
        }, separators=(",", ":")).encode(),
    )
    payload = json.loads(response["Payload"].read() or b"{}")
    if response.get("FunctionError"):
        raise RuntimeError("Direct project Batch submission Lambda failed")
    batch_job_id = str(payload.get("batchJobId") or "").strip()
    if not batch_job_id:
        raise RuntimeError("Direct project Batch submission returned no job id")
    return batch_job_id


def _recorded_batch_job_id(dispatch_batch_id: str) -> str | None:
    rows = rest(
        "dispatch_batches",
        query=f"select=aws_batch_job_id&id=eq.{dispatch_batch_id}&limit=1",
    ) or []
    value = rows[0].get("aws_batch_job_id") if rows else None
    return str(value) if value else None


def _project_submission_key(job_id: str, dispatch_generation: int) -> str:
    if dispatch_generation <= 0:
        return f"project:{job_id}:0"
    return f"project:{job_id}:generation:{dispatch_generation}"


def _project_submission_claim(
    job_id: str,
    dispatch_generation: int = 0,
) -> dict[str, Any] | None:
    key = urllib.parse.quote(
        _project_submission_key(job_id, dispatch_generation),
        safe="",
    )
    rows = rest(
        "batch_submission_claims",
        query=(
            "select=aws_batch_job_id,job_definition,job_queue"
            f"&submission_key=eq.{key}&limit=1"
        ),
    ) or []
    return rows[0] if rows else None


def _schedule_project_reconciliation(
    job_id: str,
    priority_class: str,
    dispatch_generation: int = 0,
) -> None:
    # A Batch state event can arrive after SubmitJob but before the submitter's
    # atomic claim/job binding.  Re-enter the same idempotent attempt after the
    # 90-second claim lease so it adopts the existing AWS job by exact name and
    # target instead of leaving an id-only video_jobs row behind.
    sqs.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps({
            "kind": "project",
            "jobId": job_id,
            "priorityClass": priority_class,
            "dispatchGeneration": max(0, dispatch_generation),
        }, separators=(",", ":")),
        DelaySeconds=120,
    )


def handler(_event: dict[str, Any], _context: Any) -> dict[str, int]:
    projects = rest(
        "rpc/claim_project_job_outbox",
        method="POST",
        body={"p_limit": 100},
        prefer="return=representation",
    ) or []
    project_jobs = 0
    project_failures = 0
    for item in projects:
        job_id = str(item["job_id"])
        priority_class = (
            "paid" if str(item.get("priority_class") or "").casefold() == "paid"
            else "free"
        )
        dispatch_generation = max(
            0,
            int(item.get("dispatch_generation") or 0),
        )
        try:
            batch_job_id = _submit_project(
                job_id,
                priority_class,
                dispatch_generation,
            )
            log_event(
                "project_outbox_submitted",
                job_id=job_id,
                batch_job_id=batch_job_id,
                priority_class=priority_class,
                dispatch_generation=dispatch_generation,
            )
            project_jobs += 1
        except Exception as exc:  # noqa: BLE001 - isolate one immutable target failure
            rows = rest(
                "video_jobs",
                query=f"select=aws_batch_job_id&id=eq.{job_id}&limit=1",
            ) or []
            raw_job_batch_job_id = (
                rows[0].get("aws_batch_job_id") if rows else None
            )
            job_batch_job_id = (
                str(raw_job_batch_job_id).strip()
                if raw_job_batch_job_id
                else ""
            )
            submission_claim = _project_submission_claim(
                job_id,
                dispatch_generation,
            )
            raw_claim_batch_job_id = (
                submission_claim.get("aws_batch_job_id")
                if submission_claim
                else None
            )
            recorded_batch_job_id = (
                str(raw_claim_batch_job_id).strip()
                if raw_claim_batch_job_id
                else ""
            )
            if submission_claim is not None and (
                bool(submission_claim.get("job_definition"))
                != bool(submission_claim.get("job_queue"))
            ):
                log_event(
                    "batch_submission_reconciliation_required",
                    job_id=job_id,
                    batch_job_id=job_batch_job_id,
                    claim_batch_job_id=recorded_batch_job_id,
                    error_type="IncompleteClaimTarget",
                )
                project_failures += 1
                continue
            recorded_ids = {
                value
                for value in (job_batch_job_id, recorded_batch_job_id)
                if value
            }
            if len(recorded_ids) == 1:
                expected_batch_job_id = next(iter(recorded_ids))
                # The submitter owns both idempotency and the immutable raw
                # definition/queue provenance. Re-enter it so an ambiguous
                # response repairs all three fields together; never write a
                # Batch id alone from the outbox dispatcher.
                try:
                    reconciled_batch_job_id = _submit_project(
                        job_id,
                        priority_class,
                        dispatch_generation,
                    )
                except Exception as reconciliation_exc:  # noqa: BLE001
                    _schedule_project_reconciliation(
                        job_id,
                        priority_class,
                        dispatch_generation,
                    )
                    log_event(
                        "batch_submission_reconciliation_scheduled",
                        job_id=job_id,
                        batch_job_id=expected_batch_job_id,
                        error_type=type(reconciliation_exc).__name__,
                        delay_seconds=120,
                    )
                    project_jobs += 1
                    continue
                if reconciled_batch_job_id != expected_batch_job_id:
                    log_event(
                        "batch_submission_reconciliation_required",
                        job_id=job_id,
                        batch_job_id=expected_batch_job_id,
                        error_type="BatchJobIdMismatch",
                    )
                    project_failures += 1
                    continue
                log_event(
                    "project_outbox_submit_reconciled",
                    job_id=job_id,
                    batch_job_id=reconciled_batch_job_id,
                    priority_class=priority_class,
                )
                project_jobs += 1
                continue
            if len(recorded_ids) > 1:
                log_event(
                    "batch_submission_reconciliation_required",
                    job_id=job_id,
                    batch_job_id=job_batch_job_id,
                    claim_batch_job_id=recorded_batch_job_id,
                    error_type="BatchJobIdMismatch",
                )
                project_failures += 1
                continue
            if submission_claim is not None:
                _schedule_project_reconciliation(
                    job_id,
                    priority_class,
                    dispatch_generation,
                )
                log_event(
                    "batch_submission_reconciliation_scheduled",
                    job_id=job_id,
                    batch_job_id=None,
                    error_type=type(exc).__name__,
                    delay_seconds=120,
                )
                project_failures += 1
                continue
            patch("project_job_outbox", f"id=eq.{item['outbox_id']}", {
                "status": "pending", "dispatched_at": None,
                "last_error": str(exc)[:1000],
            })
            rest(
                "rpc/release_ingestion_route",
                method="POST",
                body={
                    "p_job_id": job_id,
                    "p_route_id": item["route_id"],
                    "p_result": "dispatch_failed",
                    "p_cooldown_seconds": 0,
                },
                prefer="return=representation",
            )
            # One stale or misconfigured immutable target must not strand the
            # other project rows that this invocation already claimed. The
            # failed row is pending again and will retry after configuration is
            # corrected, while unrelated project/prepare/rerender work proceeds.
            log_event(
                "project_outbox_dispatch_failed",
                job_id=job_id,
                error_type=type(exc).__name__,
            )
            project_failures += 1
            continue
    batches = rest(
        "rpc/claim_job_outbox",
        method="POST",
        body={"p_limit": 10000},
        prefer="return=representation",
    ) or []
    jobs = 0
    dispatched_batches = 0
    batch_failures = 0
    for item in batches:
        batch_id = item["dispatch_batch_id"]
        item_count = int(item["item_count"])
        try:
            batch_job_id = _submit_prepare_batch(batch_id, item_count)
            log_event(
                "job_outbox_submitted_immediately",
                dispatch_batch_id=batch_id,
                batch_job_id=batch_job_id,
                item_count=item_count,
            )
            dispatched_batches += 1
            jobs += item_count
        except Exception as exc:  # noqa: BLE001 - isolate one claimed prepare failure
            # A synchronous invocation response can be lost after the child Lambda
            # commits the Batch id. Reconcile that ambiguous outcome before releasing
            # the proxy leases or making the outbox item pending again.
            recorded_batch_job_id = _recorded_batch_job_id(batch_id)
            if recorded_batch_job_id:
                log_event(
                    "job_outbox_submit_reconciled",
                    dispatch_batch_id=batch_id,
                    batch_job_id=recorded_batch_job_id,
                    item_count=item_count,
                )
                dispatched_batches += 1
                jobs += item_count
                continue
            log_event(
                "job_outbox_dispatch_failed",
                dispatch_batch_id=batch_id,
                error_type=type(exc).__name__,
            )
            patch("dispatch_batches", f"id=eq.{batch_id}", {
                "status": "failed", "error_message": str(exc)[:1000],
            })
            patch("job_outbox", f"dispatch_batch_id=eq.{batch_id}", {
                "status": "pending", "dispatch_batch_id": None, "dispatched_at": None,
                "last_error": str(exc)[:1000],
            })
            patch("video_jobs", f"dispatch_batch_id=eq.{batch_id}", {
                "dispatch_batch_id": None,
            })
            rest(
                "rpc/release_dispatch_batch_routes",
                method="POST",
                body={"p_dispatch_batch_id": batch_id},
                prefer="return=representation",
            )
            batch_failures += 1
            continue
    rerenders = rest(
        "rpc/claim_short_outbox", method="POST", body={"p_limit": 100},
        prefer="return=representation",
    ) or []
    dispatched_rerenders = 0
    rerender_failures = 0
    for item in rerenders:
        try:
            sqs.send_message(
                QueueUrl=queue_url,
                MessageBody=json.dumps({
                    "kind": "rerender", "shortId": item["short_id"],
                }, separators=(",", ":")),
            )
            dispatched_rerenders += 1
        except Exception as exc:  # noqa: BLE001 - isolate one claimed rerender failure
            log_event(
                "short_outbox_dispatch_failed",
                short_id=item.get("short_id"),
                error_type=type(exc).__name__,
            )
            patch("short_outbox", f"id=eq.{item['outbox_id']}", {
                "status": "pending", "dispatched_at": None,
                "last_error": str(exc)[:1000],
            })
            rerender_failures += 1
            continue
    return {
        "dispatchedProjects": project_jobs,
        "failedProjects": project_failures,
        "dispatchedBatches": dispatched_batches, "dispatchedJobs": jobs,
        "failedBatches": batch_failures,
        "dispatchedRerenders": dispatched_rerenders,
        "failedRerenders": rerender_failures,
    }
