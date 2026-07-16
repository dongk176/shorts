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


def test_retry_job_returns_to_the_outbox_scheduler() -> None:
    implementation = inspect.getsource(WorkerRepository.retry_job)

    assert "insert into shorts_mvp.job_outbox" in implementation
    assert "on conflict (job_id,kind,attempt_count) do nothing" in implementation


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
    assert (
        "now() + make_interval(days => least(greatest(%s::integer, 1), 30))"
        in implementation
    )
    assert "expires_at: Any" not in implementation


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
        },
        clip_index=1,
        start_seconds=10,
        end_seconds=40,
        hook_title="hook",
        subtitles=[],
        clean_key="edit-sources/short-a.mp4",
        retention_days=30,
        shard_index=0,
    )

    insert_call = connection.execute.call_args_list[2]
    assert "created_at" in insert_call.args[0]
    assert "now() + make_interval" in insert_call.args[0]
    assert insert_call.args[1][-2] == 30


def test_prepare_passes_retention_days_instead_of_worker_clock_expiry() -> None:
    implementation = inspect.getsource(BatchWorker.prepare)

    assert 'retention_days=int(job["retention_days"])' in implementation
    assert "timedelta(days=" not in implementation
