from __future__ import annotations

import base64
import hmac
import json
import os
import threading
import time
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
import psycopg
import pytest

from shorts_worker.ranking_pipeline import RankingFailure
from shorts_worker.ranking_service import (
    BoundedHTTPServer,
    Handler,
    RankingService,
    byte_range,
    verify_capability,
)

SECRET = "ranking-test-signing-key-" * 3


def token(method, project, source, owner, expires=None):
    data = {
        "v": 1,
        "method": method,
        "project": project,
        "source": source,
        "owner": owner,
        "exp": expires or int(time.time()) + 120,
    }
    body = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    signature = (
        base64.urlsafe_b64encode(
            hmac.digest(SECRET.encode(), f"ranking-v1.{body}".encode(), "sha256")
        )
        .decode()
        .rstrip("=")
    )
    return f"{body}.{signature}"


def test_capability_binds_method_owner_project_source_and_expiry():
    project, source, owner = (str(uuid4()) for _ in range(3))
    value = token("PUT", project, source, owner, 200)
    assert verify_capability(SECRET, value, "PUT", project, source, 100) == owner
    for method, p, s, now, candidate in [
        ("GET", project, source, 100, value),
        ("PUT", str(uuid4()), source, 100, value),
        ("PUT", project, str(uuid4()), 100, value),
        ("PUT", project, source, 200, value),
        ("PUT", project, source, 100, value + "tamper"),
    ]:
        with pytest.raises(RankingFailure):
            verify_capability(SECRET, candidate, method, p, s, now)


@pytest.mark.parametrize(
    "header,expected",
    [
        (None, (0, 99, False)),
        ("bytes=0-9", (0, 9, True)),
        ("bytes=90-", (90, 99, True)),
        ("bytes=-10", (90, 99, True)),
    ],
)
def test_preview_ranges(header, expected):
    assert byte_range(header, 100) == expected


@pytest.mark.parametrize("header", ["bytes=100-", "bytes=9-2", "bytes=-0", "bytes=0-1,4-5"])
def test_invalid_preview_ranges(header):
    with pytest.raises(ValueError):
        byte_range(header, 100)


@pytest.fixture
def service(tmp_path, monkeypatch):
    database = os.environ.get("RANKING_TEST_DATABASE_URL")
    if not database:
        pytest.skip("isolated local ranking database not configured")
    parsed = urlsplit(database)
    assert parsed.hostname in {"127.0.0.1", "localhost"} and parsed.path == "/ranking_test"
    owner, project = str(uuid4()), str(uuid4())
    with psycopg.connect(database) as db:
        db.execute(
            "insert into shorts_mvp.app_users(id,is_admin,email) "
            "values(%s,true,'admin@example.test')",
            (owner,),
        )
        db.execute(
            "insert into shorts_mvp.ranking_projects(id,user_id) values(%s,%s)", (project, owner)
        )
    svc = RankingService.__new__(RankingService)
    svc.database, svc.root, svc.task = database, tmp_path, str(uuid4())
    svc.secret, svc.origin_secret = SECRET, "test-origin-secret"
    svc.allowed_origins = {"https://www.easycut.co.kr"}
    svc.last_use, svc.upload_lock = time.monotonic(), threading.Lock()
    monkeypatch.setenv("RANKING_STORAGE_ROOT", str(tmp_path))
    yield svc, owner, project
    with psycopg.connect(database) as db:
        db.execute(
            "delete from shorts_mvp.ranking_completion_emails where operation_id in "
            "(select id from shorts_mvp.ranking_operations where project_id=%s)",
            (project,),
        )
        db.execute("delete from shorts_mvp.ranking_projects where id=%s", (project,))
        db.execute("delete from shorts_mvp.app_users where id=%s", (owner,))


def test_runtime_transaction_limits(service):
    svc, _, _ = service
    with svc.db() as db:
        assert db.execute("show statement_timeout").fetchone()["statement_timeout"] == "10s"
        assert db.execute("show lock_timeout").fetchone()["lock_timeout"] == "3s"


def source_op(service, owner, project, action="import", size=4):
    source, op = str(uuid4()), str(uuid4())
    with service.db() as db:
        db.execute(
            "insert into shorts_mvp.ranking_sources(id,project_id,status,size_bytes) "
            "values(%s,%s,'uploading',%s)",
            (source, project, size),
        )
        db.execute(
            "insert into shorts_mvp.ranking_operations(id,project_id,source_id,action,request_id) "
            "values(%s,%s,%s,%s,%s)",
            (op, project, source, action, str(uuid4())),
        )
    return source, op


