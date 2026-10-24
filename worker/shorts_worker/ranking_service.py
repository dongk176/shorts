"""Isolated administrator receiver. Originals never leave ephemeral task storage."""

from __future__ import annotations

import base64
import hmac
import json
import os
import re
import shutil
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import boto3
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .ranking_egress import RankingEgress
from .ranking_pipeline import MAX_BYTES, RankingFailure, RankingPipeline, checked_id

ROUTE = re.compile(r"^/ranking/v1/projects/([0-9a-f-]{36})/sources/([0-9a-f-]{36})$")
TOKEN_LIMIT = 2048


def verify_capability(secret, token, method, project, source, now=None):
    now = time.time() if now is None else now
    try:
        if len(token) > TOKEN_LIMIT or len(secret) < 32:
            raise ValueError()
        body, signature = token.split(".")
        expected = (
            base64.urlsafe_b64encode(
                hmac.digest(secret.encode(), f"ranking-v1.{body}".encode(), "sha256")
            )
            .decode()
            .rstrip("=")
        )
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if (
            data["v"] != 1
            or data["method"] != method
            or data["project"] != project
            or data["source"] != source
        ):
            raise ValueError()
        if not isinstance(data["exp"], int) or not now < data["exp"] <= now + (
            610 if method == "PUT" else 7210
        ):
            raise ValueError()
        return checked_id(data["owner"])
    except (ValueError, KeyError, TypeError, UnicodeError) as exc:
        raise RankingFailure("접근 권한이 만료되었습니다.") from exc


def byte_range(value, size):
    if not value:
        return 0, size - 1, False
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or not any(match.groups()):
        raise ValueError("range")
    left, right = match.groups()
    if not left:
        count = int(right)
        if count <= 0:
            raise ValueError("range")
        return max(0, size - count), size - 1, True
    start = int(left)
    end = min(int(right), size - 1) if right else size - 1
    if start >= size or end < start:
        raise ValueError("range")
    return start, end, True


