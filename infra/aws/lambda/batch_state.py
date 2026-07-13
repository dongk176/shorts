from __future__ import annotations

import json
import os
import urllib.parse
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
from common import iso_now, patch, rest

sqs = boto3.client("sqs")
queue_url = os.environ["WORK_DISPATCH_QUEUE_URL"]
FINAL_MESSAGE = (
    "영상을 가져오지 못했습니다. 영상이 공개 상태인지, 로그인·연령·지역 제한이 "
    "없는지, 삭제되거나 비공개 처리되지 않았는지 확인한 뒤 다시 시도해 주세요."
)
TERMINAL_STATUSES = {"completed", "failed", "expired", "deleted"}


def _encoded(value: object) -> str:
    return urllib.parse.quote(str(value), safe="")


def _array_job(detail: dict[str, Any]) -> tuple[str, int | None, bool]:
    batch_job_id = str(detail["jobId"])
    properties = detail.get("arrayProperties") or {}
    index = properties.get("index")
    if ":" in batch_job_id:
        parent_id, possible_index = batch_job_id.rsplit(":", 1)
        if possible_index.isdigit():
            return parent_id, int(index) if index is not None else int(possible_index), False
    is_parent = index is None and (
        int(properties.get("size") or 0) > 1 or "statusSummary" in properties
    )
    return batch_job_id, int(index) if index is not None else None, is_parent


def _send_delayed(payload: dict[str, Any]) -> None:
    sqs.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps(payload, separators=(",", ":")),
        DelaySeconds=60,
    )


def _prepare_jobs(parent_job_id: str, array_index: int | None) -> list[dict[str, Any]]:
    if array_index is None:
        return rest(
            "video_jobs",
            query=(
                "select=id,status,attempt_count,deadline_at,aws_batch_job_id"
                f"&aws_batch_job_id=eq.{_encoded(parent_job_id)}&limit=2"
            ),
        ) or []
    batches = rest(
        "dispatch_batches",
        query=(
            "select=id"
            f"&aws_batch_job_id=eq.{_encoded(parent_job_id)}&limit=1"
        ),
    ) or []
    if not batches:
        return []
    items = rest(
        "dispatch_batch_items",
        query=(
            "select=job_id"
            f"&dispatch_batch_id=eq.{_encoded(batches[0]['id'])}"
            f"&array_index=eq.{array_index}&limit=1"
        ),
    ) or []
    if not items:
        return []
    return rest(
        "video_jobs",
        query=(
            "select=id,status,attempt_count,deadline_at,aws_batch_job_id"
            f"&id=eq.{_encoded(items[0]['job_id'])}&limit=1"
        ),
    ) or []


def _handle_prepare_failure(
    parent_job_id: str, array_index: int | None, reason: str
) -> dict[str, Any] | None:
    jobs = _prepare_jobs(parent_job_id, array_index)
    if len(jobs) != 1:
        return None
    job = jobs[0]
    if job["status"] in TERMINAL_STATUSES:
        return {"ignoredJobId": job["id"]}
    results = rest(
        "rpc/handle_prepare_batch_failure",
        method="POST",
        body={
            "p_job_id": job["id"],
            "p_batch_job_id": parent_job_id,
            "p_reason": reason[:1000],
        },
        prefer="return=representation",
    ) or []
    if not results:
        return None
    action = results[0].get("action")
    if action == "retry":
        _send_delayed({
            "kind": "prepare_retry",
            "jobId": job["id"],
            "failedBatchJobId": parent_job_id,
        })
        return {"retriedJobId": job["id"]}
    if action == "failed":
        return {"failedJobId": job["id"]}
    return {"ignoredJobId": job["id"]}


def _render_rows(parent_job_id: str, array_index: int | None) -> list[dict[str, Any]]:
    query = (
        "select=id,job_id,render_shard_index,status,render_attempt_count"
        f"&render_batch_job_id=eq.{_encoded(parent_job_id)}"
        "&status=eq.rendering"
    )
    if array_index is not None:
        query += f"&render_shard_index=eq.{array_index}"
    return rest("generated_shorts", query=f"{query}&limit=100") or []


