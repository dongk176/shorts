"""Single isolated ECS ranking service, warm only while requested/active."""

import ipaddress
import json
import os
import re
import time
from urllib.parse import urlsplit

import boto3


def proxy_registry():
    """Read current routing only; never wake ECS or return other runtime secrets."""
    arn = os.environ.get("PROXY_REGISTRY_SECRET_ARN", "")
    if not re.fullmatch(
        r"arn:aws:secretsmanager:ap-northeast-2:181651591905:secret:"
        r"shorts-mvp/production/worker-runtime-[A-Za-z0-9]{6}",
        arn,
    ):
        raise ValueError("Invalid production proxy registry")
    try:
        value = boto3.client("secretsmanager").get_secret_value(SecretId=arn)
        secret = json.loads(value["SecretString"])
        rows = json.loads(secret["INGESTION_PROXY_ROUTES_JSON"])
        if not isinstance(rows, list) or not 1 <= len(rows) <= 32:
            raise ValueError()
        routes, ids, endpoints = [], set(), set()
        for row in rows:
            if row.get("egress_class") != "webshare_isp":
                continue
            rid, proxy = row["id"], row["proxy_url"]
            parsed = urlsplit(proxy)
            address = ipaddress.ip_address(parsed.hostname)
            endpoint = (str(address), parsed.port)
            if (
                not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,31}", rid)
                or parsed.scheme not in {"http", "https", "socks5", "socks5h"}
                or address.version != 4
                or not address.is_global
                or not parsed.port
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
                or rid in ids
                or endpoint in endpoints
            ):
                raise ValueError()
            ids.add(rid)
            endpoints.add(endpoint)
            routes.append(
                {"id": rid, "proxy_url": proxy, "egress_class": "webshare_isp"}
            )
        version = value.get("VersionId", "")
        if not routes or not re.fullmatch(r"[A-Za-z0-9-]{1,128}", version):
            raise ValueError()
        return {"ok": True, "registryVersion": version, "routes": routes}
    except Exception:
        # Invalid secret contents must not enter Lambda errors or CloudWatch logs.
        raise RuntimeError("Production proxy registry unavailable") from None


def handler(event, _context):
    action = event.get("action", "sweep")
    if action == "proxy_registry":
        return proxy_registry()
    if action not in {"wake", "heartbeat", "sweep"}:
        raise ValueError("unsupported ranking action")
    ecs = boto3.client("ecs")
    elb = boto3.client("elbv2")
    table = boto3.resource("dynamodb").Table(os.environ["LEASE_TABLE"])
    cluster, service = os.environ["CLUSTER"], os.environ["SERVICE"]
    now = int(time.time())
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
