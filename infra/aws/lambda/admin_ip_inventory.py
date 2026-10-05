"""Read-only, sanitized IP inventory. No DB credentials or proxy URLs leave Lambda."""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import boto3
from botocore.config import Config

_cache = {}
_versions = {}
_config = Config(connect_timeout=2, read_timeout=3, retries={"max_attempts": 1})


def fingerprints(value):
    routes = json.loads(json.loads(value)["INGESTION_PROXY_ROUTES_JSON"])
    if not isinstance(routes, list) or not 1 <= len(routes) <= 40:
        raise ValueError("invalid inventory")
    result = {}
    for row in routes:
        route = row["id"]
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,31}", route) or route in result:
            raise ValueError("invalid route")
        # Only fixed IP endpoints establish an IP identity. Rotating hostnames
        # cannot be represented truthfully by a hash of their hostname.
        host = str(ipaddress.ip_address(urlparse(row["proxy_url"]).hostname))
        result[route] = hashlib.sha256(host.encode()).hexdigest()[:10]
    return result


def assignments(snapshots, now):
    current = [s for s in snapshots if "AWSCURRENT" in s.get("VersionStages", [])]
    ordered = sorted(snapshots, key=lambda s: s["CreatedDate"], reverse=True)
    if len(current) != 1 or current[0]["VersionId"] != ordered[0]["VersionId"]:
        raise ValueError("activation history unverified")
    newest = current[0]
    result = []
    for route, identity in newest["routes"].items():
        since, exact = newest["CreatedDate"], False
        for old in ordered[1:]:
            if old["routes"].get(route) != identity:
                exact = True
                break
            since = old["CreatedDate"]
        if since > now:
            raise ValueError("future assignment")
        result.append(
            {
                "routeId": route,
                "identity": identity,
                "assignedAt": since.isoformat(),
                "assignmentExact": exact,
            }
        )
    return result


def secret_inventory(client, arn, now):
    meta = client.describe_secret(SecretId=arn)
    current = [k for k, v in meta["VersionIdsToStages"].items() if "AWSCURRENT" in v]
    if len(current) != 1:
        raise ValueError("current version unverified")
    # Metadata changes / explicit stage rollbacks invalidate our chronology.
    cache_key = (arn, current[0], meta["LastChangedDate"].isoformat())
    if cache_key in _cache:
        return _cache[cache_key]
    versions, token = [], None
    for _ in range(4):
        args = {"SecretId": arn, "IncludeDeprecated": True, "MaxResults": 100}
        if token:
            args["NextToken"] = token
        page = client.list_secret_version_ids(**args)
        versions.extend(page["Versions"])
        token = page.get("NextToken")
        if not token:
            break
    if token:
        raise ValueError("history exceeds bound")
    versions.sort(key=lambda s: s["CreatedDate"], reverse=True)
    latest = versions[0]
    if (
        latest["VersionId"] != current[0]
        or abs((meta["LastChangedDate"] - latest["CreatedDate"]).total_seconds()) > 2
    ):
        raise ValueError("activation history unverified")
    selected = []
    for version in versions:
        selected.append(version)
        if version["CreatedDate"] < now - timedelta(hours=72):
            break
    # A conservative known-since bound remains correct with truncated history.
    selected = selected[:40]

    def read(version):
        key = (arn, version["VersionId"])
        if key not in _versions:
            value = client.get_secret_value(SecretId=arn, VersionId=version["VersionId"])
            _versions[key] = fingerprints(value["SecretString"])
        return {**version, "routes": _versions[key]}

    with ThreadPoolExecutor(max_workers=5) as executor:
        snapshots = list(executor.map(read, selected))
    # Fail closed if a replacement occurred during the read.
    after = client.describe_secret(SecretId=arn)
    if (
        after["VersionIdsToStages"] != meta["VersionIdsToStages"]
        or after["LastChangedDate"] != meta["LastChangedDate"]
    ):
        raise ValueError("inventory changed during read")
    result = assignments(snapshots, now)
    _cache.clear()
    _cache[cache_key] = result
    if len(_versions) > 200:
        _versions.clear()
    return result


def handler(event, _context):
    now = datetime.now(UTC)
    try:
        account = os.environ["EXPECTED_ACCOUNT"]
        region = os.environ["AWS_REGION"]
        allowed = set(json.loads(os.environ["INVENTORY_SECRET_ARNS"]))
        targets = event.get("targets", [])
        if (
            not isinstance(targets, list)
            or not 1 <= len(targets) <= 32
            or any(
                not isinstance(t, str)
                or not re.fullmatch(
                    rf"arn:aws:batch:{region}:{account}:job-definition/[A-Za-z0-9_-]+:[0-9]+", t
                )
                for t in targets
            )
        ):
            raise ValueError("invalid worker targets")
        definitions = boto3.client("batch", config=_config).describe_job_definitions(
            jobDefinitions=targets
        )["jobDefinitions"]
        if {d["jobDefinitionArn"] for d in definitions} != set(targets):
            raise ValueError("worker targets unavailable")
        sources = set()
        for definition in definitions:
            refs = [
                s["valueFrom"]
                for s in definition.get("containerProperties", {}).get("secrets", [])
                if s["name"] == "INGESTION_PROXY_ROUTES_JSON"
            ]
            if len(refs) != 1 or not refs[0].endswith(":INGESTION_PROXY_ROUTES_JSON::"):
                raise ValueError("inventory reference unverified")
            sources.add(refs[0].removesuffix(":INGESTION_PROXY_ROUTES_JSON::"))
        if not sources or not sources.issubset(allowed):
            raise ValueError("inventory source not allowed")
        client = boto3.client("secretsmanager", config=_config)
        inventories = [secret_inventory(client, arn, now) for arn in sorted(sources)]
        routes = []
        for row in inventories[0]:
            peers = [
                next((r for r in inventory if r["routeId"] == row["routeId"]), None)
                for inventory in inventories
            ]
            if any(p is None or p["identity"] != row["identity"] for p in peers):
                continue
            routes.append(
                {
                    **row,
                    "assignedAt": max(p["assignedAt"] for p in peers),
                    "assignmentExact": all(p["assignmentExact"] for p in peers),
                }
            )
        return {"verified": True, "checkedAt": now.isoformat(), "routes": routes}
    except Exception:
        # Never serialize provider errors, event input, or secret contents.
        return {"verified": False, "checkedAt": now.isoformat(), "routes": []}
