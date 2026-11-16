#!/usr/bin/env python3
"""Publish byte-identical public ranking examples to the existing showcase CDN."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "web/lib/ranking-showroom-delivery.json").read_text())
account, bucket, distribution = "181651591905", "artiroom-uploader", "E3NYPMMRTFR2KF"


def aws(*args):
    return subprocess.run(["aws", *args], check=True, capture_output=True, timeout=120).stdout


assert json.loads(aws("sts", "get-caller-identity"))["Account"] == account
cdn = json.loads(aws("cloudfront", "get-distribution", "--id", distribution))["Distribution"]
assert cdn["ARN"] == f"arn:aws:cloudfront::{account}:distribution/{distribution}"
assert manifest["origin"] == "https://" + cdn["DomainName"]
assert cdn["DistributionConfig"]["Origins"]["Items"][0]["DomainName"] == bucket + ".s3.ap-northeast-2.amazonaws.com"
aws("s3api", "head-bucket", "--bucket", bucket, "--expected-bucket-owner", account)


def upload(asset):
    key = asset["path"]
    assert re.fullmatch(r"easycut/ranking-showcase/v1/(ko|en|ja)-[a-z0-9-]+-[0-9a-f]{16}\.mp4", key)
    source = (root / "web/public" / asset["source"]).resolve()
    assert source.is_relative_to(root / "web/public")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert digest == asset["sha256"] and digest[:16] in key
    assert source.stat().st_size == asset["bytes"]
    aws("s3api", "put-object", "--bucket", bucket, "--expected-bucket-owner", account,
        "--key", key, "--body", str(source), "--content-type", "video/mp4",
        "--cache-control", "public,max-age=31536000,immutable", "--metadata", "sha256=" + digest)
    result = json.loads(aws("s3api", "head-object", "--bucket", bucket, "--expected-bucket-owner", account, "--key", key))
    assert result["ContentLength"] == asset["bytes"] and result["Metadata"]["sha256"] == digest
    assert result["CacheControl"] == "public,max-age=31536000,immutable"
    return {"key": key, "bytes": asset["bytes"], "sha256": digest}


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for result in pool.map(upload, manifest["assets"].values()):
        print(json.dumps(result), flush=True)
