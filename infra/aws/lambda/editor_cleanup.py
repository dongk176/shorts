from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from common import iso_now, patch, rest


def handler(_event: dict[str, Any], _context: Any) -> dict[str, int]:
    cutoff = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    stale = rest(
        "editor_render_requests",
        query=(
            "select=id,short_id&status=in.(queued,rendering)"
            f"&updated_at=lt.{cutoff}&limit=100"
        ),
    ) or []
    released = 0
    for request in stale:
        request_id = str(request["id"])
        short_id = str(request["short_id"])
        patch(
            "editor_render_requests",
            f"id=eq.{request_id}&status=in.(queued,rendering)",
            {
                "status": "failed",
                "failure_code": "editor_render_stale",
                "updated_at": iso_now(),
                "completed_at": iso_now(),
            },
        )
        patch(
            "generated_shorts",
            (
                f"id=eq.{short_id}&status=eq.rerendering"
                f"&pending_edit_request_id=eq.{request_id}"
            ),
            {
                "status": "ready",
                "rerender_progress": 0,
                "pending_render_hash": None,
                "pending_edit_snapshot": None,
                "pending_edit_request_id": None,
                "rerender_batch_job_id": None,
                "render_error_code": "editor_render_stale",
                "render_error_message": "편집 렌더 작업이 시간 안에 완료되지 않았습니다.",
            },
        )
        released += 1
    return {"released": released}
