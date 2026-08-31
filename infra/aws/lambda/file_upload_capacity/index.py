from __future__ import annotations

import os
import time
from decimal import Decimal
from typing import Any
from uuid import UUID

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


def _task_inventory() -> tuple[dict[str, dict[str, Any]], bool]:
    task_arns = _task_arns()
    if not task_arns:
        return {}, True
    complete = True
    protection: dict[str, bool] = {}
    for offset in range(0, len(task_arns), 10):
        requested = task_arns[offset : offset + 10]
        response = _ecs.get_task_protection(
            cluster=_cluster,
            tasks=requested,
        )
        returned = {
            str(item.get("taskArn") or ""): item.get("protectionEnabled") is True
            for item in response.get("protectedTasks", [])
            if isinstance(item.get("protectionEnabled"), bool)
        }
        if response.get("failures") or set(returned) != set(requested):
            complete = False
        protection.update(returned)
    described: list[dict[str, Any]] = []
    for offset in range(0, len(task_arns), 100):
        requested = task_arns[offset : offset + 100]
        response = _ecs.describe_tasks(
            cluster=_cluster,
            tasks=requested,
        )
        tasks = response.get("tasks", [])
        if response.get("failures") or {
            str(task.get("taskArn") or "") for task in tasks
        } != set(requested):
            complete = False
        described.extend(tasks)
    inventory: dict[str, dict[str, Any]] = {
        task_arn: {"privateIp": "", "protected": protection.get(task_arn, False)}
        for task_arn in task_arns
    }
    for task in described:
        task_arn = str(task.get("taskArn") or "")
        private_ip = ""
        for attachment in task.get("attachments", []):
            for detail in attachment.get("details", []):
                if detail.get("name") == "privateIPv4Address":
                    private_ip = str(detail.get("value") or "")
        if task_arn in inventory:
            inventory[task_arn]["privateIp"] = private_ip
    # Missing protection is unknown, not evidence of an idle task. Preserve
    # known capacity and let the waiting browser poll again instead of failing
    # its upload session on an eventually consistent AWS inventory response.
    return inventory, complete


