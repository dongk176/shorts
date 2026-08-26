from __future__ import annotations

import os
import urllib.parse
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
from common import iso_now, log_event, patch, rest

s3 = boto3.client("s3")
batch = boto3.client("batch")
bucket = os.environ["MEDIA_BUCKET"]
STALE_HEARTBEAT_GRACE = timedelta(minutes=15)


def _has_recent_heartbeat(job: dict[str, Any], now: datetime) -> bool:
    raw_heartbeat = str(job.get("heartbeat_at") or "").strip()
    if not raw_heartbeat:
        return False
    try:
        heartbeat = datetime.fromisoformat(raw_heartbeat.replace("Z", "+00:00"))
    except ValueError:
        return False
    if heartbeat.tzinfo is None:
        return False
    return heartbeat >= now - STALE_HEARTBEAT_GRACE


def _delete_keys(keys: list[str]) -> int:
    unique = sorted({key for key in keys if key})
    if not unique:
        return 0
    for start in range(0, len(unique), 1000):
        chunk = unique[start : start + 1000]
        s3.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": key} for key in chunk], "Quiet": True},
        )
    return len(unique)


def _keys_under_prefixes(prefixes: list[str]) -> list[str]:
    paginator = s3.get_paginator("list_objects_v2")
    return [
        obj["Key"]
        for prefix in prefixes
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix)
        for obj in page.get("Contents", [])
    ]


def _version_keys(item: dict[str, Any]) -> list[str]:
    base = f"{item['mvp_session_id']}/{item['job_id']}/{item['id']}"
    return _keys_under_prefixes([
        f"outputs/{base}/",
        f"edit-sources/{base}/",
    ])


def expire_shorts() -> tuple[int, int]:
    now = urllib.parse.quote(iso_now(), safe="")
    query = (
        "select=id,job_id,mvp_session_id,output_s3_key,clean_clip_s3_key,"
        "edit_timeline_s3_key,thumbnail_s3_key"
        f"&expires_at=lte.{now}&deleted_at=is.null&limit=200"
    )
    items = rest("generated_shorts", query=query) or []
    deleted_objects = 0
    for item in items:
        keys = [
            item.get("output_s3_key"),
            item.get("clean_clip_s3_key"),
            item.get("edit_timeline_s3_key"),
            item.get("thumbnail_s3_key"),
            *_version_keys(item),
        ]
        deleted_objects += _delete_keys(keys)
        patch(
            "generated_shorts",
            f"id=eq.{item['id']}&deleted_at=is.null",
            {
                "status": "expired",
                "deleted_at": iso_now(),
                "subtitle_segments": [],
            },
        )
    return len(items), deleted_objects


def cleanup_failed_shorts() -> tuple[int, int]:
    """Delete artifacts for terminal failures, retrying on the next minute if S3 fails."""
    items = rest(
        "generated_shorts",
        query=(
            "select=id,job_id,mvp_session_id,output_s3_key,clean_clip_s3_key,"
            "edit_timeline_s3_key,thumbnail_s3_key&status=eq.failed&deleted_at=is.null&limit=200"
        ),
    ) or []
    deleted_objects = 0
    for item in items:
        predictable_thumbnail = (
            f"thumbnails/{item['mvp_session_id']}/{item['job_id']}/{item['id']}.jpg"
        )
        keys = [
            item.get("output_s3_key"),
            item.get("clean_clip_s3_key"),
            item.get("edit_timeline_s3_key"),
            item.get("thumbnail_s3_key"),
            predictable_thumbnail,
            *_version_keys(item),
        ]
        deleted_objects += _delete_keys(keys)
        patch(
            "generated_shorts",
            f"id=eq.{item['id']}&status=eq.failed&deleted_at=is.null",
            {"deleted_at": iso_now(), "subtitle_segments": []},
        )
    return len(items), deleted_objects


def release_stale_jobs() -> int:
    now = datetime.now(UTC)
    cutoff = urllib.parse.quote((now - timedelta(hours=2)).isoformat(), safe="")
    terminal = "(completed,failed,expired,deleted)"
    jobs = rest(
        "video_jobs",
        query=(
            "select=id,aws_batch_job_id,status,heartbeat_at,created_at,"
            "execution_backend,claimed_at,pipeline_version"
            f"&status=not.in.{terminal}&created_at=lt.{cutoff}&limit=100"
        ),
    ) or []
    released = 0
    for job in jobs:
        # Created-at is only the candidate scan bound. A worker that still
        # reports a recent heartbeat is active even when a recovery submission
        # replaced an older terminal Batch id.
        if _has_recent_heartbeat(job, now):
            continue
        if (
            job.get("execution_backend") == "mac_pull"
            and job.get("status") == "queued"
            and not job.get("claimed_at")
        ):
            continue
        batch_id = job.get("aws_batch_job_id")
        if batch_id:
            described = batch.describe_jobs(jobs=[batch_id]).get("jobs", [])
            if described and described[0].get("status") in {
                "SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"
            }:
                continue
        if int(job.get("pipeline_version") or 1) == 2:
            rest(
                "rpc/finalize_project_job",
                method="POST",
                body={
                    "p_job_id": job["id"],
                    "p_error_code": "stale_job",
                    "p_error_message": "작업 heartbeat가 2시간 이상 중단되었습니다.",
                },
                prefer="return=representation",
            )
        else:
            patch(
                "video_jobs",
                f"id=eq.{job['id']}",
                {
                    "status": "failed",
                    "stage": "failed",
                    "progress": 100,
                    "error_code": "stale_job",
                    "error_message": "작업 heartbeat가 2시간 이상 중단되었습니다.",
                    "source_deleted_at": iso_now(),
                },
            )
            patch(
                "usage_reservations",
                f"job_id=eq.{job['id']}&status=eq.reserved",
                {"status": "released", "released_at": iso_now()},
            )
        released += 1
    return released


