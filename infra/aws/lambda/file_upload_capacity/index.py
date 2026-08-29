from __future__ import annotations

import os
import time
from decimal import Decimal
from typing import Any

import boto3

_ecs = boto3.client("ecs")
_elbv2 = boto3.client("elbv2")
_table = boto3.resource("dynamodb").Table(os.environ["CAPACITY_TABLE"])
_cluster = os.environ["ECS_CLUSTER"]
_service = os.environ["ECS_SERVICE"]
_target_group_arn = os.environ["TARGET_GROUP_ARN"]
_maximum = max(1, min(20, int(os.environ.get("MAX_CAPACITY", "20"))))
_warm_seconds = max(0, min(3600, int(os.environ.get("WARM_SECONDS", "600"))))
_upload_window_seconds = max(
    60, min(1800, int(os.environ.get("UPLOAD_WINDOW_SECONDS", "900")))
)
_claimed_lease_seconds = max(
    900, min(21600, int(os.environ.get("CLAIMED_LEASE_SECONDS", "21600")))
)


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


def _task_arns() -> list[str]:
    return list(_ecs.list_tasks(
        cluster=_cluster,
        serviceName=_service,
        desiredStatus="RUNNING",
    ).get("taskArns", []))


def _task_inventory() -> dict[str, dict[str, Any]]:
    task_arns = _task_arns()
    if not task_arns:
        return {}
    protection: dict[str, bool] = {}
    for offset in range(0, len(task_arns), 10):
        response = _ecs.get_task_protection(
            cluster=_cluster,
            tasks=task_arns[offset : offset + 10],
        )
        protection.update({
            str(item.get("taskArn") or ""): item.get("protectionEnabled") is True
            for item in response.get("protectedTasks", [])
        })
    described: list[dict[str, Any]] = []
    for offset in range(0, len(task_arns), 100):
        described.extend(_ecs.describe_tasks(
            cluster=_cluster,
            tasks=task_arns[offset : offset + 100],
        ).get("tasks", []))
    inventory: dict[str, dict[str, Any]] = {}
    for task in described:
        task_arn = str(task.get("taskArn") or "")
        private_ip = ""
        for attachment in task.get("attachments", []):
            for detail in attachment.get("details", []):
                if detail.get("name") == "privateIPv4Address":
                    private_ip = str(detail.get("value") or "")
        if task_arn and private_ip:
            inventory[task_arn] = {
                "privateIp": private_ip,
                "protected": protection.get(task_arn, False),
            }
    return inventory


def _healthy_target_ips() -> set[str]:
    response = _elbv2.describe_target_health(TargetGroupArn=_target_group_arn)
    return {
        str(item.get("Target", {}).get("Id") or "")
        for item in response.get("TargetHealthDescriptions", [])
        if item.get("TargetHealth", {}).get("State") == "healthy"
    }


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


def _put_lease(
    upload_session_id: str,
    expires_at_epoch: int,
    token_hash: str,
    now: int,
) -> dict[str, Any]:
    if not upload_session_id or expires_at_epoch <= now or len(token_hash) != 64:
        raise ValueError("valid upload capacity lease is required")
    key = {"id": _lease_key(upload_session_id)}
    existing = _table.get_item(Key=key, ConsistentRead=True).get("Item", {})
    if existing and int(existing.get("expiresAtEpoch", 0)) > now:
        if str(existing.get("tokenHash") or "") != token_hash:
            raise ValueError("upload capacity lease token does not match")
        return dict(existing)
    item = {
        **key,
        "uploadSessionId": upload_session_id,
        "state": "waiting",
        "tokenHash": token_hash,
        "createdAtEpoch": Decimal(now),
        # The coordinator is single-concurrency, so this high-resolution
        # timestamp preserves FIFO when requests arrive within one second.
        "createdAtOrdinal": Decimal(time.time_ns()),
        "expiresAtEpoch": Decimal(expires_at_epoch),
        "updatedAtEpoch": Decimal(now),
    }
    _table.put_item(Item=item)
    return item


def _put_updated_lease(item: dict[str, Any], now: int) -> None:
    item["updatedAtEpoch"] = Decimal(now)
    _table.put_item(Item=item)


def _delete_lease(upload_session_id: str) -> None:
    if upload_session_id:
        _table.delete_item(Key={"id": _lease_key(upload_session_id)})


def _update(desired: int, service: dict[str, Any] | None = None) -> dict[str, Any]:
    service = service or _service_state()
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


