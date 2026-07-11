from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


class WorkerRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    @contextmanager
    def connect(self) -> Iterator[psycopg.Connection[dict[str, Any]]]:
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            return connection.execute(
                """
                select j.*, s.selected_plan_code, p.retention_days
                from shorts_mvp.video_jobs j
                join shorts_mvp.mvp_sessions s on s.id = j.mvp_session_id
                join shorts_mvp.plans p on p.code = s.selected_plan_code
                where j.id = %s
                """,
                (job_id,),
            ).fetchone()

    def get_short(self, short_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            return connection.execute(
                """
                select * from shorts_mvp.generated_shorts
                where id=%s and deleted_at is null and expires_at > now()
                  and status='rerendering'
                """,
                (short_id,),
            ).fetchone()

    def begin_attempt(self, job_id: str, attempt: int) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.video_jobs
                set status='starting', stage='starting', progress=7,
                  attempt_count=greatest(attempt_count,%s),
                  started_at=coalesce(started_at,now()), heartbeat_at=now()
                where id=%s
                """,
                (attempt, job_id),
            )

    def retry_job(self, job_id: str, error_code: str, message: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.video_jobs
                set status='queued', stage='queued', progress=5,
                  error_code=%s, error_message=%s, heartbeat_at=now()
                where id=%s
                """,
                (error_code[:100], f"재시도 대기: {message}"[:1000], job_id),
            )

    def stage(self, job_id: str, stage: str, progress: int, message: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.video_jobs
                set status=%s, stage=%s, progress=%s,
                    started_at=coalesce(started_at, now()), heartbeat_at=now()
                where id=%s
                """,
                (stage, stage, max(0, min(100, progress)), job_id),
            )
            connection.execute(
                """
                insert into shorts_mvp.job_events (job_id, stage, progress, message)
                values (%s,%s,%s,%s)
                """,
                (job_id, stage, max(0, min(100, progress)), message),
            )

    def heartbeat(self, job_id: str) -> None:
        with self.connect() as connection:
            connection.execute(
                "update shorts_mvp.video_jobs set heartbeat_at=now() where id=%s",
                (job_id,),
            )

    def add_short(
        self,
        *,
        short_id: str,
        job: dict[str, Any],
        clip_index: int,
        start_seconds: float,
        end_seconds: float,
        hook_title: str,
        subtitles: list[dict[str, Any]],
        clean_key: str,
        output_key: str,
        thumbnail_key: str,
        file_size: int,
        expires_at: Any,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                insert into shorts_mvp.generated_shorts (
                  id, job_id, mvp_session_id, user_id, clip_index, start_seconds,
                  end_seconds, duration_seconds, hook_title, channel_display_name,
                  subtitle_segments, subtitles_enabled, template_id, clean_clip_s3_key,
                  output_s3_key, thumbnail_s3_key, file_size_bytes, expires_at, status
                ) values (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,false,%s,%s,%s,%s,%s,%s,'ready'
                )
                on conflict (job_id, clip_index) do nothing
                """,
                (
                    short_id,
                    job["id"],
                    job["mvp_session_id"],
                    job.get("user_id"),
                    clip_index,
                    start_seconds,
                    end_seconds,
                    end_seconds - start_seconds,
                    hook_title,
                    job["channel_name"],
                    Jsonb(subtitles),
                    job["template_id"],
                    clean_key,
                    output_key,
                    thumbnail_key,
                    file_size,
                    expires_at,
                ),
            )
            connection.execute(
                """
                update shorts_mvp.generated_shorts
                set rendered_config_hash=md5(concat_ws('|', hook_title,
                  channel_display_name, subtitles_enabled::text,
                  subtitle_segments::text, template_id))
                where id=%s and rendered_config_hash is null
                """,
                (short_id,),
            )

    def complete_job(self, job_id: str) -> None:
        with self.connect() as connection, connection.transaction():
            reservation = connection.execute(
                """
                update shorts_mvp.usage_reservations
                set status='consumed', consumed_at=now()
                where job_id=%s and status='reserved'
                returning mvp_session_id, user_id, source_duration_seconds
                """,
                (job_id,),
            ).fetchone()
            if reservation:
                connection.execute(
                    """
                    insert into shorts_mvp.usage_events
                      (mvp_session_id, user_id, job_id, event_type, source_duration_seconds)
                    values (%s,%s,%s,'source_consumed',%s)
                    on conflict (job_id, event_type) do nothing
                    """,
                    (
                        reservation["mvp_session_id"],
                        reservation["user_id"],
                        job_id,
                        reservation["source_duration_seconds"],
                    ),
                )
            connection.execute(
                """
                update shorts_mvp.video_jobs
                set status='completed', stage='completed', progress=100,
                  completed_at=now(), source_deleted_at=now(), heartbeat_at=now(),
                  expires_at=(
                    select max(expires_at) from shorts_mvp.generated_shorts where job_id=%s
                  )
                where id=%s
                """,
                (job_id, job_id),
            )
            connection.execute(
                """
                insert into shorts_mvp.job_events (job_id,stage,progress,message)
                values (%s,'completed',100,'완료되었습니다.')
                """,
                (job_id,),
            )

    def fail_job(self, job_id: str, error_code: str, message: str) -> None:
        with self.connect() as connection, connection.transaction():
            connection.execute(
                """
                update shorts_mvp.video_jobs set status='failed', stage='failed', progress=100,
                  error_code=%s, error_message=%s, source_deleted_at=now(), heartbeat_at=now()
                where id=%s
                """,
                (error_code[:100], message[:1000], job_id),
            )
            connection.execute(
                """
                update shorts_mvp.usage_reservations
                set status='released', released_at=now()
                where job_id=%s and status='reserved'
                """,
                (job_id,),
            )
            connection.execute(
                """
                insert into shorts_mvp.job_events (job_id,stage,progress,message)
                values (%s,'failed',100,%s)
                """,
                (job_id, message[:500]),
            )

    def remove_partial_shorts(self, job_id: str) -> None:
        with self.connect() as connection:
            connection.execute(
                "delete from shorts_mvp.generated_shorts where job_id=%s",
                (job_id,),
            )

    def complete_rerender(self, short_id: str, new_key: str, size: int, version: int) -> str:
        with self.connect() as connection, connection.transaction():
            row = connection.execute(
                "select output_s3_key from shorts_mvp.generated_shorts where id=%s for update",
                (short_id,),
            ).fetchone()
            if not row:
                raise KeyError(short_id)
            connection.execute(
                """
                update shorts_mvp.generated_shorts
                set output_s3_key=%s, file_size_bytes=%s, render_version=%s, status='ready',
                  rendered_config_hash=pending_render_hash, pending_render_hash=null,
                  rerender_batch_job_id=null
                where id=%s
                """,
                (new_key, size, version, short_id),
            )
            return str(row["output_s3_key"])

    def reset_rerender(self, short_id: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.generated_shorts
                set status='ready', pending_render_hash=null, rerender_batch_job_id=null
                where id=%s and status='rerendering'
                """,
                (short_id,),
            )
