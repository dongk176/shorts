import importlib.util
import json
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

spec = importlib.util.spec_from_file_location(
    "ranking_capacity", Path(__file__).parent / "ranking_capacity/index.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ARN = (
    "arn:aws:secretsmanager:ap-northeast-2:181651591905:secret:"
    "shorts-mvp/production/worker-runtime-ABCDEF"
)


def registry(host="8.8.8.8", version="version-one"):
    return {
        "SecretString": json.dumps(
            {
                "DATABASE_URL": "private-db",
                "OPENAI_API_KEY": "private-ai",
                "INGESTION_PROXY_ROUTES_JSON": json.dumps(
                    [
                        {
                            "id": "webshare-01",
                            "egress_class": "webshare_isp",
                            "proxy_url": f"http://user:password@{host}:8000",
                            "other": "private",
                        }
                    ]
                ),
            }
        ),
        "VersionId": version,
    }


def test_reads_current_registry_on_every_call_without_touching_capacity(monkeypatch):
    monkeypatch.setenv("PROXY_REGISTRY_SECRET_ARN", ARN)
    client = Mock()
    client.get_secret_value.side_effect = [
        registry(),
        registry("1.1.1.1", "version-two"),
    ]
    with patch.object(module.boto3, "client", return_value=client) as make:
        first = module.handler({"action": "proxy_registry"}, None)
        second = module.handler({"action": "proxy_registry"}, None)
    assert [call.args for call in make.call_args_list] == [
        ("secretsmanager",),
        ("secretsmanager",),
    ]
    assert first["registryVersion"] == "version-one"
    assert second["registryVersion"] == "version-two"
    assert "1.1.1.1" in second["routes"][0]["proxy_url"]
    assert set(first) == {"ok", "registryVersion", "routes"}
    assert set(first["routes"][0]) == {"id", "proxy_url", "egress_class"}
    assert "private-db" not in json.dumps(first)
    client.get_secret_value.assert_called_with(SecretId=ARN)


@pytest.mark.parametrize(
    "host", ["127.0.0.1", "169.254.169.254", "10.0.0.1", "localhost"]
)
def test_bad_registry_fails_without_leaking_values(monkeypatch, host):
    monkeypatch.setenv("PROXY_REGISTRY_SECRET_ARN", ARN)
    client = Mock()
    client.get_secret_value.return_value = registry(host)
    with patch.object(module.boto3, "client", return_value=client):
        with pytest.raises(
            RuntimeError, match="^Production proxy registry unavailable$"
        ):
            module.handler({"action": "proxy_registry"}, None)


def test_wrong_environment_is_rejected_before_reading(monkeypatch):
    monkeypatch.setenv(
        "PROXY_REGISTRY_SECRET_ARN", ARN.replace("181651591905", "426197262986")
    )
    with patch.object(module.boto3, "client") as client:
        with pytest.raises(ValueError):
            module.handler({"action": "proxy_registry"}, None)
        client.assert_not_called()


def test_unknown_action_cannot_wake_capacity():
    with patch.object(module.boto3, "client") as client:
        with pytest.raises(ValueError):
            module.handler({"action": "other"}, None)
        client.assert_not_called()
