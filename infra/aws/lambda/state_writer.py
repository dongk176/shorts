from __future__ import annotations

import json
from typing import Any

from common import log_event, rest


def handler(event: dict[str, Any], _context: Any) -> dict[str, list[dict[str, str]]]:
    failures: list[dict[str, str]] = []
    for record in event.get("Records", []):
        job_id = None
        try:
            payload = json.loads(record["body"])
            job_id = payload["jobId"]
            if payload.get("type") in {"heartbeat", "stage"}:
                is_stage = payload.get("type") == "stage"
                rest("rpc/apply_job_state_event", method="POST", body={
                    "p_job_id": job_id,
                    "p_stage": payload.get("stage") if is_stage else None,
                    "p_progress": int(payload.get("progress") or 0),
                    "p_message": str(payload.get("message") or ""),
                    "p_event_at": payload["eventAt"],
                }, prefer="return=representation")
            else:
                raise ValueError("Unsupported state event")
        except Exception as exc:
            log_event(
                "state_write_failed",
                job_id=job_id,
                error_type=type(exc).__name__,
            )
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
