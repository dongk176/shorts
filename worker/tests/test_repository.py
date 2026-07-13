import inspect
from unittest.mock import MagicMock

from shorts_worker.repository import WorkerRepository


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
