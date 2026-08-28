from __future__ import annotations

import os
import time
from decimal import Decimal
from typing import Any

import boto3

_ecs = boto3.client("ecs")
_table = boto3.resource("dynamodb").Table(os.environ["CAPACITY_TABLE"])
_cluster = os.environ["ECS_CLUSTER"]
_service = os.environ["ECS_SERVICE"]
_maximum = max(1, min(20, int(os.environ.get("MAX_CAPACITY", "20"))))
_warm_seconds = max(0, min(3600, int(os.environ.get("WARM_SECONDS", "600"))))


def _bounded(value: Any) -> int:
    try:
        return max(0, min(_maximum, int(value)))
    except (TypeError, ValueError):
        return 0


def _service_state() -> dict[str, Any]:
    services = _ecs.describe_services(cluster=_cluster, services=[_service]).get(
        "services", []
    )
    if len(services) != 1:
        raise RuntimeError("file upload ECS service is unavailable")
    return services[0]


def _protected_count() -> int:
    task_arns = _ecs.list_tasks(
        cluster=_cluster,
        serviceName=_service,
        desiredStatus="RUNNING",
    ).get("taskArns", [])
    protected = 0
    for offset in range(0, len(task_arns), 10):
        response = _ecs.get_task_protection(
            cluster=_cluster,
            tasks=task_arns[offset : offset + 10],
        )
        protected += sum(
            1 for item in response.get("protectedTasks", [])
            if item.get("protectionEnabled") is True
        )
    return protected


def _warm_until() -> int:
    item = _table.get_item(Key={"id": "singleton"}, ConsistentRead=True).get(
        "Item", {}
    )
    return int(item.get("warmUntilEpoch", 0))


def _set_warm_until(epoch: int) -> None:
    _table.put_item(Item={
        "id": "singleton",
        "warmUntilEpoch": Decimal(epoch),
        "updatedAtEpoch": Decimal(int(time.time())),
    })


def _warm_after_leases(now: int, leases: list[dict[str, Any]]) -> int:
    if not leases:
        return now + _warm_seconds
    latest_expiry = max(int(item.get("expiresAtEpoch", now)) for item in leases)
    return latest_expiry + _warm_seconds


def _lease_key(upload_session_id: str) -> str:
    return f"lease#{upload_session_id}"


def _leases(now: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    # Capacity admission is safety-critical: an eventually consistent scan
    # could miss a lease that was just written by a concurrent session and
    # leave two uploads sharing one single-concurrency receiver.
    scan: dict[str, Any] = {"ConsistentRead": True}
    while True:
        response = _table.scan(**scan)
        items.extend(
            item for item in response.get("Items", [])
            if str(item.get("id", "")).startswith("lease#")
            and int(item.get("expiresAtEpoch", 0)) > now
        )
        key = response.get("LastEvaluatedKey")
        if not key:
            break
        scan = {"ConsistentRead": True, "ExclusiveStartKey": key}
    return items


def _put_lease(upload_session_id: str, expires_at_epoch: int) -> None:
    if not upload_session_id or expires_at_epoch <= int(time.time()):
        raise ValueError("valid upload capacity lease is required")
    _table.put_item(Item={
        "id": _lease_key(upload_session_id),
        "expiresAtEpoch": Decimal(expires_at_epoch),
        "updatedAtEpoch": Decimal(int(time.time())),
    })


def _delete_lease(upload_session_id: str) -> None:
    if upload_session_id:
        _table.delete_item(Key={"id": _lease_key(upload_session_id)})


def _update(desired: int) -> dict[str, Any]:
    service = _service_state()
    current = int(service.get("desiredCount", 0))
    desired = _bounded(desired)
    if desired != current:
        _ecs.update_service(
            cluster=_cluster,
            service=_service,
            desiredCount=desired,
        )
    return {
        "desiredCount": desired,
        "runningCount": int(service.get("runningCount", 0)),
        "pendingCount": int(service.get("pendingCount", 0)),
    }


def handler(event: dict[str, Any] | None, _context: Any) -> dict[str, Any]:
    event = event or {}
    action = str(event.get("action") or "reconcile")
    now = int(time.time())
    if action == "ensure":
        upload_session_id = str(event.get("uploadSessionId") or "")
        expires_at_epoch = int(event.get("expiresAtEpoch") or 0)
        _put_lease(upload_session_id, expires_at_epoch)
        requested = max(1, _bounded(event.get("desiredCount", 1)))
        leases = _leases(now)
        leased = len(leases)
        # Keep one receiver for at most ten minutes after the final unclaimed
        # session expires so its sweeper can atomically expire the DB session,
        # release usage, and prove that no raw source remains.
        _set_warm_until(_warm_after_leases(now, leases))
        return {
            "action": action,
            "leasedCount": leased,
            **_update(max(requested, leased, _protected_count())),
        }
    if action == "release":
        _delete_lease(str(event.get("uploadSessionId") or ""))
        _set_warm_until(_warm_after_leases(now, _leases(now)))
    elif action != "reconcile":
        raise ValueError("unsupported file upload capacity action")
    protected = _protected_count()
    leased = len(_leases(now))
    desired = max(leased, protected, 1 if _warm_until() > now else 0)
    return {
        "action": action,
        "leasedCount": leased,
        "protectedCount": protected,
        **_update(desired),
    }
