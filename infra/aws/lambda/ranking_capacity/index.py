"""Single isolated ECS ranking service, warm only while requested/active."""

import os
import time

import boto3


def handler(event, _context):
    ecs = boto3.client("ecs")
    elb = boto3.client("elbv2")
    table = boto3.resource("dynamodb").Table(os.environ["LEASE_TABLE"])
    cluster, service = os.environ["CLUSTER"], os.environ["SERVICE"]
    now = int(time.time())
    action = event.get("action", "sweep")
    if action not in {"wake", "heartbeat", "sweep"}:
        raise ValueError("unsupported ranking action")
    if action in {"wake", "heartbeat"}:
        table.put_item(Item={"id": "runtime", "leaseUntil": now + 900})
    lease = table.get_item(Key={"id": "runtime"}, ConsistentRead=True).get("Item", {})
    wanted = 1 if int(lease.get("leaseUntil", 0)) > now else 0
    result = ecs.describe_services(cluster=cluster, services=[service])
    if result.get("failures") or len(result.get("services", [])) != 1:
        raise RuntimeError("ranking service unavailable")
    actual = result["services"][0]
    if actual["desiredCount"] != wanted:
        ecs.update_service(cluster=cluster, service=service, desiredCount=wanted)
    ready = False
    if wanted and actual["runningCount"] == 1 and actual["pendingCount"] == 0:
        targets = elb.describe_target_health(
            TargetGroupArn=os.environ["TARGET_GROUP_ARN"]
        )
        ready = (
            sum(
                t["TargetHealth"]["State"] == "healthy"
                for t in targets["TargetHealthDescriptions"]
            )
            == 1
        )
    return {"ok": True, "ready": ready, "desiredCount": wanted}
