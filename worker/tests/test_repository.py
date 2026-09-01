import csv
import inspect
import io
import json
import os
import re
import subprocess
import threading
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

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


def test_direct_stage_update_cannot_revive_a_terminal_job() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = None

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    repository.stage(
        "job-a",
        "rendering",
        92,
        "쇼츠를 렌더링하고 있습니다. (9/10)",
        completed_count=9,
        total_count=10,
    )

    assert connection.execute.call_count == 1
    update_sql = connection.execute.call_args.args[0]
    assert "status not in ('completed','failed','expired','deleted','retry_waiting')" in update_sql
    assert "returning id" in update_sql


def test_direct_stage_event_is_written_only_after_the_state_update_succeeds() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = {"id": "job-a"}

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    repository.stage("job-a", "rendering", 69, "렌더링 중")

    assert connection.execute.call_count == 2
    assert "insert into shorts_mvp.job_events" in connection.execute.call_args_list[1].args[0]


def test_prepare_attempt_casts_nullable_override_to_integer() -> None:
    implementation = inspect.getsource(WorkerRepository.claim_prepare_attempt)
    assert "%s::integer is null" in implementation
    assert "greatest(attempt_count,%s::integer)" in implementation
    assert "status='downloading', stage='downloading', progress=10" in implementation
    assert "claimed_at=coalesce(claimed_at,now())" in implementation


def test_project_claim_is_bound_to_the_exact_dispatch_generation() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = None

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    assert repository.claim_project_run(
        "job-a",
        resume=False,
        expected_dispatch_generation=4,
    ) is None

    query, parameters = connection.execute.call_args.args
    assert "project_dispatch_generation=%s" in query
    assert "status in ('queued','retry_waiting')" in query
    assert parameters == ("job-a", 4)


def test_route_capacity_deferral_uses_one_atomic_rpc() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = {"action": "deferred"}

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    assert repository.defer_project_for_ingestion_route(
        "job-a",
        expected_dispatch_generation=2,
        expected_batch_job_id="batch-a",
        attempted_route_ids=["webshare-01", "webshare-02"],
    ) == "deferred"

    query, parameters = connection.execute.call_args.args
    assert "shorts_mvp.defer_project_for_ingestion_route" in query
    assert parameters == (
        "job-a",
        2,
        "batch-a",
        ["webshare-01", "webshare-02"],
    )


def test_route_capacity_migration_preserves_fifo_and_fixed_one_hour_budget() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202609010003_ingestion_route_capacity_requeue.sql"
    ).read_text(encoding="utf-8")

    assert "ingestion_route_wait_started_at" in migration
    assert "project_dispatch_generation" in migration
    assert "wait_started_at + interval '1 hour'" in migration
    assert "job.project_dispatch_generation+1" in migration
    assert "eligible.job_created_at" in migration
    assert "for update of outbox skip locked" in migration
    assert "capacity_requeue_enabled" in migration
    assert "ingestion_capacity_timeout" in migration
    assert "shorts_mvp.finalize_project_job" in migration
    assert "public." not in migration


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


def test_candidate_transcript_is_saved_atomically_with_provider_summary() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    repository.save_job_transcript(
        "job-a",
        requested_policy="elevenlabs_primary_openai_fallback",
        provider_used="mixed",
        model_used="scribe_v2+whisper-1",
        language_code="kor",
        language_probability=0.98,
        fallback_reasons=["HTTPStatusError"],
        source_offset_seconds=120.0,
        transcript_text="안녕하세요",
        segments=[{"start": 120.0, "end": 121.0, "text": "안녕하세요"}],
        words=[{"text": "안녕하세요", "start": 120.0, "end": 121.0}],
    )

    assert connection.execute.call_count == 2
    insert_parameters = connection.execute.call_args_list[0].args[1]
    assert insert_parameters[1:6] == (
        "elevenlabs_primary_openai_fallback",
        "mixed",
        "scribe_v2+whisper-1",
        "kor",
        0.98,
    )
    update_parameters = connection.execute.call_args_list[1].args[1]
    assert update_parameters == (
        "mixed",
        "scribe_v2+whisper-1",
        "kor",
        True,
        "job-a",
        "elevenlabs_primary_openai_fallback",
    )


def test_elevenlabs_transcription_migration_is_additive_and_private() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202608060001_elevenlabs_transcription_canary.sql"
    ).read_text(encoding="utf-8")

    assert "alter table shorts_mvp.video_jobs" in migration
    assert "create table if not exists shorts_mvp.job_transcripts" in migration
    assert "enable row level security" in migration
    assert "revoke all on shorts_mvp.job_transcripts from anon,authenticated" in migration
    assert "grant all on shorts_mvp.job_transcripts to service_role" in migration
    assert "public." not in migration


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


def test_webshare_pool_expansion_migration_adds_ten_more_central_slots() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607270002_expand_webshare_ingestion_slots.sql"
    ).read_text(encoding="utf-8")

    assert "generate_series(11,20)" in migration
    assert "'webshare-' || lpad(value::text,2,'0')" in migration
    assert "'webshare_isp', false" in migration
    assert "on conflict (route_id) do nothing" in migration
    assert "public." not in migration


def test_webshare_pool_activation_migration_enables_only_expanded_slots() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607270003_enable_expanded_webshare_ingestion_slots.sql"
    ).read_text(encoding="utf-8")

    assert "set enabled=true" in migration
    assert "route_id between 'webshare-11' and 'webshare-20'" in migration
    assert "egress_class='webshare_isp'" in migration
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

    assert "file_size_bytes, viral_score, created_at," in implementation
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
        timeline_key="edit-sources/short-a/timeline-v1.mp4",
        timeline_start_seconds=0,
        timeline_end_seconds=70,
        timeline_subtitles=[],
        retention_days=30,
        shard_index=0,
        viral_score=87,
    )

    insert_call = connection.execute.call_args_list[2]
    assert "created_at" in insert_call.args[0]
    assert "now() + make_interval" in insert_call.args[0]
    assert "selection_raw_start_seconds" in insert_call.args[0]
    assert "viral_score=excluded.viral_score" in insert_call.args[0]
    assert "edit_timeline_s3_key" in insert_call.args[0]
    assert "selection_length_adjustment=excluded.selection_length_adjustment" in insert_call.args[0]
    assert insert_call.args[0].count("%s") == len(insert_call.args[1])
    # Caption identity is inserted before the optional render spec. Legacy
    # rows keep all caption fields empty and subtitles disabled.
    assert insert_call.args[1][19:23] == (None, None, None, None)
    assert insert_call.args[1][24] is False
    assert insert_call.args[1][-3] == 87
    assert insert_call.args[1][-2] == 30


