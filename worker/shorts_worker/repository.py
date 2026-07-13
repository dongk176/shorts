from __future__ import annotations

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

import boto3
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


class WorkerRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url
        self.state_queue_url = os.getenv("STATE_EVENT_QUEUE_URL")
        self.state_queue = boto3.client("sqs") if self.state_queue_url else None

    def _enqueue_state_event(self, payload: dict[str, Any]) -> bool:
        if not self.state_queue_url or not self.state_queue:
            return False
        try:
            payload["eventAt"] = datetime.now(UTC).isoformat()
            self.state_queue.send_message(
                QueueUrl=self.state_queue_url,
                MessageBody=json.dumps(payload, separators=(",", ":")),
            )
            return True
        except Exception:
            return False

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

    def get_dispatch_job(self, dispatch_batch_id: str, array_index: int) -> str | None:
        with self.connect() as connection:
            row = connection.execute(
                """
                select job_id from shorts_mvp.dispatch_batch_items
                where dispatch_batch_id=%s and array_index=%s
                """,
                (dispatch_batch_id, array_index),
            ).fetchone()
            return str(row["job_id"]) if row else None

    def claim_next_mac_job(self, worker_id: str) -> dict[str, Any] | None:
        with self.connect() as connection, connection.transaction():
            return connection.execute(
                """
                with candidate as (
                  select id
                  from shorts_mvp.video_jobs
                  where execution_backend='mac_pull'
                    and (status='queued' or (
                      status='retry_waiting' and next_attempt_at <= now()
                    ))
                    and deadline_at > now() + interval '5 minutes'
                    and attempt_count < 10
                  order by created_at
                  for update skip locked
                  limit 1
                )
                update shorts_mvp.video_jobs j
                set status='starting', stage='starting', progress=7,
                    worker_id=%s, claimed_at=now(), heartbeat_at=now(),
                    attempt_count=j.attempt_count + 1,
                    error_code=null, error_message=null
                from candidate
                where j.id=candidate.id
                returning j.id, j.attempt_count
                """,
                (worker_id[:120],),
            ).fetchone()

    @contextmanager
    def ingestion_slot(self) -> Iterator[None]:
        """Allow parallel YouTube acquisition."""
        yield



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

    def claim_prepare_attempt(
        self, job_id: str, *, attempt_override: int | None = None
    ) -> dict[str, Any] | None:
        with self.connect() as connection, connection.transaction():
            row = connection.execute(
                """
                update shorts_mvp.video_jobs
                set status='starting', stage='starting', progress=7,
                  attempt_count=case when %s is null then attempt_count + 1
                                     else greatest(attempt_count,%s) end,
                  next_attempt_at=null, error_code=null, error_message=null,
                  started_at=coalesce(started_at,now()), heartbeat_at=now()
                where id=%s and (
                    status in ('queued','retry_waiting')
                    or (execution_backend='mac_pull' and status='starting')
                  )
                  and deadline_at > now() + interval '5 minutes'
                  and attempt_count < 10
                returning attempt_count, deadline_at
                """,
                (attempt_override, attempt_override, job_id),
            ).fetchone()
            return row

    def begin_attempt(self, job_id: str, attempt: int) -> None:
        self.claim_prepare_attempt(job_id, attempt_override=attempt)

    def retry_job(self, job_id: str, error_code: str, message: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.video_jobs
                set status='retry_waiting', stage='downloading', progress=10,
                  next_attempt_at=now() + interval '60 seconds',
                  error_code=%s, error_message=null, heartbeat_at=now()
                where id=%s and status not in ('completed','failed','expired','deleted')
                """,
                (error_code[:100], job_id),
            )
            connection.execute(
                """
                insert into shorts_mvp.job_events (job_id,stage,progress,message,metadata)
                values (%s,'retry_waiting',10,'원본 영상을 다시 준비하고 있습니다.',%s)
                """,
                (job_id, Jsonb({"internal_error": message[:300]})),
            )

    def can_retry_prepare(self, job_id: str) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """
                select attempt_count < 10
                  and deadline_at > now() + interval '5 minutes' as allowed
                from shorts_mvp.video_jobs where id=%s
                """,
                (job_id,),
            ).fetchone()
            return bool(row and row["allowed"])

    def record_ingestion_result(self, job_id: str, result: str) -> None:
        with self.connect() as connection, connection.transaction():
            connection.execute(
                "insert into shorts_mvp.ingestion_attempts (job_id,result) values (%s,%s)",
                (job_id, result),
            )
            recent = connection.execute(
                """
                select count(*)::int as total,
                  count(*) filter (where result='bot_check')::int as blocked
                from (select result from shorts_mvp.ingestion_attempts
                      order by created_at desc limit 50) attempts
                """
            ).fetchone()
            if recent and recent["total"] >= 50 and recent["blocked"] / recent["total"] >= 0.2:
                connection.execute(
                    """
                    update shorts_mvp.ingestion_circuit
                    set blocked_until=now() + interval '60 seconds', reason='bot_check_rate',
                        updated_at=now() where singleton
                    """
                )
            elif result == "success":
                connection.execute(
                    """
                    update shorts_mvp.ingestion_circuit
                    set blocked_until=null, reason=null, updated_at=now() where singleton
                      and (reason is null or reason='probe_in_progress')
                    """
                )

    def stage(self, job_id: str, stage: str, progress: int, message: str) -> None:
        bounded_progress = max(0, min(100, progress))
        if self._enqueue_state_event({
            "type": "stage", "jobId": job_id, "stage": stage,
            "progress": bounded_progress, "message": message,
        }):
            return
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.video_jobs
                set status=%s, stage=%s, progress=%s,
                    started_at=coalesce(started_at, now()), heartbeat_at=now()
                where id=%s
                """,
                (stage, stage, bounded_progress, job_id),
            )
            connection.execute(
                """
                insert into shorts_mvp.job_events (job_id, stage, progress, message)
                values (%s,%s,%s,%s)
                """,
                (job_id, stage, bounded_progress, message),
            )

    def heartbeat(self, job_id: str) -> None:
        if self._enqueue_state_event({"type": "heartbeat", "jobId": job_id}):
            return
        with self.connect() as connection:
            connection.execute(
                "update shorts_mvp.video_jobs set heartbeat_at=now() where id=%s",
                (job_id,),
            )

    def update_rerender_progress(self, short_id: str, progress: int) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.generated_shorts
                set rerender_progress=%s
                where id=%s and status='rerendering'
                """,
                (max(0, min(99, progress)), short_id),
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
            inserted = connection.execute(
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
                returning id
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
            ).fetchone()
            if inserted:
                connection.execute(
                    """
                    update shorts_mvp.site_metrics
                    set value=value + 1, updated_at=now()
                    where key='generated_shorts'
                    """
                )
            connection.execute(
                """
                update shorts_mvp.generated_shorts
                set rendered_config_hash=md5(concat_ws('|', hook_title,
                  channel_display_name, subtitles_enabled::text,
                  subtitle_segments::text, template_id, title_font_scale::text))
                where id=%s and rendered_config_hash is null
                """,
                (short_id,),
            )

    def add_pending_short(
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
        expires_at: Any,
        shard_index: int,
    ) -> bool:
        with self.connect() as connection, connection.transaction():
            locked_job = connection.execute(
                "select id from shorts_mvp.video_jobs where id=%s for share",
                (job["id"],),
            ).fetchone()
            active_job = locked_job and connection.execute(
                """
                select id from shorts_mvp.video_jobs
                where id=%s and status not in ('completed','failed','expired','deleted')
                  and deadline_at > clock_timestamp()
                """,
                (job["id"],),
            ).fetchone()
            if not active_job:
                return False
            connection.execute(
                """
                insert into shorts_mvp.generated_shorts (
                  id, job_id, mvp_session_id, user_id, clip_index, start_seconds,
                  end_seconds, duration_seconds, hook_title, channel_display_name,
                  subtitle_segments, subtitles_enabled, template_id, clean_clip_s3_key,
                  output_s3_key, thumbnail_s3_key, file_size_bytes, expires_at, status,
                  render_shard_index, render_progress
                ) values (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,false,%s,%s,null,null,null,%s,
                  'rendering',%s,0
                )
                on conflict (job_id, clip_index) do update set
                  clean_clip_s3_key=excluded.clean_clip_s3_key,
                  subtitle_segments=excluded.subtitle_segments,
                  hook_title=excluded.hook_title,
                  render_shard_index=excluded.render_shard_index,
                  status='rendering', render_progress=0,
                  render_error_code=null, render_error_message=null
                """,
                (
                    short_id, job["id"], job["mvp_session_id"], job.get("user_id"),
                    clip_index, start_seconds, end_seconds, end_seconds - start_seconds,
                    hook_title, job["channel_name"], Jsonb(subtitles), job["template_id"],
                    clean_key, expires_at, shard_index,
                ),
            )
            return True

    def mark_render_queued(self, job_id: str, planned_count: int) -> bool:
        with self.connect() as connection:
            updated = connection.execute(
                """
                update shorts_mvp.video_jobs set status='rendering', stage='rendering',
                  progress=60, planned_short_count=%s, ready_short_count=0,
                  source_deleted_at=now(), heartbeat_at=now()
                where id=%s and status not in ('completed','failed','expired','deleted')
                  and deadline_at > clock_timestamp()
                returning id
                """,
                (planned_count, job_id),
            ).fetchone()
            return bool(updated)

    def get_render_shard(self, job_id: str, shard_index: int) -> list[dict[str, Any]]:
        with self.connect() as connection:
            return list(connection.execute(
                """
                select * from shorts_mvp.generated_shorts
                where job_id=%s and render_shard_index=%s and deleted_at is null
                  and status in ('rendering','ready')
                order by clip_index
                """,
                (job_id, shard_index),
            ).fetchall())

    def begin_initial_render(self, short_id: str) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """
                update shorts_mvp.generated_shorts
                set render_attempt_count=render_attempt_count + 1, render_progress=10,
                    render_error_code=null, render_error_message=null
                where id=%s and status='rendering'
                returning id
                """,
                (short_id,),
            ).fetchone()
            return bool(row)

    def update_initial_render_progress(self, short_id: str, progress: int) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.generated_shorts set render_progress=%s
                where id=%s and status='rendering'
                """,
                (max(0, min(99, progress)), short_id),
            )

    def complete_initial_render(
        self, short_id: str, output_key: str, thumbnail_key: str, size: int
    ) -> bool:
        with self.connect() as connection, connection.transaction():
            updated = connection.execute(
                """
                update shorts_mvp.generated_shorts s
                set output_s3_key=%s, thumbnail_s3_key=%s, file_size_bytes=%s,
                    status='ready', render_progress=100,
                    rendered_config_hash=md5(concat_ws('|', hook_title,
                      channel_display_name, subtitles_enabled::text,
                      subtitle_segments::text, template_id, title_font_scale::text)),
                    render_error_code=null, render_error_message=null
                where s.id=%s and s.status='rendering'
                  and exists (
                    select 1 from shorts_mvp.video_jobs j
                    where j.id=s.job_id
                      and j.status not in ('completed','failed','expired','deleted')
                      and j.deadline_at > clock_timestamp()
                  )
                returning job_id
                """,
                (output_key, thumbnail_key, size, short_id),
            ).fetchone()
            if updated:
                connection.execute(
                    """
                    update shorts_mvp.site_metrics set value=value+1, updated_at=now()
                    where key='generated_shorts'
                    """
                )
                connection.execute(
                    "select shorts_mvp.maybe_complete_video_job(%s)",
                    (updated["job_id"],),
                )
            return bool(updated)

    def fail_initial_render(self, short_id: str, error_code: str, message: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.generated_shorts
                set render_error_code=%s, render_error_message=%s, render_progress=0
                where id=%s and status='rendering'
                """,
                (error_code[:100], message[:1000], short_id),
            )

    def maybe_complete_job(self, job_id: str) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                "select shorts_mvp.maybe_complete_video_job(%s) as completed",
                (job_id,),
            ).fetchone()
            return bool(row and row["completed"])

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

    def fail_job(self, job_id: str, error_code: str, message: str) -> bool:
        with self.connect() as connection, connection.transaction():
            failed = connection.execute(
                """
                update shorts_mvp.video_jobs set status='failed', stage='failed', progress=100,
                  error_code=%s, error_message=%s, source_deleted_at=now(), heartbeat_at=now()
                where id=%s and status not in ('completed','failed','expired','deleted')
                returning id
                """,
                (error_code[:100], message[:1000], job_id),
            ).fetchone()
            if not failed:
                return False
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
            return True

    def remove_partial_shorts(self, job_id: str) -> None:
        with self.connect() as connection:
            connection.execute(
                "delete from shorts_mvp.generated_shorts where job_id=%s",
                (job_id,),
            )

    def complete_rerender(
        self, short_id: str, new_key: str, size: int, version: int
    ) -> str | None:
        with self.connect() as connection, connection.transaction():
            row = connection.execute(
                """
                select output_s3_key from shorts_mvp.generated_shorts
                where id=%s and status='rerendering' and deleted_at is null
                  and expires_at > clock_timestamp()
                for update
                """,
                (short_id,),
            ).fetchone()
            if not row:
                return None
            updated = connection.execute(
                """
                update shorts_mvp.generated_shorts
                set output_s3_key=%s, file_size_bytes=%s, render_version=%s, status='ready',
                  rerender_progress=100,
                  rendered_config_hash=pending_render_hash, pending_render_hash=null,
                  rerender_batch_job_id=null
                where id=%s and status='rerendering' and deleted_at is null
                  and expires_at > clock_timestamp()
                returning id
                """,
                (new_key, size, version, short_id),
            ).fetchone()
            if not updated:
                return None
            return str(row["output_s3_key"])

    def reset_rerender(self, short_id: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.generated_shorts
                set status='ready', rerender_progress=0,
                  pending_render_hash=null, rerender_batch_job_id=null
                where id=%s and status='rerendering'
                """,
                (short_id,),
            )
