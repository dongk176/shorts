from __future__ import annotations

import hashlib
import json
import os
import urllib.parse
from datetime import UTC, datetime
from typing import Any

import boto3
from common import iso_now, log_event, patch, rest

batch = boto3.client("batch")

_NOMINAL_CLIP_SECONDS = {
    "sec_30": 30,
    "sec_31_60": 45,
    "sec_61_180": 90,
}


def _estimated_output_seconds(job: dict[str, Any]) -> int:
    try:
        planned_count = max(1, int(job.get("planned_short_count") or 1))
    except (TypeError, ValueError):
        planned_count = 1
    nominal_seconds = _NOMINAL_CLIP_SECONDS.get(
        str(job.get("clip_length_option") or "sec_31_60"),
        _NOMINAL_CLIP_SECONDS["sec_31_60"],
    )
    return planned_count * nominal_seconds


def _project_job_definition(
    job: dict[str, Any], *, resume: bool
) -> tuple[str, str, int]:
    standard_definition = os.environ["PROJECT_JOB_DEFINITION"]
    heavy_definition = os.environ["PROJECT_HEAVY_JOB_DEFINITION"]
    estimated_seconds = _estimated_output_seconds(job)
    stored_definition = str(job.get("batch_job_definition") or "").strip()
    if resume and stored_definition in {standard_definition, heavy_definition}:
        return (
            stored_definition,
            "heavy" if stored_definition == heavy_definition else "standard",
            estimated_seconds,
        )
    return heavy_definition, "heavy", estimated_seconds


def _share_identifier(*values: object) -> str:
    identity = next((str(value) for value in values if value), "anonymous")
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:40]
    return f"user{digest}"


def _priority_class(value: object) -> str:
    return "paid" if str(value or "").casefold() == "paid" else "free"


def _priority_share_identifier(priority_class: object, *values: object) -> str:
    return f"{_priority_class(priority_class)}{_share_identifier(*values)}"


def _scheduling_priority(priority_class: object) -> int:
    return 1000 if _priority_class(priority_class) == "paid" else 0


def _render_container_overrides(command: list[str]) -> dict[str, object]:
    return {
        "command": command,
        "environment": [{"name": "RENDER_SUBMITTED_AT", "value": iso_now()}],
    }


def _existing_batch_job(job_queue: str, job_name: str) -> str | None:
    response = batch.list_jobs(
        jobQueue=job_queue,
        filters=[{"name": "JOB_NAME", "values": [job_name]}],
        maxResults=10,
    )
    for item in response.get("jobSummaryList", []):
        if str(item.get("jobName", "")).casefold() == job_name.casefold():
            return str(item["jobId"])
    return None


def _submit_once(request: dict[str, Any], submission_key: str) -> str:
    claims = rest(
        "rpc/claim_batch_submission",
        method="POST",
        body={
            "p_submission_key": submission_key,
            "p_job_name": str(request["jobName"]),
        },
        prefer="return=representation",
    ) or []
    if not claims:
        raise RuntimeError("Batch submission claim returned no result")
    if claims[0].get("action") == "existing":
        return str(claims[0]["aws_batch_job_id"])
    if claims[0].get("action") != "claimed":
        raise RuntimeError("Batch submission is already in progress")
    existing = _existing_batch_job(str(request["jobQueue"]), str(request["jobName"]))
    batch_job_id = existing or str(batch.submit_job(**request)["jobId"])
    rest(
        "rpc/complete_batch_submission",
        method="POST",
        body={
            "p_submission_key": submission_key,
            "p_aws_batch_job_id": batch_job_id,
        },
        prefer="return=representation",
    )
    return batch_job_id