def test_pending_caption_short_inserts_immutable_identity_and_render_spec() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = {"id": "job-caption"}

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    snapshot = {"templateId": "highlight", "titleAccentColor": "#FF715E"}
    render_spec = {"schemaVersion": 1, "templateId": "highlight", "fps": 30}

    assert repository.add_pending_short(
        short_id="short-caption",
        job={
            "id": "job-caption",
            "mvp_session_id": "session-caption",
            "channel_name": "channel-caption",
            "template_id": "dark-minimal",
            "subtitle_template_id": "highlight",
            "subtitle_template_snapshot": snapshot,
        },
        clip_index=1,
        start_seconds=10,
        end_seconds=20,
        hook_title="hook",
        highlight_reason="reason",
        selection_raw_start_seconds=10,
        selection_raw_end_seconds=20,
        selection_raw_duration_seconds=10,
        selection_candidate_index=1,
        selection_provider="gemini",
        selection_model="gemini-2.5-flash-lite",
        selection_length_adjustment=None,
        selection_repositioned=False,
        subtitles=[],
        comment_overlays=[],
        clean_key="edit-sources/short-caption.mp4",
        timeline_key=None,
        timeline_start_seconds=None,
        timeline_end_seconds=None,
        timeline_subtitles=None,
        retention_days=30,
        shard_index=0,
        caption_render_spec=render_spec,
    )

    query, parameters = connection.execute.call_args_list[2].args
    assert query.count("%s") == len(parameters)
    assert parameters[19] == "highlight"
    assert parameters[20].obj == snapshot
    assert parameters[21].obj == render_spec
    assert parameters[22] is None
    assert parameters[23].obj == []
    assert parameters[24] is False
    assert parameters[26] is True
    assert "subtitle_template_id=excluded.subtitle_template_id" not in query
    assert "subtitle_template_snapshot=excluded.subtitle_template_snapshot" not in query
    assert "then excluded.caption_render_spec" in query
    assert "else generated_shorts.caption_render_spec" in query


def test_pending_v4_short_persists_initial_spec_without_dirtying_hash() -> None:
    implementation = inspect.getsource(WorkerRepository.add_pending_short)
    completion = inspect.getsource(WorkerRepository.complete_initial_render)

    assert "caption_render_spec, initial_render_spec" in implementation
    assert "else generated_shorts.caption_render_spec" in implementation
    assert "initial_render_spec=coalesce(" in implementation
    assert "Jsonb(initial_render_spec)" in implementation
    assert "title_text_styles_initialized=case" in implementation
    assert "select j.pipeline_version" in implementation
    assert "),1) <> 2" in implementation
    assert "returning id" in implementation
    assert "if not upserted:" in implementation
    # The initial v4 spec is immutable source evidence, not user-editable
    # configuration. Including it here would diverge from every current hash
    # producer and make an unchanged video appear dirty forever.
    assert "~initial-render-spec~" not in completion


def test_pending_pipeline_v2_conflict_fails_closed_before_checkpoint() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    locked = MagicMock()
    locked.fetchone.return_value = {"id": "job-v4"}
    active = MagicMock()
    active.fetchone.return_value = {"id": "job-v4"}
    conflicted = MagicMock()
    conflicted.fetchone.return_value = None
    connection.execute.side_effect = [locked, active, conflicted]

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect

    assert repository.add_pending_short(
        short_id="new-short-id",
        job={
            "id": "job-v4",
            "mvp_session_id": "session-v4",
            "channel_name": "channel-v4",
            "template_id": "dark-minimal",
            "pipeline_version": 2,
        },
        clip_index=1,
        start_seconds=10,
        end_seconds=20,
        hook_title="new hook",
        highlight_reason="new reason",
        selection_raw_start_seconds=10,
        selection_raw_end_seconds=20,
        selection_raw_duration_seconds=10,
        selection_candidate_index=1,
        selection_provider="gemini",
        selection_model="model",
        selection_length_adjustment=None,
        selection_repositioned=False,
        subtitles=[{"start": 0, "end": 1, "text": "new caption"}],
        comment_overlays=[],
        clean_key="edit-sources/new-short-id.mp4",
        timeline_key=None,
        timeline_start_seconds=None,
        timeline_end_seconds=None,
        timeline_subtitles=None,
        retention_days=30,
        shard_index=0,
        caption_render_spec={"schemaVersion": 4},
        initial_render_spec={"version": 4},
        title_text_styles=[],
        title_text_styles_initialized=True,
    ) is False

    assert connection.execute.call_count == 3
    upsert_query = connection.execute.call_args_list[2].args[0]
    assert "where coalesce((" in upsert_query
    assert "pipeline_version" in upsert_query
    assert "returning id" in upsert_query


def test_deferred_timeline_commit_only_updates_live_completed_project_output() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = {"id": "short-a"}

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect

    assert repository.complete_project_timeline(
        short_id="short-a",
        timeline_key="edit-sources/session-a/job-a/short-a/timeline-v1.mp4",
        timeline_start_seconds=0,
        timeline_end_seconds=70,
        timeline_subtitles=[],
    )

    query, parameters = connection.execute.call_args.args
    assert "s.status in ('ready','rerendering')" in query
    assert "s.deleted_at is null" in query
    assert "s.expires_at > clock_timestamp()" in query
    assert "s.edit_timeline_s3_key is null" in query
    assert "j.status='completed'" in query
    assert parameters[0].endswith("/timeline-v1.mp4")
    assert parameters[3].obj == []
    assert parameters[4] is None
    assert parameters[5] is None
    assert parameters[6] == "short-a"


def test_deferred_caption_timeline_commits_its_word_source_atomically() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = {"id": "short-a"}

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    editor_source = {
        "timelineStartSeconds": 0,
        "timelineEndSeconds": 70,
        "spec": {"schemaVersion": 3, "cues": []},
    }

    assert repository.complete_project_timeline(
        short_id="short-a",
        timeline_key="edit-sources/timeline-v1.mp4",
        timeline_start_seconds=0,
        timeline_end_seconds=70,
        timeline_subtitles=[],
        caption_editor_source=editor_source,
    )

    query, parameters = connection.execute.call_args.args
    assert "jsonb_set" in query
    assert parameters[4].obj == editor_source
    assert parameters[5].obj == editor_source


def test_legacy_snapshot_rerender_promotes_edited_timeline_subtitles() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    selected = MagicMock()
    selected.fetchone.return_value = {
        "output_s3_key": "outputs/v1.mp4",
        "thumbnail_s3_key": "thumbnails/v1.jpg",
        "clean_clip_s3_key": "edit-sources/timeline-v1.mp4",
    }
    updated = MagicMock()
    updated.fetchone.return_value = {"id": "short-a"}
    connection.execute.side_effect = [selected, updated, MagicMock()]

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect

    repository.complete_snapshot_rerender(
        "short-a",
        output_key="outputs/v2.mp4",
        thumbnail_key="thumbnails/v2.jpg",
        clean_key="edit-sources/clean-v2.mp4",
        size=123,
        version=2,
    )

    promotion_query = connection.execute.call_args_list[1].args[0]
    assert "edit_timeline_subtitle_segments=case" in promotion_query
    assert "when edit_timeline_s3_key is null then null" in promotion_query
    assert "else coalesce(" in promotion_query
    assert "pending_edit_snapshot->'timelineSubtitleSegments'" in promotion_query
    assert (
        promotion_query.index("pending_edit_snapshot->'timelineSubtitleSegments'")
        < promotion_query.index("edit_timeline_subtitle_segments\n")
    )


