from __future__ import annotations

import os
import urllib.parse
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

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
    created_before = now - timedelta(hours=2)
    heartbeat_before = now - STALE_HEARTBEAT_GRACE
    cutoff = urllib.parse.quote(created_before.isoformat(), safe="")
    terminal = "(completed,failed,expired,deleted)"
    jobs = rest(
        "video_jobs",
        query=(
            "select=id,aws_batch_job_id,status,heartbeat_at,created_at,"
            "execution_backend,claimed_at"
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
        claimed = rest(
            "rpc/finalize_stale_video_job_if_unchanged",
            method="POST",
            body={
                "p_job_id": job["id"],
                "p_observed_aws_batch_job_id": batch_id,
                "p_observed_status": job.get("status"),
                "p_observed_heartbeat_at": job.get("heartbeat_at"),
                "p_created_before": created_before.isoformat(),
                "p_heartbeat_before": heartbeat_before.isoformat(),
            },
            prefer="return=representation",
        ) or []
        if claimed and claimed[0].get("finalized"):
            released += 1
    return released


def report_batch_dispatch_health() -> int:
    rows = rest(
        "rpc/get_batch_dispatch_health",
        method="POST",
        body={},
        prefer="return=representation",
    ) or []
    snapshot = rows[0] if rows else {}
    actionable = int(snapshot.get("actionable_queued_without_batch_id") or 0)
    oldest_seconds = snapshot.get("oldest_actionable_age_seconds")
    reconciliation_required = int(
        snapshot.get("submission_claim_without_job_id") or 0
    )
    reconciliation_oldest_seconds = snapshot.get(
        "oldest_submission_claim_age_seconds"
    )
    log_event(
        "project_dispatch_health",
        actionableQueuedWithoutBatchId=actionable,
        oldestActionableAt=snapshot.get("oldest_actionable_at"),
        oldestActionableAgeSeconds=oldest_seconds,
        submissionClaimWithoutJobId=reconciliation_required,
        oldestSubmissionClaimAt=snapshot.get("oldest_submission_claim_at"),
        oldestSubmissionClaimAgeSeconds=reconciliation_oldest_seconds,
        healthy=actionable == 0 and reconciliation_required == 0,
    )
    if actionable > 0:
        log_event(
            "queued_without_batch_id",
            count=actionable,
            oldest_seconds=oldest_seconds,
        )
    if reconciliation_required > 0:
        log_event(
            "batch_submission_reconciliation_required",
            count=reconciliation_required,
            oldest_seconds=reconciliation_oldest_seconds,
        )
    return actionable


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


def cleanup_background_assets() -> int:
    """Delete only atomically claimed, unreferenced private background objects."""
    claims = rest(
        "rpc/claim_background_asset_cleanup_batch",
        method="POST",
        body={"p_limit": 20},
        prefer="return=representation",
    ) or []
    if not isinstance(claims, list) or len(claims) > 20:
        raise ValueError("Invalid background cleanup claims")
    deleted = 0
    deferred = 0
    for claim in claims:
        try:
            if not isinstance(claim, dict):
                raise TypeError("Invalid background cleanup claim")
            asset_id = str(UUID(str(claim.get("asset_id") or "")))
            user_id = str(UUID(str(claim.get("user_id") or "")))
            cleanup_token = str(UUID(str(claim.get("cleanup_token") or "")))
            key = f"custom-backgrounds/{user_id}/{asset_id}.webp"
            if (
                claim.get("asset_id") != asset_id
                or claim.get("user_id") != user_id
                or claim.get("cleanup_token") != cleanup_token
                or claim.get("object_key") != key
            ):
                raise ValueError("Invalid background cleanup path")
            # Single-object deletion surfaces S3 errors. The old bulk helper
            # intentionally remains unchanged for unrelated existing paths.
            response = s3.delete_object(Bucket=bucket, Key=key)
            if (
                response.get("ResponseMetadata", {}).get("HTTPStatusCode") not in {200, 204}
                or response.get("DeleteMarker") is True
            ):
                raise RuntimeError("Background object deletion not confirmed")
            finalized = rest(
                "rpc/finalize_background_asset_cleanup",
                method="POST",
                body={"p_asset_id": asset_id, "p_cleanup_token": cleanup_token},
                prefer="return=representation",
            )
            if finalized is not True:
                raise RuntimeError("Background cleanup finalization not confirmed")
            deleted += 1
        except Exception as exc:  # noqa: BLE001 - one asset must not block other cleanup
            deferred += 1
            log_event("background_asset_cleanup_deferred", error_type=type(exc).__name__)
    log_event("background_asset_cleanup_completed", deleted=deleted, deferred=deferred)
    return deleted


def handler(_event: dict[str, Any], _context: Any) -> dict[str, int]:
    try:
        queued_without_batch_id = report_batch_dispatch_health()
    except Exception as exc:  # noqa: BLE001 - observability must not block cleanup
        queued_without_batch_id = -1
        log_event(
            "project_dispatch_health_check_failed",
            error_type=type(exc).__name__,
        )
    deadlines = enforce_deadlines()
    failed, failed_objects = cleanup_failed_shorts()
    expired, objects = expire_shorts()
    stale = release_stale_jobs()
    rerenders = reset_stale_rerenders()
    try:
        background_objects = cleanup_background_assets()
    except Exception as exc:  # noqa: BLE001 - rollout/DB faults cannot block old cleanup
        background_objects = 0
        log_event("background_asset_cleanup_unavailable", error_type=type(exc).__name__)
    result = {
        "expiredShorts": expired,
        "cleanedFailedShorts": failed,
        "deletedObjects": objects + failed_objects + background_objects,
        "releasedStaleJobs": stale,
        "resetStaleRerenders": rerenders,
        "enforcedDeadlines": deadlines,
        "actionableQueuedWithoutBatchId": queued_without_batch_id,
    }
    log_event("cleanup_completed", **result)
    return result