class RankingService:
    def __init__(self):
        self.root = Path(os.environ["RANKING_STORAGE_ROOT"]).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if str(self.root) != "/scratch/ranking":
            raise RuntimeError("ranking storage must be ephemeral /scratch/ranking")
        expected_commit = os.environ["RANKING_SOURCE_COMMIT"]
        built_commit = (
            (Path(__file__).resolve().parents[1] / ".worker-source-git-sha").read_text().strip()
        )
        if not re.fullmatch(r"[a-f0-9]{40}", expected_commit) or built_commit != expected_commit:
            raise RuntimeError("ranking worker source identity mismatch")
        self.database = os.environ["DATABASE_URL"]
        self.secret = os.environ["RANKING_TOKEN_SECRET"]
        self.origin_secret = os.environ["RANKING_ORIGIN_SECRET"]
        if len(self.secret) < 32 or len(self.origin_secret) < 32:
            raise RuntimeError("ranking signing/origin secret is not configured")
        self.allowed_origins = set(os.environ["RANKING_ALLOWED_ORIGINS"].split(","))
        self.bucket = os.environ["AWS_S3_OUTPUT_BUCKET"]
        self.capacity = os.environ["RANKING_CAPACITY_FUNCTION_ARN"]
        self.task = str(uuid4())
        self.last_use = time.monotonic()
        self.busy = False
        self.stop = threading.Event()
        self.upload_lock = threading.Lock()
        self.lambda_client = boto3.client("lambda", region_name="ap-northeast-2")
        self.s3 = boto3.client("s3", region_name="ap-northeast-2")
        with self.db() as db:
            identity = db.execute(
                "select current_user as role,"
                " has_schema_privilege(current_user,'shorts_mvp','usage') as ordinary_access"
            ).fetchone()
            if identity["role"] != "shorts_ranking_runtime" or identity["ordinary_access"]:
                raise RuntimeError("ranking database isolation mismatch")

    @contextmanager
    def db(self):
        with psycopg.connect(
            self.database,
            row_factory=dict_row,
            connect_timeout=10,
            options=(
                "-c statement_timeout=10000 -c lock_timeout=3000 -c application_name=ranking-worker"
            ),
        ) as db:
            # Transaction poolers can ignore startup options. Apply limits to
            # the actual transaction, without changing shared session defaults.
            db.execute("set local statement_timeout = '10s'")
            db.execute("set local lock_timeout = '3s'")
            yield db

    def authorized_source(self, project, source, owner):
        with self.db() as db:
            row = db.execute(
                """select s.* from shorts_ranking_runtime.ranking_sources s
                join shorts_ranking_runtime.ranking_projects p on p.id=s.project_id
                join shorts_ranking_runtime.app_users u on u.id=p.user_id
                where s.id=%s and p.id=%s and p.user_id=%s and u.is_admin=true
                and p.deleted_at is null and p.expires_at>now() and s.expires_at>now()""",
                (source, project, owner),
            ).fetchone()
        if not row:
            raise RankingFailure("영상에 접근할 수 없습니다.")
        return row

    def directory(self, project):
        directory = self.root / checked_id(str(project))
        directory.mkdir(exist_ok=True, mode=0o700)
        return directory

    def enqueue_import(self, project, source):
        with self.db() as db:
            updated = db.execute(
                "update shorts_ranking_runtime.ranking_sources set status='queued',task_id=%s"
                " where id=%s and project_id=%s and status='uploading' returning id",
                (self.task, source, project),
            ).fetchone()
            if not updated:
                raise RankingFailure("업로드가 취소되었습니다.")
        self.last_use = time.monotonic()

    def fail_source(self, source):
        with self.db() as db:
            db.execute(
                "update shorts_ranking_runtime.ranking_sources set status='failed',"
                "error='업로드가 중단되었습니다. 다시 추가해 주세요.'"
                " where id=%s",
                (source,),
            )
            db.execute(
                "update shorts_ranking_runtime.ranking_operations set status='failed',"
                "error='업로드가 중단되었습니다. 다시 추가해 주세요.',"
                "finished_at=now(),updated_at=now()"
                " where source_id=%s and status='queued'",
                (source,),
            )

    def claim(self):
        with self.db() as db:
            # A lost receiver cannot resume an in-flight process or an uploaded original.
            db.execute(
                """update shorts_ranking_runtime.ranking_operations set status='failed',
                error='처리 서버가 재시작되었거나 시간이 초과되었습니다. 다시 시도해 주세요.',
                finished_at=now(),updated_at=now()

                where (status='running'
                and (task_id<>%s or updated_at<now()-interval '20 minutes'))
                   or (status='queued' and created_at<now()-interval '30 minutes')""",
                (self.task,),
            )
            row = db.execute("""select o.* from shorts_ranking_runtime.ranking_operations o
                join shorts_ranking_runtime.ranking_projects p on p.id=o.project_id
                join shorts_ranking_runtime.app_users u on u.id=p.user_id
                left join shorts_ranking_runtime.ranking_sources s on s.id=o.source_id

                where o.status='queued'
                and p.deleted_at is null and p.expires_at>now() and u.is_admin=true
                and (o.action<>'import' or s.status='queued')
                order by o.created_at for update of o skip locked limit 1""").fetchone()
            if row:
                db.execute(
                    "update shorts_ranking_runtime.ranking_operations set status='running',"
                    "task_id=%s,updated_at=now()"
                    " where id=%s",
                    (self.task, row["id"]),
                )
            return row

    def sources(self, project):
        with self.db() as db:
            return db.execute(
                "select * from shorts_ranking_runtime.ranking_sources where project_id=%s",
                (project,),
            ).fetchall()

    def save_source(self, source_id, metadata):
        with self.db() as db:
            db.execute(
                """update shorts_ranking_runtime.ranking_sources set status='ready',
                metadata=%s,task_id=%s,
                error=null,expires_at=now()+interval '2 hours' where id=%s""",
                (Jsonb(metadata), self.task, source_id),
            )

    def execute(self, op):
        project = str(op["project_id"])
        directory = self.directory(project)
        if shutil.disk_usage(self.root).free < 2 * 1024**3:
            raise RankingFailure("작업 공간이 부족합니다. 잠시 후 다시 시도해 주세요.")
        egress = (
            RankingEgress(self, op) if os.environ.get("RANKING_WEBSHARE_ENABLED") == "1" else None
        )
        pipeline = RankingPipeline(directory, egress=egress)
        if op["action"] != "render":
            source_id = str(op["source_id"])
            source = next(s for s in self.sources(project) if str(s["id"]) == source_id)
            (directory / source_id).mkdir(exist_ok=True, mode=0o700)
            if op["action"] == "inspect":
                meta = pipeline.register_link(source_id, source["remote_url"])
            else:
                meta = pipeline.import_source(
                    source_id, source["remote_url"] if op["action"] == "preview" else None
                )
                meta.update({"durationKnown": True, "previewReady": True})
                if source["metadata"] and source["metadata"].get("remote"):
                    meta["remote"] = source["metadata"]["remote"]
            self.save_source(source_id, meta)
            return {"source": meta}
        spec = op["payload"]
        sources = self.sources(project)
        source_map = {str(s["id"]): s for s in sources}
        for clip in spec["clips"]:
            source = source_map.get(clip["sourceId"])
            if not source or source["status"] != "ready":
                raise RankingFailure("원본 영상을 다시 추가해 주세요.")
            source_dir = directory / checked_id(clip["sourceId"])
            source_dir.mkdir(exist_ok=True, mode=0o700)
            if not (source_dir / "source.mp4").is_file():
                if not source["remote_url"]:
                    raise RankingFailure(
                        "파일 미리보기가 만료되었습니다. 파일을 다시 추가해 주세요."
                    )
                meta = pipeline.import_source(clip["sourceId"], source["remote_url"])
                meta.update({"durationKnown": True, "previewReady": True})
                if source["metadata"].get("remote"):
                    meta["remote"] = source["metadata"]["remote"]
                source["metadata"] = meta
                self.save_source(clip["sourceId"], meta)
            if clip["end"] > source["metadata"]["duration"]:
                raise RankingFailure("사용할 구간이 실제 원본 길이를 벗어났습니다.")
        (directory / "sources.json").write_text(
            json.dumps([s["metadata"] for s in sources if s["metadata"]])
        )
        render_id = str(op["id"])
        result = pipeline.render(spec, render_id)
        output = directory / result["fileName"]
        key = f"outputs/ranking/{project}/{render_id}.mp4"
        try:
            self.s3.upload_file(
                str(output),
                self.bucket,
                key,
                ExtraArgs={"ContentType": "video/mp4", "CacheControl": "private, no-store"},
            )
            return {"duration": result["duration"], "outputKey": key}
        finally:
            output.unlink(missing_ok=True)

    def finish(self, op, result=None, error=None):
        with self.db() as db:
            updated = db.execute(
                """update shorts_ranking_runtime.ranking_operations
                set status=%s,result=%s,error=%s,
                finished_at=now(),updated_at=now()
                where id=%s and status='running' and task_id=%s returning id""",
                (
                    "failed" if error else "succeeded",
                    Jsonb(result) if result else None,
                    error,
                    op["id"],
                    self.task,
                ),
            ).fetchone()
            if updated and not error and op["action"] == "render":
                db.execute(
                    "select shorts_ranking_runtime.enqueue_completion(%s)",
                    (op["id"],),
                )
            if error and op["source_id"]:
                db.execute(
                    "update shorts_ranking_runtime.ranking_sources set status='failed',error=%s"
                    " where id=%s",
                    (error, op["source_id"]),
                )

    def work(self):
        while not self.stop.is_set():
            op = None
            try:
                op = self.claim()
                if op:
                    self.busy = True
                    try:
                        self.finish(op, result=self.execute(op))
                    except Exception as exc:
                        if op["source_id"]:
                            shutil.rmtree(
                                self.root / str(op["project_id"]) / str(op["source_id"]),
                                ignore_errors=True,
                            )
                        message = (
                            str(exc)
                            if isinstance(exc, RankingFailure)
                            else "영상을 처리하지 못했습니다. 다시 시도해 주세요."
                        )
                        self.finish(op, error=message[:300])
                    finally:
                        self.busy = False
                        self.last_use = time.monotonic()
            except Exception as exc:
                print(
                    json.dumps({"event": "ranking_worker_error", "type": type(exc).__name__}),
                    flush=True,
                )
            if not op:
                self.stop.wait(2)

    def maintain(self):
        while not self.stop.wait(30):
            try:
                if self.busy or time.monotonic() - self.last_use < 600:
                    self.lambda_client.invoke(
                        FunctionName=self.capacity,
                        InvocationType="Event",
                        Payload=json.dumps({"action": "heartbeat"}).encode(),
                    )
                if not self.busy and not self.upload_lock.locked():
                    with self.db() as db:
                        expired = db.execute(
                            """select s.id,s.project_id
                            from shorts_ranking_runtime.ranking_sources s
                            join shorts_ranking_runtime.ranking_projects p on p.id=s.project_id
                            where s.task_id=%s
                            and (s.expires_at<=now() or p.deleted_at is not null
                            or p.expires_at<=now())""",
                            (self.task,),
                        ).fetchall()
                        for row in expired:
                            shutil.rmtree(
                                self.root / str(row["project_id"]) / str(row["id"]),
                                ignore_errors=True,
                            )
                            db.execute(
                                "update shorts_ranking_runtime.ranking_sources set status='expired'"
                                " where id=%s",
                                (row["id"],),
                            )
            except Exception as exc:
                print(
                    json.dumps({"event": "ranking_maintenance_error", "type": type(exc).__name__}),
                    flush=True,
                )


