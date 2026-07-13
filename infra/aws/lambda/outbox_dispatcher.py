from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

import boto3
from common import log_event, patch, rest

sqs = boto3.client("sqs")
queue_url = os.environ["WORK_DISPATCH_QUEUE_URL"]


def _circuit_limit() -> int:
    rows = rest(
        "ingestion_circuit",
        query="select=blocked_until,reason&singleton=eq.true&limit=1",
    ) or []
    if not rows:
        return 10000
    blocked_until = rows[0].get("blocked_until")
    blocked = blocked_until and datetime.fromisoformat(
        blocked_until.replace("Z", "+00:00")
    ) > datetime.now(UTC)
    if blocked:
        return 0
    return 1 if rows[0].get("reason") else 10000


def handler(_event: dict[str, Any], _context: Any) -> dict[str, int]:
    limit = _circuit_limit()
    if limit == 0:
        return {"dispatchedBatches": 0, "dispatchedJobs": 0}
    batches = rest(
        "rpc/claim_job_outbox",
        method="POST",
        body={"p_limit": limit},
        prefer="return=representation",
    ) or []
    jobs = 0
    for item in batches:
        batch_id = item["dispatch_batch_id"]
        try:
            sqs.send_message(
                QueueUrl=queue_url,
                MessageBody=json.dumps({
                    "kind": "prepare_batch",
                    "dispatchBatchId": batch_id,
                    "itemCount": int(item["item_count"]),
                }, separators=(",", ":")),
            )
            jobs += int(item["item_count"])
        except Exception as exc:
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
        "dispatchedBatches": len(batches), "dispatchedJobs": jobs,
        "dispatchedRerenders": len(rerenders),
    }
