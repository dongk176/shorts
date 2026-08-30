from __future__ import annotations

import importlib.util
import sys
import types
from decimal import Decimal
from pathlib import Path

import pytest

TOKEN_HASH = "a" * 64


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
        self.task_count = 0
        self.protected: set[str] = set()
        self.updates: list[int] = []

    def describe_services(self, **_kwargs: object) -> dict:
        return {"services": [{
            "desiredCount": self.desired,
            "runningCount": self.running,
            "pendingCount": self.pending,
        }]}

    def list_tasks(self, **_kwargs: object) -> dict:
        return {"taskArns": [f"task-{index}" for index in range(self.task_count)]}

    def get_task_protection(self, *, tasks: list[str], **_kwargs: object) -> dict:
        return {"protectedTasks": [
            {"taskArn": task, "protectionEnabled": task in self.protected}
            for task in tasks
        ]}

    def describe_tasks(self, *, tasks: list[str], **_kwargs: object) -> dict:
        return {"tasks": [
            {
                "taskArn": task,
                "attachments": [{"details": [{
                    "name": "privateIPv4Address",
                    "value": f"10.0.0.{int(task.split('-')[-1]) + 1}",
                }]}],
            }
            for task in tasks
        ]}

    def update_service(self, *, desiredCount: int, **_kwargs: object) -> None:
        self.desired = desiredCount
        self.updates.append(desiredCount)


class FakeElbv2:
    def __init__(self) -> None:
        self.healthy_ips: set[str] = set()

    def describe_target_health(self, **_kwargs: object) -> dict:
        return {"TargetHealthDescriptions": [
            {
                "Target": {"Id": address},
                "TargetHealth": {"State": "healthy"},
            }
            for address in sorted(self.healthy_ips)
        ]}


def load_capacity_lambda(monkeypatch):
    table = FakeTable()
    ecs = FakeEcs()
    elbv2 = FakeElbv2()

    def client(name: str):
        if name == "ecs":
            return ecs
        if name == "elbv2":
            return elbv2
        raise AssertionError(name)

    fake_boto3 = types.SimpleNamespace(
        client=client,
        resource=lambda name: types.SimpleNamespace(Table=lambda _name: table),
    )
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)
    monkeypatch.setenv("CAPACITY_TABLE", "test-capacity")
    monkeypatch.setenv("ECS_CLUSTER", "test-cluster")
    monkeypatch.setenv("ECS_SERVICE", "test-service")
    monkeypatch.setenv("TARGET_GROUP_ARN", "test-target-group")
    monkeypatch.setenv("MAX_CAPACITY", "20")
    monkeypatch.setenv("WARM_SECONDS", "600")
    monkeypatch.setenv("UPLOAD_WINDOW_SECONDS", "900")

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
    return module, table, ecs, elbv2


def ensure(module, session_id: str, expires_at: int = 2_000) -> dict:
    return module.handler({
        "action": "ensure",
        "uploadSessionId": session_id,
        "expiresAtEpoch": expires_at,
        "desiredCount": 1,
        "tokenHash": TOKEN_HASH,
    }, None)


def test_each_session_scales_capacity_but_waits_for_a_healthy_empty_task(
    monkeypatch,
) -> None:
    module, table, ecs, _elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)

    first = ensure(module, "session-a")
    second = ensure(module, "session-b")

    assert first["leaseState"] == "waiting"
    assert first["desiredCount"] == 1
    assert second["leaseState"] == "waiting"
    assert second["desiredCount"] == 2
    assert second["readyCount"] == 0
    assert ecs.updates == [1, 2]
    assert set(table.items) >= {"lease#session-a", "lease#session-b"}
    assert all(request.get("ConsistentRead") is True for request in table.scan_requests)


def test_fifo_grants_only_real_healthy_free_tasks_and_claim_binds_one_task(
    monkeypatch,
) -> None:
    module, _table, ecs, elbv2 = load_capacity_lambda(monkeypatch)
    clock = {"now": 1_000}
    monkeypatch.setattr(module.time, "time", lambda: clock["now"])
    ensure(module, "session-a")
    clock["now"] += 1
    ensure(module, "session-b")

    ecs.task_count = ecs.running = 1
    elbv2.healthy_ips = {"10.0.0.1"}
    first = module.handler({"action": "status", "uploadSessionId": "session-a"}, None)
    second = module.handler({"action": "status", "uploadSessionId": "session-b"}, None)

    assert first["leaseState"] == "granted"
    assert first["grantedAtEpoch"] == 1_001
    assert first["grantExpiresAtEpoch"] == 1_901
    assert second["leaseState"] == "waiting"
    claimed = module.handler({
        "action": "claim",
        "uploadSessionId": "session-a",
        "tokenHash": TOKEN_HASH,
        "taskArn": "task-0",
    }, None)
    assert claimed["leaseState"] == "claimed"

    ecs.task_count = ecs.running = 2
    ecs.protected = {"task-0"}
    elbv2.healthy_ips.add("10.0.0.2")
    second = module.handler({"action": "status", "uploadSessionId": "session-b"}, None)
    assert second["leaseState"] == "waiting"
    assert second["readyCount"] == 0

    # ALB needs two failed readiness probes before the claimed target is no
    # longer routable.  Only then may the next browser start sending bytes.
    elbv2.healthy_ips.remove("10.0.0.1")
    second = module.handler({"action": "status", "uploadSessionId": "session-b"}, None)
    assert second["leaseState"] == "granted"
    assert second["readyCount"] == 0


