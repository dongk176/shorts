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

    def claim_project_run(self, job_id: str, *, resume: bool) -> dict[str, Any] | None:
        with self.connect() as connection, connection.transaction():
            if resume:
                return connection.execute(
                    """
                    update shorts_mvp.video_jobs
                    set status='rendering',stage='rendering',progress=greatest(progress,60),
                        stage_completed_count=0,stage_total_count=0,
                        heartbeat_at=now(),error_code=null,error_message=null
                    where id=%s and pipeline_version=2
                      and preparation_finished_at is not null
                      and project_resume_count=1
                      and status not in ('completed','failed','expired','deleted')
                    returning attempt_count,deadline_at
                    """,
                    (job_id,),
                ).fetchone()
            row = connection.execute(
                """
                update shorts_mvp.video_jobs
                set status='downloading',stage='downloading',progress=10,
                    stage_completed_count=0,stage_total_count=0,
                    attempt_count=attempt_count+1,started_at=coalesce(started_at,now()),
                    claimed_at=coalesce(claimed_at,now()),heartbeat_at=now(),
                    error_code=null,error_message=null,error_details='{}'::jsonb,
                    range_download_status='pending',downloaded_media_duration_seconds=null,
                    downloaded_media_bytes=null,range_download_verified_at=null
                where id=%s and pipeline_version=2 and status='queued'
                  and deadline_at > now() + interval '5 minutes'
                returning attempt_count,deadline_at
                """,
                (job_id,),
            ).fetchone()
            if row:
                connection.execute(
                    "select shorts_mvp.initialize_project_output_attempts(%s)",
                    (job_id,),
                )
            return row

    def set_project_attempt_selected(self, job_id: str, slot_index: int) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.project_output_attempts
                set status='selected',selected_at=coalesce(selected_at,now()),
                    failure_stage=null,failure_code=null,failure_message=null,failed_at=null
                where job_id=%s and slot_index=%s and status in ('pending','selected')
                """,
                (job_id, slot_index),
            )

    def set_project_attempt_extracted(
        self, job_id: str, slot_index: int, short_id: str
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.project_output_attempts
                set status='extracted',generated_short_id=%s,
                    extracted_at=coalesce(extracted_at,now()),
                    failure_stage=null,failure_code=null,failure_message=null,failed_at=null
                where job_id=%s and slot_index=%s and status in ('selected','extracted')
                """,
                (short_id, job_id, slot_index),
            )

    def merge_project_attempt_performance_metrics(
        self, job_id: str, slot_index: int, metrics: dict[str, object]
    ) -> bool:
        try:
            with self.connect() as connection:
                connection.execute(
                    """
                    update shorts_mvp.project_output_attempts
                    set performance_metrics=performance_metrics || %s
                    where job_id=%s and slot_index=%s
                    """,
                    (Jsonb(metrics), job_id, slot_index),
                )
            return True
        except Exception as exc:
            print(json.dumps({
                "event": "performance_metrics_write_failed",
                "scope": "project_output_attempt",
                "job_id": job_id,
                "slot_index": slot_index,
                "error_type": type(exc).__name__,
            }, separators=(",", ":")), flush=True)
            return False

    def merge_job_performance_metrics(
        self, job_id: str, metrics: dict[str, object]
    ) -> bool:
        try:
            with self.connect() as connection:
                connection.execute(
                    """
                    update shorts_mvp.video_jobs
                    set performance_metrics=performance_metrics || %s
                    where id=%s
                    """,
                    (Jsonb(metrics), job_id),
                )
            return True
        except Exception as exc:
            print(json.dumps({
                "event": "performance_metrics_write_failed",
                "scope": "video_job",
                "job_id": job_id,
                "error_type": type(exc).__name__,
            }, separators=(",", ":")), flush=True)
            return False

    def fail_project_attempt(
        self,
        job_id: str,
        slot_index: int,
        *,
        stage: str,
        code: str,
        message: str,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.project_output_attempts
                set status='failed',failure_stage=%s,failure_code=%s,
                    failure_message=%s,failed_at=coalesce(failed_at,now())
                where job_id=%s and slot_index=%s and status <> 'ready'
                """,
                (stage, code[:100], message[:1000], job_id, slot_index),
            )

    def fail_unselected_project_attempts(self, job_id: str) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                update shorts_mvp.project_output_attempts
                set status='failed',failure_stage='selection',
                    failure_code='selection_shortfall',
                    failure_message='AI가 목표 개수만큼 사용할 구간을 선정하지 못했습니다.',
                    failed_at=coalesce(failed_at,now())
                where job_id=%s and status='pending'
                """,
                (job_id,),
            )
            return cursor.rowcount

    def fail_open_project_attempts(
        self, job_id: str, *, stage: str, code: str, message: str
    ) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                update shorts_mvp.project_output_attempts
                set status='failed',failure_stage=%s,failure_code=%s,
                    failure_message=%s,failed_at=coalesce(failed_at,now())
                where job_id=%s and status not in ('ready','failed')
                """,
                (stage, code[:100], message[:1000], job_id),
            )
            return cursor.rowcount

    def mark_project_preparation_finished(self, job_id: str) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """
                update shorts_mvp.video_jobs
                set status='rendering',stage='rendering',progress=60,
                    stage_completed_count=0,stage_total_count=0,
                    preparation_finished_at=coalesce(preparation_finished_at,now()),
                    source_deleted_at=coalesce(source_deleted_at,now()),heartbeat_at=now()
                where id=%s and pipeline_version=2
                  and status not in ('completed','failed','expired','deleted')
                returning id
                """,
                (job_id,),
            ).fetchone()
            return bool(row)

    def get_project_render_items(self, job_id: str) -> list[dict[str, Any]]:
        with self.connect() as connection:
            return list(connection.execute(
                """
                select s.*,j.channel_thumbnail_url,a.slot_index
                from shorts_mvp.project_output_attempts a
                join shorts_mvp.generated_shorts s on s.id=a.generated_short_id
                join shorts_mvp.video_jobs j on j.id=a.job_id
                where a.job_id=%s and a.status in ('extracted','rendering')
                  and s.status='rendering' and s.deleted_at is null
                order by a.slot_index
                """,
                (job_id,),
            ).fetchall())

    def mark_project_attempt_rendering(self, short_id: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.project_output_attempts
                set status='rendering',render_started_at=coalesce(render_started_at,now())
                where generated_short_id=%s and status='extracted'
                """,
                (short_id,),
            )

    def finalize_project_job(
        self,
        job_id: str,
        *,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> dict[str, Any] | None:
        with self.connect() as connection:
            return connection.execute(
                """
                select * from shorts_mvp.finalize_project_job(%s,%s,%s)
                """,
                (job_id, error_code, error_message),
            ).fetchone()

    def project_timeline_needed(self, short_id: str) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """
                select 1
                from shorts_mvp.generated_shorts s
                join shorts_mvp.video_jobs j on j.id=s.job_id
                where s.id=%s and s.status in ('ready','rerendering')
                  and s.deleted_at is null and s.expires_at > clock_timestamp()
                  and s.edit_timeline_s3_key is null
                  and j.status='completed'
                """,
                (short_id,),
            ).fetchone()
            return bool(row)

    def complete_project_timeline(
        self,
        *,
        short_id: str,
        timeline_key: str,
        timeline_start_seconds: float,
        timeline_end_seconds: float,
        timeline_subtitles: list[dict[str, Any]],
    ) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                """
                update shorts_mvp.generated_shorts s
                set edit_timeline_s3_key=%s,
                    edit_timeline_start_seconds=%s,
                    edit_timeline_end_seconds=%s,
                    edit_timeline_subtitle_segments=%s,
                    edit_timeline_version=1
                where s.id=%s and s.status in ('ready','rerendering')
                  and s.deleted_at is null and s.expires_at > clock_timestamp()
                  and s.edit_timeline_s3_key is null
                  and exists (
                    select 1 from shorts_mvp.video_jobs j
                    where j.id=s.job_id and j.status='completed'
                  )
                returning id
                """,
                (
                    timeline_key,
                    timeline_start_seconds,
                    timeline_end_seconds,
                    Jsonb(timeline_subtitles),
                    short_id,
                ),
            ).fetchone()
            return bool(row)

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

    def stage(
        self,
        job_id: str,
        stage: str,
        progress: int,
        message: str,
        *,
        completed_count: int | None = None,
        total_count: int | None = None,
    ) -> None:
        bounded_progress = max(0, min(100, progress))
        bounded_total = None if total_count is None else max(0, min(15, total_count))
        bounded_completed = (
            None
            if bounded_total is None
            else max(0, min(bounded_total, completed_count or 0))
        )
        if self._enqueue_state_event(
            {
                "type": "stage",
                "jobId": job_id,
                "stage": stage,
                "progress": bounded_progress,
                "message": message,
                "stageCompletedCount": bounded_completed,
                "stageTotalCount": bounded_total,
            }
        ):
            return
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.video_jobs
                set status=%s, stage=%s, progress=%s,
                    stage_completed_count=case
                      when %s::integer is null then stage_completed_count else %s::integer end,
                    stage_total_count=case
                      when %s::integer is null then stage_total_count else %s::integer end,
                    started_at=coalesce(started_at, now()), heartbeat_at=now()
                where id=%s
                """,
                (
                    stage,
                    stage,
                    bounded_progress,
                    bounded_total,
                    bounded_completed,
                    bounded_total,
                    bounded_total,
                    job_id,
                ),
            )
            connection.execute(
                """
                insert into shorts_mvp.job_events (job_id,stage,progress,message,metadata)
                values (%s,%s,%s,%s,%s)
                """,
                (
                    job_id,
                    stage,
                    bounded_progress,
                    message,
                    Jsonb({
                        "stageCompletedCount": bounded_completed,
                        "stageTotalCount": bounded_total,
                    }) if bounded_total is not None else Jsonb({}),
                ),
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
        comment_overlays: list[dict[str, Any]],
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
                  end_seconds, duration_seconds, hook_title, highlight_reason,
                  channel_display_name,
                  subtitle_segments, subtitles_enabled, comment_overlays,
                  template_id, custom_template_id, template_snapshot, video_aspect_ratio,
                  clean_clip_s3_key,
                  output_s3_key, thumbnail_s3_key, file_size_bytes, expires_at, status
                ) values (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'ready'
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
                    False,
                    Jsonb(comment_overlays),
                    job["template_id"],
                    job.get("custom_template_id"),
                    Jsonb(job["template_snapshot"]) if job.get("template_snapshot") else None,
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
                  subtitle_segments::text, comment_overlays::text, template_id,
                  coalesce(template_snapshot::text,''), video_aspect_ratio,
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
        selection_raw_start_seconds: float | None,
        selection_raw_end_seconds: float | None,
        selection_raw_duration_seconds: float | None,
        selection_candidate_index: int | None,
        selection_provider: str | None,
        selection_model: str | None,
        selection_length_adjustment: str | None,
        selection_repositioned: bool | None,
        subtitles: list[dict[str, Any]],
        comment_overlays: list[dict[str, Any]],
        clean_key: str,
        timeline_key: str | None,
        timeline_start_seconds: float | None,
        timeline_end_seconds: float | None,
        timeline_subtitles: list[dict[str, Any]] | None,
        retention_days: int,
        shard_index: int,
    ) -> bool:
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
                  end_seconds, duration_seconds,
                  selection_raw_start_seconds, selection_raw_end_seconds,
                  selection_raw_duration_seconds, selection_candidate_index,
                  selection_provider, selection_model, selection_length_adjustment,
                  selection_repositioned, hook_title, highlight_reason,
                  channel_display_name,
                  subtitle_segments, subtitles_enabled, comment_overlays,
                  template_id, custom_template_id, template_snapshot, video_aspect_ratio,
                  clean_clip_s3_key, edit_timeline_s3_key,
                  edit_timeline_start_seconds, edit_timeline_end_seconds,
                  edit_timeline_subtitle_segments, edit_timeline_version,
                  initial_start_seconds, initial_end_seconds,
                  output_s3_key, thumbnail_s3_key, file_size_bytes, created_at,
                  expires_at, status, render_shard_index, render_progress
                ) values (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,null,null,null,
                  now(),
                  now() + make_interval(days => least(greatest(%s::integer, 1), 30)),
                  'rendering',%s,0
                )
                on conflict (job_id, clip_index) do update set
                  clean_clip_s3_key=excluded.clean_clip_s3_key,
                  edit_timeline_s3_key=excluded.edit_timeline_s3_key,
                  edit_timeline_start_seconds=excluded.edit_timeline_start_seconds,
                  edit_timeline_end_seconds=excluded.edit_timeline_end_seconds,
                  edit_timeline_subtitle_segments=excluded.edit_timeline_subtitle_segments,
                  edit_timeline_version=excluded.edit_timeline_version,
                  initial_start_seconds=excluded.initial_start_seconds,
                  initial_end_seconds=excluded.initial_end_seconds,
                  subtitle_segments=excluded.subtitle_segments,
                  comment_overlays=case
                    when generated_shorts.comment_overlays='[]'::jsonb
                      then excluded.comment_overlays
                    else generated_shorts.comment_overlays
                  end,
                  hook_title=excluded.hook_title,
                  highlight_reason=excluded.highlight_reason,
                  selection_raw_start_seconds=excluded.selection_raw_start_seconds,
                  selection_raw_end_seconds=excluded.selection_raw_end_seconds,
                  selection_raw_duration_seconds=excluded.selection_raw_duration_seconds,
                  selection_candidate_index=excluded.selection_candidate_index,
                  selection_provider=excluded.selection_provider,
                  selection_model=excluded.selection_model,
                  selection_length_adjustment=excluded.selection_length_adjustment,
                  selection_repositioned=excluded.selection_repositioned,
                  video_aspect_ratio=excluded.video_aspect_ratio,
                  custom_template_id=excluded.custom_template_id,
                  template_snapshot=excluded.template_snapshot,
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
                    selection_raw_start_seconds,
                    selection_raw_end_seconds,
                    selection_raw_duration_seconds,
                    selection_candidate_index,
                    selection_provider,
                    selection_model,
                    selection_length_adjustment,
                    selection_repositioned,
                    hook_title,
                    highlight_reason,
                    (" ".join(str(job["channel_name"]).split())[:50] or "YouTube 채널"),
                    Jsonb(subtitles),
                    False,
                    Jsonb(comment_overlays),
                    job["template_id"],
                    job.get("custom_template_id"),
                    Jsonb(job["template_snapshot"]) if job.get("template_snapshot") else None,
                    job.get("video_aspect_ratio") or "1:1",
                    clean_key,
                    timeline_key,
                    timeline_start_seconds,
                    timeline_end_seconds,
                    Jsonb(timeline_subtitles) if timeline_subtitles is not None else None,
                    1 if timeline_key else None,
                    start_seconds,
                    end_seconds,
                    retention_days,
                    shard_index,
                ),
            )
            if int(job.get("pipeline_version") or 1) == 2:
                checkpoint = connection.execute(
                    """
                    update shorts_mvp.project_output_attempts
                    set status='extracted',generated_short_id=%s,
                        extracted_at=coalesce(extracted_at,now()),
                        failure_stage=null,failure_code=null,
                        failure_message=null,failed_at=null
                    where job_id=%s and slot_index=%s
                      and status in ('selected','extracted')
                    returning id
                    """,
                    (short_id, job["id"], clip_index),
                ).fetchone()
                if not checkpoint:
                    raise RuntimeError("편집용 영상 체크포인트를 확정하지 못했습니다.")
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
                      template_id, coalesce(template_snapshot::text,''), video_aspect_ratio,
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
                returning job_id,(
                  select pipeline_version from shorts_mvp.video_jobs where id=s.job_id
                ) as pipeline_version
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
                if int(updated["pipeline_version"] or 1) == 2:
                    connection.execute(
                        """
                        update shorts_mvp.project_output_attempts
                        set status='ready',ready_at=coalesce(ready_at,now()),
                            failure_stage=null,failure_code=null,failure_message=null,failed_at=null
                        where generated_short_id=%s
                        """,
                        (short_id,),
                    )
                    connection.execute(
                        """
                        update shorts_mvp.video_jobs j
                        set ready_short_count=least(j.planned_short_count,(
                              select count(*)::integer from shorts_mvp.generated_shorts s
                              where s.job_id=j.id and s.status='ready' and s.deleted_at is null
                            )),
                            progress=greatest(j.progress,65),heartbeat_at=now()
                        where j.id=%s and j.pipeline_version=2
                          and j.status not in ('completed','failed','expired','deleted')
                        """,
                        (updated["job_id"],),
                    )
                else:
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

    def fail_initial_render(
        self, short_id: str, error_code: str, message: str, *, terminal: bool = False
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.generated_shorts
                set render_error_code=%s, render_error_message=%s, render_progress=0,
                    status=case when %s then 'failed' else status end
                where id=%s and status='rendering'
                """,
                (error_code[:100], message[:1000], terminal, short_id),
            )
            if terminal:
                connection.execute(
                    """
                    update shorts_mvp.project_output_attempts
                    set status='failed',failure_stage='rendering',failure_code=%s,
                        failure_message=%s,failed_at=coalesce(failed_at,now())
                    where generated_short_id=%s and status <> 'ready'
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

    def complete_rerender(
        self,
        short_id: str,
        new_key: str,
        thumbnail_key: str,
        size: int,
        version: int,
    ) -> dict[str, str] | None:
        with self.connect() as connection, connection.transaction():
            row = connection.execute(
                """
                select output_s3_key,thumbnail_s3_key
                from shorts_mvp.generated_shorts
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
                set output_s3_key=%s, thumbnail_s3_key=%s, file_size_bytes=%s,
                  render_version=%s, status='ready',
                  rerender_progress=100,
                  rendered_config_hash=pending_render_hash, pending_render_hash=null,
                  rerender_batch_job_id=null,render_error_code=null,render_error_message=null
                where id=%s and status='rerendering' and deleted_at is null
                  and expires_at > clock_timestamp()
                returning id
                """,
                (new_key, thumbnail_key, size, version, short_id),
            ).fetchone()
            if not updated:
                return None
            return {
                key: str(row[key])
                for key in ("output_s3_key", "thumbnail_s3_key")
                if row.get(key)
            }

    def complete_snapshot_rerender(
        self,
        short_id: str,
        *,
        output_key: str,
        thumbnail_key: str,
        clean_key: str,
        size: int,
        version: int,
    ) -> dict[str, str] | None:
        with self.connect() as connection, connection.transaction():
            row = connection.execute(
                """
                select output_s3_key,thumbnail_s3_key,clean_clip_s3_key
                from shorts_mvp.generated_shorts
                where id=%s and status='rerendering' and deleted_at is null
                  and expires_at > clock_timestamp()
                  and pending_edit_snapshot is not null
                for update
                """,
                (short_id,),
            ).fetchone()
            if not row:
                return None
            updated = connection.execute(
                """
                update shorts_mvp.generated_shorts
                set output_s3_key=%s,thumbnail_s3_key=%s,clean_clip_s3_key=%s,file_size_bytes=%s,
                  render_version=%s,status='ready',rerender_progress=100,
                  start_seconds=(pending_edit_snapshot->>'startSeconds')::numeric,
                  end_seconds=(pending_edit_snapshot->>'endSeconds')::numeric,
                  duration_seconds=(pending_edit_snapshot->>'durationSeconds')::numeric,
                  hook_title=pending_edit_snapshot->>'hookTitle',
                  channel_display_name=pending_edit_snapshot->>'channelDisplayName',
                  subtitles_enabled=(pending_edit_snapshot->>'subtitlesEnabled')::boolean,
                  subtitle_segments=pending_edit_snapshot->'subtitleSegments',
                  edit_timeline_subtitle_segments=case
                    when edit_timeline_s3_key is null then null
                    else coalesce(
                      pending_edit_snapshot->'timelineSubtitleSegments',
                      edit_timeline_subtitle_segments
                    )
                  end,
                  comment_overlays=pending_edit_snapshot->'commentOverlays',
                  template_id=pending_edit_snapshot->>'templateId',
                  custom_template_id=nullif(
                    pending_edit_snapshot->>'customTemplateId',''
                  )::uuid,
                  template_snapshot=nullif(
                    pending_edit_snapshot->'templateSnapshot','null'::jsonb
                  ),
                  video_aspect_ratio=pending_edit_snapshot->>'videoAspectRatio',
                  title_font_scale=(pending_edit_snapshot->>'titleFontScale')::numeric,
                  title_text_styles=pending_edit_snapshot->'titleTextStyles',
                  title_text_styles_initialized=(
                    pending_edit_snapshot->>'titleTextStylesInitialized'
                  )::boolean,
                  rendered_config_hash=null,
                  pending_render_hash=null,pending_edit_snapshot=null,
                  rerender_batch_job_id=null,render_error_code=null,render_error_message=null
                where id=%s and status='rerendering' and deleted_at is null
                  and expires_at > clock_timestamp()
                  and pending_edit_snapshot is not null
                returning id
                """,
                (output_key, thumbnail_key, clean_key, size, version, short_id),
            ).fetchone()
            if not updated:
                return None
            connection.execute(
                """
                update shorts_mvp.generated_shorts
                set rendered_config_hash=md5(concat_ws('|', hook_title,
                  channel_display_name, subtitles_enabled::text,
                  subtitle_segments::text, comment_overlays::text, template_id,
                  coalesce(template_snapshot::text,''), video_aspect_ratio,
                  title_font_scale::text, title_text_styles::text,
                  title_text_styles_initialized::text))
                where id=%s
                """,
                (short_id,),
            )
            return {
                key: str(row[key])
                for key in ("output_s3_key", "thumbnail_s3_key", "clean_clip_s3_key")
                if row.get(key)
            }

    def complete_editor_document_rerender(
        self,
        short_id: str,
        *,
        output_key: str,
        thumbnail_key: str,
        clean_key: str,
        size: int,
        version: int,
        start_seconds: float,
        duration_seconds: float,
        subtitle_segments: list[dict[str, object]],
    ) -> dict[str, str] | None:
        with self.connect() as connection, connection.transaction():
            row = connection.execute(
                """
                select output_s3_key,thumbnail_s3_key,clean_clip_s3_key,
                  edit_timeline_s3_key,pending_edit_request_id
                from shorts_mvp.generated_shorts
                where id=%s and status='rerendering' and deleted_at is null
                  and expires_at > clock_timestamp()
                  and (pending_edit_snapshot->>'version')::int in (2,3)
                  and pending_edit_request_id is not null
                for update
                """,
                (short_id,),
            ).fetchone()
            if not row:
                return None
            updated = connection.execute(
                """
                update shorts_mvp.generated_shorts
                set output_s3_key=%s,thumbnail_s3_key=%s,clean_clip_s3_key=%s,
                  file_size_bytes=%s,render_version=%s,status='ready',
                  rerender_progress=100,
                  start_seconds=%s,end_seconds=%s,duration_seconds=%s,
                  hook_title=pending_edit_snapshot->'title'->>'text',
                  channel_display_name=pending_edit_snapshot->'channel'->>'displayName',
                  subtitles_enabled=(
                    pending_edit_snapshot->'subtitles'->>'enabled'
                  )::boolean,
                  subtitle_segments=%s,
                  comment_overlays=pending_edit_snapshot->'comments',
                  template_id=pending_edit_snapshot->'template'->>'id',
                  custom_template_id=nullif(
                    pending_edit_snapshot->'template'->>'customTemplateId',''
                  )::uuid,
                  template_snapshot=nullif(
                    pending_edit_snapshot->'template'->'snapshot','null'::jsonb
                  ),
                  video_aspect_ratio=pending_edit_snapshot->'video'->>'aspectRatio',
                  -- editor_document keeps the full v2 scale. This legacy
                  -- compatibility column still has its original 0.8..1.2
                  -- constraint, so never let v2-only values abort the atomic
                  -- promotion after a successful render.
                  title_font_scale=greatest(
                    0.8,
                    least(
                      1.2,
                      (
                        pending_edit_snapshot->'title'->>'fontScale'
                      )::numeric
                    )
                  ),
                  title_text_styles=pending_edit_snapshot->'title'->'textStyles',
                  title_text_styles_initialized=true,
                  edit_timeline_s3_key=coalesce(
                    edit_timeline_s3_key,clean_clip_s3_key
                  ),
                  edit_timeline_start_seconds=coalesce(
                    edit_timeline_start_seconds,start_seconds
                  ),
                  edit_timeline_end_seconds=coalesce(
                    edit_timeline_end_seconds,end_seconds
                  ),
                  edit_timeline_subtitle_segments=coalesce(
                    edit_timeline_subtitle_segments,
                    pending_edit_snapshot->'subtitles'->'segments'
                  ),
                  edit_timeline_version=coalesce(edit_timeline_version,1),
                  editor_document=pending_edit_snapshot,
                  editor_document_version=(
                    pending_edit_snapshot->>'version'
                  )::smallint,
                  rendered_config_hash=pending_render_hash,
                  pending_render_hash=null,pending_edit_snapshot=null,
                  pending_edit_request_id=null,
                  rerender_batch_job_id=null,
                  render_error_code=null,render_error_message=null
                where id=%s and status='rerendering' and deleted_at is null
                  and expires_at > clock_timestamp()
                  and (pending_edit_snapshot->>'version')::int in (2,3)
                  and pending_edit_request_id=%s
                returning id
                """,
                (
                    output_key,
                    thumbnail_key,
                    clean_key,
                    size,
                    version,
                    start_seconds,
                    start_seconds + duration_seconds,
                    duration_seconds,
                    Jsonb(subtitle_segments),
                    short_id,
                    row["pending_edit_request_id"],
                ),
            ).fetchone()
            if not updated:
                return None
            connection.execute(
                """
                update shorts_mvp.editor_render_requests
                set status='succeeded',output_render_version=%s,
                  failure_code=null,updated_at=now(),completed_at=now()
                where id=%s and short_id=%s and status in ('queued','rendering')
                """,
                (version, row["pending_edit_request_id"], short_id),
            )
            old_keys = {
                key: str(row[key])
                for key in ("output_s3_key", "thumbnail_s3_key", "clean_clip_s3_key")
                if row.get(key)
            }
            if not row.get("edit_timeline_s3_key"):
                # The first v2 edit of a legacy row promotes its current clean
                # clip to the immutable edit timeline. It must remain in S3.
                old_keys.pop("clean_clip_s3_key", None)
            return old_keys

    def mark_editor_render_request_rendering(self, short_id: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                update shorts_mvp.editor_render_requests request
                set status='rendering',updated_at=now()
                from shorts_mvp.generated_shorts short
                where short.id=%s
                  and request.id=short.pending_edit_request_id
                  and request.short_id=short.id
                  and request.status='queued'
                """,
                (short_id,),
            )

    def reset_rerender(self, short_id: str) -> None:
        with self.connect() as connection, connection.transaction():
            connection.execute(
                """
                update shorts_mvp.editor_render_requests request
                set status='failed',
                  failure_code=coalesce(request.failure_code,'worker_render_failed'),
                  updated_at=now(),completed_at=now()
                from shorts_mvp.generated_shorts short
                where short.id=%s
                  and request.id=short.pending_edit_request_id
                  and request.short_id=short.id
                  and request.status in ('queued','rendering')
                """,
                (short_id,),
            )
            connection.execute(
                """
                update shorts_mvp.generated_shorts
                set status='ready', rerender_progress=0,
                  pending_render_hash=null, pending_edit_snapshot=null,
                  pending_edit_request_id=null,rerender_batch_job_id=null
                where id=%s and status='rerendering'
                """,
                (short_id,),
            )