def test_first_editor_document_rerender_preserves_legacy_clean_as_timeline() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    selected = MagicMock()
    selected.fetchone.return_value = {
        "output_s3_key": "outputs/v1.mp4",
        "thumbnail_s3_key": "thumbnails/v1.jpg",
        "clean_clip_s3_key": "edit-sources/original-clean.mp4",
        "edit_timeline_s3_key": None,
        "pending_edit_request_id": "request-a",
    }
    updated = MagicMock()
    updated.fetchone.return_value = {"id": "short-a"}
    connection.execute.side_effect = [selected, updated, MagicMock()]

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect

    old_keys = repository.complete_editor_document_rerender(
        "short-a",
        output_key="outputs/v2.mp4",
        thumbnail_key="thumbnails/v2.jpg",
        clean_key="edit-sources/clean-v2.mp4",
        size=123,
        version=2,
        start_seconds=11,
        duration_seconds=3.5,
        subtitle_segments=[],
    )

    assert old_keys == {
        "output_s3_key": "outputs/v1.mp4",
        "thumbnail_s3_key": "thumbnails/v1.jpg",
    }
    promotion_query = connection.execute.call_args_list[1].args[0]
    assert "edit_timeline_s3_key=coalesce(" in promotion_query
    assert "edit_timeline_s3_key,clean_clip_s3_key" in promotion_query
    assert "pending_edit_snapshot->'subtitles'->'segments'" in promotion_query
    assert "title_font_scale=greatest(" in promotion_query
    assert "least(\n                      1.2," in promotion_query
    assert "editor_document=pending_edit_snapshot" in promotion_query


def test_editor_document_rerender_can_delete_clean_when_timeline_already_exists() -> None:
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    selected = MagicMock()
    selected.fetchone.return_value = {
        "output_s3_key": "outputs/v1.mp4",
        "thumbnail_s3_key": "thumbnails/v1.jpg",
        "clean_clip_s3_key": "edit-sources/old-clean.mp4",
        "edit_timeline_s3_key": "edit-sources/timeline-v1.mp4",
        "pending_edit_request_id": "request-a",
    }
    updated = MagicMock()
    updated.fetchone.return_value = {"id": "short-a"}
    connection.execute.side_effect = [selected, updated, MagicMock()]

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect

    old_keys = repository.complete_editor_document_rerender(
        "short-a",
        output_key="outputs/v2.mp4",
        thumbnail_key="thumbnails/v2.jpg",
        clean_key="edit-sources/clean-v2.mp4",
        size=123,
        version=2,
        start_seconds=11,
        duration_seconds=3.5,
        subtitle_segments=[],
    )

    assert old_keys and old_keys["clean_clip_s3_key"] == (
        "edit-sources/old-clean.mp4"
    )


def test_editor_document_migration_is_additive_private_and_disabled() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607310002_editor_document_v2.sql"
    ).read_text(encoding="utf-8")

    assert "alter table shorts_mvp.generated_shorts" in migration
    assert "create table if not exists shorts_mvp.editor_render_requests" in migration
    assert "editor_document->'version'='2'::jsonb" in migration
    assert "editor_document is not null" in migration
    assert "editor_document_version is not null" in migration
    assert "pending_edit_snapshot->'version'='2'::jsonb" in migration
    assert "pending_edit_request_id is not null" in migration
    assert "'editor_rendering_v2'," in migration
    assert "'editor_rendering_v2',\n  false," in migration
    assert "revoke all on shorts_mvp.editor_render_requests" in migration
    assert "public." not in migration


def test_editor_document_v3_migration_preserves_v2_and_allows_v3() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202608050001_editor_document_v3_render_spec.sql"
    ).read_text(encoding="utf-8")

    assert "editor_document_version in (2,3)" in migration
    assert "pending_edit_snapshot->>'version'" in migration
    assert "in (2,3)" in migration
    assert "not valid" in migration
    assert "validate constraint" in migration
    assert "public." not in migration


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


def test_viral_score_migration_stays_nullable_and_in_shorts_schema() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202608130001_generated_short_viral_score.sql"
    ).read_text(encoding="utf-8")

    assert "shorts_mvp.generated_shorts" in migration
    assert "viral_score smallint" in migration
    assert "viral_score is null or viral_score between 0 and 100" in migration
    assert "not null" not in migration
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


def test_selected_output_completion_policy_only_applies_to_new_jobs() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607260001_selected_output_completion_policy.sql"
    ).read_text(encoding="utf-8")

    assert "completion_policy_version smallint default 1" in migration
    assert "set completion_policy_version=1" in migration
    assert "alter column completion_policy_version set default 2" in migration
    assert (
        "when current_job.completion_policy_version >= 2 then counted_selected"
        in migration
    )
    assert "else current_job.planned_short_count" in migration
    assert "and counted_ready * 2 >= completion_denominator" in migration
    assert "where job_id=p_job_id and selected_at is not null" in migration
    assert "selected_short_count=counted_selected" in migration
    assert "unselected_short_count=counted_unselected" in migration
    assert "public." not in migration