def test_receiver_owner_and_admin_checks_precede_upload(service):
    svc, owner, project = service
    source, _ = source_op(svc, owner, project)
    server = BoundedHTTPServer(("127.0.0.1", 0), Handler)
    server.service = svc
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/ranking/v1/projects/{project}/sources/{source}"
    headers = {"x-easycut-origin-verify": svc.origin_secret, "Origin": "https://www.easycut.co.kr"}
    try:
        headers["Authorization"] = f"Bearer {token('PUT', project, source, str(uuid4()))}"
        assert httpx.put(url, headers=headers, content=b"test").status_code == 403
        headers["Authorization"] = f"Bearer {token('PUT', project, source, owner)}"
        with svc.db() as db:
            db.execute("update shorts_mvp.app_users set is_admin=false where id=%s", (owner,))
        assert httpx.put(url, headers=headers, content=b"test").status_code == 403
        with svc.db() as db:
            db.execute("update shorts_mvp.app_users set is_admin=true where id=%s", (owner,))
        assert httpx.put(url, headers=headers, content=b"bad-size").status_code == 413
        assert httpx.put(url, headers=headers, content=b"test").status_code == 202
        assert httpx.put(url, headers=headers, content=b"test").status_code == 409
        assert (svc.root / project / source / "upload").read_bytes() == b"test"
        op = svc.claim()
        assert str(op["source_id"]) == source
        svc.finish(op, error="invalid media")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_lost_worker_fails_running_operation_and_does_not_touch_regular_jobs(service):
    svc, owner, project = service
    source, operation = source_op(svc, owner, project)
    with svc.db() as db:
        db.execute(
            "update shorts_mvp.ranking_operations set status='running',"
            "task_id='old-task' where id=%s",
            (operation,),
        )
    assert svc.claim() is None
    with svc.db() as db:
        row = db.execute(
            "select status from shorts_mvp.ranking_operations where id=%s", (operation,)
        ).fetchone()
        assert row["status"] == "failed"


def test_render_success_enqueues_email_once(service):
    svc, owner, project = service
    source, operation = source_op(svc, owner, project, action="render")
    op = svc.claim()
    assert str(op["id"]) == operation
    result = {"duration": 3, "outputKey": f"outputs/ranking/{project}/{operation}.mp4"}
    svc.finish(op, result=result)
    svc.finish(op, result=result)
    with svc.db() as db:
        assert (
            db.execute(
                "select count(*) as count from shorts_mvp.ranking_completion_emails "
                "where operation_id=%s",
                (operation,),
            ).fetchone()["count"]
            == 1
        )


def test_no_browser_database_privileges(service):
    svc, _, _ = service
    for role in ("anon", "authenticated"):
        with svc.db() as db:
            db.execute(f"set local role {role}")
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                db.execute("select * from shorts_mvp.ranking_projects")
            db.rollback()


def test_canceled_upload_cannot_be_requeued(service):
    svc, owner, project = service
    source, operation = source_op(svc, owner, project)
    with svc.db() as db:
        db.execute("update shorts_mvp.ranking_sources set status='failed' where id=%s", (source,))
        db.execute(
            "update shorts_mvp.ranking_operations set status='failed' where id=%s", (operation,)
        )
    with pytest.raises(RankingFailure):
        svc.enqueue_import(project, source)
    assert svc.claim() is None


def test_runtime_role_cannot_read_email_or_change_render_payload(service):
    svc, owner, project = service
    source, operation = source_op(svc, owner, project)
    with svc.db() as db:
        db.execute("set local role shorts_ranking_runtime")
        assert db.execute(
            "select is_admin from shorts_ranking_runtime.app_users where id=%s", (owner,)
        ).fetchone()["is_admin"]
        db.execute(
            "update shorts_ranking_runtime.ranking_sources set status='queued' where id=%s",
            (source,),
        )
    for query in [
        "select email from shorts_ranking_runtime.app_users",
        "select * from shorts_mvp.ranking_projects",
        "update shorts_ranking_runtime.ranking_operations set payload='{}'::jsonb",
        "update shorts_ranking_runtime.ranking_projects set user_id=gen_random_uuid()",
        "delete from shorts_ranking_runtime.ranking_sources",
    ]:
        with svc.db() as db:
            db.execute("set local role shorts_ranking_runtime")
            with pytest.raises(
                (psycopg.errors.InsufficientPrivilege, psycopg.errors.UndefinedColumn)
            ):
                db.execute(query)
            db.rollback()


