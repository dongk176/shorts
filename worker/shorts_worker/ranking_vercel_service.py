"""One administrator project per ephemeral Vercel sandbox. No database credentials."""

from __future__ import annotations

import base64
import hmac
import json
import os
import re
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx

from .ranking_pipeline import (
    MAX_BYTES,
    RankingDownloadFailure,
    RankingFailure,
    RankingPipeline,
    checked_id,
)


def verify_token(secret, token, method, project, source, owner, now=None):
    now = time.time() if now is None else now
    try:
        if len(token) > 2048:
            return False
        body, signature = token.split(".")
        expected = (
            base64.urlsafe_b64encode(
                hmac.digest(secret.encode(), f"ranking-v1.{body}".encode(), "sha256")
            )
            .decode()
            .rstrip("=")
        )
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        return (
            hmac.compare_digest(signature, expected)
            and data
            == {
                "v": 1,
                "method": method,
                "project": project,
                "source": source,
                "owner": owner,
                "exp": data["exp"],
            }
            and type(data["exp"]) is int
            and now < data["exp"] <= now + 7210
        )
    except (ValueError, KeyError, TypeError, UnicodeError):
        return False


def byte_range(value, size):
    if not value:
        return 0, size - 1, False
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or not any(match.groups()):
        raise ValueError("range")
    left, right = match.groups()
    if not left:
        if int(right) <= 0:
            raise ValueError("range")
        return max(0, size - int(right)), size - 1, True
    start, end = int(left), min(int(right), size - 1) if right else size - 1
    if start >= size or end < start:
        raise ValueError("range")
    return start, end, True


class Egress:
    def __init__(self, proxy=""):
        self.proxy = proxy

    def run(self, action, deadline):
        # Route rotation and the total attempt budget belong to the coordinator.
        return action(self.proxy)


class VercelPipeline(RankingPipeline):
    def acquire(self, directory, url):
        return self.egress.run(lambda proxy: self._acquire(directory, url, proxy), self.deadline)


