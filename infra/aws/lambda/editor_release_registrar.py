from __future__ import annotations

import json
import os
import re
import urllib.parse
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

import boto3
from common import iso_now, log_event, rest

batch = boto3.client("batch")
ecr = boto3.client("ecr")
s3 = boto3.client("s3")

_SHA = re.compile(r"^[0-9a-f]{40}$")
_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_PRODUCTION_DEFINITION = re.compile(
    r"^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/"
    r"shorts-mvp-editor-release-[a-z0-9-]+:[1-9][0-9]*$"
)
_ISOLATED_DEFINITION = re.compile(
    r"^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/"
    r"shorts-mvp-editor-test-release-[a-z0-9-]+:[1-9][0-9]*$"
)
_REQUIRED_CHECKS = {
    "worker-image",
    "legacy-no-timeline",
    "captured-timeline",
    "editor-v2",
    "ffprobe",
    "frame-parity",
}
_REQUIRED_FONTS = {
    "pretendard",
    "black-han-sans",
    "gmarket-sans",
    "do-hyeon",
    "noto-serif-kr",
    "nanum-myeongjo",
    "suit",
    "spoqa-han-sans-neo",
}


def _required_string(event: dict[str, Any], name: str) -> str:
    value = str(event.get(name) or "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def _job_definition(arn: str) -> dict[str, Any]:
    response = batch.describe_job_definitions(jobDefinitions=[arn])
    definitions = response.get("jobDefinitions", [])
    if len(definitions) != 1 or definitions[0].get("status") != "ACTIVE":
        raise RuntimeError("Editor release job definition is not active")
    return definitions[0]


def _latest_job_definition(name: str) -> dict[str, Any]:
    response = batch.describe_job_definitions(
        jobDefinitionName=name,
        status="ACTIVE",
    )
    definitions = response.get("jobDefinitions", [])
    if not definitions:
        raise RuntimeError("Trusted editor release template is not active")
    return max(definitions, key=lambda definition: int(definition.get("revision") or 0))


def _definition_contract(definition: dict[str, Any]) -> dict[str, Any]:
    container = deepcopy(definition.get("containerProperties") or {})
    container.pop("image", None)
    environment = [
        item
        for item in container.get("environment", [])
        if item.get("name") not in {"WORKER_IMAGE_TAG", "WORKER_IMAGE_DIGEST"}
    ]
    container["environment"] = sorted(
        environment,
        key=lambda item: (str(item.get("name") or ""), str(item.get("value") or "")),
    )
    if "secrets" in container:
        container["secrets"] = sorted(
            container["secrets"],
            key=lambda item: (
                str(item.get("name") or ""),
                str(item.get("valueFrom") or ""),
            ),
        )
    if "resourceRequirements" in container:
        container["resourceRequirements"] = sorted(
            container["resourceRequirements"],
            key=lambda item: str(item.get("type") or ""),
        )
    return {
        "type": definition.get("type"),
        "parameters": definition.get("parameters") or {},
        "containerProperties": container,
        "platformCapabilities": sorted(definition.get("platformCapabilities") or []),
        "retryStrategy": definition.get("retryStrategy") or {},
        "timeout": definition.get("timeout") or {},
        "propagateTags": bool(definition.get("propagateTags")),
    }


def _verify_definition_contract(
    definition: dict[str, Any],
    trusted_template: dict[str, Any],
) -> None:
    if _definition_contract(definition) != _definition_contract(trusted_template):
        raise RuntimeError(
            "Editor release job definition differs from its trusted template"
        )


def _definition_image(definition: dict[str, Any], digest: str) -> str:
    image = str(definition.get("containerProperties", {}).get("image") or "")
    if not image.endswith(f"@{digest}"):
        raise RuntimeError("Editor release job definition does not use the requested digest")
    return image


def _verify_ecr_scan(image: str, digest: str) -> None:
    without_digest = image.removesuffix(f"@{digest}")
    repository_name = without_digest.split("/", maxsplit=1)[-1]
    response = ecr.describe_image_scan_findings(
        repositoryName=repository_name,
        imageId={"imageDigest": digest},
    )
    status = str(response.get("imageScanStatus", {}).get("status") or "")
    if status != "COMPLETE":
        raise RuntimeError("ECR image scan is not complete")
    counts = response.get("imageScanFindings", {}).get("findingSeverityCounts", {})
    if int(counts.get("CRITICAL") or 0) != 0:
        raise RuntimeError("ECR image has a critical vulnerability")


def _read_manifest(artifact_uri: str) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(artifact_uri)
    expected_bucket = os.environ["EDITOR_TEST_BUCKET_NAME"]
    if (
        parsed.scheme != "s3"
        or parsed.netloc != expected_bucket
        or not parsed.path.startswith("/editor-release-probes/")
        or not parsed.path.endswith("/manifest.json")
    ):
        raise ValueError("artifactUri is outside the isolated editor test bucket")
    response = s3.get_object(Bucket=parsed.netloc, Key=parsed.path.lstrip("/"))
    payload = response["Body"].read()
    if len(payload) > 64_000:
        raise ValueError("Editor release manifest is too large")
    manifest = json.loads(payload)
    if not isinstance(manifest, dict):
        raise ValueError("Editor release manifest must be an object")
    return manifest


def _verify_manifest(
    manifest: dict[str, Any],
    *,
    git_sha: str,
    digest: str,
) -> None:
    if (
        manifest.get("schemaVersion") != 1
        or manifest.get("gitSha") != git_sha
        or manifest.get("workerImageDigest") != digest
        or manifest.get("documentVersion") != 2
    ):
        raise RuntimeError("Editor release manifest identity does not match")
    checks = manifest.get("checks")
    if not isinstance(checks, dict) or {
        name for name in _REQUIRED_CHECKS if checks.get(name) is not True
    }:
        raise RuntimeError("Editor release manifest is missing a required check")
    media = manifest.get("media")
    if not isinstance(media, dict) or (
        media.get("width"),
        media.get("height"),
        media.get("videoCodec"),
        media.get("audioCodec"),
    ) != (1080, 1920, "h264", "aac"):
        raise RuntimeError("Editor release manifest media contract does not match")
    geometry = manifest.get("geometry")
    if not isinstance(geometry, dict) or float(
        geometry.get("maximumErrorPixels", 999)
    ) > 2:
        raise RuntimeError("Editor release geometry exceeds the two-pixel tolerance")
    if set(manifest.get("fonts") or []) != _REQUIRED_FONTS:
        raise RuntimeError("Editor release did not verify every bundled font")


def _verify_isolated_job(
    job_id: str,
    isolated_definition_arn: str,
) -> None:
    jobs = batch.describe_jobs(jobs=[job_id]).get("jobs", [])
    if len(jobs) != 1:
        raise RuntimeError("Isolated editor test job was not found")
    job = jobs[0]
    if (
        job.get("status") != "SUCCEEDED"
        or job.get("jobDefinition") != isolated_definition_arn
        or not job.get("stoppedAt")
    ):
        raise RuntimeError("Isolated editor test job did not succeed")
    stopped_at = datetime.fromtimestamp(int(job["stoppedAt"]) / 1000, tz=UTC)
    if (datetime.now(UTC) - stopped_at).total_seconds() > 24 * 60 * 60:
        raise RuntimeError("Isolated editor test evidence is older than 24 hours")


def _record_release(
    event: dict[str, Any],
    *,
    git_sha: str,
    digest: str,
    production_definition_arn: str,
    artifact_uri: str,
    manifest: dict[str, Any],
) -> str:
    existing = rest("editor_releases", query=(
        "select=id,status,ui_version,document_version,"
        "production_job_definition_arn"
        f"&git_sha=eq.{git_sha}&worker_image_digest=eq.{digest}&limit=1"
    )) or []
    if existing:
        release = existing[0]
        if (
            int(release.get("ui_version") or 0) != int(event["uiVersion"])
            or int(release.get("document_version") or 0)
            != int(event["documentVersion"])
            or release.get("production_job_definition_arn")
            != production_definition_arn
        ):
            raise RuntimeError("Existing release identity has different immutable data")
        if release.get("status") not in {
            "built",
            "staging_verified",
            "canary_ready",
        }:
            raise RuntimeError("Existing release cannot be registered again")
        release_id = str(release["id"])
    else:
        created = rest(
            "editor_releases",
            method="POST",
            body={
                "git_sha": git_sha,
                "ui_version": int(event["uiVersion"]),
                "document_version": int(event["documentVersion"]),
                "worker_image_digest": digest,
                "production_job_definition_arn": production_definition_arn,
                "status": "built",
            },
            prefer="return=representation",
        ) or []
        if len(created) != 1 or not _UUID.fullmatch(str(created[0].get("id") or "")):
            raise RuntimeError("Editor release was not created")
        release_id = str(created[0]["id"])

    check_sources = manifest.get("checkSources")
    for check_name in sorted(_REQUIRED_CHECKS):
        rest(
            "editor_release_checks",
            method="POST",
            query="on_conflict=release_id,environment,check_name",
            body={
                "release_id": release_id,
                "environment": "isolated",
                "check_name": check_name,
                "status": "passed",
                "details": {
                    "source": (
                        check_sources.get(check_name)
                        if isinstance(check_sources, dict)
                        else "isolated-probe"
                    ),
                    "batchJobId": event["isolatedBatchJobId"],
                    "workflowRunUrl": event.get("workflowRunUrl"),
                },
                "artifact_uri": artifact_uri,
                "started_at": iso_now(),
                "completed_at": iso_now(),
            },
            prefer="resolution=merge-duplicates,return=minimal",
        )
    rest(
        "editor_releases",
        method="PATCH",
        query=f"id=eq.{release_id}&status=in.(built,staging_verified)",
        body={
            "status": "staging_verified",
            "staging_verified_at": iso_now(),
        },
        prefer="return=minimal",
    )
    rest(
        "editor_releases",
        method="PATCH",
        query=f"id=eq.{release_id}&status=eq.staging_verified",
        body={"status": "canary_ready"},
        prefer="return=minimal",
    )
    states = rest(
        "editor_release_state",
        query="select=candidate_release_id,canary_enabled&singleton=eq.true&limit=1",
    ) or []
    if not states:
        raise RuntimeError("Editor release state is missing")
    current_candidate = states[0].get("candidate_release_id")
    if states[0].get("canary_enabled"):
        if current_candidate != release_id:
            raise RuntimeError("A different editor canary is currently active")
        # An idempotent workflow retry must never pause a canary that an
        # administrator started after the release evidence was registered.
        return release_id
    rest(
        "editor_release_state",
        method="PATCH",
        query="singleton=eq.true&canary_enabled=eq.false",
        body={
            "candidate_release_id": release_id,
            "canary_enabled": False,
        },
        prefer="return=minimal",
    )
    return release_id


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    git_sha = _required_string(event, "gitSha").lower()
    digest = _required_string(event, "imageDigest").lower()
    production_definition_arn = _required_string(
        event,
        "productionJobDefinitionArn",
    )
    isolated_definition_arn = _required_string(
        event,
        "isolatedJobDefinitionArn",
    )
    isolated_job_id = _required_string(event, "isolatedBatchJobId")
    artifact_uri = _required_string(event, "artifactUri")
    if not _SHA.fullmatch(git_sha) or not _DIGEST.fullmatch(digest):
        raise ValueError("Editor release identity is invalid")
    if not _PRODUCTION_DEFINITION.fullmatch(production_definition_arn):
        raise ValueError("Production editor job definition is not trusted")
    if not _ISOLATED_DEFINITION.fullmatch(isolated_definition_arn):
        raise ValueError("Isolated editor job definition is not trusted")
    if int(event.get("uiVersion") or 0) < 2 or int(
        event.get("documentVersion") or 0
    ) != 2:
        raise ValueError("Unsupported editor UI or document version")

    _verify_isolated_job(isolated_job_id, isolated_definition_arn)
    production_definition = _job_definition(production_definition_arn)
    isolated_definition = _job_definition(isolated_definition_arn)
    _verify_definition_contract(
        production_definition,
        _latest_job_definition(os.environ["RERENDER_JOB_DEFINITION"]),
    )
    _verify_definition_contract(
        isolated_definition,
        _latest_job_definition(
            os.environ["EDITOR_TEST_TEMPLATE_JOB_DEFINITION"],
        ),
    )
    production_image = _definition_image(production_definition, digest)
    isolated_image = _definition_image(isolated_definition, digest)
    if production_image != isolated_image:
        raise RuntimeError("Canary and isolated definitions use different images")
    _verify_ecr_scan(production_image, digest)
    manifest = _read_manifest(artifact_uri)
    _verify_manifest(manifest, git_sha=git_sha, digest=digest)
    release_id = _record_release(
        event,
        git_sha=git_sha,
        digest=digest,
        production_definition_arn=production_definition_arn,
        artifact_uri=artifact_uri,
        manifest=manifest,
    )
    log_event(
        "editor_release_registered",
        release_id=release_id,
        git_sha=git_sha,
        image_digest=digest,
        isolated_batch_job_id=isolated_job_id,
    )
    return {"releaseId": release_id, "status": "canary_ready"}
