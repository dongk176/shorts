from shorts_worker import worker_pipeline
from shorts_worker.config import Settings
from shorts_worker.worker_pipeline import BatchWorker


def test_render_worker_startup_does_not_require_ingestion_proxy_routes(
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.setenv("INGESTION_EGRESS_MODE", "webshare_isp")
    monkeypatch.delenv("INGESTION_PROXY_ROUTES_JSON", raising=False)

    for dependency in (
        "WorkerRepository",
        "ObjectStorage",
        "AudioTranscriber",
        "TranscriptSelector",
        "VideoRenderer",
        "WorkQueue",
    ):
        monkeypatch.setattr(worker_pipeline, dependency, lambda *args, **kwargs: object())

    provider_calls: list[float] = []

    def provider(*, timeout_seconds: float) -> object:
        provider_calls.append(timeout_seconds)
        return object()

    monkeypatch.setattr(worker_pipeline, "YtDlpIngestionProvider", provider)
    settings = Settings(
        database_url="postgresql://example.invalid/shorts",
        s3_bucket="test-bucket",
        temp_dir=tmp_path,
    )

    worker = BatchWorker(settings)

    assert provider_calls == []
    assert "ingestion" not in worker.__dict__

    assert worker.ingestion is not None
    assert provider_calls == [settings.download_timeout_seconds]
    assert worker.ingestion is worker.ingestion
    assert provider_calls == [settings.download_timeout_seconds]
