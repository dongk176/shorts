from __future__ import annotations

import json
import os
from typing import Any

import boto3
from common import iso_now, log_event, patch, rest

sqs = boto3.client("sqs")
queue_url = os.environ["EDITOR_WORK_DISPATCH_QUEUE_URL"]


def handler(_event: dict[str, Any], _context: Any) -> dict[str, int]:
    claimed = rest(
        "rpc/claim_editor_render_outbox",
        method="POST",
        body={"p_limit": 25},
        prefer="return=representation",
    ) or []
    dispatched = 0
    for item in claimed:
        try:
            sqs.send_message(
                QueueUrl=queue_url,
                MessageBody=json.dumps({
                    "kind": "rerender",
                    "shortId": item["short_id"],
                    "requestId": item["request_id"],
                }, separators=(",", ":")),
            )
            patch("editor_render_outbox", f"id=eq.{item['outbox_id']}", {
                "status": "dispatched",
                "dispatched_at": iso_now(),
                "updated_at": iso_now(),
            })
            dispatched += 1
        except Exception as exc:
            attempts = int(item.get("attempt_count") or 1)
            terminal = attempts >= 5
            patch("editor_render_outbox", f"id=eq.{item['outbox_id']}", {
                "status": "failed" if terminal else "pending",
                "claimed_at": None,
                "available_at": iso_now(),
                "updated_at": iso_now(),
                "last_error": str(exc)[:1000],
            })
            log_event(
                "editor_outbox_dispatch_failed",
                short_id=item.get("short_id"),
                request_id=item.get("request_id"),
                terminal=terminal,
                error_type=type(exc).__name__,
            )
            if terminal:
                patch(
                    "editor_render_requests",
                    f"id=eq.{item['request_id']}&status=eq.queued",
                    {
                        "status": "failed",
                        "failure_code": "editor_dispatch_failed",
                        "updated_at": iso_now(),
                        "completed_at": iso_now(),
                    },
                )
                patch(
                    "generated_shorts",
                    (
                        f"id=eq.{item['short_id']}&status=eq.rerendering"
                        f"&pending_edit_request_id=eq.{item['request_id']}"
                    ),
                    {
                        "status": "ready",
                        "rerender_progress": 0,
                        "pending_render_hash": None,
                        "pending_edit_snapshot": None,
                        "pending_edit_request_id": None,
                        "rerender_batch_job_id": None,
                        "render_error_code": "editor_dispatch_failed",
                        "render_error_message": "편집 렌더 작업을 시작하지 못했습니다.",
                    },
                )
            else:
                raise
    return {"claimed": len(claimed), "dispatched": dispatched}
