from __future__ import annotations

import json
import os
import urllib.parse
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import boto3
from common import iso_now, log_event, patch, rest

sqs = boto3.client("sqs")
queue_url = os.environ["WORK_DISPATCH_QUEUE_URL"]
FINAL_MESSAGE = (
    "영상을 가져오지 못했습니다. 영상이 공개 상태인지, 로그인·연령·지역 제한이 "
    "없는지, 삭제되거나 비공개 처리되지 않았는지 확인한 뒤 다시 시도해 주세요."
)
RENDER_FINAL_MESSAGE = (
    "쇼츠 영상을 만드는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
)
TERMINAL_STATUSES = {"completed", "failed", "expired", "deleted"}
MAX_EXTERNAL_RENDER_RETRIES = 1


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


def _project_job(
    batch_job_id: str, detail: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    rows = rest(
        "video_jobs",
        query=(
            "select=id,status,pipeline_version,project_resume_count,preparation_finished_at"
            f"&aws_batch_job_id=eq.{_encoded(batch_job_id)}&pipeline_version=eq.2&limit=1"
        ),
    ) or []
    if rows:
        return rows[0]
    job_name = str((detail or {}).get("jobName") or "")
    if not job_name.startswith("shorts-project-"):
        return None
    candidate = job_name.removeprefix("shorts-project-")
    candidate = (
        candidate.removesuffix("-resume-1")
        if candidate.endswith("-resume-1")
        else candidate.removesuffix("-0")
    )
    try:
        job_id = str(UUID(candidate))
    except ValueError:
        return None
    rows = rest(
        "video_jobs",
        query=(
            "select=id,status,pipeline_version,project_resume_count,preparation_finished_at,"
            "aws_batch_job_id"
            f"&id=eq.{_encoded(job_id)}&pipeline_version=eq.2&limit=1"
        ),
    ) or []
    if not rows:
        return None
    if not rows[0].get("aws_batch_job_id"):
        patch("video_jobs", f"id=eq.{_encoded(job_id)}&aws_batch_job_id=is.null", {
            "aws_batch_job_id": batch_job_id,
        })
    return rows[0]


def _handle_project_failure(
    batch_job_id: str, reason: str, detail: dict[str, Any]
) -> dict[str, Any] | None:
    job = _project_job(batch_job_id, detail)
    if not job:
        return None
    if job["status"] in TERMINAL_STATUSES:
        return {"ignoredProjectJobId": job["id"]}
    category = _render_failure_category(detail, reason)
    results = rest(
        "rpc/handle_project_batch_failure",
        method="POST",
        body={
            "p_job_id": job["id"],
            "p_batch_job_id": batch_job_id,
            "p_reason": reason[:1000],
        },
        prefer="return=representation",
    ) or []
    if not results:
        return None
    action = str(results[0].get("action") or "ignored")
    if action == "resume":
        sqs.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({
                "kind": "project_resume", "jobId": job["id"],
            }, separators=(",", ":")),
        )
    return {
        "projectJobId": job["id"],
        "action": action,
        "failureCategory": category,
        "resumeCount": int(results[0].get("resume_count") or 0),
    }


def _render_retry_count(detail: dict[str, Any]) -> int:
    parameters = detail.get("parameters") or {}
    raw_value = parameters.get("renderRetryCount")
    if raw_value is None:
        job_name = str(detail.get("jobName") or "")
        if job_name.startswith("shorts-render-retry-"):
            raw_value = job_name.rsplit("-", 1)[-1]
    try:
        return max(0, int(raw_value or 0))
    except (TypeError, ValueError):
        return 0


def _render_failure_category(detail: dict[str, Any], reason: str) -> str:
    container = detail.get("container") or {}
    exit_code = container.get("exitCode")
    combined = " ".join(
        str(value)
        for value in (reason, container.get("reason"), detail.get("statusReason"))
        if value
    ).casefold()
    if str(exit_code) == "137" or any(
        marker in combined for marker in ("outofmemory", "out of memory", "oom")
    ):
        return "oom"
    if any(
        marker in combined
        for marker in (
            "host ec2",
            "instance terminated",
            "spot interruption",
            "task failed to start",
            "resourceinitializationerror",
            "cannotpullcontainererror",
            "capacity is unavailable",
            "fargate spot interruption",
            "platform task error",
            "ecs agent",
            "internal error",
        )
    ):
        return "infrastructure"
    return "application"


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


def _fail_job(job_id: str, error_code: str, error_message: str) -> None:
    encoded_job_id = _encoded(job_id)
    patch(
        "video_jobs",
        f"id=eq.{encoded_job_id}&status=not.in.(completed,failed,expired,deleted)",
        {
            "status": "failed",
            "stage": "failed",
            "progress": 100,
            "error_code": error_code,
            "error_message": error_message,
            "source_deleted_at": iso_now(),
        },
    )
    patch(
        "usage_reservations",
        f"job_id=eq.{encoded_job_id}&status=eq.reserved",
        {"status": "released", "released_at": iso_now()},
    )
    patch(
        "generated_shorts",
        (
            f"job_id=eq.{encoded_job_id}&deleted_at=is.null"
            "&status=in.(rendering,rerendering)"
        ),
        {
            "status": "failed",
            "render_progress": 0,
            "render_error_code": error_code,
            "render_error_message": error_message,
        },
    )