class Service:
    def __init__(self, config):
        self.project = checked_id(config["project"])
        self.owner = checked_id(config["owner"])
        self.secret = config["secret"]
        if len(self.secret) < 32:
            raise ValueError("secret")
        self.origins = set(config["origins"])
        self.directory = Path(os.environ["RANKING_STORAGE_ROOT"]) / self.project
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = threading.Lock()
        self.operations = {}
        self.sources = {}
        self.last_use = time.monotonic()

    def submit(self, operation, data):
        checked_id(operation)
        action = data.get("action")
        if action not in {"preview", "import", "render"}:
            raise RankingFailure("잘못된 작업입니다.")
        with self.lock:
            attempt = data.get("attempt", 0)
            maximum = data.get("maxAttempts", 3)
            if (
                type(maximum) is not int
                or not 1 <= maximum <= 10
                or type(attempt) is not int
                or not 0 <= attempt < maximum
            ):
                raise RankingFailure("재시도 횟수를 확인해 주세요.")
            previous = self.operations.get(operation)
            if previous:
                if any(
                    previous["data"].get(key) != data.get(key)
                    for key in ("action", "sourceId", "url", "maxAttempts")
                ):
                    raise RankingFailure("재시도할 원본이 변경되었습니다.")
                if not (
                    previous["status"] == "failed"
                    and previous.get("failureCategory") in {"bot_check", "network_error"}
                    and attempt == previous["attempt"] + 1
                ):
                    return previous
            active = [
                o
                for o in self.operations.values()
                if o["status"] in {"running", "uploading", "receiving"}
            ]
            if active and (
                action == "render" or any(o["data"]["action"] == "render" for o in active)
            ):
                raise RankingFailure("진행 중인 작업이 있습니다.")
            if len(active) >= 3:
                raise RankingFailure("동시에 준비할 수 있는 영상은 3개입니다.")
            if action != "render" and any(
                o["data"].get("sourceId") == data.get("sourceId") for o in active
            ):
                raise RankingFailure("이미 준비 중인 영상입니다.")
            if len(self.operations) >= 80:
                raise RankingFailure("작업이 많습니다. 새로 시작해 주세요.")
            if action != "render":
                source = checked_id(data["sourceId"])
                (self.directory / source).mkdir(exist_ok=True, mode=0o700)
                if action == "import":
                    size = data.get("size")
                    if type(size) is not int or not 0 < size <= (
                        30 * 1024**2 if data.get("kind") == "audio" else MAX_BYTES
                    ):
                        raise RankingFailure("파일 크기를 확인해 주세요.")
            self.operations[operation] = {
                "status": "uploading" if action == "import" else "running",
                "data": data,
                "attempt": attempt,
                "result": None,
            }
            self.last_use = time.monotonic()
        if action != "import":
            threading.Thread(target=self.execute, args=(operation,), daemon=True).start()
        return self.operations[operation]

    def execute(self, operation):
        op = self.operations[operation]
        op["status"] = "running"
        data = op["data"]
        try:
            pipeline = VercelPipeline(
                self.directory,
                egress=Egress(data.get("proxy", "")),
                progress=lambda value: op.update(progress=value),
            )
            if data["action"] != "render":
                source = data["sourceId"]
                if data.get("kind") == "audio":
                    metadata = pipeline.import_audio(source)
                else:
                    metadata = pipeline.import_source(source, data.get("url"))
                metadata.update(durationKnown=True, previewReady=True)
                if data.get("remote"):
                    metadata["remote"] = data["remote"]
                self.sources[source] = metadata
                result = {"source": metadata}
            else:
                spec = data["spec"]
                for source in data["sources"]:
                    sid = checked_id(source["id"])
                    if sid not in self.sources:
                        if not source.get("url"):
                            raise RankingFailure(
                                "업로드한 파일이 만료되었습니다. 파일을 다시 추가해 주세요."
                            )
                        (self.directory / sid).mkdir(exist_ok=True, mode=0o700)
                        metadata = pipeline.import_source(sid, source["url"])
                        metadata.update(durationKnown=True, previewReady=True)
                        self.sources[sid] = metadata
                (self.directory / "sources.json").write_text(
                    json.dumps(list(self.sources.values()))
                )
                result = pipeline.render(spec, operation)
                file = self.directory / result["fileName"]
                try:
                    # URL is minted by the authenticated web API for this result only.
                    with file.open("rb") as stream:
                        response = httpx.put(
                            data["outputUploadUrl"],
                            content=stream,
                            headers={
                                "Content-Type": "video/mp4",
                                "Content-Length": str(file.stat().st_size),
                            },
                            timeout=90,
                            follow_redirects=False,
                        )
                    response.raise_for_status()
                    result = {"duration": result["duration"], "outputKey": data["outputKey"]}
                finally:
                    file.unlink(missing_ok=True)
            op.update(status="succeeded", result=result)
        except Exception as exc:
            if isinstance(exc, RankingDownloadFailure):
                op["failureCategory"] = exc.category
                op["failureReason"] = exc.reason
            if data.get("sourceId"):
                shutil.rmtree(self.directory / data["sourceId"], ignore_errors=True)
            op.update(
                status="failed",
                error=str(exc)[:300]
                if isinstance(exc, RankingFailure)
                else "영상을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            )
        finally:
            self.last_use = time.monotonic()
            # Signed output URL must not be included in status responses or retained.
            op["data"].pop("outputUploadUrl", None)
            op["data"].pop("proxy", None)


class Handler(BaseHTTPRequestHandler):
    server_version = "RankingVercel"

    def log_message(self, *_):
        pass

    @property
    def service(self):
        return self.server.service

    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin in self.service.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET,PUT,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type,Range")
            self.send_header(
                "Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges"
            )

    def reply(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "private, no-store")
        self.cors()
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def internal(self):
        return hmac.compare_digest(
            self.headers.get("Authorization", ""), "Bearer " + self.service.secret
        )

    def media_identity(self, method):
        parsed = urlsplit(self.path)
        match = re.fullmatch(r"/sources/([0-9a-f-]{36})", parsed.path)
        if not match:
            raise RankingFailure("접근할 수 없습니다.")
        source = checked_id(match[1])
        auth = self.headers.get("Authorization", "")
        token = (
            auth[7:] if auth.startswith("Bearer ") else parse_qs(parsed.query).get("token", [""])[0]
        )
        origin = self.headers.get("Origin", "")
        if (origin and origin not in self.service.origins) or not verify_token(
            self.service.secret, token, method, self.service.project, source, self.service.owner
        ):
            raise RankingFailure("접근 권한이 만료되었습니다.")
        return source

    def do_OPTIONS(self):
        self.reply(204 if self.headers.get("Origin") in self.service.origins else 403, {})

    def do_POST(self):
        if not self.internal():
            return self.reply(403, {})
        try:
            match = re.fullmatch(r"/operations/([0-9a-f-]{36})", self.path)
            size = int(self.headers.get("Content-Length", "0"))
            if not match or not 0 < size <= 100000 or self.headers.get("Transfer-Encoding"):
                return self.reply(400, {})
            self.connection.settimeout(20)
            self.service.submit(match[1], json.loads(self.rfile.read(size)))
            self.reply(202, {"ok": True})
        except (RankingFailure, ValueError, KeyError):
            self.reply(400, {"error": "작업을 확인해 주세요."})

    def do_DELETE(self):
        if not self.internal():
            return self.reply(403, {})
        match = re.fullmatch(r"/operations/([0-9a-f-]{36})", self.path)
        if not match:
            return self.reply(404, {})
        with self.service.lock:
            op = self.service.operations.get(match[1])
            if not op:
                return self.reply(404, {})
            if op["status"] not in {"uploading", "failed"}:
                return self.reply(409, {})
            op.update(status="failed", error="업로드가 중단되었습니다. 다시 추가해 주세요.")
            source = op["data"].get("sourceId")
            if source:
                shutil.rmtree(self.service.directory / checked_id(source), ignore_errors=True)
        self.reply(200, {"ok": True})

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"ok": True})
        match = re.fullmatch(r"/operations/([0-9a-f-]{36})", self.path)
        if match:
            if not self.internal():
                return self.reply(403, {})
            op = self.service.operations.get(match[1])
            return self.reply(
                200 if op else 404, {k: v for k, v in (op or {}).items() if k != "data"}
            )
        try:
            sid = self.media_identity("GET")
            file = self.service.directory / sid / "source.mp4"
            if sid not in self.service.sources or not file.is_file():
                return self.reply(410, {"error": "미리보기가 만료되었습니다."})
            size = file.stat().st_size
            try:
                start, end, partial = byte_range(self.headers.get("Range"), size)
            except ValueError:
                return self.reply(416, {})
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "private, no-store")
            self.cors()
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            self.connection.settimeout(60)
            with file.open("rb") as stream:
                stream.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            self.service.last_use = time.monotonic()
        except RankingFailure:
            self.reply(403, {})
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass

    def do_PUT(self):
        op = None
        try:
            sid = self.media_identity("PUT")
            with self.service.lock:
                op = next(
                    (
                        o
                        for o in self.service.operations.values()
                        if o["status"] == "uploading" and o["data"].get("sourceId") == sid
                    ),
                    None,
                )
                if not op:
                    return self.reply(409, {})
                size = int(self.headers.get("Content-Length", "0"))
                if self.headers.get("Transfer-Encoding") or size != op["data"]["size"]:
                    return self.reply(413, {})
                op["status"] = "receiving"
            self.connection.settimeout(60)
            deadline = time.monotonic() + 300
            with (self.service.directory / sid / "upload").open("xb") as stream:
                remaining = size
                while remaining:
                    if time.monotonic() > deadline:
                        raise TimeoutError()
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("incomplete")
                    stream.write(chunk)
                    remaining -= len(chunk)
            operation = next(k for k, v in self.service.operations.items() if v is op)
            threading.Thread(target=self.service.execute, args=(operation,), daemon=True).start()
            self.reply(202, {"ok": True})
        except (RankingFailure, ValueError, TimeoutError, OSError):
            if op:
                op.update(status="failed", error="업로드가 중단되었습니다. 다시 추가해 주세요.")
            self.reply(400, {})


class BoundedServer(ThreadingHTTPServer):
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


def main():
    config = Path(os.environ["RANKING_CONFIG_FILE"])
    service = Service(json.loads(config.read_text()))
    config.unlink()
    server = BoundedServer(("0.0.0.0", 8080), Handler)
    server.daemon_threads = True
    server.service = service
    try:
        server.serve_forever()
    finally:
        shutil.rmtree(service.directory, ignore_errors=True)


if __name__ == "__main__":
    main()
