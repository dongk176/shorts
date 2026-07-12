from __future__ import annotations

import urllib.parse
from typing import Any

from common import iso_now, patch, rest


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    detail = event.get("detail") or {}
    batch_job_id = detail.get("jobId")
    status = detail.get("status")
    if not batch_job_id or status not in {"SUCCEEDED", "FAILED"}:
        return {"ignored": True}
    encoded = urllib.parse.quote(str(batch_job_id), safe="")
    jobs = rest(
        "video_jobs",
        query=f"select=id,status&aws_batch_job_id=eq.{encoded}&limit=1",
    ) or []
    if jobs and status == "FAILED" and jobs[0]["status"] not in {
        "completed", "failed", "expired", "deleted"
    }:
        job_id = jobs[0]["id"]
        reason = str(detail.get("statusReason") or "AWS Batch 작업이 실패했습니다.")[:1000]
        patch(
            "video_jobs",
            f"id=eq.{job_id}",
            {
                "status": "failed",
                "stage": "failed",
                "progress": 100,
                "error_code": "batch_failed",
                "error_message": reason,
                "source_deleted_at": iso_now(),
            },
        )
        patch(
            "usage_reservations",
            f"job_id=eq.{job_id}&status=eq.reserved",
            {"status": "released", "released_at": iso_now()},
        )
        return {"updatedJobId": job_id}
    shorts = rest(
        "generated_shorts",
        query=f"select=id,status&rerender_batch_job_id=eq.{encoded}&limit=1",
    ) or []
    if shorts and status == "FAILED" and shorts[0]["status"] == "rerendering":
        patch(
            "generated_shorts",
            f"id=eq.{shorts[0]['id']}",
            {
                "status": "ready",
                "rerender_progress": 0,
                "pending_render_hash": None,
                "rerender_batch_job_id": None,
            },
        )
        return {"resetShortId": shorts[0]["id"]}
    return {"ignored": True}