def _handle_render_failure(
    parent_job_id: str,
    array_index: int | None,
    reason: str,
    detail: dict[str, Any],
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
    retry_count = _render_retry_count(detail)
    failure_category = _render_failure_category(detail, reason)
    worker_attempt_count = max(int(row["render_attempt_count"]) for row in rows)
    retry_exhausted = (
        retry_count >= MAX_EXTERNAL_RENDER_RETRIES or worker_attempt_count >= 2
    )
    if (
        failure_category == "oom"
        or retry_exhausted
        or deadline <= datetime.now(UTC) + timedelta(seconds=75)
    ):
        error_code = "render_oom" if failure_category == "oom" else "render_failed"
        _fail_job(job_id, error_code, RENDER_FINAL_MESSAGE)
        return {
            "failedRenderJobId": job_id,
            "failureCategory": failure_category,
            "retryCount": retry_count,
        }
    patch(
        "generated_shorts",
        (
            f"job_id=eq.{_encoded(job_id)}&render_shard_index=eq.{shard_index}"
            f"&render_batch_job_id=eq.{_encoded(parent_job_id)}&status=eq.rendering"
        ),
        {
            "render_progress": 0,
            "render_error_code": f"batch_{failure_category}",
            "render_error_message": reason[:1000],
        },
    )
    _send_delayed({
        "kind": "render_retry",
        "jobId": job_id,
        "shardIndex": shard_index,
        "failedBatchJobId": parent_job_id,
        "retryCount": retry_count + 1,
    })
    return {
        "retriedRenderJobId": job_id,
        "shardIndex": shard_index,
        "failureCategory": failure_category,
        "retryCount": retry_count + 1,
    }


def _handle_rerender_failure(
    batch_job_id: str, reason: str, detail: dict[str, Any]
) -> dict[str, Any] | None:
    shorts = rest(
        "generated_shorts",
        query=(
            "select=id,status,render_version,pending_edit_request_id"
            f"&rerender_batch_job_id=eq.{_encoded(batch_job_id)}&limit=1"
        ),
    ) or []
    if not shorts or shorts[0]["status"] != "rerendering":
        return None
    failure_category = _render_failure_category(detail, reason)
    try:
        rerender_attempt = int((detail.get("parameters") or {}).get("rerenderAttempt") or 0)
    except (TypeError, ValueError):
        rerender_attempt = 0
    if failure_category == "infrastructure" and rerender_attempt < 1:
        patch(
            "generated_shorts",
            f"id=eq.{_encoded(shorts[0]['id'])}&status=eq.rerendering",
            {
                "rerender_progress": 0,
                "rerender_batch_job_id": None,
                "render_error_code": "rerender_batch_infrastructure",
                "render_error_message": reason[:1000],
            },
        )
        sqs.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps({
                "kind": "rerender", "shortId": shorts[0]["id"], "attempt": 1,
            }, separators=(",", ":")),
        )
        return {
            "retriedShortId": shorts[0]["id"],
            "failureCategory": failure_category,
            "retryCount": 1,
        }
    pending_request_id = shorts[0].get("pending_edit_request_id")
    if pending_request_id:
        patch(
            "editor_render_requests",
            (
                f"id=eq.{_encoded(pending_request_id)}"
                f"&short_id=eq.{_encoded(shorts[0]['id'])}"
                "&status=in.(queued,rendering)"
            ),
            {
                "status": "failed",
                "failure_code": f"rerender_batch_{failure_category}",
                "updated_at": iso_now(),
                "completed_at": iso_now(),
            },
        )
    patch(
        "generated_shorts",
        f"id=eq.{_encoded(shorts[0]['id'])}&status=eq.rerendering",
        {
            "status": "ready",
            "rerender_progress": 0,
            "pending_render_hash": None,
            "pending_edit_snapshot": None,
            "pending_edit_request_id": None,
            "rerender_batch_job_id": None,
            "render_error_code": f"rerender_batch_{failure_category}",
            "render_error_message": reason[:1000],
        },
    )
    return {
        "resetShortId": shorts[0]["id"],
        "failureCategory": failure_category,
    }


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    detail = event.get("detail") or {}
    batch_job_id = detail.get("jobId")
    status = detail.get("status")
    if not batch_job_id or status not in {"SUCCEEDED", "FAILED"}:
        return {"ignored": True}
    if status == "SUCCEEDED":
        project = _project_job(str(batch_job_id), detail)
        if project and project["status"] not in TERMINAL_STATUSES:
            rest(
                "rpc/finalize_project_job",
                method="POST",
                body={"p_job_id": project["id"]},
                prefer="return=representation",
            )
            return {"reconciledProjectJobId": project["id"]}
        return {"ignored": True}
    parent_job_id, array_index, is_array_parent = _array_job(detail)
    if is_array_parent:
        return {"ignoredArrayParent": parent_job_id}
    reason = str(detail.get("statusReason") or "AWS Batch 작업이 실패했습니다.")[:1000]
    project = _handle_project_failure(parent_job_id, reason, detail)
    if project:
        log_event("project_batch_failure_handled", batch_job_id=parent_job_id, **project)
        return project
    prepare = _handle_prepare_failure(parent_job_id, array_index, reason)
    if prepare:
        log_event("batch_failure_handled", batch_job_id=parent_job_id, **prepare)
        return prepare
    render = _handle_render_failure(parent_job_id, array_index, reason, detail)
    if render:
        log_event("render_batch_failure_handled", batch_job_id=parent_job_id, **render)
        return render
    rerender = _handle_rerender_failure(str(batch_job_id), reason, detail)
    result = rerender or {"ignored": True}
    log_event("batch_failure_handled", batch_job_id=parent_job_id, **result)
    return result