def enforce_deadlines() -> int:
    now = urllib.parse.quote(iso_now(), safe="")
    processing_jobs = rest("video_jobs", query=(
        "select=id,aws_batch_job_id,status,dispatch_batch_id"
        f"&deadline_at=lte.{now}"
        "&status=not.in.(completed,failed,expired,deleted,queued,retry_waiting)&limit=500"
    )) or []
    queued_jobs = rest("video_jobs", query=(
        "select=id,aws_batch_job_id,status,dispatch_batch_id"
        f"&queue_expires_at=lte.{now}&status=in.(queued,retry_waiting)&limit=500"
    )) or []
    jobs = list({job["id"]: job for job in [*processing_jobs, *queued_jobs]}.values())
    enforced = 0
    for job in jobs:
        claimed = rest(
            "rpc/fail_video_job_at_deadline",
            method="POST",
            body={"p_job_id": job["id"]},
            prefer="return=representation",
        ) or []
        if not claimed or not claimed[0].get("failed"):
            continue
        enforced += 1
        batch_ids: set[str] = set()
        batch_id = job.get("aws_batch_job_id")
        if batch_id and job.get("dispatch_batch_id"):
            encoded_dispatch = urllib.parse.quote(job["dispatch_batch_id"], safe="")
            encoded_job = urllib.parse.quote(job["id"], safe="")
            items = rest("dispatch_batch_items", query=(
                "select=array_index,dispatch_batches(item_count)"
                f"&dispatch_batch_id=eq.{encoded_dispatch}&job_id=eq.{encoded_job}&limit=1"
            )) or []
            if items and int(items[0].get("dispatch_batches", {}).get("item_count", 1)) > 1:
                batch_ids.add(f"{batch_id}:{items[0]['array_index']}")
            else:
                batch_ids.add(batch_id)
        elif batch_id:
            batch_ids.add(batch_id)
        shorts = rest("generated_shorts", query=(
            "select=id,status,render_batch_job_id,output_s3_key,clean_clip_s3_key,"
            "edit_timeline_s3_key,thumbnail_s3_key"
            f"&job_id=eq.{urllib.parse.quote(job['id'], safe='')}"
        )) or []
        batch_ids.update(
            item["render_batch_job_id"] for item in shorts if item.get("render_batch_job_id")
        )
        for active_batch_id in batch_ids:
            try:
                batch.terminate_job(
                    jobId=active_batch_id, reason="job processing deadline reached"
                )
            except Exception:
                try:
                    batch.cancel_job(
                        jobId=active_batch_id, reason="job processing deadline reached"
                    )
                except Exception:
                    pass
        _delete_keys([
            key
            for item in shorts
            if item.get("status") == "failed"
            for key in (
                item.get("output_s3_key"), item.get("clean_clip_s3_key"),
                item.get("edit_timeline_s3_key"),
                item.get("thumbnail_s3_key"),
            )
            if key
        ])
    return enforced


def reset_stale_rerenders() -> int:
    cutoff = urllib.parse.quote((datetime.now(UTC) - timedelta(hours=2)).isoformat(), safe="")
    items = rest(
        "generated_shorts",
        query=(
            "select=id,rerender_batch_job_id,pending_edit_request_id"
            "&status=eq.rerendering"
            f"&updated_at=lt.{cutoff}&limit=100"
        ),
    ) or []
    reset = 0
    for item in items:
        batch_id = item.get("rerender_batch_job_id")
        if batch_id:
            described = batch.describe_jobs(jobs=[batch_id]).get("jobs", [])
            if described and described[0].get("status") in {
                "SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"
            }:
                continue
        pending_request_id = item.get("pending_edit_request_id")
        if pending_request_id:
            patch(
                "editor_render_requests",
                (
                    f"id=eq.{pending_request_id}"
                    f"&short_id=eq.{item['id']}"
                    "&status=in.(queued,rendering)"
                ),
                {
                    "status": "failed",
                    "failure_code": "rerender_stale_timeout",
                    "updated_at": iso_now(),
                    "completed_at": iso_now(),
                },
            )
        patch(
            "generated_shorts",
            f"id=eq.{item['id']}&status=eq.rerendering",
            {
                "status": "ready",
                "rerender_progress": 0,
                "pending_render_hash": None,
                "pending_edit_snapshot": None,
                "pending_edit_request_id": None,
                "rerender_batch_job_id": None,
            },
        )
        reset += 1
    return reset


def handler(_event: dict[str, Any], _context: Any) -> dict[str, int]:
    deadlines = enforce_deadlines()
    failed, failed_objects = cleanup_failed_shorts()
    expired, objects = expire_shorts()
    stale = release_stale_jobs()
    rerenders = reset_stale_rerenders()
    result = {
        "expiredShorts": expired,
        "cleanedFailedShorts": failed,
        "deletedObjects": objects + failed_objects,
        "releasedStaleJobs": stale,
        "resetStaleRerenders": rerenders,
        "enforcedDeadlines": deadlines,
    }
    log_event("cleanup_completed", **result)
    return result
