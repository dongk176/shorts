from __future__ import annotations

from pathlib import Path

import boto3


class ObjectStorage:
    def __init__(self, bucket: str, region: str) -> None:
        self.bucket = bucket
        self.client = boto3.client("s3", region_name=region)

    def upload(self, path: Path, key: str, content_type: str) -> int:
        self.client.upload_file(
            str(path),
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type, "ServerSideEncryption": "AES256"},
        )
        result = self.client.head_object(Bucket=self.bucket, Key=key)
        return int(result["ContentLength"])

    def download(self, key: str, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(path))
        return path

    def delete(self, key: str) -> None:
        if key:
            self.client.delete_object(Bucket=self.bucket, Key=key)

    def delete_prefix(self, prefix: str) -> None:
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
            if keys:
                self.client.delete_objects(
                    Bucket=self.bucket,
                    Delete={"Objects": keys, "Quiet": True},
                )
