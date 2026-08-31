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
        self.get_requests: list[dict] = []

    def get_item(self, *, Key: dict, ConsistentRead: bool = False) -> dict:
        self.get_requests.append({"Key": dict(Key), "ConsistentRead": ConsistentRead})
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
        self.deployments: list[dict] = []

    def describe_services(self, **_kwargs: object) -> dict:
        return {"services": [{
            "desiredCount": self.desired,
            "runningCount": self.running,
            "pendingCount": self.pending,
            "deployments": self.deployments,
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
    # Liveness stays healthy on the busy task. A different free task can admit
    # work without waiting for that busy receiver to fail an ALB health check.
    assert second["leaseState"] == "granted"
    assert second["healthyCount"] == 2
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
def test_safe_fifo_admission_keeps_busy_targets_live_but_never_reclaims_them(
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
            next_grant = module.handler({
                "action": "status",
                "uploadSessionId": next_session_id,
            }, None)
            assert next_grant["leaseState"] == "granted"
            assert next_grant["healthyCount"] == count
            # ALB first-touch can still reach a busy receiver. Its HTTP lock
            # returns 409 before reading bytes; even a direct duplicate task
            # claim cannot consume the next session's one-use capacity grant.
            rejected = module.handler({
                "action": "claim",
                "uploadSessionId": next_session_id,
                "tokenHash": TOKEN_HASH,
                "taskArn": f"task-{index}",
            }, None)
            assert rejected["leaseState"] == "not_granted"

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

    waiting = module.handler({
        "action": "status",
        "uploadSessionId": "session-20",
    }, None)
    assert waiting["leaseState"] == "waiting"
    assert waiting["waitingCount"] == 1
    assert waiting["desiredCount"] == 20
    assert waiting["healthyCount"] == 20
    assert waiting["readyCount"] == 0

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


@pytest.mark.parametrize("count", [2, 5, 20])
def test_terminal_release_keeps_other_claimed_tasks_and_unfinished_cleanup(
    monkeypatch, count: int,
) -> None:
    module, table, ecs, elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    ecs.desired = ecs.running = ecs.task_count = count
    ecs.protected = {f"task-{index}" for index in range(count)}
    elbv2.healthy_ips = {f"10.0.0.{index + 1}" for index in range(count)}
    for index in range(count):
        table.put_item(Item={
            "id": f"lease#session-{index}",
            "uploadSessionId": f"session-{index}",
            "state": "claimed",
            "taskArn": f"task-{index}",
            "expiresAtEpoch": Decimal(2_000),
        })

    # Successful and failed terminal paths both notify release. A released
    # lease is not evidence that its task has finished local source cleanup.
    released = module.handler({
        "action": "release", "uploadSessionId": "session-0",
    }, None)
    assert released["desiredCount"] == count
    assert released["claimedCount"] == count - 1
    assert ecs.updates == []

    ecs.protected.remove("task-0")
    finished = module.handler({"action": "reconcile"}, None)
    assert finished["desiredCount"] == count - 1
    assert finished["protectedCount"] == count - 1
    assert ecs.updates == [count - 1]
    assert {lease["taskArn"] for lease in module._leases(1_000)} == ecs.protected


def test_protected_cleanup_and_an_unassigned_upload_need_separate_capacity(monkeypatch) -> None:
    module, _table, ecs, elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    ecs.desired = ecs.running = ecs.task_count = 1
    ecs.protected = {"task-0"}
    elbv2.healthy_ips = {"10.0.0.1"}

    waiting = ensure(module, "session-next")
    assert waiting["leaseState"] == "waiting"
    assert waiting["desiredCount"] == 2

    ecs.running = ecs.task_count = 2
    elbv2.healthy_ips.add("10.0.0.2")
    granted = module.handler({"action": "status", "uploadSessionId": "session-next"}, None)
    assert granted["leaseState"] == "granted"
    assert granted["desiredCount"] == 2
    assert ecs.updates == [2]


def test_claimed_task_without_confirmed_protection_defers_scale_in(monkeypatch) -> None:
    module, table, ecs, _elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    ecs.desired = ecs.running = ecs.task_count = 2
    table.put_item(Item={
        "id": "lease#still-working", "state": "claimed", "taskArn": "task-1",
        "expiresAtEpoch": Decimal(2_000),
    })

    held = module.handler({"action": "reconcile"}, None)
    assert held["desiredCount"] == 2
    assert ecs.updates == []

    ecs.protected = {"task-1"}
    safe = module.handler({"action": "reconcile"}, None)
    assert safe["desiredCount"] == 1
    assert ecs.updates == [1]


@pytest.mark.parametrize("deployments,pending", [
    ([{"rolloutState": "IN_PROGRESS"}], 0),
    ([{"rolloutState": "FAILED"}], 0),
    ([{"rolloutState": "COMPLETED"}, {"status": "ACTIVE"}], 0),
    ([], 1),
])
def test_service_transition_defers_scale_in(monkeypatch, deployments: list[dict], pending: int):
    module, _table, ecs, _elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    ecs.desired = ecs.running = ecs.task_count = 2
    ecs.protected = {"task-1"}
    ecs.deployments = deployments
    ecs.pending = pending

    held = module.handler({"action": "reconcile"}, None)
    assert held["desiredCount"] == 2
    assert ecs.updates == []

    ecs.deployments = [{"rolloutState": "COMPLETED"}]
    ecs.pending = 0
    assert module.handler({"action": "reconcile"}, None)["desiredCount"] == 1


@pytest.mark.parametrize("action", ["ensure", "status"])
@pytest.mark.parametrize("operation,response", [
    ("get_task_protection", {"protectedTasks": [], "failures": [{"reason": "MISSING"}]}),
    ("get_task_protection", {"protectedTasks": []}),
    ("describe_tasks", {"tasks": [], "failures": [{"reason": "MISSING"}]}),
    ("describe_tasks", {"tasks": []}),
])
def test_partial_task_inventory_cannot_grant_or_scale_in(monkeypatch, action, operation, response):
    module, table, ecs, elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    ecs.desired = ecs.running = ecs.task_count = 2
    elbv2.healthy_ips = {"10.0.0.1", "10.0.0.2"}
    table.put_item(Item={
        "id": "lease#waiting", "state": "waiting", "uploadSessionId": "waiting",
        "expiresAtEpoch": Decimal(2_000), "tokenHash": TOKEN_HASH,
    })
    monkeypatch.setattr(ecs, operation, lambda **_kwargs: response)

    held = ensure(module, "waiting") if action == "ensure" else module.handler({
        "action": "status", "uploadSessionId": "waiting",
    }, None)
    assert held["leaseState"] == "waiting"
    assert held["readyCount"] == 0
    assert held["desiredCount"] == 2
    assert table.items["lease#waiting"]["state"] == "waiting"
    assert ecs.updates == []


def test_missing_listed_tasks_cannot_erase_running_capacity(monkeypatch) -> None:
    module, _table, ecs, _elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    ecs.desired = ecs.running = 2
    ecs.task_count = 0

    held = module.handler({"action": "reconcile"}, None)
    assert held["desiredCount"] == 2
    assert held["readyCount"] == 0
    assert ecs.updates == []


def test_protected_task_without_an_ip_still_holds_cleanup_capacity(monkeypatch) -> None:
    module, _table, ecs, _elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    ecs.desired = ecs.running = ecs.task_count = 2
    ecs.protected = {"task-0", "task-1"}
    monkeypatch.setattr(ecs, "describe_tasks", lambda **_kwargs: {
        "tasks": [{"taskArn": "task-0"}, {"taskArn": "task-1"}],
    })

    held = module.handler({"action": "reconcile"}, None)
    assert held["protectedCount"] == 2
    assert held["desiredCount"] == 2
    assert held["readyCount"] == 0
    assert ecs.updates == []


@pytest.mark.parametrize("busy_state", ["claimed", "protected"])
def test_either_a_claim_or_protection_removes_live_tasks_from_free_slots(
    monkeypatch, busy_state: str,
) -> None:
    module, table, ecs, elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    ecs.desired = ecs.running = ecs.task_count = 1
    elbv2.healthy_ips = {"10.0.0.1"}
    if busy_state == "protected":
        ecs.protected = {"task-0"}
    else:
        table.put_item(Item={
            "id": "lease#busy", "state": "claimed", "taskArn": "task-0",
            "expiresAtEpoch": Decimal(2_000),
        })

    waiting = ensure(module, "next")
    assert waiting["healthyCount"] == 1
    assert waiting["readyCount"] == 0
    assert waiting["leaseState"] == "waiting"


@pytest.mark.parametrize("latest_change", [
    {"desiredCount": 3},
    {"taskDefinition": "new-receiver"},
    {"runningCount": 3},
    {"deployments": [{"rolloutState": "IN_PROGRESS"}]},
])
def test_service_change_before_update_cannot_shrink_from_a_stale_snapshot(
    monkeypatch, latest_change: dict,
) -> None:
    module, _table, ecs, _elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    ecs.desired = ecs.running = ecs.task_count = 2
    ecs.protected = {"task-1"}
    initial = ecs.describe_services()["services"][0]
    states = iter([initial, {**initial, **latest_change}])
    monkeypatch.setattr(ecs, "describe_services", lambda **_kwargs: {"services": [next(states)]})

    held = module.handler({"action": "reconcile"}, None)
    assert held["desiredCount"] == latest_change.get("desiredCount", 2)
    assert ecs.updates == []


OWNER_SESSION = "12345678-1234-4234-8234-123456789abc"
OWNER_TASK = "arn:aws:ecs:ap-northeast-2:123456789012:task/test-cluster/owner-task"


def cleanup_owner_fixture(monkeypatch):
    module, table, ecs, _elbv2 = load_capacity_lambda(monkeypatch)
    monkeypatch.setattr(module.time, "time", lambda: 1_000)
    table.put_item(Item={
        "id": f"lease#{OWNER_SESSION}", "uploadSessionId": OWNER_SESSION,
        "state": "claimed", "taskArn": OWNER_TASK, "expiresAtEpoch": Decimal(2_000),
    })
    response = {"tasks": [{
        "taskArn": OWNER_TASK,
        "clusterArn": "arn:aws:ecs:ap-northeast-2:123456789012:cluster/test-cluster",
        "group": "service:test-service", "lastStatus": "STOPPED",
    }]}
    describe_calls = []

    def describe(**kwargs):
        describe_calls.append(kwargs)
        return response

    monkeypatch.setattr(ecs, "describe_tasks", describe)
    return module, table, ecs, response, describe_calls


def test_cleanup_ownership_only_proves_exact_stopped_owner_without_any_writes(monkeypatch):
    module, table, ecs, _response, calls = cleanup_owner_fixture(monkeypatch)
    before = {key: dict(item) for key, item in table.items.items()}
    result = module.handler({"action": "cleanup_ownership", "uploadSessionId": OWNER_SESSION}, None)

    assert result == {
        "action": "cleanup_ownership", "uploadSessionId": OWNER_SESSION,
        "ownerStopped": True, "taskArn": OWNER_TASK,
    }
    assert calls == [{"cluster": "test-cluster", "tasks": [OWNER_TASK]}]
    assert table.get_requests == [
        {"Key": {"id": f"lease#{OWNER_SESSION}"}, "ConsistentRead": True},
        {"Key": {"id": f"lease#{OWNER_SESSION}"}, "ConsistentRead": True},
    ]
    assert table.items == before
    assert table.scan_requests == []
    assert ecs.updates == []


@pytest.mark.parametrize(
    "status", ["RUNNING", "PENDING", "STOPPING", "DEACTIVATING", "UNKNOWN", None]
)
def test_cleanup_ownership_never_reclaims_live_or_ambiguous_owner(monkeypatch, status):
    module, table, ecs, response, _calls = cleanup_owner_fixture(monkeypatch)
    response["tasks"][0]["lastStatus"] = status
    result = module.handler({"action": "cleanup_ownership", "uploadSessionId": OWNER_SESSION}, None)
    assert result["ownerStopped"] is False
    assert "taskArn" not in result
    assert len(table.get_requests) == 1
    assert ecs.updates == []


@pytest.mark.parametrize("change", [
    {"state": "waiting"}, {"state": "granted"}, {"state": "released"},
    {"expiresAtEpoch": Decimal(999)}, {"expiresAtEpoch": Decimal(1_000)},
    {"uploadSessionId": "different-session"}, {"taskArn": ""},
    {"taskArn": OWNER_TASK.replace("test-cluster", "other-cluster")},
])
def test_cleanup_ownership_requires_unexpired_claimed_owner_binding(monkeypatch, change):
    module, table, ecs, _response, calls = cleanup_owner_fixture(monkeypatch)
    table.items[f"lease#{OWNER_SESSION}"].update(change)
    result = module.handler({"action": "cleanup_ownership", "uploadSessionId": OWNER_SESSION}, None)
    assert result["ownerStopped"] is False
    assert calls == []
    assert ecs.updates == []


@pytest.mark.parametrize(
    "case", ["missing-lease", "missing-task", "failure", "owner", "cluster", "service"]
)
def test_cleanup_ownership_fails_closed_on_missing_or_different_evidence(monkeypatch, case):
    module, table, ecs, response, _calls = cleanup_owner_fixture(monkeypatch)
    if case == "missing-lease":
        table.items.clear()
    elif case == "missing-task":
        response["tasks"] = []
    elif case == "failure":
        response["failures"] = [{"reason": "MISSING"}]
    elif case == "owner":
        response["tasks"][0]["taskArn"] = OWNER_TASK + "-other"
    elif case == "cluster":
        response["tasks"][0]["clusterArn"] = "another-cluster"
    else:
        response["tasks"][0]["group"] = "service:other-service"
    result = module.handler({"action": "cleanup_ownership", "uploadSessionId": OWNER_SESSION}, None)
    assert result["ownerStopped"] is False
    assert table.scan_requests == []
    assert ecs.updates == []


@pytest.mark.parametrize("mutation", ["owner", "released", "expired", "missing", "read-error"])
def test_cleanup_ownership_rechecks_binding_after_stopped_observation(monkeypatch, mutation):
    module, table, ecs, response, _calls = cleanup_owner_fixture(monkeypatch)

    def describe(**_kwargs):
        if mutation == "read-error":
            raise RuntimeError("read unavailable")
        if mutation == "missing":
            table.items.clear()
        elif mutation == "owner":
            table.items[f"lease#{OWNER_SESSION}"]["taskArn"] += "-new"
        elif mutation == "released":
            table.items[f"lease#{OWNER_SESSION}"]["state"] = "released"
        else:
            monkeypatch.setattr(module.time, "time", lambda: 2_001)
        return response

    monkeypatch.setattr(ecs, "describe_tasks", describe)
    result = module.handler({"action": "cleanup_ownership", "uploadSessionId": OWNER_SESSION}, None)
    assert result["ownerStopped"] is False
    assert ecs.updates == []


def test_cleanup_owner_guard_filters_a_candidate_batch_without_reconciliation(monkeypatch):
    module, table, ecs, _response, calls = cleanup_owner_fixture(monkeypatch)
    missing = "12345678-1234-4234-8234-123456789abd"
    before = {key: dict(item) for key, item in table.items.items()}
    verified = [session_id for session_id in (missing, OWNER_SESSION, "not-a-uuid")
                if module.handler({
                    "action": "cleanup_ownership", "uploadSessionId": session_id,
                }, None)["ownerStopped"]]
    assert verified == [OWNER_SESSION]
    assert len(calls) == 1
    assert table.items == before
    assert table.scan_requests == []
    assert ecs.updates == []