class BoundedHTTPServer(ThreadingHTTPServer):
    """Bound memory/DB connections even when clients hold slow connections open."""

    daemon_threads = True

    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(24)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            request.settimeout(60)
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "RankingReceiver"

    def log_message(self, *_args):
        pass  # Never log query capabilities, signed URLs or request bodies.

    @property
    def service(self):
        return self.server.service

    def respond(self, status, body=None, headers=None):
        raw = b"" if status == 204 else json.dumps(body or {}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "private, no-store")
        self.cors()
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(raw)

    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin in self.service.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET,PUT,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type,Range")
            self.send_header(
                "Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges"
            )

    def identity(self, method):
        if not hmac.compare_digest(
            self.headers.get("x-easycut-origin-verify", ""), self.service.origin_secret
        ):
            raise RankingFailure("접근할 수 없습니다.")
        parsed = urlsplit(self.path)
        match = ROUTE.fullmatch(parsed.path)
        if not match:
            raise RankingFailure("잘못된 주소입니다.")
        project, source = map(checked_id, match.groups())
        origin = self.headers.get("Origin", "")
        if origin and origin not in self.service.allowed_origins:
            raise RankingFailure("접근할 수 없습니다.")
        auth = self.headers.get("Authorization", "")
        token = (
            auth[7:] if auth.startswith("Bearer ") else parse_qs(parsed.query).get("token", [""])[0]
        )
        owner = verify_capability(self.service.secret, token, method, project, source)
        row = self.service.authorized_source(project, source, owner)
        return project, source, row

    def do_OPTIONS(self):
        if self.headers.get("Origin") not in self.service.allowed_origins:
            return self.respond(403)
        return self.respond(204)

    def do_GET(self):
        if self.path == "/ranking/health":
            return self.respond(200, {"ok": True})
        try:
            project, source, row = self.identity("GET")
            file = self.service.root / project / source / "source.mp4"
            if row["status"] != "ready" or not file.is_file():
                return self.respond(
                    410, {"error": "미리보기가 만료되었습니다. 영상을 다시 추가해 주세요."}
                )
            size = file.stat().st_size
            try:
                start, end, partial = byte_range(self.headers.get("Range"), size)
            except ValueError:
                return self.respond(416, headers={"Content-Range": f"bytes */{size}"})
            self.service.last_use = time.monotonic()
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "private, no-store")
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.cors()
            self.end_headers()
            with file.open("rb") as stream:
                stream.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except RankingFailure:
            self.respond(403, {"error": "접근 권한이 없거나 만료되었습니다."})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_PUT(self):
        source = None
        locked = False
        written = False
        try:
            project, source, row = self.identity("PUT")
            size = int(self.headers.get("Content-Length", "0"))
            if (
                self.headers.get("Transfer-Encoding")
                or size <= 0
                or size > MAX_BYTES
                or size != row["size_bytes"]
            ):
                return self.respond(413, {"error": "파일 크기를 확인해 주세요."})
            if row["status"] != "uploading":
                return self.respond(409, {"error": "이미 업로드된 영상입니다."})
            locked = self.service.upload_lock.acquire(blocking=False)
            if not locked:
                return self.respond(409, {"error": "다른 업로드가 진행 중입니다."})
            if shutil.disk_usage(self.service.root).free < 2 * MAX_BYTES + 2 * 1024**3:
                return self.respond(503, {"error": "작업 공간이 부족합니다."})
            directory = self.service.directory(project) / source
            directory.mkdir(exist_ok=True, mode=0o700)
            self.connection.settimeout(60)
            deadline = time.monotonic() + 600
            with (directory / "upload").open("xb") as file:
                written = True
                remaining = size
                while remaining:
                    if time.monotonic() > deadline:
                        raise TimeoutError()
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("incomplete")
                    file.write(chunk)
                    remaining -= len(chunk)
            self.service.enqueue_import(project, source)
            self.respond(202, {"ok": True})
        except RankingFailure:
            if written:
                shutil.rmtree(self.service.root / project / source, ignore_errors=True)
            self.respond(403, {"error": "접근 권한이 없거나 만료되었습니다."})
        except Exception:
            if source and locked:
                shutil.rmtree(self.service.root / project / source, ignore_errors=True)
                self.service.fail_source(source)
            self.respond(400, {"error": "업로드가 중단되었습니다. 다시 추가해 주세요."})
        finally:
            if locked:
                self.service.upload_lock.release()


def main():
    service = RankingService()
    server = BoundedHTTPServer(("0.0.0.0", 8080), Handler)
    server.service = service
    threading.Thread(target=service.work, daemon=True).start()
    threading.Thread(target=service.maintain, daemon=True).start()
    try:
        server.serve_forever()
    finally:
        service.stop.set()
        server.server_close()
        shutil.rmtree(service.root, ignore_errors=True)


if __name__ == "__main__":
    main()
