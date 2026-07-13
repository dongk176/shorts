from __future__ import annotations

import os
import urllib.parse
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
from common import iso_now, patch, rest

s3 = boto3.client("s3")
batch = boto3.client("batch")
bucket = os.environ["MEDIA_BUCKET"]


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


def _version_keys(item: dict[str, Any]) -> list[str]:
    prefix = (
        f"outputs/{item['mvp_session_id']}/{item['job_id']}/{item['id']}/"
    )
    paginator = s3.get_paginator("list_objects_v2")
    return [
        obj["Key"]
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix)
        for obj in page.get("Contents", [])
    ]


def expire_shorts() -> tuple[int, int]:
    now = urllib.parse.quote(iso_now(), safe="")
    query = (
        "select=id,job_id,mvp_session_id,output_s3_key,clean_clip_s3_key,thumbnail_s3_key"
        f"&expires_at=lte.{now}&deleted_at=is.null&limit=200"
    )
    items = rest("generated_shorts", query=query) or []
    deleted_objects = 0
    for item in items:
        keys = [
            item.get("output_s3_key"),
            item.get("clean_clip_s3_key"),
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


def release_stale_jobs() -> int:
    cutoff = urllib.parse.quote((datetime.now(UTC) - timedelta(hours=2)).isoformat(), safe="")
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
    jobs = rest("video_jobs", query=(
        "select=id,aws_batch_job_id,status,dispatch_batch_id"
        f"&deadline_at=lte.{now}&status=not.in.(completed,failed,expired,deleted)&limit=500"
    )) or []
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
            "select=id,render_batch_job_id,output_s3_key,clean_clip_s3_key,thumbnail_s3_key"
            f"&job_id=eq.{urllib.parse.quote(job['id'], safe='')}"
        )) or []
        batch_ids.update(
            item["render_batch_job_id"] for item in shorts if item.get("render_batch_job_id")
        )
        for active_batch_id in batch_ids:
            try:
                batch.terminate_job(
                    jobId=active_batch_id, reason="15 minute job deadline reached"
                )
            except Exception:
                try:
                    batch.cancel_job(
                        jobId=active_batch_id, reason="15 minute job deadline reached"
                    )
                except Exception:
                    pass
        _delete_keys([
            key
            for item in shorts
            for key in (
                item.get("output_s3_key"), item.get("clean_clip_s3_key"),
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
            "select=id,rerender_batch_job_id&status=eq.rerendering"
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
        patch(
            "generated_shorts",
            f"id=eq.{item['id']}&status=eq.rerendering",
            {
                "status": "ready",
                "rerender_progress": 0,
                "pending_render_hash": None,
                "rerender_batch_job_id": None,
            },
        )
        reset += 1
    return reset


def handler(_event: dict[str, Any], _context: Any) -> dict[str, int]:
    deadlines = enforce_deadlines()
    expired, objects = expire_shorts()
    stale = release_stale_jobs()
    rerenders = reset_stale_rerenders()
    return {
        "expiredShorts": expired,
        "deletedObjects": objects,
        "releasedStaleJobs": stale,
        "resetStaleRerenders": rerenders,
        "enforcedDeadlines": deadlines,
    }