def _submit(payload: dict[str, Any]) -> str | None:
    kind = payload.get("kind")
    if kind in {"project", "project_resume"}:
        job_id = str(payload["jobId"])
        resume = kind == "project_resume"
        encoded_job_id = urllib.parse.quote(job_id, safe="")
        jobs = rest("video_jobs", query=(
            "select=id,status,pipeline_version,project_resume_count,aws_batch_job_id,"
            "mvp_session_id,user_id,preparation_finished_at,planned_short_count,"
            "clip_length_option,batch_job_definition,dispatch_priority_class"
            f"&id=eq.{encoded_job_id}&limit=1"
        )) or []
        if not jobs or int(jobs[0].get("pipeline_version") or 1) != 2:
            return None
        job = jobs[0]
        expected_status = "rendering" if resume else "queued"
        if job["status"] != expected_status:
            return None
        if resume and (
            int(job.get("project_resume_count") or 0) != 1
            or not job.get("preparation_finished_at")
        ):
            return None
        if job.get("aws_batch_job_id"):
            return str(job["aws_batch_job_id"])
        suffix = "resume-1" if resume else "0"
        command = ["python", "-m", "shorts_worker", "project", "--job-id", job_id]
        if resume:
            command.append("--resume")
        job_definition, resource_tier, estimated_seconds = _project_job_definition(
            job,
            resume=resume,
        )
        priority_class = _priority_class(
            job.get("dispatch_priority_class") or payload.get("priorityClass")
        )
        log_event(
            "project_resource_tier_selected",
            job_id=job_id,
            resource_tier=resource_tier,
            estimated_output_seconds=estimated_seconds,
            job_definition=job_definition,
            resume=resume,
            priority_class=priority_class,
        )
        request = dict(
            jobName=f"shorts-project-{job_id}-{suffix}",
            jobQueue=os.environ["PROJECT_BATCH_QUEUE"],
            jobDefinition=job_definition,
            shareIdentifier=_priority_share_identifier(
                priority_class,
                job.get("user_id"), job.get("mvp_session_id"), job_id
            ),
            schedulingPriorityOverride=_scheduling_priority(priority_class),
            containerOverrides=_render_container_overrides(command),
            retryStrategy={"attempts": 1},
            timeout={"attemptDurationSeconds": 7200},
        )
        submission_key = f"project:{job_id}:resume:1" if resume else f"project:{job_id}:0"
        project_batch_id = _submit_once(request, submission_key)
        patch(
            "video_jobs",
            f"id=eq.{encoded_job_id}&status=eq.{expected_status}",
            {
                "aws_batch_job_id": project_batch_id,
                "batch_job_definition": job_definition,
            },
        )
        return project_batch_id
    if kind == "prepare_batch":
        dispatch_id = str(payload["dispatchBatchId"])
        count = max(1, min(10000, int(payload["itemCount"])))
        queue_name = os.environ["PREPARE_BATCH_QUEUE"]
        request: dict[str, Any] = {
            "jobName": f"shorts-prepare-{dispatch_id}",
            "jobQueue": queue_name,
            "jobDefinition": os.environ["PREPARE_JOB_DEFINITION"],
            "containerOverrides": {"command": [
                "python", "-m", "shorts_worker", "prepare-array",
                "--dispatch-batch-id", dispatch_id,
            ]},
            "retryStrategy": {"attempts": 1},
            "timeout": {"attemptDurationSeconds": 3600},
        }
        existing_batches = rest(
            "dispatch_batches",
            query=(
                "select=status,aws_batch_job_id"
                f"&id=eq.{urllib.parse.quote(dispatch_id, safe='')}&limit=1"
            ),
        ) or []
        if not existing_batches:
            return None
        recorded_id = existing_batches[0].get("aws_batch_job_id")
        if recorded_id:
            return str(recorded_id)
        if count > 1:
            request["arrayProperties"] = {"size": count}
        batch_id = _submit_once(request, f"prepare:{dispatch_id}")
        patch("dispatch_batches", f"id=eq.{dispatch_id}", {
            "status": "submitted", "aws_batch_job_id": batch_id,
            "submitted_at": iso_now(),
        })
        patch("video_jobs", f"dispatch_batch_id=eq.{dispatch_id}", {
            "aws_batch_job_id": batch_id,
        })
        return batch_id
    if kind == "prepare_retry":
        job_id = str(payload["jobId"])
        encoded = urllib.parse.quote(job_id, safe="")
        failed_batch_id = payload.get("failedBatchJobId")
        rows = rest("video_jobs", query=(
            "select=id,attempt_count,status,aws_batch_job_id"
            f"&id=eq.{encoded}&limit=1"
        )) or []
        if not rows:
            return None
        job = rows[0]
        if failed_batch_id and job.get("aws_batch_job_id") != failed_batch_id:
            return None
        if job["status"] != "retry_waiting" or int(job["attempt_count"]) >= 10:
            return None
        rest(
            "rpc/enqueue_prepare_retry",
            method="POST",
            body={"p_job_id": job_id},
            prefer="return=representation",
        )
        return None
    if kind == "render":
        job_id = str(payload["jobId"])
        count = max(1, int(payload["shardCount"]))
        encoded_job_id = urllib.parse.quote(job_id, safe="")
        pending = rest("generated_shorts", query=(
            "select=id,render_batch_job_id"
            f"&job_id=eq.{encoded_job_id}&status=eq.rendering&limit=100"
        )) or []
        if not pending:
            return None
        recorded_ids = {
            str(item["render_batch_job_id"])
            for item in pending if item.get("render_batch_job_id")
        }
        if recorded_ids:
            return sorted(recorded_ids)[0]
        jobs = rest("video_jobs", query=(
            "select=id,status,deadline_at,mvp_session_id,user_id,"
            "dispatch_priority_class"
            f"&id=eq.{encoded_job_id}&limit=1"
        )) or []
        if not jobs or jobs[0]["status"] != "rendering":
            return None
        deadline = datetime.fromisoformat(jobs[0]["deadline_at"].replace("Z", "+00:00"))
        if deadline <= datetime.now(UTC):
            return None
        priority_class = _priority_class(jobs[0].get("dispatch_priority_class"))
        request = {
            "jobName": f"shorts-render-{job_id}",
            "jobQueue": os.environ["RENDER_BATCH_QUEUE"],
            "jobDefinition": os.environ["RENDER_JOB_DEFINITION"],
            "shareIdentifier": _priority_share_identifier(
                priority_class,
                jobs[0].get("user_id"), jobs[0].get("mvp_session_id"), job_id
            ),
            "schedulingPriorityOverride": _scheduling_priority(priority_class),
            "parameters": {"renderRetryCount": "0"},
            "containerOverrides": _render_container_overrides([
                "python", "-m", "shorts_worker", "render-shard", "--job-id", job_id,
            ]),
            "retryStrategy": {"attempts": 1},
            "timeout": {"attemptDurationSeconds": 1200},
        }
        if count > 1:
            request["arrayProperties"] = {"size": count}
        render_batch_id = _submit_once(request, f"render:{job_id}")
        patch(
            "generated_shorts",
            f"job_id=eq.{encoded_job_id}&status=eq.rendering",
            {"render_batch_job_id": render_batch_id},
        )
        return render_batch_id
    if kind == "render_retry":
        job_id = str(payload["jobId"])
        shard_index = max(0, int(payload["shardIndex"]))
        failed_batch_id = str(payload["failedBatchJobId"])
        retry_count = max(1, int(payload.get("retryCount") or 1))
        encoded_job_id = urllib.parse.quote(job_id, safe="")
        encoded_failed_batch_id = urllib.parse.quote(failed_batch_id, safe="")
        pending = rest("generated_shorts", query=(
            "select=id"
            f"&job_id=eq.{encoded_job_id}&render_shard_index=eq.{shard_index}"
            f"&render_batch_job_id=eq.{encoded_failed_batch_id}"
            "&status=eq.rendering&limit=1"
        )) or []
        jobs = rest("video_jobs", query=(
            "select=id,status,deadline_at,mvp_session_id,user_id,"
            "dispatch_priority_class"
            f"&id=eq.{encoded_job_id}&limit=1"
        )) or []
        if not pending or not jobs or jobs[0]["status"] != "rendering":
            return None
        deadline = datetime.fromisoformat(jobs[0]["deadline_at"].replace("Z", "+00:00"))
        if deadline <= datetime.now(UTC):
            return None
        retry_name = (
            f"shorts-render-retry-{job_id}-{shard_index}-{retry_count}"
        )
        priority_class = _priority_class(jobs[0].get("dispatch_priority_class"))
        request = dict(
            jobName=retry_name,
            jobQueue=os.environ["RENDER_BATCH_QUEUE"],
            jobDefinition=os.environ["RENDER_JOB_DEFINITION"],
            shareIdentifier=_priority_share_identifier(
                priority_class,
                jobs[0].get("user_id"), jobs[0].get("mvp_session_id"), job_id
            ),
            schedulingPriorityOverride=_scheduling_priority(priority_class),
            parameters={"renderRetryCount": str(retry_count)},
            containerOverrides=_render_container_overrides([
                "python", "-m", "shorts_worker", "render-shard", "--job-id", job_id,
                "--shard-index", str(shard_index),
            ]),
            retryStrategy={"attempts": 1},
            timeout={"attemptDurationSeconds": 1200},
        )
        render_retry_id = _submit_once(
            request, f"render-retry:{job_id}:{shard_index}:{failed_batch_id}"
        )
        patch(
            "generated_shorts",
            (
                f"job_id=eq.{encoded_job_id}&render_shard_index=eq.{shard_index}"
                f"&render_batch_job_id=eq.{encoded_failed_batch_id}&status=eq.rendering"
            ),
            {"render_batch_job_id": render_retry_id},
        )
        return render_retry_id
    if kind == "rerender":
        short_id = str(payload["shortId"])
        rerender_attempt = max(0, min(1, int(payload.get("attempt") or 0)))
        encoded_short_id = urllib.parse.quote(short_id, safe="")
        shorts = rest("generated_shorts", query=(
            "select=id,status,render_version,rerender_batch_job_id,mvp_session_id,"
            "job_id"
            f"&id=eq.{encoded_short_id}&status=eq.rerendering&limit=1"
        )) or []
        if not shorts:
            return None
        if shorts[0].get("rerender_batch_job_id"):
            return str(shorts[0]["rerender_batch_job_id"])
        parent_jobs = rest("video_jobs", query=(
            "select=id,user_id,mvp_session_id,dispatch_priority_class"
            f"&id=eq.{urllib.parse.quote(str(shorts[0]['job_id']), safe='')}&limit=1"
        )) or []
        parent_job = parent_jobs[0] if parent_jobs else {}
        priority_class = _priority_class(
            parent_job.get("dispatch_priority_class")
        )
        version = int(shorts[0]["render_version"]) + 1
        request = dict(
            jobName=f"shorts-rerender-{short_id}-v{version}-a{rerender_attempt}",
            jobQueue=os.environ["PROJECT_BATCH_QUEUE"],
            jobDefinition=os.environ["RERENDER_JOB_DEFINITION"],
            shareIdentifier=_priority_share_identifier(
                priority_class,
                parent_job.get("user_id"),
                parent_job.get("mvp_session_id"),
                shorts[0].get("mvp_session_id"),
                short_id,
            ),
            schedulingPriorityOverride=_scheduling_priority(priority_class),
            containerOverrides=_render_container_overrides([
                "python", "-m", "shorts_worker", "rerender", "--short-id", short_id,
            ]),
            parameters={"rerenderAttempt": str(rerender_attempt)},
            retryStrategy={"attempts": 1},
            timeout={"attemptDurationSeconds": 1200},
        )
        rerender_batch_id = _submit_once(
            request, f"rerender:{short_id}:{version}:{rerender_attempt}"
        )
        patch(
            "generated_shorts",
            f"id=eq.{encoded_short_id}&status=eq.rerendering",
            {"rerender_batch_job_id": rerender_batch_id},
        )
        return rerender_batch_id
    raise ValueError(f"Unsupported work kind: {kind}")


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    if event.get("kind"):
        result = _submit(event)
        log_event(
            "batch_submit_succeeded",
            kind=event.get("kind"),
            job_id=event.get("jobId"),
            batch_job_id=result,
            invocation="direct",
        )
        return {"batchJobId": result}

    failures: list[dict[str, str]] = []
    for record in event.get("Records", []):
        payload: dict[str, Any] = {}
        try:
            payload = json.loads(record["body"])
            result = _submit(payload)
            log_event(
                "batch_submit_succeeded",
                kind=payload.get("kind"),
                job_id=payload.get("jobId"),
                batch_job_id=result,
            )
        except Exception as exc:
            log_event(
                "batch_submit_failed",
                kind=payload.get("kind"),
                job_id=payload.get("jobId"),
                error_type=type(exc).__name__,
            )
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
