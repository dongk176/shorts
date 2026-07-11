from __future__ import annotations

import json
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .schemas import JobStatus


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


class JobDatabase:
    """Small SQLite repository; each operation owns its connection for thread safety."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    youtube_url TEXT NOT NULL,
                    template_id TEXT NOT NULL,
                    range_start_seconds REAL NOT NULL DEFAULT 0,
                    range_end_seconds REAL,
                    channel_name TEXT,
                    source_path TEXT,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
                    message TEXT NOT NULL,
                    outputs_json TEXT NOT NULL DEFAULT '[]',
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(jobs)").fetchall()
            }
            if "range_start_seconds" not in columns:
                connection.execute(
                    "ALTER TABLE jobs ADD COLUMN range_start_seconds REAL NOT NULL DEFAULT 0"
                )
            if "range_end_seconds" not in columns:
                connection.execute("ALTER TABLE jobs ADD COLUMN range_end_seconds REAL")
            if "channel_name" not in columns:
                connection.execute("ALTER TABLE jobs ADD COLUMN channel_name TEXT")
            if "source_path" not in columns:
                connection.execute("ALTER TABLE jobs ADD COLUMN source_path TEXT")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS job_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
                    level TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )

    def recover_interrupted_jobs(self) -> int:
        """Mark work lost during a process restart as failed instead of leaving it stuck."""
        terminal = (JobStatus.COMPLETED.value, JobStatus.FAILED.value)
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE jobs
                SET status = ?, message = ?, error_message = ?, updated_at = ?
                WHERE status NOT IN (?, ?)
                """,
                (
                    JobStatus.FAILED.value,
                    "서버가 다시 시작되어 작업이 중단되었습니다. 다시 시도해 주세요.",
                    "서버 재시작으로 작업 중단",
                    _utc_now(),
                    *terminal,
                ),
            )
            return cursor.rowcount

    def create_job(
        self,
        job_id: str,
        youtube_url: str,
        template_id: str,
        range_start_seconds: float = 0,
        range_end_seconds: float | None = None,
    ) -> None:
        now = _utc_now()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO jobs (
                    job_id, youtube_url, template_id, range_start_seconds,
                    range_end_seconds, status, progress, message,
                    outputs_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
                """,
                (
                    job_id,
                    youtube_url,
                    template_id,
                    range_start_seconds,
                    range_end_seconds,
                    JobStatus.QUEUED.value,
                    0,
                    "작업을 준비하고 있습니다.",
                    now,
                    now,
                ),
            )

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if row is None:
            return None
        result = dict(row)
        try:
            result["outputs"] = json.loads(result.pop("outputs_json"))
        except (TypeError, json.JSONDecodeError):
            result["outputs"] = []
            result.pop("outputs_json", None)
        return result

    def update_job(
        self,
        job_id: str,
        *,
        status: JobStatus | str | None = None,
        progress: int | None = None,
        message: str | None = None,
        outputs: list[dict[str, Any]] | None = None,
        error_message: str | None = None,
        channel_name: str | None = None,
        source_path: str | None = None,
    ) -> None:
        fields: list[str] = []
        values: list[Any] = []
        if status is not None:
            fields.append("status = ?")
            values.append(status.value if isinstance(status, JobStatus) else status)
        if progress is not None:
            fields.append("progress = ?")
            values.append(max(0, min(100, int(progress))))
        if message is not None:
            fields.append("message = ?")
            values.append(message)
        if outputs is not None:
            fields.append("outputs_json = ?")
            values.append(json.dumps(outputs, ensure_ascii=False))
        if error_message is not None:
            fields.append("error_message = ?")
            values.append(error_message)
        if channel_name is not None:
            fields.append("channel_name = ?")
            values.append(channel_name)
        if source_path is not None:
            fields.append("source_path = ?")
            values.append(source_path)
        fields.append("updated_at = ?")
        values.extend((_utc_now(), job_id))
        with self._connect() as connection:
            cursor = connection.execute(
                f"UPDATE jobs SET {', '.join(fields)} WHERE job_id = ?",  # noqa: S608
                values,
            )
            if cursor.rowcount == 0:
                raise KeyError(job_id)

    def append_log(self, job_id: str, level: str, message: str) -> None:
        # Avoid unbounded SQLite rows and accidental secret leakage through arbitrary objects.
        safe_message = str(message).replace("\x00", "")[-20_000:]
        for variable in ("OPENAI_API_KEY", "GEMINI_API_KEY"):
            api_key = os.getenv(variable)
            if api_key:
                safe_message = safe_message.replace(api_key, "[REDACTED]")
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO job_logs (job_id, level, message, created_at) VALUES (?, ?, ?, ?)",
                (job_id, level.upper()[:10], safe_message, _utc_now()),
            )

    def get_logs(self, job_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT level, message, created_at FROM job_logs WHERE job_id = ? ORDER BY id",
                (job_id,),
            ).fetchall()
        return [dict(row) for row in rows]
