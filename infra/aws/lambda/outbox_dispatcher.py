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


def _submit_project(job_id: str, priority_class: str) -> str:
    response = lambda_client.invoke(
        FunctionName=batch_submitter_function,
        InvocationType="RequestResponse",
        Payload=json.dumps({
            "kind": "project",
            "jobId": job_id,
            "priorityClass": priority_class,
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


def _recorded_project_batch_job_id(job_id: str) -> str | None:
    key = urllib.parse.quote(f"project:{job_id}:0", safe="")
    rows = rest(
        "batch_submission_claims",
        query=f"select=aws_batch_job_id&submission_key=eq.{key}&limit=1",
    ) or []
    value = rows[0].get("aws_batch_job_id") if rows else None
    return str(value) if value else None


def handler(_event: dict[str, Any], _context: Any) -> dict[str, int]:
    projects = rest(
        "rpc/claim_project_job_outbox",
        method="POST",
        body={"p_limit": 100},
        prefer="return=representation",
    ) or []
    project_jobs = 0
    for item in projects:
        job_id = str(item["job_id"])
        priority_class = (
            "paid" if str(item.get("priority_class") or "").casefold() == "paid"
            else "free"
        )
        try:
            batch_job_id = _submit_project(job_id, priority_class)
            log_event(
                "project_outbox_submitted",
                job_id=job_id,
                batch_job_id=batch_job_id,
                priority_class=priority_class,
            )
            project_jobs += 1
        except Exception as exc:  # noqa: BLE001 - isolate one immutable target failure
            rows = rest(
                "video_jobs",
                query=f"select=aws_batch_job_id&id=eq.{job_id}&limit=1",
            ) or []
            if rows and rows[0].get("aws_batch_job_id"):
                project_jobs += 1
                continue
            recorded_batch_job_id = _recorded_project_batch_job_id(job_id)
            if recorded_batch_job_id:
                patch("video_jobs", f"id=eq.{job_id}", {
                    "aws_batch_job_id": recorded_batch_job_id,
                })
                project_jobs += 1
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
            continue
    batches = rest(
        "rpc/claim_job_outbox",
        method="POST",
        body={"p_limit": 10000},
        prefer="return=representation",
    ) or []
    jobs = 0
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
            jobs += item_count
        except Exception as exc:
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
            raise
    rerenders = rest(
        "rpc/claim_short_outbox", method="POST", body={"p_limit": 100},
        prefer="return=representation",
    ) or []
    for item in rerenders:
        try:
            sqs.send_message(
                QueueUrl=queue_url,
                MessageBody=json.dumps({
                    "kind": "rerender", "shortId": item["short_id"],
                }, separators=(",", ":")),
            )
        except Exception as exc:
            log_event(
                "short_outbox_dispatch_failed",
                short_id=item.get("short_id"),
                error_type=type(exc).__name__,
            )
            patch("short_outbox", f"id=eq.{item['outbox_id']}", {
                "status": "pending", "dispatched_at": None,
                "last_error": str(exc)[:1000],
            })
            raise
    return {
        "dispatchedProjects": project_jobs,
        "dispatchedBatches": len(batches), "dispatchedJobs": jobs,
        "dispatchedRerenders": len(rerenders),
    }