def test_batch_target_and_stale_guard_migration_is_atomic_and_private() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202608260005_batch_target_and_stale_guards.sql"
    ).read_text(encoding="utf-8")
    validation = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202608260006_batch_target_and_stale_guards_validate.sql"
    ).read_text(encoding="utf-8")

    assert "batch_target_key text" in migration
    assert "batch_target_release_id text" in migration
    assert "video_jobs_batch_target_pair_check" in migration
    assert "job_definition text" in migration
    assert "job_queue text" in migration
    assert (
        "create or replace function "
        "shorts_mvp.complete_project_batch_submission_target" in migration
    )
    assert "p_expected_batch_target_key text" in migration
    assert "p_expected_batch_target_release_id text" in migration
    assert "p_observed_job_definition text" in migration
    assert "p_observed_job_queue text" in migration
    assert "update shorts_mvp.batch_submission_claims" in migration
    assert "update shorts_mvp.video_jobs" in migration
    assert "set aws_batch_job_id=p_aws_batch_job_id" in migration
    assert "current_job.batch_target_key" in migration
    assert "current_job.batch_target_release_id" in migration
    assert (
        "current_job.batch_job_definition\n"
        "      is distinct from p_observed_job_definition"
        in migration
    )
    assert (
        "current_job.batch_job_queue\n"
        "      is distinct from p_observed_job_queue"
        in migration
    )
    assert migration.count(
        "text,uuid,text,text,text,text,text,text,text"
    ) == 2
    assert (
        "create or replace function "
        "shorts_mvp.finalize_stale_video_job_if_unchanged" in migration
    )
    assert "for update" in migration
    assert "current_job.aws_batch_job_id is distinct from p_observed_aws_batch_job_id" in migration
    assert "current_job.status is distinct from p_observed_status" in migration
    assert "current_job.heartbeat_at is distinct from p_observed_heartbeat_at" in migration
    assert "current_job.created_at >= p_created_before" in migration
    assert "current_job.status in ('queued','retry_waiting')" in migration
    assert "current_job.queue_expires_at > clock_timestamp()" in migration
    assert "'queue_waiting'::text" in migration
    assert "current_job.ingestion_route_leased_at >= p_heartbeat_before" in migration
    assert "from shorts_mvp.project_job_outbox outbox" in migration
    assert "from shorts_mvp.batch_submission_claims claim" in migration
    assert "current_job.project_resume_count=1" in migration
    assert "':resume:1'" in migration
    assert "claim.aws_batch_job_id is not null" in migration
    assert "claim.claimed_at >= p_heartbeat_before" in migration
    assert "current_job.aws_batch_job_id is null" in migration
    assert (
        "claim.aws_batch_job_id is null\n"
        "            and claim.claimed_at >= p_heartbeat_before"
    ) in migration
    assert "from shorts_mvp.finalize_project_job(" in migration
    assert "update shorts_mvp.usage_reservations" in migration
    assert "create or replace function shorts_mvp.get_batch_dispatch_health()" in migration
    assert "join shorts_mvp.project_job_outbox outbox" in migration
    assert "outbox.status='dispatched' or outbox.last_error is not null" in migration
    assert "submission_claim_without_job_id bigint" in migration
    assert "claim_mismatch as (" in migration
    assert "claim.aws_batch_job_id is null" in migration
    assert (
        "job.aws_batch_job_id is distinct from claim.aws_batch_job_id"
        in migration
    )
    assert (
        "job.aws_batch_job_id is not null\n"
        "            and job.batch_job_definition is null"
        in migration
    )
    assert "claim.job_definition is not null and (" in migration
    assert "job.batch_job_definition is distinct from claim.job_definition" in migration
    assert "job.batch_job_queue is distinct from claim.job_queue" in migration
    assert (
        "(job.batch_job_definition is null)\n"
        "            is distinct from (job.batch_job_queue is null)"
        in migration
    )
    assert (
        "(claim.job_definition is null)\n"
        "            is distinct from (claim.job_queue is null)"
        in migration
    )
    assert "and job.status in ('queued','retry_waiting')" not in migration
    assert "statement_timestamp() - interval '5 minutes'" in migration
    assert "job.execution_backend='aws_batch'" in migration
    assert "from public,anon,authenticated" in migration
    assert "public." not in migration
    assert "set local lock_timeout = '3s'" in validation
    assert validation.count("validate constraint video_jobs_batch_target_") == 3
    assert "public." not in validation


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


def test_transcription_failure_message_migration_is_scoped() -> None:
    migration = (
        Path(__file__).parents[2]
        / "supabase"
        / "migrations"
        / "202607290005_transcription_failure_message.sql"
    ).read_text(encoding="utf-8")

    assert "shorts_mvp.apply_transcription_failure_message" in migration
    assert "new.error_code='TranscriptionError'" in migration
    assert "영상에서 사람의 목소리를 찾지 못해 쇼츠를 생성할 수 없습니다." in migration
    assert "사용량은 다시 복구되었습니다." in migration
    assert "public." not in migration


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


def _upload_failure_repository(*, final_status="completed", session_status="claimed",
                               source_deleted_at=None):
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    connection = MagicMock()
    results = [
        {"id": "session-a", "status": session_status, "source_deleted_at": source_deleted_at},
        {"final_status": final_status} if final_status else None,
        {"id": "session-a"},
        None,
    ]
    connection.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value=result)) for result in results
    ]

    @contextmanager
    def connect():
        yield connection

    repository.connect = connect
    return repository, connection


@pytest.mark.parametrize("source_deleted", [False, True])
@pytest.mark.parametrize("expired", [False, True])
def test_upload_failure_preserves_authoritative_completed_output(source_deleted, expired):
    repository, connection = _upload_failure_repository()

    assert repository.fail_upload_session(
        "session-a", "job-a", error_code="upload_completion_commit_failed",
        message="late receiver failure", source_deleted=source_deleted, expired=expired,
    )

    assert "for update of us" in connection.execute.call_args_list[0].args[0]
    assert "j.source_type='upload'" in connection.execute.call_args_list[0].args[0]
    assert "finalize_project_job" in connection.execute.call_args_list[1].args[0]
    parameters = connection.execute.call_args_list[2].args[1]
    assert parameters == (
        "completed", None, None, "completed", source_deleted, "session-a", "job-a",
    )
    assert connection.execute.call_args_list[3].args[1] == (source_deleted, "job-a")
    connection.transaction.assert_called_once()


@pytest.mark.parametrize("expired,expected", [(False, "failed"), (True, "expired")])
def test_upload_failure_retains_real_project_failure_without_own_billing_updates(expired, expected):
    repository, connection = _upload_failure_repository(final_status="failed")
    assert repository.fail_upload_session(
        "session-a", "job-a", error_code="upload_body_incomplete", message="missing bytes",
        source_deleted=False, expired=expired,
    )
    parameters = connection.execute.call_args_list[2].args[1]
    assert parameters == (
        expected, "upload_body_incomplete", "missing bytes", expected, False, "session-a", "job-a",
    )
    queries = " ".join(call.args[0] for call in connection.execute.call_args_list)
    assert "usage_reservations" not in queries
    assert "usage_events" not in queries


def test_upload_late_failure_cannot_unset_previously_confirmed_raw_deletion():
    repository, connection = _upload_failure_repository(
        session_status="completed", source_deleted_at="2026-08-31T01:00:00Z",
    )
    assert repository.fail_upload_session(
        "session-a", "job-a", error_code="late_error", message="late error",
        source_deleted=False,
    )
    assert connection.execute.call_args_list[2].args[1][4] is True
    assert connection.execute.call_args_list[3].args[1] == (True, "job-a")


def test_upload_missing_owned_session_never_finalizes_or_modifies_another_job():
    repository, connection = _upload_failure_repository()
    connection.execute.side_effect = [MagicMock(fetchone=MagicMock(return_value=None))]
    assert not repository.fail_upload_session(
        "session-a", "other-job", error_code="late_error", message="late error",
    )
    assert connection.execute.call_count == 1


def test_upload_unconfirmed_project_finalization_aborts_the_transaction():
    repository, connection = _upload_failure_repository(final_status=None)
    with pytest.raises(RuntimeError, match="did not confirm an outcome"):
        repository.fail_upload_session(
            "session-a", "job-a", error_code="late_error", message="late error",
        )
    assert connection.execute.call_count == 2
    exit_arguments = connection.transaction.return_value.__exit__.call_args.args
    assert exit_arguments[0] is RuntimeError


def test_upload_completion_acknowledgement_is_idempotent_for_the_same_completed_job():
    implementation = inspect.getsource(WorkerRepository.complete_upload_session)
    assert "us.status in ('claimed','completed')" in implementation
    assert "j.status='completed'" in implementation
    assert "completed_at=coalesce(completed_at,clock_timestamp())" in implementation
    assert "source_deleted_at=coalesce(source_deleted_at,clock_timestamp())" in implementation


