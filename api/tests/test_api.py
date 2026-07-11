from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.database import JobDatabase
from app.ingestion import IngestionProvider, VideoMetadata
from app.main import create_app, resolve_storage_file


class FakeIngestionProvider(IngestionProvider):
    def __init__(self, duration: float = 600) -> None:
        self.duration = duration

    def analyze_url(self, youtube_url: str) -> VideoMetadata:
        return VideoMetadata(
            video_id="dQw4w9WgXcQ",
            title="테스트 영상",
            channel_name="테스트 채널",
            thumbnail_url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            duration_seconds=self.duration,
        )

    def download_video(self, youtube_url: str, destination: Path) -> Path:
        raise AssertionError("API validation tests must not download videos")

    def download_subtitles(self, youtube_url: str, destination: Path) -> Path | None:
        return None


def test_analyze_and_create_job_contract(tmp_path: Path) -> None:
    settings = Settings(
        storage_dir=tmp_path / "storage",
        database_path=tmp_path / "storage" / "jobs.sqlite3",
        temp_dir=tmp_path / "temp",
        openai_api_key=None,
    )
    app = create_app(settings=settings, ingestion_provider=FakeIngestionProvider())
    with TestClient(app) as client:
        response = client.post(
            "/api/analyze",
            json={"youtube_url": "https://youtu.be/dQw4w9WgXcQ"},
        )
        assert response.status_code == 200
        assert response.json()["duration_seconds"] == 600

        # Keep this contract test isolated from the actual background video pipeline.
        client.app.state.job_manager.submit = lambda *_: None
        created = client.post(
            "/api/jobs",
            json={
                "youtube_url": "https://youtu.be/dQw4w9WgXcQ",
                "template_id": "paper",
                "rights_confirmed": True,
                "range_start_seconds": 120,
                "range_end_seconds": 480,
            },
        )
        assert created.status_code == 202
        assert created.json()["status"] == "queued"
        stored = client.app.state.database.get_job(created.json()["job_id"])
        assert stored["range_start_seconds"] == 120
        assert stored["range_end_seconds"] == 480
        polled = client.get(f"/api/jobs/{created.json()['job_id']}")
        assert polled.status_code == 200
        assert polled.json()["outputs"] == []


def test_api_rejects_invalid_template_and_missing_rights(tmp_path: Path) -> None:
    settings = Settings(
        storage_dir=tmp_path / "storage",
        database_path=tmp_path / "storage" / "jobs.sqlite3",
        temp_dir=tmp_path / "temp",
    )
    app = create_app(settings=settings, ingestion_provider=FakeIngestionProvider())
    with TestClient(app) as client:
        invalid_template = client.post(
            "/api/jobs",
            json={
                "youtube_url": "https://youtu.be/dQw4w9WgXcQ",
                "template_id": "unknown",
                "rights_confirmed": True,
            },
        )
        assert invalid_template.status_code == 422

        missing_rights = client.post(
            "/api/jobs",
            json={
                "youtube_url": "https://youtu.be/dQw4w9WgXcQ",
                "template_id": "dark-red",
                "rights_confirmed": False,
            },
        )
        assert missing_rights.status_code == 400
        assert "사용 허가" in missing_rights.json()["detail"]

        invalid_range = client.post(
            "/api/jobs",
            json={
                "youtube_url": "https://youtu.be/dQw4w9WgXcQ",
                "template_id": "dark-red",
                "rights_confirmed": True,
                "range_start_seconds": 500,
                "range_end_seconds": 400,
            },
        )
        assert invalid_range.status_code == 400
        assert "사용 구간" in invalid_range.json()["detail"]


def test_analyze_rejects_video_over_sixty_minutes(tmp_path: Path) -> None:
    settings = Settings(
        storage_dir=tmp_path / "storage",
        database_path=tmp_path / "storage" / "jobs.sqlite3",
        temp_dir=tmp_path / "temp",
    )
    app = create_app(settings=settings, ingestion_provider=FakeIngestionProvider(3_601))
    with TestClient(app) as client:
        response = client.post(
            "/api/analyze",
            json={"youtube_url": "https://youtu.be/dQw4w9WgXcQ"},
        )
        assert response.status_code == 400
        assert "60분" in response.json()["detail"]


def test_storage_path_traversal_is_blocked(tmp_path: Path) -> None:
    storage = tmp_path / "storage"
    storage.mkdir()
    safe = storage / "job" / "clip.mp4"
    safe.parent.mkdir()
    safe.write_bytes(b"video")
    assert resolve_storage_file(storage, "job/clip.mp4") == safe

    outside = tmp_path / "outside.mp4"
    outside.write_bytes(b"secret")
    for requested in ("../outside.mp4", "/etc/passwd", "job/../../outside.mp4"):
        try:
            resolve_storage_file(storage, requested)
        except FileNotFoundError:
            pass
        else:
            raise AssertionError(f"Traversal path was accepted: {requested}")


@pytest.mark.parametrize(
    ("variable", "secret"),
    [
        ("OPENAI_API_KEY", "sk-sensitive-openai-value"),
        ("GEMINI_API_KEY", "sensitive-gemini-value"),
    ],
)
def test_job_logs_redact_ai_keys(
    tmp_path: Path, monkeypatch, variable: str, secret: str
) -> None:
    database = JobDatabase(tmp_path / "jobs.sqlite3")
    database.initialize()
    database.create_job("a" * 32, "https://youtu.be/dQw4w9WgXcQ", "dark-red")
    monkeypatch.setenv(variable, secret)
    database.append_log("a" * 32, "ERROR", f"request failed: {secret}")
    log = database.get_logs("a" * 32)[0]["message"]
    assert secret not in log
    assert "[REDACTED]" in log