def _fail_job(job_id: str, error_code: str) -> None:
    encoded_job_id = _encoded(job_id)
    patch(
        "video_jobs",
        f"id=eq.{encoded_job_id}&status=not.in.(completed,failed,expired,deleted)",
        {
            "status": "failed",
            "stage": "failed",
            "progress": 100,
            "error_code": error_code,
            "error_message": FINAL_MESSAGE,
            "source_deleted_at": iso_now(),
        },
    )
    patch(
        "usage_reservations",
        f"job_id=eq.{encoded_job_id}&status=eq.reserved",
        {"status": "released", "released_at": iso_now()},
    )


def _handle_render_failure(
    parent_job_id: str, array_index: int | None, reason: str
) -> dict[str, Any] | None:
    rows = _render_rows(parent_job_id, array_index)
    if not rows:
        return None
    job_ids = {str(row["job_id"]) for row in rows}
    shard_indexes = {int(row["render_shard_index"]) for row in rows}
    if len(job_ids) != 1 or len(shard_indexes) != 1:
        return None
    job_id = next(iter(job_ids))
    shard_index = next(iter(shard_indexes))
    jobs = rest(
        "video_jobs",
        query=(
            "select=id,status,deadline_at"
            f"&id=eq.{_encoded(job_id)}&limit=1"
        ),
    ) or []
    if not jobs or jobs[0]["status"] in TERMINAL_STATUSES:
        return {"ignoredRenderJobId": job_id}
    deadline = datetime.fromisoformat(jobs[0]["deadline_at"].replace("Z", "+00:00"))
    if deadline <= datetime.now(UTC) + timedelta(seconds=75):
        _fail_job(job_id, "render_failed")
        return {"failedRenderJobId": job_id}
    patch(
        "generated_shorts",
        (
            f"job_id=eq.{_encoded(job_id)}&render_shard_index=eq.{shard_index}"
            f"&render_batch_job_id=eq.{_encoded(parent_job_id)}&status=eq.rendering"
        ),
        {
            "render_progress": 0,
            "render_error_code": "batch_failed",
            "render_error_message": reason[:1000],
        },
    )
    _send_delayed({
        "kind": "render_retry",
        "jobId": job_id,
        "shardIndex": shard_index,
        "failedBatchJobId": parent_job_id,
    })
    return {"retriedRenderJobId": job_id, "shardIndex": shard_index}


def _handle_rerender_failure(batch_job_id: str) -> dict[str, Any] | None:
    shorts = rest(
        "generated_shorts",
        query=(
            "select=id,status"
            f"&rerender_batch_job_id=eq.{_encoded(batch_job_id)}&limit=1"
        ),
    ) or []
    if not shorts or shorts[0]["status"] != "rerendering":
        return None
    patch(
        "generated_shorts",
        f"id=eq.{_encoded(shorts[0]['id'])}&status=eq.rerendering",
        {
            "status": "ready",
            "rerender_progress": 0,
            "pending_render_hash": None,
            "rerender_batch_job_id": None,
        },
    )
    return {"resetShortId": shorts[0]["id"]}


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    detail = event.get("detail") or {}
    batch_job_id = detail.get("jobId")
    status = detail.get("status")
    if not batch_job_id or status not in {"SUCCEEDED", "FAILED"}:
        return {"ignored": True}
    if status == "SUCCEEDED":
        return {"ignored": True}
    parent_job_id, array_index, is_array_parent = _array_job(detail)
    if is_array_parent:
        return {"ignoredArrayParent": parent_job_id}
    reason = str(detail.get("statusReason") or "AWS Batch 작업이 실패했습니다.")[:1000]
    prepare = _handle_prepare_failure(parent_job_id, array_index, reason)
    if prepare:
        return prepare
    render = _handle_render_failure(parent_job_id, array_index, reason)
    if render:
        return render
    rerender = _handle_rerender_failure(str(batch_job_id))
    return rerender or {"ignored": True}