def test_upload_pending_raw_cleanup_retains_heartbeat_and_stale_sweep_contract():
    heartbeat = inspect.getsource(WorkerRepository.heartbeat_upload_session)
    claim = inspect.getsource(WorkerRepository.claim_abandoned_upload_sessions)
    finalize = inspect.getsource(WorkerRepository.finalize_abandoned_upload_source_cleanup)
    assert "status='claimed' and not exists" in heartbeat
    assert "file_upload_emergency_stop" in heartbeat
    assert "status in ('completed','failed','expired')" in heartbeat
    assert "and source_deleted_at is null" in heartbeat
    assert "us.status in ('expired','failed','completed')" in claim
    assert "and us.source_deleted_at is null" in claim
    assert "coalesce(us.heartbeat_at,us.created_at)" in claim
    assert "and (%s::uuid is null or us.id<>%s::uuid)" in claim
    assert "and status in ('expired','failed','completed')" in finalize
    assert finalize.index("for update of us") < finalize.index(
        "select * from shorts_mvp.finalize_project_job"
    )


@pytest.mark.parametrize("verified_ids", [None, [], ["not-a-uuid"], [None], [str(uuid4())] * 101])
def test_upload_sweep_never_mutates_without_bounded_exact_owner_verified_ids(verified_ids):
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    repository.connect = MagicMock(side_effect=AssertionError("must not open a DB connection"))
    assert repository.claim_abandoned_upload_sessions(
        stale_after_seconds=120, active_upload_session_id=None,
        verified_upload_session_ids=verified_ids,
    ) == []
    repository.connect.assert_not_called()


def test_upload_stale_candidate_listing_is_read_only_and_claim_rechecks_eligibility():
    listing = inspect.getsource(WorkerRepository.list_abandoned_upload_sessions)
    claim = inspect.getsource(WorkerRepository.claim_abandoned_upload_sessions)
    assert "update shorts_mvp" not in listing and "for update" not in listing
    for implementation in (listing, claim):
        assert "us.status='awaiting_upload'" in implementation
        assert "us.status='claimed'" in implementation
        assert "us.status in ('expired','failed','completed')" in implementation
        assert "us.source_deleted_at is null" in implementation
        assert "and (%s::uuid is null or us.id<>%s::uuid)" in implementation
    assert "and us.id=any(%s::uuid[])" in claim
    assert "for update skip locked" in claim
    for implementation in (listing, claim):
        assert "us.claimed_at is null and us.consumed_at is null" in implementation
        assert "coalesce(us.received_bytes,0)=0" in implementation


def test_upload_expired_awaiting_ids_are_bounded_and_validated_separately():
    repository = WorkerRepository("postgresql://example", "ap-northeast-2")
    repository.connect = MagicMock(side_effect=AssertionError("must not open a DB connection"))
    assert repository.claim_abandoned_upload_sessions(
        stale_after_seconds=120, active_upload_session_id=None,
        expired_awaiting_upload_session_ids=["not-a-uuid"],
    ) == []
    assert repository.claim_abandoned_upload_sessions(
        stale_after_seconds=120, active_upload_session_id=None,
        verified_upload_session_ids=[str(uuid4())] * 50,
        expired_awaiting_upload_session_ids=[str(uuid4())] * 51,
    ) == []
    repository.connect.assert_not_called()


class _UploadPostgresConnection:
    """Run the actual repository SQL through psql in a network-none test DB.

    No application DATABASE_URL or production credentials are read. psql keeps
    one transaction/connection alive so PostgreSQL, not a mock, owns row locks.
    """

    def __init__(self, container):
        self.process = subprocess.Popen(
            ["docker", "exec", "-i", "--env", "PGCONNECT_TIMEOUT=5", container,
             "psql", "-X", "-q", "--csv", "-P", "null=__SQL_NULL__",
             "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "upload_repository_test"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True,
        )
        self.execute("set statement_timeout='5s'; set lock_timeout='4s'", parse=False)

    def execute(self, query, parameters=(), *, parse=True):
        chunks = query.split("%s")
        assert len(chunks) == len(parameters) + 1

        def literal(value):
            if value is None:
                return "NULL"
            if isinstance(value, bool):
                return "true" if value else "false"
            if isinstance(value, int):
                return str(value)
            if isinstance(value, list):
                return "ARRAY[" + ",".join(literal(item) for item in value) + "]"
            return "'" + str(value).replace("'", "''") + "'"

        statement = chunks[0]
        for value, chunk in zip(parameters, chunks[1:], strict=True):
            statement += literal(value) + chunk
        marker = f"upload_test_end_{uuid4().hex}"
        self.process.stdin.write(statement.rstrip().rstrip(";") + f";\n\\echo {marker}\n")
        self.process.stdin.flush()
        output = []
        while True:
            line = self.process.stdout.readline()
            if not line:
                error = self.process.stderr.read()
                self.process.wait(timeout=6)
                raise RuntimeError(error)
            if line.strip() == marker:
                break
            output.append(line)
        rows = []
        if parse and output:
            rows = [
                {key: None if value == "__SQL_NULL__" else value for key, value in row.items()}
                for row in csv.DictReader(io.StringIO("".join(output)))
            ]
        return MagicMock(
            fetchone=MagicMock(return_value=rows[0] if rows else None),
            fetchall=MagicMock(return_value=rows),
        )

    @contextmanager
    def transaction(self):
        self.execute("begin", parse=False)
        try:
            yield
        except BaseException:
            if self.process.poll() is None:
                self.execute("rollback", parse=False)
            raise
        else:
            self.execute("commit", parse=False)

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=6)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=3)
        self.process.stdout.close()
        self.process.stderr.close()


