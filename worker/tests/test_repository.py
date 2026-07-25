import inspect
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock

from shorts_worker.repository import WorkerRepository
from shorts_worker.worker_pipeline import BatchWorker


def test_state_queue_client_uses_the_configured_region(monkeypatch) -> None:
    client = MagicMock()
    boto3_client = MagicMock(return_value=client)
    monkeypatch.setenv("STATE_EVENT_QUEUE_URL", "https://sqs.example/state")
    monkeypatch.setattr("shorts_worker.repository.boto3.client", boto3_client)

    repository = WorkerRepository("postgresql://example", "ap-northeast-2")

    assert repository.state_queue is client
    boto3_client.assert_called_once_with("sqs", region_name="ap-northeast-2")


def test_prepare_attempt_casts_nullable_override_to_integer() -> None:
    implementation = inspect.getsource(WorkerRepository.claim_prepare_attempt)
    assert "%s::integer is null" in implementation
    assert "greatest(attempt_count,%s::integer)" in implementation
    assert "status='downloading', stage='downloading', progress=10" in implementation
    assert "claimed_at=coalesce(claimed_at,now())" in implementation


def test_retry_job_returns_to_the_outbox_scheduler() -> None:
    implementation = inspect.getsource(WorkerRepository.retry_job)

    assert "insert into shorts_mvp.job_outbox" in implementation
    assert "on conflict (job_id,kind,attempt_count) do nothing" in implementation


def test_fail_job_persists_structured_error_details() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = {"id": "job-a"}

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    details = {
        "category": "ingestion",
        "reason": "비공개 영상은 지원하지 않습니다.",
        "job_attempt": 2,
    }

    assert repository.fail_job(
        "job-a",
        "youtube_private_video",
        "사용자용 메시지",
        error_details=details,
    )

    failure_parameters = connection.execute.call_args_list[0].args[1]
    assert failure_parameters[0] == "youtube_private_video"
    assert failure_parameters[1] == "사용자용 메시지"
    assert failure_parameters[2].obj == details
    event_parameters = connection.execute.call_args_list[-1].args[1]
    assert event_parameters[2].obj == {
        "error_code": "youtube_private_video",
        **details,
    }


def test_ingestion_failure_details_migration_is_schema_qualified() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607170004_ingestion_failure_details.sql"
    ).read_text(encoding="utf-8")

    assert "shorts_mvp.video_jobs" in migration
    assert "error_details jsonb not null default '{}'::jsonb" in migration
    assert "jsonb_typeof(error_details) = 'object'" in migration
    assert "public." not in migration


def test_highlight_reason_migration_is_schema_qualified() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607170007_generated_short_highlight_reason.sql"
    ).read_text(encoding="utf-8")

    assert "shorts_mvp.generated_shorts" in migration
    assert "highlight_reason text not null default ''" in migration
    assert "public." not in migration


def test_route_release_uses_the_schema_qualified_atomic_function() -> None:
    implementation = inspect.getsource(WorkerRepository.release_ingestion_route)

    assert "shorts_mvp.release_ingestion_route" in implementation


def test_route_rotation_uses_the_schema_qualified_atomic_function() -> None:
    implementation = inspect.getsource(WorkerRepository.rotate_ingestion_route)

    assert "shorts_mvp.rotate_ingestion_route" in implementation
    assert "%s::text[]" in implementation


def test_webshare_migration_seeds_ten_central_slots_and_extends_deadline_on_admission() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607160002_webshare_ingestion_slots.sql"
    ).read_text(encoding="utf-8")

    assert "generate_series(1,10)" in migration
    assert "for update of o skip locked" in migration
    assert "for update of s skip locked" in migration
    assert "lease_expires_at=clock_timestamp() + interval '20 minutes'" in migration
    assert "30 + ceil(j.source_duration_seconds / 60.0)" in migration
    assert "public." not in migration


def test_inline_route_rotation_migration_locks_and_excludes_attempted_routes() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607170001_inline_ingestion_route_rotation.sql"
    ).read_text(encoding="utf-8")

    assert "create or replace function shorts_mvp.rotate_ingestion_route" in migration
    assert "for update of s skip locked" in migration
    assert "p_excluded_route_ids" in migration
    assert "lease_expires_at=clock_timestamp() + interval '20 minutes'" in migration
    assert "public." not in migration


def test_pending_short_uses_one_database_clock_for_creation_and_expiry() -> None:
    implementation = inspect.getsource(WorkerRepository.add_pending_short)

    assert "file_size_bytes, created_at," in implementation
    assert "now()," in implementation
    assert "now() + make_interval(days => least(greatest(%s::integer, 1), 30))" in implementation
    assert "expires_at: Any" not in implementation
    assert "when generated_shorts.comment_overlays='[]'::jsonb" in implementation
    assert "else generated_shorts.comment_overlays" in implementation