def _healthy_target_ips() -> set[str]:
    response = _elbv2.describe_target_health(TargetGroupArn=_target_group_arn)
    return {
        str(item.get("Target", {}).get("Id") or "")
        for item in response.get("TargetHealthDescriptions", [])
        if item.get("TargetHealth", {}).get("State") == "healthy"
        and item.get("Target", {}).get("Id")
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


def _service_transitioning(service: dict[str, Any]) -> bool:
    deployments = service.get("deployments", [])
    return (
        int(service.get("pendingCount", 0)) > 0
        or len(deployments) > 1
        or any(item.get("rolloutState") in {"IN_PROGRESS", "FAILED"} for item in deployments)
    )


def _update(desired: int, service: dict[str, Any] | None = None) -> dict[str, Any]:
    service = service or _service_state()
    current = int(service.get("desiredCount", 0))
    desired = _bounded(desired)
    if desired != current:
        latest = _service_state()
        latest_current = int(latest.get("desiredCount", 0))
        # Do not turn a stale reconciliation into scale-in during a deployment
        # or while another controller is changing the service's capacity.
        if desired < latest_current and (
            latest_current != current
            or latest.get("taskDefinition") != service.get("taskDefinition")
            or latest.get("runningCount") != service.get("runningCount")
            or _service_transitioning(latest)
        ):
            desired = latest_current
        service = latest
        if desired != latest_current:
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
    inventory, inventory_complete = _task_inventory()
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
    inventory_complete = (
        inventory_complete and len(inventory) >= int(service.get("runningCount", 0))
    )
    # ALB /livez stays healthy while a receiver is busy. A request may first
    # reach that task, which returns 409 before reading bytes or claiming the
    # bearer. The browser retries only while the session remains unclaimed.
    # Admission is single-flight and requires a known healthy, unclaimed slot;
    # it does not promise that the ALB's first HTTP target is that idle task.
    granted = [item for item in leases if item.get("state") == "granted"]
    waiting = sorted(
        (item for item in leases if item.get("state") == "waiting"),
        key=lambda item: (
            int(item.get("createdAtOrdinal", item.get("createdAtEpoch", 0))),
            str(item.get("uploadSessionId") or ""),
        ),
    )
    grant_count = int(
        grant_waiting
        and bool(waiting)
        and ready_task_count > 0
        and not granted
        and inventory_complete
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
    admission_ready_count = int(
        ready_task_count > 0
        and not granted
        and inventory_complete
    )
    # A task can still be protected for cleanup after its lease expires or is
    # released. Count those tasks separately from unassigned upload leases.
    unassigned_count = sum(
        1 for item in leases
        if item.get("state") != "claimed" or not item.get("taskArn")
    )
    desired = max(
        min(unassigned_count + len(claimed_task_arns | protected_task_arns), _maximum),
        protected_count,
        1 if _warm_until() > now else 0,
    )
    current = int(service.get("desiredCount", 0))
    if desired < current and (
        claimed_task_arns - protected_task_arns
        or not inventory_complete
        or _service_transitioning(service)
    ):
        # A claimed but not observably protected task must never become the
        # scheduler's arbitrary scale-in victim when a different task finishes.
        desired = current
    return {
        "leasedCount": leased_count,
        "waitingCount": len(waiting),
        "grantedCount": len(granted),
        "claimedCount": sum(1 for item in leases if item.get("state") == "claimed"),
        "protectedCount": protected_count,
        "healthyCount": len(healthy_task_arns),
        # This is single-flight admission capacity, not the healthy-target
        # count: a live target may still be claimed, protected, or unknown.
        "readyCount": admission_ready_count,
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


def _cleanup_ownership(upload_session_id: str, now: int) -> dict[str, Any]:
    result: dict[str, Any] = {
        "action": "cleanup_ownership",
        "uploadSessionId": upload_session_id,
        "ownerStopped": False,
    }
    try:
        if str(UUID(upload_session_id)) != upload_session_id:
            return result
        key = {"id": _lease_key(upload_session_id)}
        lease = _table.get_item(Key=key, ConsistentRead=True).get("Item", {})
        if (
            lease.get("uploadSessionId") != upload_session_id
            or lease.get("state") != "claimed"
            or int(lease.get("expiresAtEpoch", 0)) <= now
        ):
            return result
        task_arn = str(lease.get("taskArn") or "")
        owner_prefix, separator, task_resource = task_arn.partition(":task/")
        cluster_name = _cluster.rsplit("/", 1)[-1]
        if (
            not separator
            or not owner_prefix.startswith("arn:aws:ecs:")
            or not task_resource.startswith(f"{cluster_name}/")
            or len(task_resource.split("/")) != 2
        ):
            return result
        response = _ecs.describe_tasks(cluster=_cluster, tasks=[task_arn])
        tasks = response.get("tasks", [])
        if response.get("failures") or len(tasks) != 1:
            return result
        task = tasks[0]
        if (
            task.get("taskArn") != task_arn
            or task.get("clusterArn") != f"{owner_prefix}:cluster/{cluster_name}"
            or task.get("group") != f"service:{_service.rsplit('/', 1)[-1]}"
            or task.get("lastStatus") != "STOPPED"
        ):
            return result
        # A stale DB heartbeat or expired/missing lease is never proof that a
        # different receiver has stopped. Re-read the exact owner binding after
        # DescribeTasks before permitting the repository's conditional reclaim.
        current = _table.get_item(Key=key, ConsistentRead=True).get("Item", {})
        if current != lease or int(current.get("expiresAtEpoch", 0)) <= int(time.time()):
            return result
        result.update(ownerStopped=True, taskArn=task_arn)
    except Exception:  # noqa: BLE001 - uncertain ownership must always fail closed
        # This guard is read-only and fail-closed, including transient AWS reads.
        # Do not log bearer/lease contents or turn uncertainty into reclamation.
        return result
    return result


def handler(event: dict[str, Any] | None, _context: Any) -> dict[str, Any]:
    event = event or {}
    action = str(event.get("action") or "reconcile")
    now = int(time.time())
    if action == "cleanup_ownership":
        return _cleanup_ownership(str(event.get("uploadSessionId") or ""), now)
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