@pytest.fixture(scope="module")
def _upload_postgres_container():
    container = os.environ.get("UPLOAD_REPOSITORY_TEST_CONTAINER", "")
    if not container:
        pytest.skip("requires an explicitly labelled network-none PostgreSQL test container")
    assert re.fullmatch(r"shorts-upload-repository-test-[a-z0-9-]{1,80}", container)
    inspected = subprocess.run(
        ["docker", "inspect", container], capture_output=True, text=True,
        timeout=10, check=True,
    )
    metadata = json.loads(inspected.stdout)[0]
    assert metadata["HostConfig"]["NetworkMode"] == "none"
    assert not metadata["HostConfig"].get("PortBindings")
    assert metadata["Config"]["Labels"].get("easycut.test-scope") == "upload-repository"
    assert all(mount["Type"] == "tmpfs" for mount in metadata.get("Mounts", []))
    connection = _UploadPostgresConnection(container)
    try:
        connection.execute("""
          create schema shorts_mvp;
          create table shorts_mvp.video_jobs(
            id uuid primary key,user_id uuid not null,mvp_session_id uuid not null,
            source_type text default 'upload',execution_backend text default 'upload_service',
            status text,stage text,progress integer default 0,
            planned_short_count integer default 2,completion_policy_version integer default 2,
            ingestion_route_id uuid,selected_short_count integer,unselected_short_count integer,
            ready_short_count integer,failed_short_count integer,render_success_percent numeric,
            completed_at timestamptz,source_deleted_at timestamptz,heartbeat_at timestamptz,
            expires_at timestamptz,error_code text,error_message text
          );
          create table shorts_mvp.upload_sessions(
            id uuid primary key,job_id uuid references shorts_mvp.video_jobs(id),
            user_id uuid not null,mvp_session_id uuid not null,status text,
            expected_bytes bigint default 10,received_bytes bigint default 10,
            failure_code text,failure_reason text,source_deleted_at timestamptz,
            heartbeat_at timestamptz,completed_at timestamptz,claimed_at timestamptz,
            consumed_at timestamptz,
            expires_at timestamptz default now()+interval '15 minutes',
            created_at timestamptz default now(),source_thumbnail_s3_key text,
            check(status in (
              'awaiting_upload','claimed','completed','expired','cancelled','failed'
            )),
            check(status<>'completed' or completed_at is not null)
          );
          create table shorts_mvp.runtime_feature_flags(flag_key text primary key,enabled boolean);
          create table shorts_mvp.project_output_attempts(
            job_id uuid,selected_at timestamptz,status text,generated_short_id uuid,
            ready_at timestamptz,failure_stage text,failure_code text,failure_message text,
            failed_at timestamptz
          );
          create table shorts_mvp.generated_shorts(
            id uuid primary key,job_id uuid,status text,deleted_at timestamptz,
            render_progress integer,render_error_code text,render_error_message text,
            expires_at timestamptz default now()+interval '30 days'
          );
          create table shorts_mvp.usage_reservations(
            id uuid primary key,mvp_session_id uuid,user_id uuid,job_id uuid unique,
            status text,source_duration_seconds integer,
            consumed_at timestamptz,released_at timestamptz
          );
          create table shorts_mvp.usage_events(
            mvp_session_id uuid,user_id uuid,job_id uuid,event_type text,
            source_duration_seconds integer,unique(job_id,event_type)
          );
          create table shorts_mvp.job_events(
            job_id uuid,stage text,progress integer,message text,metadata jsonb
          );
        """, parse=False)
        migration = (Path(__file__).parents[2] / "supabase/migrations"
                     / "202607260001_selected_output_completion_policy.sql").read_text()
        finalizer = "create or replace function shorts_mvp.finalize_project_job" + migration.split(
            "create or replace function shorts_mvp.finalize_project_job", 1,
        )[1].split("grant execute", 1)[0]
        connection.execute(finalizer, parse=False)
    finally:
        connection.close()
    return container


@pytest.fixture
def upload_postgres(_upload_postgres_container, monkeypatch):
    monkeypatch.delenv("STATE_EVENT_QUEUE_URL", raising=False)
    repository = WorkerRepository("unused-network-none-test", "ap-northeast-2")

    @contextmanager
    def connect():
        connection = _UploadPostgresConnection(_upload_postgres_container)
        try:
            yield connection
        finally:
            connection.close()

    repository.connect = connect
    with connect() as connection:
        connection.execute("""
          truncate shorts_mvp.upload_sessions,shorts_mvp.project_output_attempts,
            shorts_mvp.generated_shorts,shorts_mvp.usage_events,shorts_mvp.job_events,
            shorts_mvp.usage_reservations,shorts_mvp.video_jobs,
            shorts_mvp.runtime_feature_flags;
          insert into shorts_mvp.runtime_feature_flags values ('file_upload',false);
        """, parse=False)
    return repository


def _seed_upload_postgres(repository, *, ready=True, job_status="rendering"):
    job_id, session_id, user_id, mvp_id = (str(uuid4()) for _ in range(4))
    with repository.connect() as connection:
        connection.execute("""
          insert into shorts_mvp.video_jobs(id,user_id,mvp_session_id,status)
          values(%s,%s,%s,%s);
          insert into shorts_mvp.upload_sessions(id,job_id,user_id,mvp_session_id,status,claimed_at)
          values(%s,%s,%s,%s,'claimed',clock_timestamp());
          insert into shorts_mvp.usage_reservations(
            id,job_id,user_id,mvp_session_id,status,source_duration_seconds
          ) values(%s,%s,%s,%s,'reserved',300);
        """, (job_id, user_id, mvp_id, job_status, session_id, job_id, user_id, mvp_id,
                 str(uuid4()), job_id, user_id, mvp_id), parse=False)
        for _ in range(2):
            short_id = str(uuid4())
            connection.execute("""
              insert into shorts_mvp.generated_shorts(id,job_id,status) values(%s,%s,%s);
              insert into shorts_mvp.project_output_attempts(
                job_id,selected_at,status,generated_short_id
              ) values(%s,clock_timestamp(),'rendering',%s);
            """, (short_id, job_id, "ready" if ready else "rendering", job_id, short_id),
                parse=False)
    return job_id, session_id


def _upload_postgres_outcome(repository):
    with repository.connect() as connection:
        return connection.execute("""
          select job.status as job_status,session.status as session_status,
            session.source_deleted_at is not null as source_deleted,
            job.source_deleted_at is not null as job_source_deleted,
            session.failure_code,reservation.status as reservation_status,
            (select count(*) from shorts_mvp.usage_events) as event_count
          from shorts_mvp.video_jobs job
          join shorts_mvp.upload_sessions session on session.job_id=job.id
          join shorts_mvp.usage_reservations reservation on reservation.job_id=job.id
        """).fetchone()


@pytest.mark.parametrize("ready,expected", [(True, "completed"), (False, "failed")])
def test_postgres_upload_failure_uses_real_finalizer_without_double_usage(
    upload_postgres, ready, expected,
):
    job_id, session_id = _seed_upload_postgres(upload_postgres, ready=ready)
    for _ in range(2):
        assert upload_postgres.fail_upload_session(
            session_id, job_id, error_code="late_receiver_error", message="late receiver error",
        )
    outcome = _upload_postgres_outcome(upload_postgres)
    assert outcome["job_status"] == outcome["session_status"] == expected
    assert outcome["reservation_status"] == ("consumed" if ready else "released")
    assert outcome["event_count"] == "1"
    assert outcome["failure_code"] == (None if ready else "late_receiver_error")


