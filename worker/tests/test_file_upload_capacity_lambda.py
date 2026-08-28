from __future__ import annotations

import importlib.util
import sys
import types
from decimal import Decimal
from pathlib import Path


class FakeTable:
    def __init__(self) -> None:
        self.items: dict[str, dict] = {}
        self.scan_requests: list[dict] = []

    def get_item(self, *, Key: dict, ConsistentRead: bool = False) -> dict:
        del ConsistentRead
        item = self.items.get(Key["id"])
        return {"Item": dict(item)} if item else {}

    def put_item(self, *, Item: dict) -> None:
        self.items[str(Item["id"])] = dict(Item)

    def delete_item(self, *, Key: dict) -> None:
        self.items.pop(str(Key["id"]), None)

    def scan(self, **kwargs: object) -> dict:
        self.scan_requests.append(dict(kwargs))
        return {"Items": [dict(item) for item in self.items.values()]}


class FakeEcs:
    def __init__(self) -> None:
        self.desired = 0
        self.running = 0
        self.pending = 0
        self.protected = 0
        self.updates: list[int] = []

    def describe_services(self, **_kwargs: object) -> dict:
        return {"services": [{
            "desiredCount": self.desired,
            "runningCount": self.running,
            "pendingCount": self.pending,
        }]}

    def list_tasks(self, **_kwargs: object) -> dict:
        return {"taskArns": [f"task-{index}" for index in range(self.protected)]}

    def get_task_protection(self, *, tasks: list[str], **_kwargs: object) -> dict:
        return {"protectedTasks": [
            {"taskArn": task, "protectionEnabled": True}
            for task in tasks
        ]}

    def update_service(self, *, desiredCount: int, **_kwargs: object) -> None:
        self.desired = desiredCount
        self.updates.append(desiredCount)


def load_capacity_lambda(monkeypatch):
    table = FakeTable()
    ecs = FakeEcs()
    fake_boto3 = types.SimpleNamespace(
        client=lambda name: ecs if name == "ecs" else None,
        resource=lambda name: types.SimpleNamespace(Table=lambda _table_name: table),
    )
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)
    monkeypatch.setenv("CAPACITY_TABLE", "test-capacity")
    monkeypatch.setenv("ECS_CLUSTER", "test-cluster")
    monkeypatch.setenv("ECS_SERVICE", "test-service")
    monkeypatch.setenv("MAX_CAPACITY", "20")
    monkeypatch.setenv("WARM_SECONDS", "600")

    source = (
        Path(__file__).parents[2]
        / "infra/aws/lambda/file_upload_capacity/index.py"
    )
    name = "test_file_upload_capacity_index"
    spec = importlib.util.spec_from_file_location(name, source)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, name, module)
    spec.loader.exec_module(module)
    return module, table, ecs


def test_each_session_holds_one_capacity_lease(monkeypatch) -> None:
    module, table, ecs = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)

    first = module.handler({
        "action": "ensure",
        "uploadSessionId": "session-a",
        "expiresAtEpoch": 2_000,
        "desiredCount": 1,
    }, None)
    second = module.handler({
        "action": "ensure",
        "uploadSessionId": "session-b",
        "expiresAtEpoch": 2_000,
        "desiredCount": 1,
    }, None)

    assert first["leasedCount"] == 1
    assert first["desiredCount"] == 1
    assert second["leasedCount"] == 2
    assert second["desiredCount"] == 2
    assert ecs.updates == [1, 2]
    assert set(table.items) >= {"lease#session-a", "lease#session-b"}
    assert table.scan_requests
    assert all(request.get("ConsistentRead") is True for request in table.scan_requests)


def test_release_keeps_remaining_lease_then_scales_to_zero_after_warm_window(
    monkeypatch,
) -> None:
    module, table, ecs = load_capacity_lambda(monkeypatch)
    clock = {"now": 1_000}
    monkeypatch.setattr(module.time, "time", lambda: clock["now"])
    for session_id in ("session-a", "session-b"):
        module.handler({
            "action": "ensure",
            "uploadSessionId": session_id,
            "expiresAtEpoch": 2_000,
        }, None)

    first_release = module.handler({
        "action": "release",
        "uploadSessionId": "session-a",
    }, None)
    assert first_release["leasedCount"] == 1
    assert first_release["desiredCount"] == 1
    assert "lease#session-a" not in table.items

    second_release = module.handler({
        "action": "release",
        "uploadSessionId": "session-b",
    }, None)
    assert second_release["leasedCount"] == 0
    assert second_release["desiredCount"] == 1
    assert table.items["singleton"]["warmUntilEpoch"] == Decimal(1_600)

    clock["now"] = 1_601
    reconciled = module.handler({"action": "reconcile"}, None)
    assert reconciled["desiredCount"] == 0
    assert ecs.desired == 0


def test_expired_leases_do_not_hold_capacity_and_protected_tasks_do(monkeypatch) -> None:
    module, table, ecs = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    table.put_item(Item={
        "id": "lease#expired",
        "expiresAtEpoch": Decimal(999),
    })
    ecs.protected = 2

    reconciled = module.handler({"action": "reconcile"}, None)

    assert reconciled["leasedCount"] == 0
    assert reconciled["protectedCount"] == 2
    assert reconciled["desiredCount"] == 2
