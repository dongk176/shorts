"""Real shared-IP concurrency checks; opt-in, disposable localhost DB only."""

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from urllib.parse import urlsplit
from uuid import uuid4

import psycopg
import pytest

URL = os.environ.get("RANKING_TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="isolated local ranking database required")


def connect():
    parsed = urlsplit(URL)
    assert parsed.hostname in {"127.0.0.1", "localhost"} and parsed.path == "/ranking_test"
    return psycopg.connect(URL)


@pytest.fixture
def data():
    owner, project, op = [str(uuid4()) for _ in range(3)]
    with connect() as db:
        db.execute(
            "truncate shorts_mvp.ingestion_route_slots, shorts_mvp.video_jobs, "
            "shorts_mvp.app_users, shorts_mvp.project_job_outbox, "
            "shorts_mvp.job_outbox, shorts_mvp.dispatch_batches, "
            "shorts_mvp.dispatch_batch_items cascade"
        )
        db.execute(
            "insert into shorts_mvp.app_users values(%s,true,'admin@example.test')", (owner,)
        )
        db.execute(
            "insert into shorts_mvp.ranking_projects(id,user_id) values(%s,%s)", (project, owner)
        )
        db.execute(
            "insert into "
            "shorts_mvp.ranking_operations(id,project_id,action,status,task_id,request_id)"
            " values(%s,%s,'inspect','running','task',%s)",
            (op, project, str(uuid4())),
        )
        db.execute("insert into shorts_mvp.ingestion_route_slots(route_id) values('a'),('b'),('c')")
    return owner, project, op


def claim(db, op, task="task"):
    return db.execute(
        "select shorts_ranking_runtime.claim_route(%s,%s,array['a','b','c'],array[]::text[])",
        (op, task),
    ).fetchone()[0]


def regular(db, route=None, pipeline=2):
    job = str(uuid4())
    db.execute(
        "insert into "
        "shorts_mvp.video_jobs(id,status,deadline_at,queue_expires_at,ingestion_route_id,pipeline_version)"
        " values(%s,%s,now()+interval '1 hour',now()+interval '1 hour',%s,%s)",
        (job, "downloading" if route else "queued", route, pipeline),
    )
    if route:
        db.execute(
            "update shorts_mvp.ingestion_route_slots set "
            "leased_job_id=%s,lease_expires_at=now()+interval '1 hour' where route_id=%s",
            (job, route),
        )
    else:
        table = "project_job_outbox" if pipeline == 2 else "job_outbox"
        db.execute(
            f"insert into shorts_mvp.{table}(id,job_id,status) values(%s,%s,'pending')",
            (str(uuid4()), job),
        )
    return job


@pytest.mark.parametrize(
    "scheduler,pipeline",
    [("claim_project_job_outbox_without_ingestion_circuit", 2), ("claim_job_outbox", 1)],
)
def test_existing_schedulers_skip_ranking_and_running_regular_jobs(data, scheduler, pipeline):
    with connect() as db:
        first = regular(db, "a")
        assert claim(db, data[2]) == "b"
        second = regular(db, pipeline=pipeline)
        db.execute(f"select * from shorts_mvp.{scheduler}(10)").fetchall()
        rows = db.execute(
            "select route_id,leased_job_id,ranking_operation_id from "
            "shorts_mvp.ingestion_route_slots order by route_id"
        ).fetchall()
        assert str(rows[0][1]) == first
        assert rows[1][1] is None and str(rows[1][2]) == data[2]
        assert str(rows[2][1]) == second


def test_regular_rotation_skips_ranking_lease(data):
    with connect() as db:
        assert claim(db, data[2]) == "a"
        job = regular(db, "b")
        row = db.execute(
            "select route_id from "
            "shorts_mvp.rotate_ingestion_route(%s,'b','network_error',0,array['b'])",
            (job,),
        ).fetchone()
        assert row[0] == "c"


def test_restricted_runtime_must_bind_active_task_and_admin(data):
    with connect() as db:
        db.execute("set local role shorts_ranking_runtime")
        assert claim(db, data[2], task="wrong") is None
        assert claim(db, str(uuid4())) is None
        assert claim(db, data[2]) == "a"
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            db.execute("select * from shorts_mvp.video_jobs")
        db.rollback()
        db.execute("update shorts_mvp.app_users set is_admin=false where id=%s", (data[0],))
        assert claim(db, data[2]) is None


def test_expired_lease_recovers_without_changing_regular_job(data):
    with connect() as db:
        assert claim(db, data[2]) == "a"
        db.execute(
            "update shorts_mvp.ingestion_route_slots set "
            "ranking_lease_expires_at=now()-interval '1 second' where route_id='a'"
        )
        job = regular(db)
        db.execute(
            "select * from shorts_mvp.claim_project_job_outbox_without_ingestion_circuit(1)"
        ).fetchall()
        assert (
            str(
                db.execute(
                    "select leased_job_id from shorts_mvp.ingestion_route_slots where route_id='a'"
                ).fetchone()[0]
            )
            == job
        )
        # Late ranking release clears only its own marker, never the new regular lease.
        assert db.execute(
            "select shorts_ranking_runtime.release_route(%s,'task','a','success')", (data[2],)
        ).fetchone()[0]
        assert (
            str(
                db.execute(
                    "select leased_job_id from shorts_mvp.ingestion_route_slots where route_id='a'"
                ).fetchone()[0]
            )
            == job
        )


def test_one_ranking_ip_globally_and_release_is_owner_bound(data):
    with connect() as db:
        assert claim(db, data[2]) == "a"
        assert claim(db, data[2]) is None
        assert not db.execute(
            "select shorts_ranking_runtime.release_route(%s,'other-task','a','success')", (data[2],)
        ).fetchone()[0]
        assert db.execute(
            "select shorts_ranking_runtime.release_route(%s,'task','a','success')", (data[2],)
        ).fetchone()[0]
        assert claim(db, data[2]) == "a"


def test_simultaneous_rankings_cannot_claim_two_ips(data):
    op2 = str(uuid4())
    with connect() as db:
        db.execute(
            "insert into "
            "shorts_mvp.ranking_operations(id,project_id,action,status,task_id,request_id)"
            " values(%s,%s,'inspect','succeeded','task',%s)",
            (op2, data[1], str(uuid4())),
        )
        # A second project represents a replacement receiver's concurrent request.
        p2 = str(uuid4())
        db.execute(
            "insert into shorts_mvp.ranking_projects(id,user_id) values(%s,%s)", (p2, data[0])
        )
        db.execute(
            "update shorts_mvp.ranking_operations set project_id=%s,status='running' where id=%s",
            (p2, op2),
        )
    barrier = Barrier(2)

    def run(op):
        with connect() as db:
            barrier.wait(timeout=5)
            return claim(db, op)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, [data[2], op2]))
    assert sum(value is not None for value in results) == 1


def test_simultaneous_regular_and_ranking_acquisition_share_one_slot(data):
    with connect() as db:
        db.execute("delete from shorts_mvp.ingestion_route_slots where route_id<>'a'")
        job = regular(db)
    barrier = Barrier(2)

    def run(kind):
        with connect() as db:
            barrier.wait(timeout=5)
            if kind == "ranking":
                return claim(db, data[2])
            rows = db.execute(
                "select * from shorts_mvp.claim_project_job_outbox_without_ingestion_circuit(1)"
            ).fetchall()
            return bool(rows)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, ["ranking", "regular"]))
    assert sum(bool(x) for x in results) == 1
    with connect() as db:
        row = db.execute(
            "select leased_job_id,ranking_operation_id "
            "from shorts_mvp.ingestion_route_slots where route_id='a'"
        ).fetchone()
        assert sum(x is not None for x in row) == 1
        assert str(row[0]) == job or str(row[1]) == data[2]