def test_postgres_completed_upload_keeps_raw_cleanup_pending_and_heartbeat(upload_postgres):
    job_id, session_id = _seed_upload_postgres(upload_postgres)
    assert upload_postgres.fail_upload_session(
        session_id, job_id, error_code="raw_cleanup_failed", message="raw cleanup pending",
        source_deleted=False,
    )
    outcome = _upload_postgres_outcome(upload_postgres)
    assert outcome["job_status"] == outcome["session_status"] == "completed"
    assert outcome["source_deleted"] == outcome["job_source_deleted"] == "f"
    with upload_postgres.connect() as connection:
        connection.execute(
            "insert into shorts_mvp.runtime_feature_flags "
            "values ('file_upload_emergency_stop',true)"
        )
    assert upload_postgres.heartbeat_upload_session(session_id, 10)
    assert upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
        verified_upload_session_ids=[session_id],
    ) == []
    with upload_postgres.connect() as connection:
        connection.execute(
            "update shorts_mvp.upload_sessions "
            "set heartbeat_at=clock_timestamp()-interval '1 hour'"
        )
    assert upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=session_id,
        verified_upload_session_ids=[session_id],
    ) == []
    claimed = upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
        verified_upload_session_ids=[session_id],
    )
    assert len(claimed) == 1 and claimed[0]["previous_status"] == "completed"
    assert upload_postgres.finalize_abandoned_upload_source_cleanup(
        session_id, job_id, previous_status="completed",
    )["final_status"] == "completed"
    assert _upload_postgres_outcome(upload_postgres)["source_deleted"] == "t"
    assert not upload_postgres.heartbeat_upload_session(session_id, 10)


def test_postgres_upload_completion_acknowledgement_and_deletion_are_monotonic(upload_postgres):
    job_id, session_id = _seed_upload_postgres(upload_postgres)
    upload_postgres.finalize_project_job(job_id)
    assert upload_postgres.complete_upload_session(session_id, job_id)
    assert upload_postgres.complete_upload_session(session_id, job_id)
    assert upload_postgres.fail_upload_session(
        session_id, job_id, error_code="stale_failure", message="stale failure",
        source_deleted=False,
    )
    outcome = _upload_postgres_outcome(upload_postgres)
    assert outcome["job_status"] == outcome["session_status"] == "completed"
    assert outcome["source_deleted"] == outcome["job_source_deleted"] == "t"
    assert outcome["event_count"] == "1"


def test_postgres_upload_terminal_update_error_rolls_back_finalization_and_usage(upload_postgres):
    job_id, session_id = _seed_upload_postgres(upload_postgres, ready=False)
    with upload_postgres.connect() as connection:
        connection.execute(
            "alter table shorts_mvp.upload_sessions "
            "add constraint terminal_test_failure check(failure_code is null)"
        )
    try:
        with pytest.raises(RuntimeError, match="terminal_test_failure"):
            upload_postgres.fail_upload_session(
                session_id, job_id, error_code="injected_failure", message="injected failure",
            )
    finally:
        with upload_postgres.connect() as connection:
            connection.execute(
                "alter table shorts_mvp.upload_sessions drop constraint terminal_test_failure"
            )
    outcome = _upload_postgres_outcome(upload_postgres)
    assert outcome["job_status"] == "rendering" and outcome["session_status"] == "claimed"
    assert outcome["reservation_status"] == "reserved" and outcome["event_count"] == "0"


def test_postgres_upload_late_failure_waits_for_completion_row_lock(upload_postgres):
    job_id, session_id = _seed_upload_postgres(upload_postgres)
    upload_postgres.finalize_project_job(job_id)
    held, release, finished = threading.Event(), threading.Event(), threading.Event()
    exceptions = []
    original_connect = upload_postgres.connect
    completing = WorkerRepository("unused-network-none-test", "ap-northeast-2")

    @contextmanager
    def gated_connect():
        with original_connect() as connection:
            execute = connection.execute

            def gated_execute(query, parameters=(), **kwargs):
                result = execute(query, parameters, **kwargs)
                if "update shorts_mvp.upload_sessions us" in query:
                    held.set()
                    assert release.wait(3)
                return result

            connection.execute = gated_execute
            yield connection

    completing.connect = gated_connect

    def complete():
        try:
            assert completing.complete_upload_session(session_id, job_id)
        except BaseException as exc:
            exceptions.append(exc)

    def fail():
        try:
            assert upload_postgres.fail_upload_session(
                session_id, job_id, error_code="late_failure", message="late failure",
                source_deleted=False,
            )
        except BaseException as exc:
            exceptions.append(exc)
        finally:
            finished.set()

    first = threading.Thread(target=complete)
    second = threading.Thread(target=fail)
    first.start()
    try:
        assert held.wait(3)
        second.start()
        assert not finished.wait(0.15)
    finally:
        release.set()
        first.join(timeout=6)
        if second.ident is not None:
            second.join(timeout=6)
    assert not first.is_alive() and not second.is_alive() and not exceptions
    outcome = _upload_postgres_outcome(upload_postgres)
    assert outcome["job_status"] == outcome["session_status"] == "completed"
    assert outcome["source_deleted"] == outcome["job_source_deleted"] == "t"
    assert outcome["event_count"] == "1"


def test_postgres_upload_sweeper_and_completion_share_session_first_lock_order(upload_postgres):
    job_id, session_id = _seed_upload_postgres(upload_postgres)
    assert upload_postgres.fail_upload_session(
        session_id, job_id, error_code="cleanup_pending", message="cleanup pending",
        source_deleted=False,
    )
    held, release, sweep_entered, swept, saw_job_lock = (
        threading.Event() for _ in range(5)
    )
    exceptions, sweep_results = [], []
    original_connect = upload_postgres.connect
    completing = WorkerRepository("unused-network-none-test", "ap-northeast-2")
    sweeping = WorkerRepository("unused-network-none-test", "ap-northeast-2")

    @contextmanager
    def gated_completion_connect():
        with original_connect() as connection:
            execute = connection.execute

            def gated_execute(query, parameters=(), **kwargs):
                result = execute(query, parameters, **kwargs)
                if "update shorts_mvp.upload_sessions us" in query:
                    held.set()
                    assert release.wait(3)
                return result

            connection.execute = gated_execute
            yield connection

    @contextmanager
    def watched_sweep_connect():
        with original_connect() as connection:
            execute = connection.execute

            def watched_execute(query, parameters=(), **kwargs):
                sweep_entered.set()
                result = execute(query, parameters, **kwargs)
                if "select * from shorts_mvp.finalize_project_job" in query:
                    saw_job_lock.set()
                return result

            connection.execute = watched_execute
            yield connection

    completing.connect = gated_completion_connect
    sweeping.connect = watched_sweep_connect

    def complete():
        try:
            assert completing.complete_upload_session(session_id, job_id)
        except BaseException as exc:
            exceptions.append(exc)

    def sweep():
        try:
            sweep_results.append(sweeping.finalize_abandoned_upload_source_cleanup(
                session_id, job_id, previous_status="completed",
            ))
        except BaseException as exc:
            exceptions.append(exc)
        finally:
            swept.set()

    first = threading.Thread(target=complete)
    second = threading.Thread(target=sweep)
    first.start()
    try:
        assert held.wait(3)
        second.start()
        assert sweep_entered.wait(3)
        assert not saw_job_lock.wait(0.15)
        assert not swept.is_set()
    finally:
        release.set()
        first.join(timeout=6)
        if second.ident is not None:
            second.join(timeout=6)
    assert not first.is_alive() and not second.is_alive() and not exceptions
    assert sweep_results == [None]
    outcome = _upload_postgres_outcome(upload_postgres)
    assert outcome["job_status"] == outcome["session_status"] == "completed"
    assert outcome["source_deleted"] == outcome["job_source_deleted"] == "t"
    assert outcome["event_count"] == "1"


