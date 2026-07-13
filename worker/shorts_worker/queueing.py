from __future__ import annotations

import json
import os
from typing import Any

import boto3


class WorkQueue:
    def __init__(self, region: str) -> None:
        self.queue_url = os.getenv("WORK_DISPATCH_QUEUE_URL")
        self.client = boto3.client("sqs", region_name=region) if self.queue_url else None

    def send(self, payload: dict[str, Any], *, delay_seconds: int = 0) -> None:
        if not self.queue_url or not self.client:
            raise RuntimeError("WORK_DISPATCH_QUEUE_URL이 설정되지 않았습니다.")
        self.client.send_message(
            QueueUrl=self.queue_url,
            MessageBody=json.dumps(payload, separators=(",", ":")),
            DelaySeconds=max(0, min(900, int(delay_seconds))),
        )
