"""Opt-in deadline accounting regression against a disposable loopback database."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
import pytest

URL = os.environ.get("DEADLINE_IO_TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="requires isolated local deadline fixture DB")
ROOT = Path(__file__).parents[2]
FIX = ROOT / "supabase/migrations/20261019170147_fix_deadline_failure_code_ambiguity.sql"


def baseline_function():
    source = (
        ROOT / "supabase/migrations/202609010003_ingestion_route_capacity_requeue.sql"
    ).read_text()
    return source[
        source.index(
            "create or replace function shorts_mvp.fail_video_job_at_deadline"
        ) : source.index("create or replace function shorts_mvp.get_batch_dispatch_health")
    ]


@pytest.fixture(scope="module")
def database():
    target = urlparse(URL)
    assert target.hostname in {"localhost", "127.0.0.1"}
    assert target.path == "/deadline_io_test"
    with psycopg.connect(URL, autocommit=True, connect_timeout=5) as db:
        db.execute("""
        DROP SCHEMA IF EXISTS shorts_mvp CASCADE;
        CREATE SCHEMA shorts_mvp;
        CREATE TABLE shorts_mvp.video_jobs(
          id uuid primary key,status text,pipeline_version int default 2,
          queue_expires_at timestamptz,deadline_at timestamptz,
          ingestion_route_wait_started_at timestamptz,ingestion_route_id text,
          planned_short_count int default 2,completion_policy_version int default 2,
          stage text,progress int,selected_short_count int,unselected_short_count int,
          ready_short_count int,failed_short_count int,render_success_percent numeric,
          completed_at timestamptz,source_deleted_at timestamptz,heartbeat_at timestamptz,
          expires_at timestamptz,error_code text,error_message text);
        CREATE TABLE shorts_mvp.project_output_attempts(
          id uuid primary key,job_id uuid,generated_short_id uuid,status text,
          selected_at timestamptz,ready_at timestamptz,failure_stage text,
          failure_code text,failure_message text,failed_at timestamptz);
        CREATE TABLE shorts_mvp.generated_shorts(
          id uuid primary key,job_id uuid,status text,deleted_at timestamptz,
          output_s3_key text,expires_at timestamptz,render_progress int,
          render_error_code text,render_error_message text);
        CREATE TABLE shorts_mvp.usage_reservations(
          id uuid primary key,job_id uuid,mvp_session_id uuid,user_id uuid,status text,
          source_duration_seconds int,consumed_at timestamptz,released_at timestamptz);
        CREATE TABLE shorts_mvp.usage_events(
          mvp_session_id uuid,user_id uuid,job_id uuid,event_type text,
          source_duration_seconds int,unique(job_id,event_type));
        CREATE TABLE shorts_mvp.job_events(
          job_id uuid,stage text,progress int,message text,metadata jsonb);
        CREATE TABLE shorts_mvp.project_job_outbox(job_id uuid,status text,last_error text);
        CREATE TABLE shorts_mvp.route_releases(
          job_id uuid,route_id text,reason text,primary key(job_id,route_id));
        CREATE FUNCTION shorts_mvp.release_ingestion_route(uuid,text,text,int)
          RETURNS void LANGUAGE sql AS $$
          INSERT INTO shorts_mvp.route_releases VALUES($1,$2,$3) ON CONFLICT DO NOTHING$$;
        """)
        db.execute(
            (
                ROOT
                / "supabase/migrations"
                / "20261019020730_preserve_initial_outputs_during_editor_render.sql"
            ).read_text()
        )
        db.execute(FIX.read_text())
        yield db


@pytest.fixture(autouse=True)
def clean(database):
    database.execute("""TRUNCATE shorts_mvp.video_jobs,shorts_mvp.project_output_attempts,
      shorts_mvp.generated_shorts,shorts_mvp.usage_reservations,shorts_mvp.usage_events,
      shorts_mvp.job_events,shorts_mvp.project_job_outbox,shorts_mvp.route_releases""")


def job(db, *, pipeline=2, ready=0, capacity=False, future=False):
    jid = uuid4()
    db.execute(
        """INSERT INTO shorts_mvp.video_jobs
      (id,status,pipeline_version,queue_expires_at,deadline_at,ingestion_route_wait_started_at,ingestion_route_id)
      VALUES(%s,%s,%s,now()+%s::interval,now()+%s::interval,%s,'route-a')""",
        (
            jid,
            "retry_waiting" if capacity else "rendering",
            pipeline,
            "1 hour" if future else "-1 hour",
            "1 hour" if future else "-1 hour",
            "2026-01-01T00:00:00Z" if capacity else None,
        ),
    )
    db.execute(
        "INSERT INTO shorts_mvp.usage_reservations VALUES(%s,%s,%s,%s,'reserved',600,null,null)",
        (uuid4(), jid, uuid4(), uuid4()),
    )
    db.execute("INSERT INTO shorts_mvp.project_job_outbox VALUES(%s,'dispatched',null)", (jid,))
    for index in range(2):
        sid = uuid4()
        db.execute(
            "INSERT INTO shorts_mvp.generated_shorts(id,job_id,status,output_s3_key,expires_at) "
            "VALUES(%s,%s,%s,%s,now()+interval '30 days')",
            (
                sid,
                jid,
                "ready" if index < ready else "rendering",
                "output" if index < ready else None,
            ),
        )
        db.execute(
            "INSERT INTO shorts_mvp.project_output_attempts"
            "(id,job_id,generated_short_id,status,selected_at) "
            "VALUES(%s,%s,%s,'rendering',now())",
            (uuid4(), jid, sid),
        )
    return jid


def test_reproduces_collision_then_installs_fix(database):
    jid = job(database)
    with database.transaction(force_rollback=True):
        database.execute(baseline_function())
        with pytest.raises(psycopg.errors.AmbiguousColumn), database.transaction():
            database.execute("SELECT * FROM shorts_mvp.fail_video_job_at_deadline(%s)", (jid,))
        assert database.execute(
            "SELECT status FROM shorts_mvp.video_jobs WHERE id=%s", (jid,)
        ).fetchone() == ("rendering",)


@pytest.mark.parametrize(
    "pipeline,ready,capacity,final,usage,code",
    [
        (2, 0, False, "failed", "released", "job_deadline"),
        (2, 0, True, "failed", "released", "ingestion_capacity_timeout"),
        (2, 1, False, "completed", "consumed", None),
        (1, 0, False, "failed", "released", "job_deadline"),
    ],
)
def test_deadline_finalizes_and_accounts_once(
    database, pipeline, ready, capacity, final, usage, code
):
    jid = job(database, pipeline=pipeline, ready=ready, capacity=capacity)
    assert database.execute(
        "SELECT * FROM shorts_mvp.fail_video_job_at_deadline(%s)", (jid,)
    ).fetchone() == (True,)
    assert database.execute(
        "SELECT status,error_code FROM shorts_mvp.video_jobs WHERE id=%s", (jid,)
    ).fetchone() == (final, code)
    assert database.execute(
        "SELECT status FROM shorts_mvp.usage_reservations WHERE job_id=%s", (jid,)
    ).fetchone() == (usage,)
    assert database.execute(
        "SELECT * FROM shorts_mvp.fail_video_job_at_deadline(%s)", (jid,)
    ).fetchone() == (False,)
    assert database.execute("SELECT count(*) FROM shorts_mvp.job_events").fetchone() == (1,)
    assert database.execute("SELECT count(*) FROM shorts_mvp.route_releases").fetchone() == (1,)
    if pipeline == 2:
        assert database.execute("SELECT count(*) FROM shorts_mvp.usage_events").fetchone() == (1,)
        assert database.execute(
            "SELECT count(*) FROM shorts_mvp.project_output_attempts WHERE failure_code=%s",
            ("ingestion_capacity_timeout" if capacity else "job_deadline",),
        ).fetchone() == (2 - ready,)


def test_does_not_end_a_live_job(database):
    jid = job(database, future=True)
    assert database.execute(
        "SELECT * FROM shorts_mvp.fail_video_job_at_deadline(%s)", (jid,)
    ).fetchone() == (False,)
    assert database.execute("SELECT status FROM shorts_mvp.usage_reservations").fetchone() == (
        "reserved",
    )
    assert database.execute("SELECT count(*) FROM shorts_mvp.usage_events").fetchone() == (0,)