def test_claim_rejects_wrong_token(monkeypatch) -> None:
    module, _table, ecs, elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    ensure(module, "session-a")
    ecs.task_count = ecs.running = 1
    elbv2.healthy_ips = {"10.0.0.1"}
    module.handler({"action": "status", "uploadSessionId": "session-a"}, None)

    denied = module.handler({
        "action": "claim",
        "uploadSessionId": "session-a",
        "tokenHash": "b" * 64,
        "taskArn": "task-0",
    }, None)
    assert denied["leaseState"] == "not_granted"

    wrong_task = module.handler({
        "action": "claim",
        "uploadSessionId": "session-a",
        "tokenHash": TOKEN_HASH,
        "taskArn": "task-not-in-service",
    }, None)
    assert wrong_task["leaseState"] == "not_granted"


@pytest.mark.parametrize("count", [5, 20])
def test_safe_fifo_admission_waits_for_each_busy_target_to_leave_alb(
    monkeypatch,
    count: int,
) -> None:
    module, _table, ecs, elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    for index in range(count):
        ensure(module, f"session-{index:02d}")
    ecs.task_count = ecs.running = count
    elbv2.healthy_ips = {f"10.0.0.{index}" for index in range(1, count + 1)}

    for index in range(count):
        session_id = f"session-{index:02d}"
        state = module.handler({
            "action": "status",
            "uploadSessionId": session_id,
        }, None)
        assert state["leaseState"] == "granted"
        assert state["grantedCount"] == 1

        claimed = module.handler({
            "action": "claim",
            "uploadSessionId": session_id,
            "tokenHash": TOKEN_HASH,
            "taskArn": f"task-{index}",
        }, None)
        assert claimed["leaseState"] == "claimed"
        ecs.protected.add(f"task-{index}")

        if index + 1 < count:
            next_session_id = f"session-{index + 1:02d}"
            blocked = module.handler({
                "action": "status",
                "uploadSessionId": next_session_id,
            }, None)
            assert blocked["leaseState"] == "waiting"
            elbv2.healthy_ips.remove(f"10.0.0.{index + 1}")

    final = module.handler({
        "action": "status",
        "uploadSessionId": f"session-{count - 1:02d}",
    }, None)
    assert final["claimedCount"] == count
    assert final["grantedCount"] == 0
    assert final["waitingCount"] == 0
    assert final["desiredCount"] == count


def test_twenty_first_session_waits_until_a_released_task_is_ready_again(
    monkeypatch,
) -> None:
    module, _table, ecs, elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    for index in range(21):
        ensure(module, f"session-{index:02d}")
    ecs.task_count = ecs.running = 20
    elbv2.healthy_ips = {f"10.0.0.{index}" for index in range(1, 21)}

    for index in range(20):
        session_id = f"session-{index:02d}"
        state = module.handler({
            "action": "status",
            "uploadSessionId": session_id,
        }, None)
        assert state["leaseState"] == "granted"
        claimed = module.handler({
            "action": "claim",
            "uploadSessionId": session_id,
            "tokenHash": TOKEN_HASH,
            "taskArn": f"task-{index}",
        }, None)
        assert claimed["leaseState"] == "claimed"
        ecs.protected.add(f"task-{index}")
        elbv2.healthy_ips.remove(f"10.0.0.{index + 1}")

    waiting = module.handler({
        "action": "status",
        "uploadSessionId": "session-20",
    }, None)
    assert waiting["leaseState"] == "waiting"
    assert waiting["waitingCount"] == 1
    assert waiting["desiredCount"] == 20

    module.handler({
        "action": "release",
        "uploadSessionId": "session-00",
    }, None)
    ecs.protected.remove("task-0")
    elbv2.healthy_ips.add("10.0.0.1")
    granted = module.handler({
        "action": "status",
        "uploadSessionId": "session-20",
    }, None)
    assert granted["leaseState"] == "granted"
    reused = module.handler({
        "action": "claim",
        "uploadSessionId": "session-20",
        "tokenHash": TOKEN_HASH,
        "taskArn": "task-0",
    }, None)
    assert reused["leaseState"] == "claimed"

    active = [
        item for item in module._leases(1_000)
        if item.get("state") == "claimed"
    ]
    assert len(active) == 20
    assert len({item["taskArn"] for item in active}) == 20


def test_releasing_an_unclaimed_grant_unblocks_the_next_fifo_session(
    monkeypatch,
) -> None:
    module, table, ecs, elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    ensure(module, "session-a")
    ensure(module, "session-b")
    ecs.task_count = ecs.running = 1
    elbv2.healthy_ips = {"10.0.0.1"}

    first = module.handler({"action": "status", "uploadSessionId": "session-a"}, None)
    assert first["leaseState"] == "granted"
    blocked = module.handler({"action": "status", "uploadSessionId": "session-b"}, None)
    assert blocked["leaseState"] == "waiting"

    module.handler({"action": "release", "uploadSessionId": "session-a"}, None)
    second = module.handler({"action": "status", "uploadSessionId": "session-b"}, None)
    assert second["leaseState"] == "granted"
    assert "lease#session-a" not in table.items



def test_release_keeps_remaining_lease_then_scales_to_zero_after_warm_window(
    monkeypatch,
) -> None:
    module, table, ecs, _elbv2 = load_capacity_lambda(monkeypatch)
    clock = {"now": 1_000}
    monkeypatch.setattr(module.time, "time", lambda: clock["now"])
    for session_id in ("session-a", "session-b"):
        ensure(module, session_id)

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
    module, table, ecs, _elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    table.put_item(Item={
        "id": "lease#expired",
        "expiresAtEpoch": Decimal(999),
    })
    ecs.task_count = ecs.running = 2
    ecs.protected = {"task-0", "task-1"}

    reconciled = module.handler({"action": "reconcile"}, None)

    assert reconciled["leasedCount"] == 0
    assert reconciled["protectedCount"] == 2
    assert reconciled["desiredCount"] == 2
