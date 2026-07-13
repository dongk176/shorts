from __future__ import annotations

import json
import os
import urllib.parse
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
from common import iso_now, log_event, patch, rest

batch = boto3.client("batch")
sqs = boto3.client("sqs")
queue_url = os.environ["WORK_DISPATCH_QUEUE_URL"]
FINAL_MESSAGE = (
    "영상을 가져오지 못했습니다. 영상이 공개 상태인지, 로그인·연령·지역 제한이 "
    "없는지, 삭제되거나 비공개 처리되지 않았는지 확인한 뒤 다시 시도해 주세요."
)


def _prepare_gate() -> str:
    rows = rest(
        "rpc/claim_ingestion_gate",
        method="POST",
        body={},
        prefer="return=representation",
    ) or []
    action = str(rows[0].get("action") or "open") if rows else "open"
    return action if action in {"open", "wait", "probe"} else "wait"


def _delay(payload: dict[str, Any]) -> None:
    sqs.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps(payload, separators=(",", ":")),
        DelaySeconds=60,
    )


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
        prepare_gate = _prepare_gate()
        if prepare_gate == "wait":
            _delay(payload)
            return None
        if prepare_gate == "probe" and count > 1:
            minute_bucket = int(datetime.now(UTC).timestamp() // 60)
            request["jobName"] = f"shorts-probe-{dispatch_id}-{minute_bucket}"
            probe_id = _submit_once(
                request, f"prepare-probe:{dispatch_id}:{minute_bucket}"
            )
            _delay(payload)
            return probe_id
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
            "select=id,attempt_count,deadline_at,status,aws_batch_job_id"
            f"&id=eq.{encoded}&limit=1"
        )) or []
        if not rows:
            return None
        job = rows[0]
        if failed_batch_id and job.get("aws_batch_job_id") != failed_batch_id:
            return None
        deadline = datetime.fromisoformat(job["deadline_at"].replace("Z", "+00:00"))
        if job["status"] != "retry_waiting" or int(job["attempt_count"]) >= 10 \
                or deadline <= datetime.now(UTC) + timedelta(minutes=5):
            patch("video_jobs", f"id=eq.{encoded}&status=eq.retry_waiting", {
                "status": "failed", "stage": "failed", "progress": 100,
                "error_code": "prepare_deadline", "error_message": FINAL_MESSAGE,
                "source_deleted_at": iso_now(),
            })
            patch("usage_reservations", f"job_id=eq.{encoded}&status=eq.reserved", {
                "status": "released", "released_at": iso_now(),
            })
            return None
        prepare_gate = _prepare_gate()
        if prepare_gate == "wait":
            _delay(payload)
            return None
        next_attempt = int(job["attempt_count"]) + 1
        job_name = f"shorts-retry-{job_id}-a{next_attempt}"
        request = dict(
            jobName=job_name,
            jobQueue=os.environ["PREPARE_BATCH_QUEUE"],
            jobDefinition=os.environ["PREPARE_JOB_DEFINITION"],
            containerOverrides={"command": [
                "python", "-m", "shorts_worker", "prepare", "--job-id", job_id,
                "--attempt", str(next_attempt),
            ]},
            retryStrategy={"attempts": 1},
            timeout={"attemptDurationSeconds": 3600},
        )
        retry_batch_id = _submit_once(
            request, f"prepare-retry:{job_id}:{next_attempt}"
        )
        update_query = f"id=eq.{encoded}"
        if failed_batch_id:
            update_query += (
                f"&aws_batch_job_id=eq.{urllib.parse.quote(str(failed_batch_id), safe='')}"
            )
        else:
            update_query += "&status=eq.retry_waiting"
        patch("video_jobs", update_query, {
            "aws_batch_job_id": retry_batch_id, "dispatch_batch_id": None,
            "attempt_count": next_attempt, "next_attempt_at": None,
        })
        return retry_batch_id
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
            "select=id,status,deadline_at"
            f"&id=eq.{encoded_job_id}&limit=1"
        )) or []
        if not jobs or jobs[0]["status"] != "rendering":
            return None
        deadline = datetime.fromisoformat(jobs[0]["deadline_at"].replace("Z", "+00:00"))
        if deadline <= datetime.now(UTC):
            return None
        request = {
            "jobName": f"shorts-render-{job_id}",
            "jobQueue": os.environ["RENDER_BATCH_QUEUE"],
            "jobDefinition": os.environ["RENDER_JOB_DEFINITION"],
            "containerOverrides": {"command": [
                "python", "-m", "shorts_worker", "render-shard", "--job-id", job_id,
            ]},
            "retryStrategy": {"attempts": 2},
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
        encoded_job_id = urllib.parse.quote(job_id, safe="")
        encoded_failed_batch_id = urllib.parse.quote(failed_batch_id, safe="")
        pending = rest("generated_shorts", query=(
            "select=id"
            f"&job_id=eq.{encoded_job_id}&render_shard_index=eq.{shard_index}"
            f"&render_batch_job_id=eq.{encoded_failed_batch_id}"
            "&status=eq.rendering&limit=1"
        )) or []
        jobs = rest("video_jobs", query=(
            "select=id,status,deadline_at"
            f"&id=eq.{encoded_job_id}&limit=1"
        )) or []
        if not pending or not jobs or jobs[0]["status"] != "rendering":
            return None
        deadline = datetime.fromisoformat(jobs[0]["deadline_at"].replace("Z", "+00:00"))
        if deadline <= datetime.now(UTC):
            return None
        retry_name = (
            f"shorts-render-retry-{job_id}-{shard_index}-{failed_batch_id}"
        )
        request = dict(
            jobName=retry_name,
            jobQueue=os.environ["RENDER_BATCH_QUEUE"],
            jobDefinition=os.environ["RENDER_JOB_DEFINITION"],
            containerOverrides={"command": [
                "python", "-m", "shorts_worker", "render-shard", "--job-id", job_id,
                "--shard-index", str(shard_index),
            ]},
            retryStrategy={"attempts": 2},
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
        encoded_short_id = urllib.parse.quote(short_id, safe="")
        shorts = rest("generated_shorts", query=(
            "select=id,status,render_version,rerender_batch_job_id"
            f"&id=eq.{encoded_short_id}&status=eq.rerendering&limit=1"
        )) or []
        if not shorts:
            return None
        if shorts[0].get("rerender_batch_job_id"):
            return str(shorts[0]["rerender_batch_job_id"])
        version = int(shorts[0]["render_version"]) + 1
        request = dict(
            jobName=f"shorts-rerender-{short_id}-v{version}",
            jobQueue=os.environ["RENDER_BATCH_QUEUE"],
            jobDefinition=os.environ["RENDER_JOB_DEFINITION"],
            containerOverrides={"command": [
                "python", "-m", "shorts_worker", "rerender", "--short-id", short_id,
            ]},
            retryStrategy={"attempts": 2},
            timeout={"attemptDurationSeconds": 600},
        )
        rerender_batch_id = _submit_once(
            request, f"rerender:{short_id}:v{version}"
        )
        patch(
            "generated_shorts",
            f"id=eq.{encoded_short_id}&status=eq.rerendering",
            {"rerender_batch_job_id": rerender_batch_id},
        )
        return rerender_batch_id
    raise ValueError(f"Unsupported work kind: {kind}")


def handler(event: dict[str, Any], _context: Any) -> dict[str, list[dict[str, str]]]:
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