def test_pending_short_insert_passes_retention_period_not_an_absolute_time() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = {"id": "job-a"}

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect

    assert repository.add_pending_short(
        short_id="short-a",
        job={
            "id": "job-a",
            "mvp_session_id": "session-a",
            "channel_name": "channel-a",
            "template_id": "dark-red",
            "template_snapshot": {"config": {"subtitle": {"visible": True}}},
        },
        clip_index=1,
        start_seconds=10,
        end_seconds=40,
        hook_title="hook",
        highlight_reason="Gemini가 선택한 이유",
        selection_raw_start_seconds=12,
        selection_raw_end_seconds=32,
        selection_raw_duration_seconds=20,
        selection_candidate_index=2,
        selection_provider="gemini",
        selection_model="gemini-2.5-flash-lite",
        selection_length_adjustment="min_clamp",
        selection_repositioned=False,
        subtitles=[],
        comment_overlays=[],
        clean_key="edit-sources/short-a.mp4",
        retention_days=30,
        shard_index=0,
    )

    insert_call = connection.execute.call_args_list[2]
    assert "created_at" in insert_call.args[0]
    assert "now() + make_interval" in insert_call.args[0]
    assert "selection_raw_start_seconds" in insert_call.args[0]
    assert "selection_length_adjustment=excluded.selection_length_adjustment" in insert_call.args[0]
    assert insert_call.args[0].count("%s") == len(insert_call.args[1])
    assert insert_call.args[1][20] is False
    assert insert_call.args[1][-2] == 30


def test_selection_observability_migration_stays_in_shorts_schema() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607200003_generated_short_selection_observability.sql"
    ).read_text(encoding="utf-8")

    assert "shorts_mvp.generated_shorts" in migration
    assert "selection_raw_start_seconds" in migration
    assert "selection_raw_end_seconds" in migration
    assert "selection_raw_duration_seconds" in migration
    assert "selection_provider" in migration
    assert "selection_model" in migration
    assert "selection_length_adjustment" in migration
    assert "selection_repositioned" in migration
    assert "public." not in migration


def test_prepare_passes_retention_days_instead_of_worker_clock_expiry() -> None:
    implementation = inspect.getsource(BatchWorker.prepare)

    assert 'retention_days=int(job["retention_days"])' in implementation
    assert "highlight_reason=clip.reason" in implementation
    assert "timedelta(days=" not in implementation


def test_fargate_project_migration_keeps_ready_outputs_and_uses_half_threshold() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607220001_fargate_project_pipeline.sql"
    ).read_text(encoding="utf-8")

    assert "create table if not exists shorts_mvp.project_output_attempts" in migration
    assert "when counted_ready * 2 >= current_job.planned_short_count" in migration
    assert "where job_id=p_job_id and status='rendering'" in migration
    assert "status in ('rendering','rerendering','ready')" not in migration.split(
        "create or replace function shorts_mvp.finalize_project_job", 1
    )[1].split("create or replace function shorts_mvp.handle_project_batch_failure", 1)[0]
    assert "set status='consumed'" in migration
    assert "set status='released'" in migration
    assert "project_resume_count=1" in migration


def test_restricted_content_failure_message_migration_is_scoped() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607230006_restricted_content_failure_message.sql"
    ).read_text(encoding="utf-8")

    assert "youtube_members_only" in migration
    assert "youtube_paid_content" in migration
    assert "사용량은 다시 복구되었습니다" in migration
    assert "video_jobs_restricted_content_failure_message" in migration


def test_render_performance_migration_adds_atomic_stage_counts_and_internal_metrics() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607220002_render_performance.sql"
    ).read_text(encoding="utf-8")

    assert "stage_completed_count integer not null default 0" in migration
    assert "stage_total_count integer not null default 0" in migration
    assert migration.count("performance_metrics jsonb not null default '{}'::jsonb") == 2
    assert "create or replace function shorts_mvp.apply_job_state_event_v2" in migration
    assert "stage_completed_count=case" in migration
    assert "stage_total_count=case" in migration
    assert "public." not in migration


def test_project_resource_tier_migration_finalizes_terminal_stage_counts() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607220003_project_resource_tiers.sql"
    ).read_text(encoding="utf-8")

    assert "sync_terminal_project_stage_counts" in migration
    assert "new.stage_completed_count := new.stage_total_count" in migration
    assert "set stage_completed_count=stage_total_count" in migration
    assert "pipeline_version=2" in migration
    assert "public." not in migration
