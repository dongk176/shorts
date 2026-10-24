"""Capacity control must never resize the ordinary upload/Batch services."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize(
    "action,lease,running,healthy,expected",
    [
        ("wake", 0, 0, False, 1),
        ("heartbeat", 0, 1, True, 1),
        ("sweep", 999, 1, True, 0),
        ("sweep", 1100, 1, True, 1),
    ],
)
def test_capacity_uses_only_ranking_service(monkeypatch, action, lease, running, healthy, expected):
    path = Path(__file__).resolve().parents[2] / "infra/aws/lambda/ranking_capacity/index.py"
    spec = importlib.util.spec_from_file_location("ranking_capacity_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    item = {"id": "runtime", "leaseUntil": lease}
    mutations = []

    def put_item(Item):
        item.update(Item)

    def describe_services(**kwargs):
        assert kwargs == {"cluster": "ranking-cluster", "services": ["ranking-service"]}
        return {"services": [{"desiredCount": running, "runningCount": running, "pendingCount": 0}]}

    table = SimpleNamespace(put_item=put_item, get_item=lambda **_: {"Item": item})
    ecs = SimpleNamespace(
        describe_services=describe_services, update_service=lambda **kw: mutations.append(kw)
    )
    elb = SimpleNamespace(
        describe_target_health=lambda **_: {
            "TargetHealthDescriptions": [
                {"TargetHealth": {"State": "healthy" if healthy else "initial"}}
            ]
        }
    )
    monkeypatch.setattr(module.boto3, "client", lambda name: {"ecs": ecs, "elbv2": elb}[name])
    monkeypatch.setattr(module.boto3, "resource", lambda _: SimpleNamespace(Table=lambda _: table))
    monkeypatch.setattr(module.time, "time", lambda: 1000)
    for key, value in {
        "LEASE_TABLE": "ranking-lease",
        "CLUSTER": "ranking-cluster",
        "SERVICE": "ranking-service",
        "TARGET_GROUP_ARN": "ranking-target",
    }.items():
        monkeypatch.setenv(key, value)
    result = module.handler({"action": action}, None)
    assert result["desiredCount"] == expected
    assert result["ready"] == bool(expected and running and healthy)
    assert mutations == (
        [{"cluster": "ranking-cluster", "service": "ranking-service", "desiredCount": expected}]
        if running != expected
        else []
    )