def _reconcile(now: int, *, grant_waiting: bool = False) -> dict[str, Any]:
    leases = _leases(now)
    service = _service_state()
    inventory = _task_inventory()
    healthy_ips = _healthy_target_ips()
    claimed_task_arns = {
        str(item.get("taskArn") or "")
        for item in leases
        if item.get("state") == "claimed" and item.get("taskArn")
    }
    protected_task_arns = {
        task_arn
        for task_arn, item in inventory.items()
        if item.get("protected") is True
    }
    healthy_task_arns = {
        task_arn
        for task_arn, item in inventory.items()
        if item.get("privateIp") in healthy_ips
    }
    ready_task_count = len(
        healthy_task_arns - claimed_task_arns - protected_task_arns
    )
    granted = [item for item in leases if item.get("state") == "granted"]
    waiting = sorted(
        (item for item in leases if item.get("state") == "waiting"),
        key=lambda item: (
            int(item.get("createdAtOrdinal", item.get("createdAtEpoch", 0))),
            str(item.get("uploadSessionId") or ""),
        ),
    )
    grant_count = (
        max(0, min(len(waiting), ready_task_count - len(granted)))
        if grant_waiting
        else 0
    )
    for item in waiting[:grant_count]:
        grant_expires = now + _upload_window_seconds
        item["state"] = "granted"
        item["grantedAtEpoch"] = Decimal(now)
        item["grantExpiresAtEpoch"] = Decimal(grant_expires)
        item["expiresAtEpoch"] = Decimal(grant_expires)
        _put_updated_lease(item, now)
    if grant_count:
        leases = _leases(now)
        granted = [item for item in leases if item.get("state") == "granted"]
        waiting = [item for item in leases if item.get("state") == "waiting"]
    protected_count = len(protected_task_arns)
    leased_count = len(leases)
    desired = max(
        min(leased_count, _maximum),
        protected_count,
        1 if _warm_until() > now else 0,
    )
    return {
        "leasedCount": leased_count,
        "waitingCount": len(waiting),
        "grantedCount": len(granted),
        "claimedCount": sum(1 for item in leases if item.get("state") == "claimed"),
        "protectedCount": protected_count,
        "healthyCount": len(healthy_task_arns),
        "readyCount": max(0, ready_task_count - len(granted)),
        "startingCount": max(
            0,
            int(service.get("pendingCount", 0))
            + int(service.get("runningCount", 0))
            - len(healthy_task_arns),
        ),
        **_update(desired, service),
    }


def _lease_status(upload_session_id: str, now: int) -> dict[str, Any]:
    item = _table.get_item(
        Key={"id": _lease_key(upload_session_id)}, ConsistentRead=True
    ).get("Item", {})
    if not item or int(item.get("expiresAtEpoch", 0)) <= now:
        return {"leaseState": "expired"}
    result: dict[str, Any] = {"leaseState": str(item.get("state") or "waiting")}
    if item.get("grantedAtEpoch") is not None:
        result["grantedAtEpoch"] = int(item["grantedAtEpoch"])
    if item.get("grantExpiresAtEpoch") is not None:
        result["grantExpiresAtEpoch"] = int(item["grantExpiresAtEpoch"])
    return result


def handler(event: dict[str, Any] | None, _context: Any) -> dict[str, Any]:
    event = event or {}
    action = str(event.get("action") or "reconcile")
    now = int(time.time())
    if action == "ensure":
        upload_session_id = str(event.get("uploadSessionId") or "")
        expires_at_epoch = int(event.get("expiresAtEpoch") or 0)
        token_hash = str(event.get("tokenHash") or "").lower()
        _put_lease(upload_session_id, expires_at_epoch, token_hash, now)
        requested = max(1, _bounded(event.get("desiredCount", 1)))
        leases = _leases(now)
        _set_warm_until(_warm_after_leases(now, leases))
        state = _reconcile(now, grant_waiting=True)
        state.update(_lease_status(upload_session_id, now))
        if state["desiredCount"] < requested:
            state.update(_update(requested))
        return {"action": action, **state}
    if action == "status":
        upload_session_id = str(event.get("uploadSessionId") or "")
        return {
            "action": action,
            **_reconcile(now, grant_waiting=True),
            **_lease_status(upload_session_id, now),
        }
    if action == "claim":
        upload_session_id = str(event.get("uploadSessionId") or "")
        token_hash = str(event.get("tokenHash") or "").lower()
        task_arn = str(event.get("taskArn") or "")
        item = _table.get_item(
            Key={"id": _lease_key(upload_session_id)}, ConsistentRead=True
        ).get("Item", {})
        active_leases = _leases(now)
        task_is_running = task_arn in set(_task_arns())
        task_is_already_claimed = any(
            lease.get("state") == "claimed"
            and lease.get("taskArn") == task_arn
            and lease.get("uploadSessionId") != upload_session_id
            for lease in active_leases
        )
        if (
            item.get("state") == "claimed"
            and str(item.get("tokenHash") or "") == token_hash
            and item.get("taskArn") == task_arn
            and int(item.get("expiresAtEpoch", 0)) > now
            and task_is_running
        ):
            return {"action": action, "leaseState": "claimed"}
        if (
            item.get("state") != "granted"
            or str(item.get("tokenHash") or "") != token_hash
            or int(item.get("grantExpiresAtEpoch", 0)) <= now
            or not task_arn
            or not task_is_running
            or task_is_already_claimed
        ):
            return {"action": action, "leaseState": "not_granted"}
        item["state"] = "claimed"
        item["taskArn"] = task_arn
        item["claimedAtEpoch"] = Decimal(now)
        item["expiresAtEpoch"] = Decimal(now + _claimed_lease_seconds)
        _put_updated_lease(item, now)
        return {"action": action, "leaseState": "claimed"}
    if action == "release":
        _delete_lease(str(event.get("uploadSessionId") or ""))
        _set_warm_until(_warm_after_leases(now, _leases(now)))
    elif action != "reconcile":
        raise ValueError("unsupported file upload capacity action")
    return {"action": action, **_reconcile(now)}
