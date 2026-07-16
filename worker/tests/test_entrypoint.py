from pathlib import Path
from types import SimpleNamespace

from shorts_worker import __main__ as worker_main


def test_entrypoint_starts_four_preconfigured_wireproxy_routes() -> None:
    script = (Path(__file__).parents[1] / "entrypoint.sh").read_text(encoding="utf-8")

    assert 'wireproxy -d' not in script
    assert "[Socks5]" in script
    assert "WARP_CONF_${suffix}_B64" in script
    assert "WARP_PROXY_ROUTES_JSON" in script
    for port in range(1081, 1085):
        assert f"{port}" in script
    assert 'touch /dev/log' in script
    assert 'wireproxy -c "$config_path" &' in script


def test_entrypoint_keeps_legacy_single_warp_configuration() -> None:
    script = (Path(__file__).parents[1] / "entrypoint.sh").read_text(encoding="utf-8")

    assert 'start_wireproxy "warp" "$WARP_CONF_B64" 1080 "$WARP_CONFIG_PATH"' in script
    assert "Legacy WARP_CONF_B64 cannot be combined" in script


def test_prepare_array_command_resolves_the_array_index(monkeypatch) -> None:
    calls: list[tuple[str, object]] = []
    fake_worker = SimpleNamespace(
        repository=SimpleNamespace(
            get_dispatch_job=lambda dispatch_id, index: (
                calls.append((dispatch_id, index)) or "job-a"
            )
        ),
        prepare=lambda job_id: calls.append(("prepare", job_id)),
    )
    monkeypatch.setenv("AWS_BATCH_JOB_ARRAY_INDEX", "3")
    monkeypatch.setattr(worker_main, "Settings", lambda: object())
    monkeypatch.setattr(worker_main, "BatchWorker", lambda _settings: fake_worker)
    monkeypatch.setattr(
        "sys.argv",
        ["shorts_worker", "prepare-array", "--dispatch-batch-id", "dispatch-a"],
    )

    worker_main.main()

    assert calls == [("dispatch-a", 3), ("prepare", "job-a")]


def test_prepare_retry_command_preserves_reserved_attempt(monkeypatch) -> None:
    calls: list[tuple[str, object]] = []
    fake_worker = SimpleNamespace(
        initial=lambda job_id, *, attempt_override=None: calls.append(
            (job_id, attempt_override)
        )
    )
    monkeypatch.setattr(worker_main, "Settings", lambda: object())
    monkeypatch.setattr(worker_main, "BatchWorker", lambda _settings: fake_worker)
    monkeypatch.setattr(
        "sys.argv",
        ["shorts_worker", "prepare", "--job-id", "job-a", "--attempt", "4"],
    )

    worker_main.main()

    assert calls == [("job-a", 4)]