@pytest.mark.parametrize("session_status", ["claimed", "completed", "failed"])
def test_postgres_upload_stale_listing_and_unverified_claim_never_change_owner_state(
    upload_postgres, session_status,
):
    job_id, session_id = _seed_upload_postgres(
        upload_postgres, ready=session_status != "failed",
    )
    if session_status != "claimed":
        assert upload_postgres.fail_upload_session(
            session_id, job_id, error_code="cleanup_pending", message="cleanup pending",
            source_deleted=False,
        )
    with upload_postgres.connect() as connection:
        connection.execute(
            "update shorts_mvp.upload_sessions set heartbeat_at='2000-01-01'"
        )
    before = _upload_postgres_outcome(upload_postgres)
    listed = upload_postgres.list_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
    )
    assert len(listed) == 1
    assert listed[0]["id"] == session_id and listed[0]["previous_status"] == session_status
    assert _upload_postgres_outcome(upload_postgres) == before
    assert upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
    ) == []
    assert upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
        verified_upload_session_ids=[str(uuid4())],
    ) == []
    assert upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=session_id,
        verified_upload_session_ids=[session_id],
    ) == []
    assert _upload_postgres_outcome(upload_postgres) == before
    claimed = upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
        verified_upload_session_ids=[session_id],
    )
    assert len(claimed) == 1 and claimed[0]["id"] == session_id
    after = _upload_postgres_outcome(upload_postgres)
    assert after["session_status"] == ("failed" if session_status == "claimed" else session_status)
    assert after["source_deleted"] == "f"
    assert after["job_status"] == before["job_status"]
    assert after["reservation_status"] == before["reservation_status"]
    assert after["event_count"] == before["event_count"]


def test_postgres_upload_verified_claim_rechecks_refresh_and_skips_live_row_lock(upload_postgres):
    _job_id, session_id = _seed_upload_postgres(upload_postgres)
    with upload_postgres.connect() as connection:
        connection.execute(
            "update shorts_mvp.upload_sessions set heartbeat_at='2000-01-01'"
        )
    listed = upload_postgres.list_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
    )
    assert [row["id"] for row in listed] == [session_id]
    with upload_postgres.connect() as connection, connection.transaction():
        connection.execute(
            "update shorts_mvp.upload_sessions set heartbeat_at=clock_timestamp()"
        )
        # The read-only list predates this owner's heartbeat transaction. Even
        # an otherwise verified ID cannot retire its locked row from another DB
        # connection, and the fresh heartbeat remains authoritative on commit.
        assert upload_postgres.claim_abandoned_upload_sessions(
            stale_after_seconds=30, active_upload_session_id=None,
            verified_upload_session_ids=[session_id],
        ) == []
    assert upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
        verified_upload_session_ids=[session_id],
    ) == []
    outcome = _upload_postgres_outcome(upload_postgres)
    assert outcome["session_status"] == "claimed" and outcome["job_status"] == "rendering"
    assert outcome["source_deleted"] == "f"
    assert outcome["reservation_status"] == "reserved" and outcome["event_count"] == "0"


def _seed_expired_awaiting_upload_postgres(repository):
    job_id, session_id = _seed_upload_postgres(repository, ready=False, job_status="uploading")
    with repository.connect() as connection:
        connection.execute("""
          update shorts_mvp.upload_sessions
          set status='awaiting_upload',claimed_at=null,consumed_at=null,received_bytes=0,
              heartbeat_at=null,expires_at=clock_timestamp()-interval '1 minute'
        """)
    return job_id, session_id


def test_postgres_upload_expired_unconsumed_token_has_separate_no_body_claim(upload_postgres):
    job_id, session_id = _seed_expired_awaiting_upload_postgres(upload_postgres)
    listed = upload_postgres.list_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
    )
    assert len(listed) == 1 and listed[0]["previous_status"] == "awaiting_upload"
    assert upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
        verified_upload_session_ids=[session_id],
    ) == []
    claimed = upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
        expired_awaiting_upload_session_ids=[session_id],
    )
    assert len(claimed) == 1 and claimed[0]["previous_status"] == "awaiting_upload"
    before_cleanup = _upload_postgres_outcome(upload_postgres)
    assert before_cleanup["session_status"] == "expired"
    assert before_cleanup["job_status"] == "uploading"
    assert before_cleanup["source_deleted"] == "f"
    assert before_cleanup["reservation_status"] == "reserved"
    finalized = upload_postgres.finalize_abandoned_upload_source_cleanup(
        session_id, job_id, previous_status="awaiting_upload",
    )
    assert finalized["final_status"] == "failed"
    after = _upload_postgres_outcome(upload_postgres)
    assert after["session_status"] == "expired" and after["source_deleted"] == "t"
    assert after["reservation_status"] == "released" and after["event_count"] == "1"


@pytest.mark.parametrize("unsafe_change", [
    "expires_at=clock_timestamp()+interval '1 minute'",
    "claimed_at=clock_timestamp(),consumed_at=clock_timestamp()",
    "received_bytes=1",
])
def test_postgres_upload_no_body_claim_rechecks_expiry_and_never_consumed_markers(
    upload_postgres, unsafe_change,
):
    _job_id, session_id = _seed_expired_awaiting_upload_postgres(upload_postgres)
    with upload_postgres.connect() as connection:
        # Values are fixed test cases, never application/user SQL.
        connection.execute("update shorts_mvp.upload_sessions set " + unsafe_change)
    before = _upload_postgres_outcome(upload_postgres)
    assert upload_postgres.list_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
    ) == []
    assert upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
        expired_awaiting_upload_session_ids=[session_id],
    ) == []
    assert _upload_postgres_outcome(upload_postgres) == before


def test_postgres_upload_no_body_claim_cannot_retire_token_claimed_after_listing(upload_postgres):
    _job_id, session_id = _seed_expired_awaiting_upload_postgres(upload_postgres)
    assert len(upload_postgres.list_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
    )) == 1
    with upload_postgres.connect() as connection, connection.transaction():
        connection.execute("""
          update shorts_mvp.upload_sessions
          set status='claimed',claimed_at=clock_timestamp(),consumed_at=clock_timestamp(),
              heartbeat_at=clock_timestamp()-interval '1 hour'
        """)
        assert upload_postgres.claim_abandoned_upload_sessions(
            stale_after_seconds=30, active_upload_session_id=None,
            expired_awaiting_upload_session_ids=[session_id],
        ) == []
    # Even a stale claimed row must not reuse the no-body authority obtained
    # for its older awaiting snapshot. Its task now needs the STOPPED guard.
    assert upload_postgres.claim_abandoned_upload_sessions(
        stale_after_seconds=30, active_upload_session_id=None,
        expired_awaiting_upload_session_ids=[session_id],
    ) == []
    outcome = _upload_postgres_outcome(upload_postgres)
    assert outcome["session_status"] == "claimed" and outcome["source_deleted"] == "f"
    assert outcome["reservation_status"] == "reserved" and outcome["event_count"] == "0"
