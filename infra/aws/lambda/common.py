from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from functools import lru_cache
from typing import Any

import boto3


@lru_cache(maxsize=1)
def runtime_secret() -> dict[str, str]:
    response = boto3.client("secretsmanager").get_secret_value(
        SecretId=os.environ["RUNTIME_SECRET_ARN"]
    )
    return json.loads(response.get("SecretString") or "{}")


def rest(
    table: str,
    *,
    method: str = "GET",
    query: str = "",
    body: dict[str, Any] | None = None,
    prefer: str | None = None,
) -> Any:
    secret = runtime_secret()
    base = secret.get("SUPABASE_URL", "").rstrip("/")
    key = secret.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    url = f"{base}/rest/v1/{table}"
    if query:
        url = f"{url}?{query}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": "shorts_mvp",
        "Content-Profile": "shorts_mvp",
    }
    if prefer:
        headers["Prefer"] = prefer
    encoded = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        encoded = json.dumps(body, separators=(",", ":")).encode()
    request = urllib.request.Request(url, data=encoded, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = response.read()
            return json.loads(payload) if payload else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(f"Supabase REST {error.code}: {detail}") from error


def patch(table: str, query: str, body: dict[str, Any]) -> None:
    rest(table, method="PATCH", query=query, body=body, prefer="return=minimal")


def iso_now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat()