def test_restricted_worker_upload_render_and_email_outbox(service, monkeypatch):
    from contextlib import contextmanager

    from psycopg.types.json import Jsonb

    from shorts_worker.ranking_pipeline import RankingPipeline

    svc, owner, project = service
    original_db = svc.db

    @contextmanager
    def restricted_db():
        with original_db() as db:
            db.execute("set local role shorts_ranking_runtime")
            yield db

    captures = []

    class OutputOnlyS3:
        def upload_file(self, file, bucket, key, ExtraArgs):
            with open(file, "rb") as stream:
                captures.append((bucket, key, ExtraArgs, stream.read()))

    svc.s3, svc.bucket = OutputOnlyS3(), "local-test-output"
    monkeypatch.setattr(svc, "db", restricted_db)
    directory = svc.directory(project)
    pipeline = RankingPipeline(directory)
    source_ids = []
    for color in ("red", "green", "blue"):
        source, operation = str(uuid4()), str(uuid4())
        with original_db() as db:
            db.execute(
                "insert into shorts_mvp.ranking_sources(id,project_id,status,size_bytes) "
                "values(%s,%s,'uploading',4)",
                (source, project),
            )
            db.execute(
                "insert into shorts_mvp.ranking_operations"
                "(id,project_id,source_id,action,request_id) values(%s,%s,%s,'import',%s)",
                (operation, project, source, str(uuid4())),
            )
        source_dir = directory / source
        source_dir.mkdir()
        pipeline.run(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"color=c={color}:s=180x320:r=30:d=2",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-f",
                "mp4",
                str(source_dir / "upload"),
            ]
        )
        svc.enqueue_import(project, source)
        op = svc.claim()
        svc.finish(op, result=svc.execute(op))
        assert not (source_dir / "upload").exists()
        source_ids.append(source)
    render = str(uuid4())
    spec = {
        "title": "운영 후보 렌더 테스트",
        "subtitle": "선택한 순서 그대로",
        "rankCount": 3,
        "descending": True,
        "playbackOrder": [2, 3, 1],
        "clips": [
            {"rank": i + 1, "sourceId": source, "label": f"장면 {i + 1}", "start": 0.5, "end": 1.5}
            for i, source in enumerate(source_ids)
        ],
    }
    with original_db() as db:
        db.execute(
            "insert into shorts_mvp.ranking_operations"
            "(id,project_id,action,payload,request_id) values(%s,%s,'render',%s,%s)",
            (render, project, Jsonb(spec), str(uuid4())),
        )
    op = svc.claim()
    result = svc.execute(op)
    svc.finish(op, result=result)
    assert result["duration"] == pytest.approx(3, abs=1 / 30)
    assert len(captures) == 1
    assert captures[0][1] == f"outputs/ranking/{project}/{render}.mp4"
    output = directory / "verified-result.mp4"
    output.write_bytes(captures[0][3])
    info = pipeline.probe(output)
    assert info["duration"] == pytest.approx(3, abs=0.1)
    assert (info["width"], info["height"]) == (720, 1280)
    with original_db() as db:
        assert (
            db.execute(
                "select status from shorts_mvp.ranking_completion_emails where operation_id=%s",
                (render,),
            ).fetchone()["status"]
            == "pending"
        )


@pytest.mark.parametrize("end,valid", [(4, True), (6, False)])
def test_render_owns_pending_link_download_and_actual_range_validation(
    tmp_path, monkeypatch, end, valid
):
    """A queued web submission needs no further browser calls to inspect/download."""
    from types import SimpleNamespace

    project, source_id, operation = (str(uuid4()) for _ in range(3))
    remote = {
        "url": "https://www.youtube.com/watch?v=vtQV5zRU71o",
        "platform": "youtube",
        "videoId": "vtQV5zRU71o",
    }
    source = {
        "id": source_id,
        "status": "ready",
        "remote_url": remote["url"],
        "metadata": {"id": source_id, "duration": 1200, "durationKnown": False, "remote": remote},
    }
    svc = RankingService.__new__(RankingService)
    svc.root, svc.bucket = tmp_path, "test-bucket"
    svc.directory = lambda _: tmp_path
    svc.sources = lambda _: [source]
    saved, uploads, imports = [], [], []
    svc.save_source = lambda *args: saved.append(args)
    svc.s3 = SimpleNamespace(upload_file=lambda *args, **kwargs: uploads.append(args))
    monkeypatch.setenv("RANKING_WEBSHARE_ENABLED", "0")

    class Pipeline:
        def __init__(self, directory, **kwargs):
            self.directory = directory

        def import_source(self, source, url):
            imports.append((source, url))
            return {"id": source, "duration": 5, "width": 720, "height": 1280, "hasAudio": True}

        def render(self, spec, render_id):
            assert spec["clips"][0]["start"] == 1
            assert spec["playbackOrder"] == [2]
            assert json.loads((tmp_path / "sources.json").read_text())[0]["duration"] == 5
            (tmp_path / "result.mp4").write_bytes(b"fixture-result")
            return {"fileName": "result.mp4", "duration": end - 1}

    monkeypatch.setattr("shorts_worker.ranking_service.RankingPipeline", Pipeline)
    spec = {
        "playbackOrder": [2],
        "clips": [{"rank": 2, "sourceId": source_id, "start": 1, "end": end}],
    }
    op = {"project_id": project, "id": operation, "action": "render", "payload": spec}
    if valid:
        assert svc.execute(op)["duration"] == 3
        assert len(uploads) == 1
        assert not (tmp_path / "result.mp4").exists()
    else:
        with pytest.raises(RankingFailure, match="실제 원본 길이"):
            svc.execute(op)
        assert not uploads
    assert imports == [(source_id, remote["url"])]
    assert saved[0][1]["durationKnown"] is True
