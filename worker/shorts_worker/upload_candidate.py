from __future__ import annotations

import os
from datetime import UTC, datetime
from uuid import UUID


def upload_candidate_scope() -> tuple[str | None, str | None]:
    release = os.getenv("FILE_UPLOAD_CANDIDATE_RELEASE_ID")
    admin = os.getenv("FILE_UPLOAD_CANDIDATE_ADMIN_ID")
    if not release and not admin:
        return None, None
    try:
        return str(UUID(release or "")), str(UUID(admin or ""))
    except ValueError as exc:
        raise RuntimeError("Invalid isolated upload receiver scope") from exc


def upload_candidate_accepting() -> bool:
    if upload_candidate_scope()[0] is None:
        return True
    try:
        expires = datetime.fromisoformat(
            os.environ["FILE_UPLOAD_CANDIDATE_EXPIRES_AT"].replace("Z", "+00:00"),
        )
        return expires > datetime.now(UTC)
    except (KeyError, ValueError, TypeError):
        return False
