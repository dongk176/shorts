#!/usr/bin/env python3
"""Upload only content-addressed showcase previews to the verified existing CDN origin."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
folder = Path(sys.argv[1]).resolve()
manifest = json.loads((root / "web/lib/showcase-delivery.json").read_text())
bucket = "artiroom-uploader"
account = "181651591905"


def aws(*args):
    return subprocess.run(["aws", *args], check=True, capture_output=True, timeout=90).stdout


identity = json.loads(aws("sts", "get-caller-identity", "--output", "json"))
assert identity["Account"] == account
cdn = json.loads(aws("cloudfront", "get-distribution", "--id", "E3NYPMMRTFR2KF"))["Distribution"]
assert cdn["ARN"] == f"arn:aws:cloudfront::{account}:distribution/E3NYPMMRTFR2KF"
assert manifest["origin"] == "https://" + cdn["DomainName"]
assert cdn["DistributionConfig"]["Origins"]["Items"][0]["DomainName"] == bucket + ".s3.ap-northeast-2.amazonaws.com"
aws("s3api", "head-bucket", "--bucket", bucket, "--expected-bucket-owner", account)


def upload(key):
    match = re.fullmatch(r"easycut/showcase/v2/((?:ko|en|ja)-[a-z]+-(?:[123]|source))-([0-9a-f]{16})\.(mp4|webp)", key)
    assert match, key
    path = folder / key.rsplit("/", 1)[1]
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest[:16] == match[2]
    aws("s3api", "put-object", "--bucket", bucket, "--expected-bucket-owner", account,
        "--key", key, "--body", str(path), "--content-type", "video/mp4" if key.endswith(".mp4") else "image/webp",
        "--cache-control", "public,max-age=31536000,immutable", "--metadata", "sha256=" + digest)
    result = json.loads(aws("s3api", "head-object", "--bucket", bucket, "--expected-bucket-owner", account, "--key", key))
    assert result["ContentLength"] == path.stat().st_size and result["Metadata"]["sha256"] == digest
    return key


keys = [value for asset in manifest["assets"].values() for value in asset.values()]
assert len(keys) == 144 and len(set(keys)) == 144
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for count, key in enumerate(pool.map(upload, keys), 1):
        print(f"{count}/144 verified {key}", flush=True)
