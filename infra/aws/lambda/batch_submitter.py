from __future__ import annotations

import json
import os
import urllib.parse
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
from common import iso_now, patch, rest

batch = boto3.client("batch")
sqs = boto3.client("sqs")
queue_url = os.environ["WORK_DISPATCH_QUEUE_URL"]
FINAL_MESSAGE = (
    "영상을 가져오지 못했습니다. 영상이 공개 상태인지, 로그인·연령·지역 제한이 "
    "없는지, 삭제되거나 비공개 처리되지 않았는지 확인한 뒤 다시 시도해 주세요."
)


def _prepare_gate() -> str:
    rows = rest(
        "ingestion_circuit",
        query="select=blocked_until,reason&singleton=eq.true&limit=1",
    ) or []
    if not rows:
        return "open"
    row = rows[0]
    now = datetime.now(UTC)
    blocked_until = row.get("blocked_until")
    if blocked_until and datetime.fromisoformat(blocked_until.replace("Z", "+00:00")) > now:
        return "wait"
    if row.get("reason"):
        patch("ingestion_circuit", "singleton=eq.true", {
            "blocked_until": (now + timedelta(seconds=60)).isoformat(),
            "reason": "probe_in_progress", "updated_at": iso_now(),
        })
        return "probe"
    return "open"


def _delay(payload: dict[str, Any]) -> None:
    sqs.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps(payload, separators=(",", ":")),
        DelaySeconds=60,
    )


def _submit(payload: dict[str, Any]) -> str | None:
    kind = payload.get("kind")
    prepare_gate = "open"
    if kind in {"prepare_batch", "prepare_retry"}:
        prepare_gate = _prepare_gate()
        if prepare_gate == "wait":
            _delay(payload)
            return None
    if kind == "prepare_batch":
        dispatch_id = str(payload["dispatchBatchId"])
        count = max(1, min(10000, int(payload["itemCount"])))
        request: dict[str, Any] = {
            "jobName": f"shorts-prepare-{dispatch_id[:8]}",
            "jobQueue": os.environ["PREPARE_BATCH_QUEUE"],
            "jobDefinition": os.environ["PREPARE_JOB_DEFINITION"],
            "containerOverrides": {"command": [
                "python", "-m", "shorts_worker", "prepare-array",
                "--dispatch-batch-id", dispatch_id,
            ]},
            "retryStrategy": {"attempts": 1},
            "timeout": {"attemptDurationSeconds": 840},
        }
        if prepare_gate == "probe" and count > 1:
            response = batch.submit_job(**request)
            _delay(payload)
            return response["jobId"]
        if count > 1:
            request["arrayProperties"] = {"size": count}
        response = batch.submit_job(**request)
        batch_id = response["jobId"]
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
        rows = rest("video_jobs", query=(
            "select=id,attempt_count,deadline_at,status"
            f"&id=eq.{encoded}&limit=1"
        )) or []
        if not rows:
            return None
        job = rows[0]
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
        response = batch.submit_job(
            jobName=f"shorts-retry-{job_id[:8]}",
            jobQueue=os.environ["PREPARE_BATCH_QUEUE"],
            jobDefinition=os.environ["PREPARE_JOB_DEFINITION"],
            containerOverrides={"command": [
                "python", "-m", "shorts_worker", "prepare", "--job-id", job_id,
            ]},
            retryStrategy={"attempts": 1},
            timeout={"attemptDurationSeconds": 840},
        )
        patch("video_jobs", f"id=eq.{encoded}", {"aws_batch_job_id": response["jobId"]})
        return response["jobId"]
    if kind == "render":
        job_id = str(payload["jobId"])
        count = max(1, int(payload["shardCount"]))
        request = {
            "jobName": f"shorts-render-{job_id[:8]}",
            "jobQueue": os.environ["RENDER_BATCH_QUEUE"],
            "jobDefinition": os.environ["RENDER_JOB_DEFINITION"],
            "containerOverrides": {"command": [
                "python", "-m", "shorts_worker", "render-shard", "--job-id", job_id,
            ]},
            "retryStrategy": {"attempts": 2},
            "timeout": {"attemptDurationSeconds": 600},
        }
        if count > 1:
            request["arrayProperties"] = {"size": count}
        response = batch.submit_job(**request)
        encoded_job_id = urllib.parse.quote(job_id, safe="")
        patch(
            "generated_shorts",
            f"job_id=eq.{encoded_job_id}&status=eq.rendering",
            {"render_batch_job_id": response["jobId"]},
        )
        return response["jobId"]
    if kind == "rerender":
        short_id = str(payload["shortId"])
        response = batch.submit_job(
            jobName=f"shorts-rerender-{short_id[:8]}",
            jobQueue=os.environ["RENDER_BATCH_QUEUE"],
            jobDefinition=os.environ["RENDER_JOB_DEFINITION"],
            containerOverrides={"command": [
                "python", "-m", "shorts_worker", "rerender", "--short-id", short_id,
            ]},
            retryStrategy={"attempts": 2},
            timeout={"attemptDurationSeconds": 600},
        )
        patch(
            "generated_shorts",
            f"id=eq.{urllib.parse.quote(short_id, safe='')}&status=eq.rerendering",
            {"rerender_batch_job_id": response["jobId"]},
        )
        return response["jobId"]
    raise ValueError(f"Unsupported work kind: {kind}")


def handler(event: dict[str, Any], _context: Any) -> dict[str, list[dict[str, str]]]:
    failures: list[dict[str, str]] = []
    for record in event.get("Records", []):
        try:
            _submit(json.loads(record["body"]))
        except Exception:
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
