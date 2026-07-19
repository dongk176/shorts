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

from .schemas import default_comment_overlays

_SOURCE_DOWNLOAD_STATUSES = frozenset({"full_source_expected", "unexpected_duration"})


class WorkerRepository:
    def __init__(self, database_url: str, aws_region: str) -> None:
        self.database_url = database_url
        self.state_queue_url = os.getenv("STATE_EVENT_QUEUE_URL")
        self.state_queue = (
            boto3.client("sqs", region_name=aws_region) if self.state_queue_url else None
        )

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
                select j.*, j.retention_days_snapshot as retention_days
                from shorts_mvp.video_jobs j
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
                    error_code=null, error_message=null, error_details='{}'::jsonb
                from candidate
                where j.id=candidate.id
                returning j.id, j.attempt_count
                """,
                (worker_id[:120],),
            ).fetchone()

    @contextmanager
    def ingestion_slot(self) -> Iterator[None]:
        """Compatibility context; production slots are reserved by the dispatcher."""
        yield

    def release_ingestion_route(
        self,
        job_id: str,
        route_id: str,
        *,
        result: str,
        cooldown_seconds: int = 0,
    ) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """
                select shorts_mvp.release_ingestion_route(%s,%s,%s,%s) as released
                """,
                (job_id, route_id, result, cooldown_seconds),
            ).fetchone()
            return bool(row and row["released"])

    def rotate_ingestion_route(
        self,
        job_id: str,
        current_route_id: str | None,
        *,
        result: str,
        cooldown_seconds: int,
        excluded_route_ids: list[str],
    ) -> str | None:
        with self.connect() as connection:
            row = connection.execute(
                """
                select route_id
                from shorts_mvp.rotate_ingestion_route(%s,%s,%s,%s,%s::text[])
                """,
                (
                    job_id,
                    current_route_id,
                    result,
                    cooldown_seconds,
                    excluded_route_ids,
                ),
            ).fetchone()
            return str(row["route_id"]) if row and row.get("route_id") else None

    def get_short(self, short_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            return connection.execute(
                """
                select s.*, j.channel_thumbnail_url
                from shorts_mvp.generated_shorts s
                join shorts_mvp.video_jobs j on j.id=s.job_id
                where s.id=%s and s.deleted_at is null and s.expires_at > now()
                  and s.status='rerendering'
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
                set status='downloading', stage='downloading', progress=10,
                  attempt_count=case when %s::integer is null then attempt_count + 1
                                     else greatest(attempt_count,%s::integer) end,
                  next_attempt_at=null, error_code=null, error_message=null,
                  error_details='{}'::jsonb,
                  started_at=coalesce(started_at,now()),
                  claimed_at=coalesce(claimed_at,now()), heartbeat_at=now(),
                  range_download_status='pending',
                  downloaded_media_duration_seconds=null,
                  downloaded_media_bytes=null,
                  range_download_verified_at=null
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
        with self.connect() as connection, connection.transaction():
            retry = connection.execute(
                """
                update shorts_mvp.video_jobs
                set status='retry_waiting', stage='downloading', progress=10,
                  next_attempt_at=now() + interval '60 seconds',
                  error_code=%s, error_message=null, heartbeat_at=now()
                where id=%s and status not in ('completed','failed','expired','deleted')
                  and attempt_count < 10 and queue_expires_at > now()
                returning attempt_count,next_attempt_at
                """,
                (error_code[:100], job_id),
            ).fetchone()
            if not retry:
                return
            connection.execute(
                """
                insert into shorts_mvp.job_outbox
                  (job_id,kind,attempt_count,available_at)
                values (%s,'prepare',%s,%s)
                on conflict (job_id,kind,attempt_count) do nothing
                """,
                (job_id, retry["attempt_count"], retry["next_attempt_at"]),
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

    def record_source_download_observation(
        self,
        job_id: str,
        *,
        status: str,
        duration_seconds: float | None,
        media_bytes: int | None,
    ) -> None:
        if status not in _SOURCE_DOWNLOAD_STATUSES:
            raise ValueError(f"unsupported source download status: {status}")
        if duration_seconds is not None and duration_seconds <= 0:
            raise ValueError("download duration must be positive when provided")
        if media_bytes is not None and media_bytes <= 0:
            raise ValueError("download observation values must be positive")

        with self.connect() as connection, connection.transaction():
            connection.execute(
                """
                update shorts_mvp.video_jobs
                set range_download_status=%s,
                    downloaded_media_duration_seconds=%s,
                    downloaded_media_bytes=%s,
                    range_download_verified_at=now(), heartbeat_at=now()
                where id=%s
                """,
                (status, duration_seconds, media_bytes, job_id),
            )
            connection.execute(
                """
                insert into shorts_mvp.job_events
                  (job_id,stage,progress,message,metadata)
                values (
                  %s,'downloading',20,'다운로드한 전체 영상을 확인했습니다.',%s
                )
                """,
                (
                    job_id,
                    Jsonb(
                        {
                            "source_download_status": status,
                            "downloaded_media_duration_seconds": duration_seconds,
                            "downloaded_media_bytes": media_bytes,
                        }
                    ),
                ),
            )

    def record_ingestion_result(
        self,
        job_id: str,
        result: str,
        *,
        route_id: str | None = None,
        egress_class: str | None = None,
        job_attempt: int | None = None,
    ) -> None:
        with self.connect() as connection, connection.transaction():
            connection.execute(
                """
                insert into shorts_mvp.ingestion_attempts
                  (job_id,result,route_id,egress_class,job_attempt)
                values (%s,%s,%s,%s,%s)
                """,
                (job_id, result, route_id, egress_class, job_attempt),
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
        if self._enqueue_state_event(
            {
                "type": "stage",
                "jobId": job_id,
                "stage": stage,
                "progress": bounded_progress,
                "message": message,
            }
        ):
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
        highlight_reason: str,
        subtitles: list[dict[str, Any]],
        clean_key: str,
        output_key: str,
        thumbnail_key: str,
        file_size: int,
        expires_at: Any,
    ) -> None:
        comments = (
            default_comment_overlays(end_seconds - start_seconds)
            if job["template_id"] == "comment-capture"
            else []
        )
        with self.connect() as connection:
            inserted = connection.execute(
                """
                insert into shorts_mvp.generated_shorts (
                  id, job_id, mvp_session_id, user_id, clip_index, start_seconds,
                  end_seconds, duration_seconds, hook_title, highlight_reason,
                  channel_display_name,
                  subtitle_segments, subtitles_enabled, comment_overlays,
                  template_id, video_aspect_ratio,
                  clean_clip_s3_key,
                  output_s3_key, thumbnail_s3_key, file_size_bytes, expires_at, status
                ) values (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,false,%s,%s,%s,%s,%s,%s,%s,%s,'ready'
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
                    highlight_reason,
                    job["channel_name"],
                    Jsonb(subtitles),
                    Jsonb(comments),
                    job["template_id"],
                    job.get("video_aspect_ratio") or "1:1",
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
                  subtitle_segments::text, comment_overlays::text, template_id, video_aspect_ratio,
                  title_font_scale::text, title_text_styles::text,
                  title_text_styles_initialized::text))
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
        highlight_reason: str,
        subtitles: list[dict[str, Any]],
        clean_key: str,
        retention_days: int,
        shard_index: int,
    ) -> bool:
        comments = (
            default_comment_overlays(end_seconds - start_seconds)
            if job["template_id"] == "comment-capture"
            else []
        )
        with self.connect() as connection, connection.transaction():
            locked_job = connection.execute(
                "select id from shorts_mvp.video_jobs where id=%s for share",
                (job["id"],),
            ).fetchone()
            active_job = (
                locked_job
                and connection.execute(
                    """
                select id from shorts_mvp.video_jobs
                where id=%s and status not in ('completed','failed','expired','deleted')
                  and deadline_at > clock_timestamp()
                """,
                    (job["id"],),
                ).fetchone()
            )
            if not active_job:
                return False
            connection.execute(
                """
                insert into shorts_mvp.generated_shorts (
                  id, job_id, mvp_session_id, user_id, clip_index, start_seconds,
                  end_seconds, duration_seconds, hook_title, highlight_reason,
                  channel_display_name,
                  subtitle_segments, subtitles_enabled, comment_overlays,
                  template_id, video_aspect_ratio,
                  clean_clip_s3_key,
                  output_s3_key, thumbnail_s3_key, file_size_bytes, created_at,
                  expires_at, status, render_shard_index, render_progress
                ) values (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,false,%s,%s,%s,%s,null,null,null,
                  now(),
                  now() + make_interval(days => least(greatest(%s::integer, 1), 30)),
                  'rendering',%s,0
                )
                on conflict (job_id, clip_index) do update set
                  clean_clip_s3_key=excluded.clean_clip_s3_key,
                  subtitle_segments=excluded.subtitle_segments,
                  comment_overlays=case
                    when generated_shorts.comment_overlays='[]'::jsonb
                      then excluded.comment_overlays
                    else generated_shorts.comment_overlays
                  end,
                  hook_title=excluded.hook_title,
                  highlight_reason=excluded.highlight_reason,
                  video_aspect_ratio=excluded.video_aspect_ratio,
                  render_shard_index=excluded.render_shard_index,
                  status='rendering', render_progress=0,
                  render_error_code=null, render_error_message=null
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
                    highlight_reason,
                    (" ".join(str(job["channel_name"]).split())[:50] or "YouTube 채널"),
                    Jsonb(subtitles),
                    Jsonb(comments),
                    job["template_id"],
                    job.get("video_aspect_ratio") or "1:1",
                    clean_key,
                    retention_days,
                    shard_index,
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
            return list(
                connection.execute(
                    """
                select s.*, j.channel_thumbnail_url
                from shorts_mvp.generated_shorts s
                join shorts_mvp.video_jobs j on j.id=s.job_id
                where s.job_id=%s and s.render_shard_index=%s and s.deleted_at is null
                  and s.status in ('rendering','ready')
                order by s.clip_index
                """,
                    (job_id, shard_index),
                ).fetchall()
            )

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
                      subtitle_segments::text, comment_overlays::text,
                      template_id, video_aspect_ratio,
                      title_font_scale::text, title_text_styles::text,
                      title_text_styles_initialized::text)),
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

    def initial_render_matches(self, short_id: str, output_key: str, thumbnail_key: str) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """
                select 1 from shorts_mvp.generated_shorts
                where id=%s and status='ready'
                  and output_s3_key=%s and thumbnail_s3_key=%s
                  and deleted_at is null
                """,
                (short_id, output_key, thumbnail_key),
            ).fetchone()
            return bool(row)

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

    def fail_job(
        self,
        job_id: str,
        error_code: str,
        message: str,
        *,
        error_details: dict[str, object] | None = None,
    ) -> bool:
        persisted_details = error_details or {}
        with self.connect() as connection, connection.transaction():
            failed = connection.execute(
                """
                update shorts_mvp.video_jobs set status='failed', stage='failed', progress=100,
                  error_code=%s, error_message=%s, error_details=%s,
                  source_deleted_at=now(), heartbeat_at=now()
                where id=%s and status not in ('completed','failed','expired','deleted')
                returning id
                """,
                (error_code[:100], message[:1000], Jsonb(persisted_details), job_id),
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
                update shorts_mvp.generated_shorts
                set status='failed', render_progress=0,
                    render_error_code=%s, render_error_message=%s
                where job_id=%s and status in ('rendering','rerendering','ready')
                  and deleted_at is null
                """,
                (error_code[:100], message[:1000], job_id),
            )
            connection.execute(
                """
                insert into shorts_mvp.job_events (job_id,stage,progress,message,metadata)
                values (%s,'failed',100,%s,%s)
                """,
                (
                    job_id,
                    message[:500],
                    Jsonb({"error_code": error_code[:100], **persisted_details}),
                ),
            )
            return True

    def remove_partial_shorts(self, job_id: str) -> None:
        with self.connect() as connection:
            connection.execute(
                "delete from shorts_mvp.generated_shorts where job_id=%s",
                (job_id,),
            )

    def complete_rerender(self, short_id: str, new_key: str, size: int, version: int) -> str | None:
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
