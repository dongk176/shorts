from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
import urllib.parse
import urllib.request
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
_V4_REQUIRED_CHECKS = {
    "runtime-identity",
    "render-spec-v4",
    "caption-render-spec-v4",
    "worker-title-compositor-parity",
    "worker-caption-noop-parity",
    "font-manifest",
    "font-fallback",
    "browser-parity-worker-matrix",
}
_SUPPORTED_DOCUMENT_VERSIONS = {2, 3}
_REQUIRED_FONTS = {
    "pretendard",
    "noto-sans-kr",
    "do-hyeon",
    "jua",
    "jalnan-2",
    "cafe24-anemone",
    "cafe24-pro-up",
    "sandbox-aggro",
    "galmuri-9",
    "black-han-sans",
    "godo",
    "gmarket-sans",
    "nanum-square-neo",
    "s-core-dream",
    "suit",
    "spoqa-han-sans-neo",
    "noto-serif-kr",
    "nanum-myeongjo",
    "ridi-batang",
    "paperlogy",
}
_CANDIDATE_VCPUS = "4"
_CANDIDATE_FFMPEG_THREADS = "4"
_V4_RENDER_SPEC_VERSION = 4
_V4_CAPTION_RENDER_SPEC_VERSION = 4
_FONT_MANIFEST_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_BROWSER_PARITY_CHECK = "browser-worker-visual-parity"
_BROWSER_PARITY_MATRIX_NAME = "browser-parity/matrix.json"
_BROWSER_PARITY_CASE_COUNT = 66
_BROWSER_PARITY_REPORT_MAX_BYTES = 512 * 1024
_BROWSER_PARITY_REQUIRED_CHECKS = {
    _BROWSER_PARITY_CHECK,
    "actualChromium",
    "exactFontsLoaded",
    "authoritativeDomGeometry",
    "workerFrameInkBounds",
    "captionWordInkAndGapMatrix",
    "highlightCaptionInkBounds",
    "browserTemplateCompilerParity",
    "storedSpecConsumerParity",
    "titleScenarioMatrix",
    "allEditorFontsVisualMatrix",
    "allEditorFontsBothCaptionModes",
    "allEditorFontsTitleMatrix",
    "pureLanguageBoundaryMatrix",
}
_BROWSER_PARITY_REQUIRED_COVERAGE = {
    "long-korean-title",
    "transparent-title-background",
    "colored-title-background",
    "non-centered-title",
    "edge-clamped-title",
    "pop-caption",
    "highlight-caption",
    "mixed-language-caption",
    "pure-korean-caption",
    "pure-english-caption",
    "font-template-mode-matrix",
    "title-font-matrix",
    "mixed-language-title",
}
_GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com"
_GITHUB_OIDC_JWKS_URL = f"{_GITHUB_OIDC_ISSUER}/.well-known/jwks"
_GITHUB_OIDC_RSA_SHA256_PREFIX = bytes.fromhex(
    "3031300d060960864801650304020105000420"
)
_V4_DEFINITION_ENVIRONMENT = {
    "EDITOR_RELEASE_GIT_SHA",
    "EDITOR_RENDER_SPEC_VERSION",
    "EDITOR_CAPTION_RENDER_SPEC_VERSION",
    "EDITOR_FONT_MANIFEST_SHA256",
}
_PROJECT_TARGET_LANES = {
    "legacy_project",
    "source_range",
    "elevenlabs_transcription",
    "subtitle_templates",
    "unified_template_subtitles",
}
_PROJECT_TARGET_RELEASE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{2,127}$")
_PROJECT_JOB_DEFINITION = re.compile(
    r"^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/"
    r"shorts-mvp-editor-v4-[a-z0-9-]+-[0-9a-f]{12}:[1-9][0-9]*$"
)
_PROBE_ID = _UUID
_BATCH_JOB_ID = _UUID
_PROBE_NONCE = re.compile(r"^[0-9a-f]{32}$")
_ECR_REPOSITORY_URI = re.compile(
    r"^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/"
    r"[A-Za-z0-9._/-]+$"
)
_ISOLATED_DEFINITION_V4 = re.compile(
    r"^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-definition/"
    r"shorts-mvp-editor-test-release-[0-9a-f]{12}-[0-9a-f]{8}-4vcpu:"
    r"[1-9][0-9]*$"
)
_JOB_QUEUE = re.compile(
    r"^arn:aws:batch:[a-z0-9-]+:[0-9]{12}:job-queue/[A-Za-z0-9_-]+$"
)
_EDITOR_FONT_ROOT = "/app/worker/shorts_worker/assets/editor_fonts"
_REQUIRED_FONT_FILES = {
    "pretendard": "Pretendard-Bold.woff2",
    "noto-sans-kr": "NotoSansKR-Variable.ttf",
    "do-hyeon": "DoHyeon-Regular.ttf",
    "jua": "Jua-Regular.ttf",
    "jalnan-2": "Jalnan2-Regular.woff2",
    "cafe24-anemone": "Cafe24Anemone-Bold.woff",
    "cafe24-pro-up": "Cafe24ProUp-Regular.woff2",
    "sandbox-aggro": "SandboxAggro-Bold.ttf",
    "galmuri-9": "Galmuri9-Regular.ttf",
    "black-han-sans": "BlackHanSans-Regular.ttf",
    "godo": "Godo-Bold.ttf",
    "gmarket-sans": "GmarketSans-Bold.ttf",
    "nanum-square-neo": "NanumSquareNeo-Bold.ttf",
    "s-core-dream": "SCoreDream-ExtraBold.otf",
    "suit": "SUIT-Bold.woff2",
    "spoqa-han-sans-neo": "SpoqaHanSansNeo-Bold.woff2",
    "noto-serif-kr": "NotoSerifKR-Variable.ttf",
    "nanum-myeongjo": "NanumMyeongjo-Bold.ttf",
    "ridi-batang": "RIDIBatang-Regular.woff",
    "paperlogy": "Paperlogy-7Bold.ttf",
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
    *,
    allow_candidate_resources: bool = False,
    git_sha: str | None = None,
    render_spec_version: int | None = None,
    caption_render_spec_version: int | None = None,
    font_manifest_sha256: str | None = None,
) -> None:
    candidate_contract = _definition_contract(definition)
    trusted_contract = _definition_contract(trusted_template)
    candidate_container = candidate_contract["containerProperties"]
    trusted_container = trusted_contract["containerProperties"]
    if allow_candidate_resources:
        definition_name = str(definition.get("jobDefinitionName") or "")
        if not definition_name.endswith("-4vcpu"):
            raise RuntimeError("Editor release job definition is not the 4 vCPU candidate")
        candidate_resources = candidate_container.get("resourceRequirements", [])
        trusted_resources = trusted_container.get("resourceRequirements", [])
        candidate_vcpu = next(
            (item for item in candidate_resources if item.get("type") == "VCPU"),
            None,
        )
        trusted_vcpu = next(
            (item for item in trusted_resources if item.get("type") == "VCPU"),
            None,
        )
        if candidate_vcpu is None or candidate_vcpu.get("value") != _CANDIDATE_VCPUS:
            raise RuntimeError("Editor release candidate must use exactly 4 vCPU")
        if trusted_vcpu is None:
            raise RuntimeError("Trusted editor template does not define vCPU")
        candidate_vcpu["value"] = trusted_vcpu.get("value")

        candidate_environment = candidate_container.get("environment", [])
        trusted_environment = trusted_container.get("environment", [])
        for name, required_value in (
            ("TASK_VCPUS", _CANDIDATE_VCPUS),
            ("FFMPEG_THREADS", _CANDIDATE_FFMPEG_THREADS),
        ):
            candidate_item = next(
                (item for item in candidate_environment if item.get("name") == name),
                None,
            )
            trusted_item = next(
                (item for item in trusted_environment if item.get("name") == name),
                None,
            )
            if candidate_item is None or candidate_item.get("value") != required_value:
                raise RuntimeError(f"Editor release candidate has invalid {name}")
            if trusted_item is None:
                raise RuntimeError(f"Trusted editor template does not define {name}")
            candidate_item["value"] = trusted_item.get("value")
    candidate_environment = candidate_container.get("environment", [])
    expected_v4_environment = {
        "EDITOR_RELEASE_GIT_SHA": git_sha,
        "EDITOR_RENDER_SPEC_VERSION": str(render_spec_version),
        "EDITOR_CAPTION_RENDER_SPEC_VERSION": str(caption_render_spec_version),
        "EDITOR_FONT_MANIFEST_SHA256": font_manifest_sha256,
    } if render_spec_version is not None else {}
    observed_v4_environment = {
        str(item.get("name") or ""): str(item.get("value") or "")
        for item in candidate_environment
        if item.get("name") in _V4_DEFINITION_ENVIRONMENT
    }
    if observed_v4_environment != expected_v4_environment:
        raise RuntimeError(
            "Editor release candidate has invalid v4 capability environment"
        )
    candidate_container["environment"] = [
        item for item in candidate_environment
        if item.get("name") not in _V4_DEFINITION_ENVIRONMENT
    ]
    # A later v4 release may clone the currently promoted v4 definition.
    # Release evidence is verified above for the candidate and must not make
    # the underlying resource/queue contract appear different merely because
    # the trusted predecessor carries its own immutable provenance values.
    trusted_environment = trusted_container.get("environment", [])
    trusted_container["environment"] = [
        item for item in trusted_environment
        if item.get("name") not in _V4_DEFINITION_ENVIRONMENT
    ]
    if candidate_contract != trusted_contract:
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


def _rpc(name: str, body: dict[str, Any]) -> dict[str, Any]:
    value = rest(f"rpc/{name}", method="POST", body=body)
    if isinstance(value, list) and len(value) == 1:
        value = value[0]
    if not isinstance(value, dict):
        raise RuntimeError(f"Editor release RPC returned invalid data: {name}")
    return value


def _repository_identity() -> tuple[str, str]:
    repository_uri = os.environ.get(
        "EDITOR_RELEASE_ECR_REPOSITORY_URI",
        "",
    ).strip()
    if not _ECR_REPOSITORY_URI.fullmatch(repository_uri):
        raise RuntimeError("Editor release ECR repository URI is invalid")
    return repository_uri, repository_uri.split("/", maxsplit=1)[1]


def _verify_ecr_release_identity(git_sha: str, digest: str) -> str:
    repository_uri, repository_name = _repository_identity()
    response = ecr.describe_images(
        repositoryName=repository_name,
        imageIds=[{"imageTag": f"editor-release-{git_sha}"}],
    )
    details = response.get("imageDetails", [])
    if (
        len(details) != 1
        or details[0].get("imageDigest") != digest
        or f"editor-release-{git_sha}" not in (details[0].get("imageTags") or [])
    ):
        raise RuntimeError("Editor release tag does not resolve to the requested digest")
    image = f"{repository_uri}@{digest}"
    _verify_ecr_scan(image, digest)
    return image


def _allowed_registrar_pass_roles() -> set[str]:
    try:
        values = json.loads(
            os.environ.get("EDITOR_RELEASE_REGISTRAR_PASS_ROLE_ARNS", "[]")
        )
    except json.JSONDecodeError as error:
        raise RuntimeError("Editor release registrar pass-role set is invalid") from error
    if (
        not isinstance(values, list)
        or not values
        or any(
            not isinstance(value, str)
            or not re.fullmatch(r"arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]+", value)
            for value in values
        )
    ):
        raise RuntimeError("Editor release registrar pass-role set is invalid")
    return set(values)


def _registration_payload(
    trusted: dict[str, Any],
    *,
    name: str,
    image: str,
    git_sha: str,
    digest: str,
    font_manifest_sha256: str,
    candidate_resources: bool,
    forced_task_role_arn: str | None = None,
    forced_execution_role_arn: str | None = None,
) -> dict[str, Any]:
    if trusted.get("status") != "ACTIVE" or trusted.get("type") != "container":
        raise RuntimeError("Trusted editor release template is not active")
    payload: dict[str, Any] = {
        "jobDefinitionName": name,
        "type": "container",
        "containerProperties": deepcopy(trusted.get("containerProperties") or {}),
    }
    for key in (
        "parameters",
        "platformCapabilities",
        "retryStrategy",
        "timeout",
        "propagateTags",
    ):
        if trusted.get(key) is not None:
            payload[key] = deepcopy(trusted[key])
    container = payload["containerProperties"]
    container["image"] = image
    if forced_task_role_arn is not None:
        container["jobRoleArn"] = forced_task_role_arn
    if forced_execution_role_arn is not None:
        container["executionRoleArn"] = forced_execution_role_arn
    allowed_roles = _allowed_registrar_pass_roles()
    for role_key in ("jobRoleArn", "executionRoleArn"):
        role_arn = str(container.get(role_key) or "")
        if role_arn not in allowed_roles:
            raise RuntimeError(
                f"Editor release template {role_key} is outside the registrar allowlist"
            )
    resources = deepcopy(container.get("resourceRequirements") or [])
    if candidate_resources:
        resources = [item for item in resources if item.get("type") != "VCPU"]
        resources.append({"type": "VCPU", "value": _CANDIDATE_VCPUS})
    container["resourceRequirements"] = resources
    environment = [
        item
        for item in deepcopy(container.get("environment") or [])
        if item.get("name")
        not in {
            "WORKER_IMAGE_TAG",
            "WORKER_IMAGE_DIGEST",
            "TASK_VCPUS",
            "FFMPEG_THREADS",
            *_V4_DEFINITION_ENVIRONMENT,
        }
    ]
    if candidate_resources:
        environment.extend([
            {"name": "TASK_VCPUS", "value": _CANDIDATE_VCPUS},
            {"name": "FFMPEG_THREADS", "value": _CANDIDATE_FFMPEG_THREADS},
        ])
    else:
        trusted_environment = {
            str(item.get("name") or ""): str(item.get("value") or "")
            for item in trusted.get("containerProperties", {}).get("environment", [])
        }
        for name in ("TASK_VCPUS", "FFMPEG_THREADS"):
            if name in trusted_environment:
                environment.append({"name": name, "value": trusted_environment[name]})
    environment.extend([
        {"name": "WORKER_IMAGE_TAG", "value": digest},
        {"name": "WORKER_IMAGE_DIGEST", "value": digest},
        {"name": "EDITOR_RELEASE_GIT_SHA", "value": git_sha},
        {"name": "EDITOR_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_CAPTION_RENDER_SPEC_VERSION", "value": "4"},
        {"name": "EDITOR_FONT_MANIFEST_SHA256", "value": font_manifest_sha256},
    ])
    container["environment"] = sorted(
        environment,
        key=lambda item: (str(item.get("name") or ""), str(item.get("value") or "")),
    )
    tags = {
        str(key): str(value)
        for key, value in (trusted.get("tags") or {}).items()
        if not str(key).lower().startswith("aws:")
        and str(key).lower()
        not in {
            "releasesha",
            "workerimagedigest",
            "renderspecversion",
            "captionrenderspecversion",
            "fontmanifestsha256",
        }
    }
    tags.update({
        "ReleaseSha": git_sha,
        "WorkerImageDigest": digest,
        "RenderSpecVersion": "4",
        "CaptionRenderSpecVersion": "4",
        "FontManifestSha256": font_manifest_sha256,
    })
    payload["tags"] = tags
    return payload


def _registration_contract(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "jobDefinitionName": str(value.get("jobDefinitionName") or ""),
        **_definition_contract(value),
        "tags": {
            str(key): str(item)
            for key, item in sorted((value.get("tags") or {}).items())
        },
    }


def _register_exact_definition(payload: dict[str, Any]) -> str:
    response = batch.describe_job_definitions(
        jobDefinitionName=payload["jobDefinitionName"],
        status="ACTIVE",
    )
    matches = [
        definition
        for definition in response.get("jobDefinitions", [])
        if _registration_contract(definition) == _registration_contract(payload)
    ]
    if len(matches) > 1:
        raise RuntimeError("Multiple active editor release definitions match")
    if matches:
        arn = str(matches[0].get("jobDefinitionArn") or "")
    else:
        registered = batch.register_job_definition(**payload)
        arn = str(registered.get("jobDefinitionArn") or "")
    if not arn:
        raise RuntimeError("Editor release Job Definition registration failed")
    return arn


def _read_manifest(artifact_uri: str) -> tuple[dict[str, Any], str]:
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
        raise TypeError("Editor release manifest must be an object")
    return manifest, hashlib.sha256(payload).hexdigest()


def _read_versioned_json(
    artifact_uri: str,
    *,
    maximum_bytes: int,
    version_id: str | None = None,
) -> tuple[dict[str, Any], str, str]:
    parsed = urllib.parse.urlparse(artifact_uri)
    expected_bucket = os.environ["EDITOR_TEST_BUCKET_NAME"]
    if (
        parsed.scheme != "s3"
        or parsed.netloc != expected_bucket
        or not parsed.path.startswith("/editor-release-probes/")
        or not parsed.path.endswith(".json")
    ):
        raise ValueError("Editor release evidence is outside the isolated test bucket")
    request: dict[str, Any] = {
        "Bucket": parsed.netloc,
        "Key": parsed.path.lstrip("/"),
        "ChecksumMode": "ENABLED",
    }
    if version_id is not None:
        if not version_id or len(version_id) > 1024:
            raise ValueError("Editor release evidence version is invalid")
        request["VersionId"] = version_id
    response = s3.get_object(**request)
    observed_version = str(response.get("VersionId") or "")
    if not observed_version:
        raise RuntimeError("Editor release evidence is not S3-versioned")
    if version_id is not None and observed_version != version_id:
        raise RuntimeError("Editor release evidence version does not match")
    payload = response["Body"].read(maximum_bytes + 1)
    if len(payload) > maximum_bytes:
        raise ValueError("Editor release evidence is too large")
    checksum = hashlib.sha256(payload).hexdigest()
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise TypeError("Editor release JSON evidence must be an object")
    return value, checksum, observed_version


def _read_browser_parity_matrix(
    *,
    artifact_uri: str,
    manifest: dict[str, Any],
    version_id: str | None = None,
) -> tuple[dict[str, Any], str, str]:
    artifact = urllib.parse.urlparse(artifact_uri)
    contract = manifest.get("browserParityMatrix")
    matrix_path = artifact.path.removesuffix("manifest.json") + _BROWSER_PARITY_MATRIX_NAME
    if (
        artifact.scheme != "s3"
        or artifact.netloc != os.environ["EDITOR_TEST_BUCKET_NAME"]
        or not isinstance(contract, dict)
        or contract.get("schemaVersion") != 1
        or contract.get("caseCount") != _BROWSER_PARITY_CASE_COUNT
        or set(contract.get("fontIds") or []) != _REQUIRED_FONTS
        or not _FONT_MANIFEST_SHA256.fullmatch(str(contract.get("sha256") or ""))
    ):
        raise RuntimeError("Isolated worker browser parity matrix contract is invalid")
    matrix_uri = urllib.parse.urlunparse(
        ("s3", artifact.netloc, matrix_path, "", "", "")
    )
    if version_id is None:
        response = s3.get_object(
            Bucket=artifact.netloc,
            Key=matrix_path.lstrip("/"),
        )
        payload = response["Body"].read()
        if len(payload) > _BROWSER_PARITY_REPORT_MAX_BYTES:
            raise ValueError("Worker browser parity matrix is too large")
        matrix_sha256 = hashlib.sha256(payload).hexdigest()
        value = json.loads(payload)
        if not isinstance(value, dict):
            raise TypeError("Worker browser parity matrix must be an object")
    else:
        value, matrix_sha256, _ = _read_versioned_json(
            matrix_uri,
            maximum_bytes=_BROWSER_PARITY_REPORT_MAX_BYTES,
            version_id=version_id,
        )
    if matrix_sha256 != contract["sha256"]:
        raise RuntimeError("Worker browser parity matrix hash does not match")
    return value, matrix_sha256, matrix_uri


def _read_inline_browser_parity_report(
    report_json: str,
    expected_sha256: str,
) -> dict[str, Any]:
    normalized_hash = expected_sha256.strip().lower()
    payload = report_json.encode("utf-8")
    if (
        not _FONT_MANIFEST_SHA256.fullmatch(normalized_hash)
        or not payload
        or len(payload) > _BROWSER_PARITY_REPORT_MAX_BYTES
    ):
        raise ValueError("Inline browser/worker parity report is invalid")
    if hashlib.sha256(payload).hexdigest() != normalized_hash:
        raise RuntimeError("Inline browser/worker parity report hash does not match")
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise TypeError("Inline browser/worker parity report must be an object")
    return value


def _parity_number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise TypeError(f"Browser/worker parity {name} is invalid")
    number = float(value)
    if number < 0 or number > 2:
        raise RuntimeError(f"Browser/worker parity {name} exceeds 2px")
    return number


def _base64url_decode(value: str) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("GitHub OIDC token contains invalid base64url data")
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _github_jwks() -> dict[str, Any]:
    request = urllib.request.Request(
        _GITHUB_OIDC_JWKS_URL,
        headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        payload = response.read(128 * 1024 + 1)
    if len(payload) > 128 * 1024:
        raise RuntimeError("GitHub OIDC JWKS response is too large")
    value = json.loads(payload)
    if not isinstance(value, dict) or not isinstance(value.get("keys"), list):
        raise TypeError("GitHub OIDC JWKS response is invalid")
    return value


def _verify_rs256_signature(
    signing_input: bytes,
    signature: bytes,
    jwk: dict[str, Any],
) -> None:
    if jwk.get("kty") != "RSA" or jwk.get("alg") not in {None, "RS256"}:
        raise RuntimeError("GitHub OIDC signing key is invalid")
    modulus = int.from_bytes(_base64url_decode(str(jwk.get("n") or "")), "big")
    exponent = int.from_bytes(_base64url_decode(str(jwk.get("e") or "")), "big")
    key_size = (modulus.bit_length() + 7) // 8
    if key_size < 256 or exponent < 3 or len(signature) != key_size:
        raise RuntimeError("GitHub OIDC RSA key or signature is invalid")
    encoded = pow(int.from_bytes(signature, "big"), exponent, modulus).to_bytes(
        key_size,
        "big",
    )
    digest_info = _GITHUB_OIDC_RSA_SHA256_PREFIX + hashlib.sha256(
        signing_input
    ).digest()
    padding_length = key_size - len(digest_info) - 3
    expected = b"\x00\x01" + b"\xff" * padding_length + b"\x00" + digest_info
    if padding_length < 8 or not hmac.compare_digest(encoded, expected):
        raise RuntimeError("GitHub OIDC signature is invalid")


def _verify_github_oidc_claims(
    claims: dict[str, Any],
    *,
    git_sha: str,
) -> dict[str, str]:
    repository = os.environ["GITHUB_OIDC_REPOSITORY"]
    repository_id = os.environ["GITHUB_OIDC_REPOSITORY_ID"]
    repository_owner_id = os.environ["GITHUB_OIDC_REPOSITORY_OWNER_ID"]
    environment = os.environ["GITHUB_OIDC_ENVIRONMENT"]
    release_tag = os.environ["GITHUB_OIDC_RELEASE_TAG"]
    workflow_path = os.environ["GITHUB_OIDC_WORKFLOW_PATH"]
    workflow_name = os.environ["GITHUB_OIDC_WORKFLOW_NAME"]
    audience = os.environ["GITHUB_OIDC_AUDIENCE"]
    expected_ref = f"refs/tags/{release_tag}"
    expected_workflow_ref = f"{repository}/{workflow_path}@{expected_ref}"
    expected_sub = f"repo:{repository}:environment:{environment}"
    now = int(time.time())
    token_audience = claims.get("aud")
    audiences = (
        {str(value) for value in token_audience}
        if isinstance(token_audience, list)
        else {str(token_audience or "")}
    )
    try:
        issued_at = int(claims["iat"])
        not_before = int(claims.get("nbf", issued_at))
        expires_at = int(claims["exp"])
        run_id = str(int(claims["run_id"]))
        run_attempt = str(int(claims["run_attempt"]))
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError("GitHub OIDC temporal/run claims are invalid") from error
    if (
        claims.get("iss") != _GITHUB_OIDC_ISSUER
        or audiences != {audience}
        or claims.get("repository") != repository
        or claims.get("repository_id") != repository_id
        or claims.get("repository_owner_id") != repository_owner_id
        or claims.get("environment") != environment
        or claims.get("sub") != expected_sub
        or claims.get("ref") != expected_ref
        or claims.get("ref_type") != "tag"
        or claims.get("ref_protected") != "true"
        or claims.get("sha") != git_sha
        or claims.get("workflow_ref") != expected_workflow_ref
        or claims.get("workflow") != workflow_name
        or issued_at > now + 60
        or not_before > now + 60
        or expires_at < now - 60
        or expires_at - issued_at > 10 * 60
        or not re.fullmatch(r"[1-9][0-9]*", run_id)
        or not re.fullmatch(r"[1-9][0-9]*", run_attempt)
    ):
        raise RuntimeError("GitHub OIDC release identity does not match")
    return {
        "repository": repository,
        "repositoryId": repository_id,
        "repositoryOwnerId": repository_owner_id,
        "environment": environment,
        "ref": expected_ref,
        "sha": git_sha,
        "workflowRef": expected_workflow_ref,
        "workflow": workflow_name,
        "runId": run_id,
        "runAttempt": run_attempt,
        "workflowRunUrl": (
            f"https://github.com/{repository}/actions/runs/{run_id}/"
            f"attempts/{run_attempt}"
        ),
    }


def _verify_github_oidc_token(
    token: str,
    *,
    git_sha: str,
) -> dict[str, str]:
    parts = token.split(".")
    if len(parts) != 3 or len(token) > 16_384:
        raise ValueError("GitHub OIDC token is invalid")
    header_value = json.loads(_base64url_decode(parts[0]))
    claims = json.loads(_base64url_decode(parts[1]))
    if not isinstance(header_value, dict) or not isinstance(claims, dict):
        raise TypeError("GitHub OIDC token payload is invalid")
    key_id = str(header_value.get("kid") or "")
    if header_value.get("alg") != "RS256" or not key_id:
        raise RuntimeError("GitHub OIDC token algorithm is invalid")
    keys = [
        key
        for key in _github_jwks()["keys"]
        if isinstance(key, dict) and key.get("kid") == key_id
    ]
    if len(keys) != 1:
        raise RuntimeError("GitHub OIDC signing key was not found")
    _verify_rs256_signature(
        f"{parts[0]}.{parts[1]}".encode("ascii"),
        _base64url_decode(parts[2]),
        keys[0],
    )
    return _verify_github_oidc_claims(claims, git_sha=git_sha)


def _verify_browser_parity_report(
    report: dict[str, Any],
    *,
    matrix: dict[str, Any],
    matrix_uri: str,
    matrix_sha256: str,
    manifest_sha256: str,
    git_sha: str,
    digest: str,
    font_manifest_sha256: str,
    release_identity: dict[str, str] | None = None,
) -> None:
    expected_runtime_identity = {
        "sourceGitSha": git_sha,
        "imageDigest": digest,
        "renderSpecVersion": "4",
        "captionRenderSpecVersion": "4",
        "fontManifestSha256": font_manifest_sha256,
    }
    checks = report.get("checks")
    if (
        report.get("schemaVersion") != 2
        or report.get("gitSha") != git_sha
        or report.get("workerImageDigest") != digest
        or report.get("fontManifestSha256") != font_manifest_sha256
        or report.get("runtimeIdentity") != expected_runtime_identity
        or (
            release_identity is not None
            and report.get("releaseIdentity") != release_identity
        )
        or report.get("workerManifestSha256") != manifest_sha256
        or report.get("workerMatrixSha256") != matrix_sha256
        or report.get("workerMatrixSource") != matrix_uri
        or report.get("maximumAllowedErrorPixels") != 2
        or report.get("caseCount") != _BROWSER_PARITY_CASE_COUNT
        or set(report.get("fontIds") or []) != _REQUIRED_FONTS
        or set(report.get("coverage") or []) != _BROWSER_PARITY_REQUIRED_COVERAGE
        or not isinstance(report.get("browsers"), list)
        or not report["browsers"]
        or any("Chrome/" not in str(value) for value in report["browsers"])
        or not isinstance(checks, dict)
        or any(checks.get(name) is not True for name in _BROWSER_PARITY_REQUIRED_CHECKS)
    ):
        raise RuntimeError("Browser/worker parity report identity or checks do not match")
    _parity_number(report.get("maximumDomErrorPixels"), "DOM error")
    _parity_number(report.get("maximumPixelErrorPixels"), "pixel error")

    matrix_cases = matrix.get("cases")
    report_cases = report.get("cases")
    if (
        matrix.get("schemaVersion") != 1
        or matrix.get("renderer") != "isolated-linux-worker-v4"
        or matrix.get("runtimeIdentity") != expected_runtime_identity
        or matrix.get("caseCount") != _BROWSER_PARITY_CASE_COUNT
        or set(matrix.get("fontIds") or []) != _REQUIRED_FONTS
        or not isinstance(matrix_cases, list)
        or len(matrix_cases) != _BROWSER_PARITY_CASE_COUNT
        or not isinstance(report_cases, list)
        or len(report_cases) != _BROWSER_PARITY_CASE_COUNT
    ):
        raise RuntimeError("Worker browser parity matrix identity is invalid")

    expected_cases: dict[str, dict[str, Any]] = {}
    coverage: set[str] = set()
    caption_modes: dict[str, set[str]] = {}
    title_fonts: set[str] = set()
    for item in matrix_cases:
        if not isinstance(item, dict):
            raise TypeError("Worker browser parity matrix case is invalid")
        case_id = str(item.get("id") or "")
        case_coverage = item.get("coverage")
        fixture = item.get("fixture")
        frame_name = str(item.get("workerFrameName") or "")
        frame_sha256 = str(item.get("workerFrameSha256") or "")
        font_id = str(item.get("fontId") or "")
        if (
            not re.fullmatch(r"[a-z0-9-]{3,100}", case_id)
            or case_id in expected_cases
            or not isinstance(case_coverage, list)
            or not isinstance(fixture, dict)
            or fixture.get("caseId") != case_id
            or fixture.get("coverage") != case_coverage
            or fixture.get("fontId") != font_id
            or font_id not in _REQUIRED_FONTS
            or frame_name != f"frames/{case_id}.png"
            or not _FONT_MANIFEST_SHA256.fullmatch(frame_sha256)
        ):
            raise RuntimeError("Worker browser parity matrix case identity is invalid")
        expected_cases[case_id] = item
        coverage.update(str(value) for value in case_coverage)
        if "font-template-mode-matrix" in case_coverage:
            template_id = str(item.get("templateId") or "")
            caption = fixture.get("caption")
            if (
                template_id not in {"pop", "highlight"}
                or not isinstance(caption, dict)
                or caption.get("mode")
                != ("positioned-pop" if template_id == "pop" else "flow-highlight")
            ):
                raise RuntimeError("Worker caption font/mode matrix case is invalid")
            caption_modes.setdefault(font_id, set()).add(template_id)
        if "title-font-matrix" in case_coverage:
            compiler_input = (fixture.get("title") or {}).get("compilerInput") or {}
            title = str(compiler_input.get("title") or "")
            if (
                compiler_input.get("fontId") != font_id
                or not re.search(r"[A-Za-z]", title)
                or not re.search(r"[가-힣]", title)
                or font_id in title_fonts
            ):
                raise RuntimeError("Worker title font matrix case is invalid")
            title_fonts.add(font_id)
    if (
        coverage != _BROWSER_PARITY_REQUIRED_COVERAGE
        or set(caption_modes) != _REQUIRED_FONTS
        or any(value != {"pop", "highlight"} for value in caption_modes.values())
        or title_fonts != _REQUIRED_FONTS
    ):
        raise RuntimeError("Worker browser parity coverage is incomplete")

    observed_cases: set[str] = set()
    for item in report_cases:
        if not isinstance(item, dict):
            raise TypeError("Browser parity aggregate case is invalid")
        case_id = str(item.get("caseId") or "")
        expected = expected_cases.get(case_id)
        case_checks = item.get("checks")
        if (
            expected is None
            or case_id in observed_cases
            or item.get("coverage") != expected.get("coverage")
            or item.get("fontId") != expected.get("fontId")
            or item.get("workerFrameSha256") != expected.get("workerFrameSha256")
            or item.get("workerFrameSource")
            != matrix_uri.removesuffix("matrix.json")
            + str(expected.get("workerFrameName") or "")
            or not _FONT_MANIFEST_SHA256.fullmatch(
                str(item.get("browserScreenshotSha256") or "")
            )
            or not isinstance(case_checks, dict)
            or case_checks.get(_BROWSER_PARITY_CHECK) is not True
            or case_checks.get("browserTemplateCompilerParity") is not True
            or case_checks.get("storedSpecConsumerParity") is not True
        ):
            raise RuntimeError(f"Browser parity aggregate case is invalid: {case_id}")
        _parity_number(item.get("maximumDomErrorPixels"), f"{case_id} DOM error")
        _parity_number(item.get("maximumPixelErrorPixels"), f"{case_id} pixel error")
        observed_cases.add(case_id)
    if observed_cases != set(expected_cases):
        raise RuntimeError("Browser parity aggregate omitted worker matrix cases")


def _verify_manifest(
    manifest: dict[str, Any],
    *,
    git_sha: str,
    digest: str,
    document_version: int,
    subtitle_editing_capable: bool,
    render_spec_version: int | None = None,
    caption_render_spec_version: int | None = None,
    font_manifest_sha256: str | None = None,
) -> None:
    is_v4 = render_spec_version == _V4_RENDER_SPEC_VERSION
    expected_schema_version = 2 if is_v4 else 1
    if (
        manifest.get("schemaVersion") != expected_schema_version
        or manifest.get("gitSha") != git_sha
        or manifest.get("workerImageDigest") != digest
        or manifest.get("documentVersion") != document_version
    ):
        raise RuntimeError("Editor release manifest identity does not match")
    if is_v4 and (
        manifest.get("renderSpecVersion") != render_spec_version
        or manifest.get("captionRenderSpecVersion")
        != caption_render_spec_version
        or manifest.get("fontManifestSha256") != font_manifest_sha256
    ):
        raise RuntimeError("Editor release v4 capability evidence does not match")
    if is_v4:
        runtime_identity = manifest.get("runtimeIdentity")
        if not isinstance(runtime_identity, dict) or runtime_identity != {
            "sourceGitSha": git_sha,
            "imageDigest": digest,
            "renderSpecVersion": str(render_spec_version),
            "captionRenderSpecVersion": str(caption_render_spec_version),
            "fontManifestSha256": font_manifest_sha256,
        }:
            raise RuntimeError("Editor release runtime identity evidence does not match")
    checks = manifest.get("checks")
    required_checks = _REQUIRED_CHECKS | (
        _V4_REQUIRED_CHECKS if is_v4 else set()
    )
    if not isinstance(checks, dict) or {
        name for name in required_checks if checks.get(name) is not True
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
    if is_v4:
        font_manifest = manifest.get("fontManifest")
        entries = (
            font_manifest.get("entries")
            if isinstance(font_manifest, dict)
            else None
        )
        if (
            not isinstance(font_manifest, dict)
            or font_manifest.get("sha256") != font_manifest_sha256
            or font_manifest.get("fallbackDetected") is not False
            or not isinstance(entries, list)
            or len(entries) != len(_REQUIRED_FONTS)
        ):
            raise RuntimeError("Editor release font manifest is invalid")
        observed_font_ids: set[str] = set()
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {
                "fontId",
                "sha256",
                "postscriptName",
                "resolvedPath",
                "cssToAssScale",
                "cssToAssBaselineOffsetEm",
                "titleBaselineOffsetEm",
                "wordSpaceAdvanceEm",
            }:
                raise RuntimeError("Editor release font manifest is invalid")
            font_id = str(entry.get("fontId") or "")
            file_sha256 = str(entry.get("sha256") or "")
            postscript_name = str(entry.get("postscriptName") or "").strip()
            resolved_path = str(entry.get("resolvedPath") or "").strip()
            css_to_ass_scale = entry.get("cssToAssScale")
            css_to_ass_baseline_offset = entry.get("cssToAssBaselineOffsetEm")
            title_baseline_offset = entry.get("titleBaselineOffsetEm")
            word_space_advance = entry.get("wordSpaceAdvanceEm")
            expected_file = _REQUIRED_FONT_FILES.get(font_id)
            expected_path = (
                f"{_EDITOR_FONT_ROOT}/{expected_file}" if expected_file else ""
            )
            if (
                font_id in observed_font_ids
                or not _FONT_MANIFEST_SHA256.fullmatch(file_sha256)
                or not postscript_name
                or resolved_path != expected_path
                or ".." in resolved_path.split("/")
                or isinstance(css_to_ass_scale, bool)
                or not isinstance(css_to_ass_scale, int | float)
                or not 0 < float(css_to_ass_scale) <= 1.2
                or isinstance(css_to_ass_baseline_offset, bool)
                or not isinstance(css_to_ass_baseline_offset, int | float)
                or not -0.25 <= float(css_to_ass_baseline_offset) <= 0.25
                or isinstance(title_baseline_offset, bool)
                or not isinstance(title_baseline_offset, int | float)
                or not -0.25 <= float(title_baseline_offset) <= 0.75
                or isinstance(word_space_advance, bool)
                or not isinstance(word_space_advance, int | float)
                or not 0 < float(word_space_advance) <= 1
            ):
                raise RuntimeError("Editor release font manifest is invalid")
            observed_font_ids.add(font_id)
        if observed_font_ids != _REQUIRED_FONTS:
            raise RuntimeError("Editor release font manifest is incomplete")
        canonical_manifest = json.dumps(
            {
                "fallbackDetected": False,
                "entries": sorted(entries, key=lambda entry: entry["fontId"]),
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        computed_manifest_sha256 = hashlib.sha256(canonical_manifest).hexdigest()
        if computed_manifest_sha256 != font_manifest_sha256:
            raise RuntimeError("Editor release font manifest hash does not match")
    capabilities = manifest.get("capabilities")
    if (
        not isinstance(capabilities, dict)
        or capabilities.get("subtitleEditing") is not subtitle_editing_capable
        or not subtitle_editing_capable
    ):
        raise RuntimeError(
            "Editor release did not verify the subtitle editing capability"
        )


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


def _read_project_target_registry() -> dict[str, Any]:
    path = os.environ.get("PROJECT_TARGET_REGISTRY_PATH", "").strip()
    if path != "/var/task/production-project-targets.json":
        raise RuntimeError("Production project target registry is not configured")
    with open(path, encoding="utf-8") as handle:
        registry = json.load(handle)
    if not isinstance(registry, dict):
        raise TypeError("Production project target registry is invalid")
    lanes = registry.get("lanes")
    if (
        registry.get("version") != 1
        or registry.get("environment") != "production"
        or not isinstance(lanes, dict)
        or set(lanes) != _PROJECT_TARGET_LANES
    ):
        raise RuntimeError("Production project target registry is invalid")
    return registry


def _arn_identity(arn: str) -> tuple[str, str]:
    match = re.match(r"^arn:aws:batch:([^:]+):([0-9]{12}):", arn)
    if not match:
        raise ValueError("Batch target ARN identity is invalid")
    return match.group(1), match.group(2)


def _verify_project_targets(
    event: dict[str, Any],
    *,
    git_sha: str,
    digest: str,
    render_spec_version: int,
    caption_render_spec_version: int,
    font_manifest_sha256: str,
) -> dict[str, dict[str, str]]:
    supplied = event.get("projectTargets")
    if not isinstance(supplied, dict) or set(supplied) != _PROJECT_TARGET_LANES:
        raise ValueError("Editor v4 release must declare all five project targets")
    registry = _read_project_target_registry()
    verified: dict[str, dict[str, str]] = {}
    for lane in sorted(_PROJECT_TARGET_LANES):
        target = supplied.get(lane)
        if not isinstance(target, dict) or set(target) != {
            "batchTargetReleaseId",
            "workerSourceGitSha",
            "workerImageDigest",
            "jobDefinitionArn",
            "jobQueueArn",
        }:
            raise ValueError(f"Editor v4 {lane} project target is invalid")
        normalized = {
            name: str(value or "").strip() for name, value in target.items()
        }
        definition_arn = normalized["jobDefinitionArn"]
        queue_arn = normalized["jobQueueArn"]
        if (
            not _PROJECT_TARGET_RELEASE_ID.fullmatch(
                normalized["batchTargetReleaseId"]
            )
            or normalized["workerSourceGitSha"] != git_sha
            or normalized["workerImageDigest"] != digest
            or not _PROJECT_JOB_DEFINITION.fullmatch(definition_arn)
            or git_sha[:12] not in definition_arn
            or not _JOB_QUEUE.fullmatch(queue_arn)
            or _arn_identity(definition_arn) != _arn_identity(queue_arn)
        ):
            raise ValueError(f"Editor v4 {lane} project target identity is invalid")
        trusted_target = registry["lanes"][lane]["current"]
        if queue_arn != trusted_target.get("jobQueueArn"):
            raise RuntimeError(f"Editor v4 {lane} queue differs from current")
        candidate = _job_definition(definition_arn)
        trusted = _job_definition(str(trusted_target.get("jobDefinitionArn") or ""))
        _definition_image(candidate, digest)
        _verify_definition_contract(
            candidate,
            trusted,
            git_sha=git_sha,
            render_spec_version=render_spec_version,
            caption_render_spec_version=caption_render_spec_version,
            font_manifest_sha256=font_manifest_sha256,
        )
        verified[lane] = normalized
    return verified


def _record_release(
    event: dict[str, Any],
    *,
    git_sha: str,
    digest: str,
    production_definition_arn: str,
    artifact_uri: str,
    manifest: dict[str, Any],
    subtitle_editing_capable: bool,
    render_spec_version: int | None = None,
    caption_render_spec_version: int | None = None,
    font_manifest_sha256: str | None = None,
    project_targets: dict[str, dict[str, str]] | None = None,
    browser_parity_matrix_uri: str | None = None,
    browser_parity_report_sha256: str | None = None,
    browser_parity_report: dict[str, Any] | None = None,
    workflow_run_url: str | None = None,
) -> str:
    existing = rest("editor_releases", query=(
        "select=id,status,ui_version,document_version,"
        "production_job_definition_arn,subtitle_editing_capable,"
        "render_spec_version,caption_render_spec_version,font_manifest_sha256"
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
            or release.get("subtitle_editing_capable")
            is not subtitle_editing_capable
            or release.get("render_spec_version") != render_spec_version
            or release.get("caption_render_spec_version")
            != caption_render_spec_version
            or release.get("font_manifest_sha256") != font_manifest_sha256
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
                "subtitle_editing_capable": subtitle_editing_capable,
                "render_spec_version": render_spec_version,
                "caption_render_spec_version": caption_render_spec_version,
                "font_manifest_sha256": font_manifest_sha256,
                "status": "built",
            },
            prefer="return=representation",
        ) or []
        if len(created) != 1 or not _UUID.fullmatch(str(created[0].get("id") or "")):
            raise RuntimeError("Editor release was not created")
        release_id = str(created[0]["id"])

    if render_spec_version == 4:
        if not project_targets or set(project_targets) != _PROJECT_TARGET_LANES:
            raise RuntimeError("Editor v4 project targets were not verified")
        expected_targets = {
            lane: {
                "target_key": lane,
                "batch_target_release_id": target["batchTargetReleaseId"],
                "worker_source_git_sha": target["workerSourceGitSha"],
                "worker_image_digest": target["workerImageDigest"],
                "job_definition_arn": target["jobDefinitionArn"],
                "job_queue_arn": target["jobQueueArn"],
            }
            for lane, target in project_targets.items()
        }
        existing_targets = rest(
            "editor_release_project_targets",
            query=(
                "select=target_key,batch_target_release_id,worker_source_git_sha,"
                "worker_image_digest,job_definition_arn,job_queue_arn"
                f"&release_id=eq.{release_id}"
            ),
        ) or []
        if existing_targets:
            observed_targets = {
                str(target.get("target_key") or ""): target
                for target in existing_targets
            }
            if observed_targets != expected_targets:
                raise RuntimeError(
                    "Existing release has different immutable project targets"
                )
        else:
            rest(
                "editor_release_project_targets",
                method="POST",
                body=[
                    {"release_id": release_id, **expected_targets[lane]}
                    for lane in sorted(expected_targets)
                ],
                prefer="return=minimal",
            )

    check_sources = manifest.get("checkSources")
    required_checks = _REQUIRED_CHECKS | (
        _V4_REQUIRED_CHECKS if render_spec_version == 4 else set()
    )
    if render_spec_version == 4:
        if (
            browser_parity_report is None
            or browser_parity_matrix_uri is None
            or browser_parity_report_sha256 is None
            or workflow_run_url is None
        ):
            raise RuntimeError("Editor v4 browser/worker parity was not verified")
        required_checks.add(_BROWSER_PARITY_CHECK)
    for check_name in sorted(required_checks):
        is_browser_parity = check_name == _BROWSER_PARITY_CHECK
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
                        "actual-chromium-vs-isolated-linux-worker"
                        if is_browser_parity
                        else check_sources.get(check_name)
                        if isinstance(check_sources, dict)
                        else "isolated-probe"
                    ),
                    "batchJobId": event["isolatedBatchJobId"],
                    "workflowRunUrl": workflow_run_url,
                    **({
                        "reportSha256": browser_parity_report_sha256,
                        "caseCount": browser_parity_report["caseCount"],
                        "maximumDomErrorPixels": browser_parity_report[
                            "maximumDomErrorPixels"
                        ],
                        "maximumPixelErrorPixels": browser_parity_report[
                            "maximumPixelErrorPixels"
                        ],
                        "report": browser_parity_report,
                    } if is_browser_parity and browser_parity_report else {}),
                },
                "artifact_uri": (
                    browser_parity_matrix_uri
                    if is_browser_parity
                    else artifact_uri
                ),
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


def _legacy_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
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
    document_version = int(event.get("documentVersion") or 0)
    subtitle_editing_capable = event.get("subtitleEditingCapable") is True
    if (
        int(event.get("uiVersion") or 0) < 2
        or document_version not in _SUPPORTED_DOCUMENT_VERSIONS
    ):
        raise ValueError("Unsupported editor UI or document version")
    if not subtitle_editing_capable:
        raise ValueError("Editor release must declare subtitle editing capability")
    render_spec_version: int | None = None
    caption_render_spec_version: int | None = None
    font_manifest_sha256: str | None = None
    project_targets: dict[str, dict[str, str]] | None = None
    browser_parity_report_json: str | None = None
    browser_parity_report_sha256: str | None = None
    workflow_run_url: str | None = None
    claims_v4 = any(
        event.get(name) is not None
        for name in (
            "renderSpecVersion",
            "captionRenderSpecVersion",
            "fontManifestSha256",
            "browserParityReportJson",
            "browserParityReportUri",
            "browserParityReportSha256",
        )
    )
    if claims_v4:
        render_spec_version = int(event.get("renderSpecVersion") or 0)
        caption_render_spec_version = int(
            event.get("captionRenderSpecVersion") or 0
        )
        font_manifest_sha256 = str(
            event.get("fontManifestSha256") or ""
        ).strip().lower()
        if (
            render_spec_version != _V4_RENDER_SPEC_VERSION
            or caption_render_spec_version != _V4_CAPTION_RENDER_SPEC_VERSION
            or not _FONT_MANIFEST_SHA256.fullmatch(font_manifest_sha256)
            or document_version != 3
        ):
            raise ValueError(
                "Editor v4 release must declare exact render, caption, and font capabilities"
            )
        if event.get("browserParityReportUri") is not None:
            raise ValueError("S3 browser parity reports are not authoritative")
        if event.get("workflowRunUrl") is not None:
            raise ValueError("workflowRunUrl must be derived from verified OIDC claims")
        browser_parity_report_json = _required_string(
            event,
            "browserParityReportJson",
        )
        browser_parity_report_sha256 = _required_string(
            event,
            "browserParityReportSha256",
        ).lower()
        if not _FONT_MANIFEST_SHA256.fullmatch(browser_parity_report_sha256):
            raise ValueError("browserParityReportSha256 is invalid")
        oidc_identity = _verify_github_oidc_token(
            _required_string(event, "githubOidcToken"),
            git_sha=git_sha,
        )
        workflow_run_url = oidc_identity["workflowRunUrl"]
        project_targets = _verify_project_targets(
            event,
            git_sha=git_sha,
            digest=digest,
            render_spec_version=render_spec_version,
            caption_render_spec_version=caption_render_spec_version,
            font_manifest_sha256=font_manifest_sha256,
        )
    elif event.get("projectTargets") is not None:
        raise ValueError("Legacy editor releases cannot claim v4 project targets")

    _verify_isolated_job(isolated_job_id, isolated_definition_arn)
    production_definition = _job_definition(production_definition_arn)
    isolated_definition = _job_definition(isolated_definition_arn)
    _verify_definition_contract(
        production_definition,
        _latest_job_definition(os.environ["RERENDER_JOB_DEFINITION"]),
        allow_candidate_resources=True,
        git_sha=git_sha,
        render_spec_version=render_spec_version,
        caption_render_spec_version=caption_render_spec_version,
        font_manifest_sha256=font_manifest_sha256,
    )
    _verify_definition_contract(
        isolated_definition,
        _latest_job_definition(
            os.environ["EDITOR_TEST_TEMPLATE_JOB_DEFINITION"],
        ),
        allow_candidate_resources=True,
        git_sha=git_sha,
        render_spec_version=render_spec_version,
        caption_render_spec_version=caption_render_spec_version,
        font_manifest_sha256=font_manifest_sha256,
    )
    production_image = _definition_image(production_definition, digest)
    isolated_image = _definition_image(isolated_definition, digest)
    if production_image != isolated_image:
        raise RuntimeError("Canary and isolated definitions use different images")
    _verify_ecr_scan(production_image, digest)
    manifest, manifest_sha256 = _read_manifest(artifact_uri)
    _verify_manifest(
        manifest,
        git_sha=git_sha,
        digest=digest,
        document_version=document_version,
        subtitle_editing_capable=subtitle_editing_capable,
        render_spec_version=render_spec_version,
        caption_render_spec_version=caption_render_spec_version,
        font_manifest_sha256=font_manifest_sha256,
    )
    browser_parity_report: dict[str, Any] | None = None
    browser_parity_matrix_uri: str | None = None
    if render_spec_version == _V4_RENDER_SPEC_VERSION:
        if browser_parity_report_json is None or browser_parity_report_sha256 is None:
            raise RuntimeError("Editor v4 browser/worker parity evidence is missing")
        browser_parity_matrix, browser_parity_matrix_sha256, browser_parity_matrix_uri = (
            _read_browser_parity_matrix(
                artifact_uri=artifact_uri,
                manifest=manifest,
            )
        )
        browser_parity_report = _read_inline_browser_parity_report(
            browser_parity_report_json,
            browser_parity_report_sha256,
        )
        _verify_browser_parity_report(
            browser_parity_report,
            matrix=browser_parity_matrix,
            matrix_uri=browser_parity_matrix_uri,
            matrix_sha256=browser_parity_matrix_sha256,
            manifest_sha256=manifest_sha256,
            git_sha=git_sha,
            digest=digest,
            font_manifest_sha256=font_manifest_sha256 or "",
        )
    release_id = _record_release(
        event,
        git_sha=git_sha,
        digest=digest,
        production_definition_arn=production_definition_arn,
        artifact_uri=artifact_uri,
        manifest=manifest,
        subtitle_editing_capable=subtitle_editing_capable,
        render_spec_version=render_spec_version,
        caption_render_spec_version=caption_render_spec_version,
        font_manifest_sha256=font_manifest_sha256,
        project_targets=project_targets,
        browser_parity_matrix_uri=browser_parity_matrix_uri,
        browser_parity_report_sha256=browser_parity_report_sha256,
        browser_parity_report=browser_parity_report,
        workflow_run_url=workflow_run_url,
    )
    log_event(
        "editor_release_registered",
        release_id=release_id,
        git_sha=git_sha,
        image_digest=digest,
        isolated_batch_job_id=isolated_job_id,
        subtitle_editing_capable=subtitle_editing_capable,
        render_spec_version=render_spec_version,
        caption_render_spec_version=caption_render_spec_version,
        font_manifest_sha256=font_manifest_sha256,
    )
    return {"releaseId": release_id, "status": "canary_ready"}


def _v4_request_identity(event: dict[str, Any]) -> tuple[
    str,
    str,
    str,
    dict[str, str],
]:
    git_sha = _required_string(event, "gitSha").lower()
    digest = _required_string(event, "imageDigest").lower()
    font_manifest_sha256 = _required_string(
        event,
        "fontManifestSha256",
    ).lower()
    if (
        not _SHA.fullmatch(git_sha)
        or not _DIGEST.fullmatch(digest)
        or not _FONT_MANIFEST_SHA256.fullmatch(font_manifest_sha256)
    ):
        raise ValueError("Editor v4 release identity is invalid")
    identity = _verify_github_oidc_token(
        _required_string(event, "githubOidcToken"),
        git_sha=git_sha,
    )
    _verify_ecr_release_identity(git_sha, digest)
    return git_sha, digest, font_manifest_sha256, identity


def _probe_response(probe: dict[str, Any]) -> dict[str, Any]:
    return {
        "probeRunId": str(probe.get("id") or ""),
        "nonce": str(probe.get("nonce") or ""),
        "state": str(probe.get("state") or ""),
        "isolatedJobName": probe.get("isolated_job_name"),
        "isolatedJobDefinitionArn": probe.get("isolated_job_definition_arn"),
        "isolatedBatchJobId": probe.get("isolated_batch_job_id"),
        "artifactUri": probe.get("artifact_uri"),
        "manifestVersionId": probe.get("manifest_s3_version_id"),
        "matrixVersionId": probe.get("matrix_s3_version_id"),
        "releaseId": probe.get("finalized_release_id"),
    }


def _reserve_probe(
    *,
    git_sha: str,
    digest: str,
    font_manifest_sha256: str,
    identity: dict[str, str],
) -> dict[str, Any]:
    return _rpc("reserve_editor_release_probe_v4", {
        "p_git_sha": git_sha,
        "p_worker_image_digest": digest,
        "p_font_manifest_sha256": font_manifest_sha256,
        "p_github_repository": identity["repository"],
        "p_github_repository_id": int(identity["repositoryId"]),
        "p_github_repository_owner_id": int(identity["repositoryOwnerId"]),
        "p_github_workflow_ref": identity["workflowRef"],
        "p_github_workflow_name": identity["workflow"],
        "p_github_release_ref": identity["ref"],
        "p_github_environment": identity["environment"],
        "p_github_workflow_run_id": int(identity["runId"]),
        "p_github_workflow_run_attempt": int(identity["runAttempt"]),
    })


def _reconcile_probe_job(
    *,
    job_name: str,
    queue_arn: str,
    definition_arn: str,
) -> str | None:
    response = batch.list_jobs(
        jobQueue=queue_arn,
        filters=[{"name": "JOB_NAME", "values": [job_name]}],
        maxResults=100,
    )
    summaries = [
        summary
        for summary in response.get("jobSummaryList", [])
        if summary.get("jobName") == job_name
    ]
    if not summaries:
        return None
    if len(summaries) != 1:
        raise RuntimeError("Multiple isolated probe jobs share one release identity")
    job_id = str(summaries[0].get("jobId") or "")
    jobs = batch.describe_jobs(jobs=[job_id]).get("jobs", [])
    if (
        len(jobs) != 1
        or jobs[0].get("jobName") != job_name
        or jobs[0].get("jobQueue") != queue_arn
        or jobs[0].get("jobDefinition") != definition_arn
    ):
        raise RuntimeError("Reconciled isolated probe job identity differs")
    return job_id


def _start_v4_probe(event: dict[str, Any]) -> dict[str, Any]:
    git_sha, digest, font_manifest_sha256, identity = _v4_request_identity(event)
    probe = _reserve_probe(
        git_sha=git_sha,
        digest=digest,
        font_manifest_sha256=font_manifest_sha256,
        identity=identity,
    )
    probe_id = str(probe.get("id") or "")
    nonce = str(probe.get("nonce") or "")
    state = str(probe.get("state") or "")
    if not _PROBE_ID.fullmatch(probe_id) or not _PROBE_NONCE.fullmatch(nonce):
        raise RuntimeError("Reserved editor release probe identity is invalid")
    if state != "reserved":
        response = _probe_response(probe)
        if probe.get("isolated_batch_job_id"):
            response["artifactUri"] = _probe_artifact_uri(probe)
        return response

    image = f"{_repository_identity()[0]}@{digest}"
    trusted = _latest_job_definition(
        os.environ["EDITOR_TEST_TEMPLATE_JOB_DEFINITION"],
    )
    definition_name = (
        f"shorts-mvp-editor-test-release-{git_sha[:12]}-{nonce[:8]}-4vcpu"
    )
    definition_payload = _registration_payload(
        trusted,
        name=definition_name,
        image=image,
        git_sha=git_sha,
        digest=digest,
        font_manifest_sha256=font_manifest_sha256,
        candidate_resources=True,
        forced_task_role_arn=os.environ["EDITOR_TEST_TASK_ROLE_ARN"],
        forced_execution_role_arn=os.environ["EDITOR_TEST_EXECUTION_ROLE_ARN"],
    )
    definition_arn = _register_exact_definition(definition_payload)
    if not _ISOLATED_DEFINITION_V4.fullmatch(definition_arn):
        raise RuntimeError("Isolated editor v4 Job Definition ARN is invalid")
    _verify_definition_contract(
        _job_definition(definition_arn),
        trusted,
        allow_candidate_resources=True,
        git_sha=git_sha,
        render_spec_version=4,
        caption_render_spec_version=4,
        font_manifest_sha256=font_manifest_sha256,
    )

    queue_arn = os.environ["EDITOR_TEST_JOB_QUEUE_ARN"]
    if not _JOB_QUEUE.fullmatch(queue_arn):
        raise RuntimeError("Isolated editor test queue ARN is invalid")
    job_name = f"editor-release-{git_sha[:12]}-{nonce[:8]}"
    job_id = _reconcile_probe_job(
        job_name=job_name,
        queue_arn=queue_arn,
        definition_arn=definition_arn,
    )
    if job_id is None:
        submitted = batch.submit_job(
            jobName=job_name,
            jobQueue=queue_arn,
            jobDefinition=definition_arn,
            containerOverrides={
                "command": ["python", "-m", "shorts_worker", "editor-release-probe"],
                "environment": [
                    {"name": "EDITOR_RELEASE_GIT_SHA", "value": git_sha},
                    {"name": "EDITOR_RELEASE_SUITE_VERIFIED", "value": "true"},
                    {"name": "EDITOR_RELEASE_PROBE_NONCE", "value": nonce},
                    {"name": "EDITOR_RELEASE_PROBE_RUN_ID", "value": probe_id},
                    {"name": "EDITOR_RENDER_SPEC_VERSION", "value": "4"},
                    {"name": "EDITOR_CAPTION_RENDER_SPEC_VERSION", "value": "4"},
                    {
                        "name": "EDITOR_FONT_MANIFEST_SHA256",
                        "value": font_manifest_sha256,
                    },
                ],
            },
            retryStrategy={"attempts": 1},
            timeout={"attemptDurationSeconds": 2700},
            propagateTags=True,
            tags={
                "ReleaseSha": git_sha,
                "ProbeNonce": nonce,
                "ProbeRunId": probe_id,
            },
        )
        job_id = str(submitted.get("jobId") or "")
    if not _BATCH_JOB_ID.fullmatch(job_id):
        raise RuntimeError("Isolated editor probe Batch job ID is invalid")
    attached = _rpc("attach_editor_release_probe_job_v4", {
        "p_probe_id": probe_id,
        "p_nonce": nonce,
        "p_isolated_job_name": job_name,
        "p_isolated_job_queue_arn": queue_arn,
        "p_isolated_job_definition_arn": definition_arn,
        "p_isolated_batch_job_id": job_id,
    })
    log_event(
        "editor_release_probe_started",
        probe_run_id=probe_id,
        git_sha=git_sha,
        image_digest=digest,
        isolated_batch_job_id=job_id,
    )
    response = _probe_response(attached)
    response["artifactUri"] = _probe_artifact_uri(attached)
    return response


def _load_probe(probe_id: str) -> dict[str, Any]:
    if not _PROBE_ID.fullmatch(probe_id):
        raise ValueError("probeRunId is invalid")
    rows = rest(
        "editor_release_probe_runs",
        query=(
            "select=*&id=eq."
            f"{urllib.parse.quote(probe_id, safe='')}&limit=1"
        ),
    ) or []
    if len(rows) != 1 or not isinstance(rows[0], dict):
        raise RuntimeError("Editor release probe was not found")
    return rows[0]


def _verify_probe_request_identity(
    probe: dict[str, Any],
    *,
    git_sha: str,
    digest: str,
    font_manifest_sha256: str,
    identity: dict[str, str],
) -> None:
    expected = {
        "git_sha": git_sha,
        "worker_image_digest": digest,
        "font_manifest_sha256": font_manifest_sha256,
        "github_repository": identity["repository"],
        "github_repository_id": int(identity["repositoryId"]),
        "github_repository_owner_id": int(identity["repositoryOwnerId"]),
        "github_workflow_ref": identity["workflowRef"],
        "github_workflow_name": identity["workflow"],
        "github_release_ref": identity["ref"],
        "github_environment": identity["environment"],
        "github_workflow_run_id": int(identity["runId"]),
        "github_workflow_run_attempt": int(identity["runAttempt"]),
    }
    if any(probe.get(name) != value for name, value in expected.items()):
        raise RuntimeError("Editor release probe and OIDC identities differ")


def _verify_isolated_v4_job(probe: dict[str, Any]) -> dict[str, Any]:
    job_id = str(probe.get("isolated_batch_job_id") or "")
    jobs = batch.describe_jobs(jobs=[job_id]).get("jobs", [])
    if len(jobs) != 1:
        raise RuntimeError("Isolated editor v4 test job was not found")
    job = jobs[0]
    container = job.get("container") or {}
    environment = {
        str(item.get("name") or ""): str(item.get("value") or "")
        for item in container.get("environment", [])
    }
    attempts = job.get("attempts") or []
    latest_attempt = (attempts[-1].get("container") or {}) if attempts else {}
    if (
        job.get("status") != "SUCCEEDED"
        or job.get("jobName") != probe.get("isolated_job_name")
        or job.get("jobQueue") != probe.get("isolated_job_queue_arn")
        or job.get("jobDefinition") != probe.get("isolated_job_definition_arn")
        or container.get("command")
        != ["python", "-m", "shorts_worker", "editor-release-probe"]
        or environment.get("EDITOR_RELEASE_PROBE_NONCE") != probe.get("nonce")
        or environment.get("EDITOR_RELEASE_PROBE_RUN_ID") != str(probe.get("id"))
        or environment.get("EDITOR_RELEASE_GIT_SHA") != probe.get("git_sha")
        or int(latest_attempt.get("exitCode", -1)) != 0
        or not job.get("stoppedAt")
    ):
        raise RuntimeError("Isolated editor v4 test job identity or result differs")
    stopped_at = datetime.fromtimestamp(int(job["stoppedAt"]) / 1000, tz=UTC)
    if (datetime.now(UTC) - stopped_at).total_seconds() > 24 * 60 * 60:
        raise RuntimeError("Isolated editor v4 evidence is older than 24 hours")
    return job


def _probe_artifact_uri(probe: dict[str, Any]) -> str:
    digest = str(probe["worker_image_digest"])
    return (
        f"s3://{os.environ['EDITOR_TEST_BUCKET_NAME']}/editor-release-probes/"
        f"{probe['git_sha']}/{digest[7:19]}/{probe['nonce']}/"
        f"{probe['isolated_batch_job_id']}/manifest.json"
    )


def _artifact_contract(
    manifest: dict[str, Any],
    relative_name: str,
) -> dict[str, str]:
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list):
        raise RuntimeError("Editor release manifest artifact versions are missing")
    matches = [
        item
        for item in artifacts
        if isinstance(item, dict) and item.get("relativeName") == relative_name
    ]
    if len(matches) != 1:
        raise RuntimeError(f"Editor release artifact is missing: {relative_name}")
    item = matches[0]
    value = {
        "versionId": str(item.get("versionId") or ""),
        "sha256": str(item.get("sha256") or ""),
    }
    if (
        not value["versionId"]
        or len(value["versionId"]) > 1024
        or not _FONT_MANIFEST_SHA256.fullmatch(value["sha256"])
    ):
        raise RuntimeError("Editor release artifact version contract is invalid")
    return value


def _register_v4_production_definitions(
    *,
    git_sha: str,
    digest: str,
    font_manifest_sha256: str,
) -> tuple[str, dict[str, dict[str, Any]]]:
    image = f"{_repository_identity()[0]}@{digest}"
    trusted_rerender = _job_definition(os.environ["RERENDER_JOB_DEFINITION"])
    production_payload = _registration_payload(
        trusted_rerender,
        name=f"shorts-mvp-editor-release-{git_sha[:12]}-4vcpu",
        image=image,
        git_sha=git_sha,
        digest=digest,
        font_manifest_sha256=font_manifest_sha256,
        candidate_resources=True,
    )
    production_arn = _register_exact_definition(production_payload)
    if not _PRODUCTION_DEFINITION.fullmatch(production_arn):
        raise RuntimeError("Production editor release Job Definition ARN is invalid")
    _verify_definition_contract(
        _job_definition(production_arn),
        trusted_rerender,
        allow_candidate_resources=True,
        git_sha=git_sha,
        render_spec_version=4,
        caption_render_spec_version=4,
        font_manifest_sha256=font_manifest_sha256,
    )

    registry = _read_project_target_registry()
    targets: dict[str, dict[str, Any]] = {}
    for lane in sorted(_PROJECT_TARGET_LANES):
        trusted_target = registry["lanes"][lane]["current"]
        trusted_arn = str(trusted_target.get("jobDefinitionArn") or "")
        queue_arn = str(trusted_target.get("jobQueueArn") or "")
        trusted = _job_definition(trusted_arn)
        lane_slug = lane.replace("_", "-")
        payload = _registration_payload(
            trusted,
            name=f"shorts-mvp-editor-v4-{lane_slug}-{git_sha[:12]}",
            image=image,
            git_sha=git_sha,
            digest=digest,
            font_manifest_sha256=font_manifest_sha256,
            candidate_resources=False,
        )
        definition_arn = _register_exact_definition(payload)
        if not _PROJECT_JOB_DEFINITION.fullmatch(definition_arn):
            raise RuntimeError(f"Editor v4 {lane} Job Definition ARN is invalid")
        _verify_definition_contract(
            _job_definition(definition_arn),
            trusted,
            git_sha=git_sha,
            render_spec_version=4,
            caption_render_spec_version=4,
            font_manifest_sha256=font_manifest_sha256,
        )
        targets[lane] = {
            "batchTargetReleaseId": f"{lane_slug}-{git_sha[:12]}-v4",
            "workerSourceGitSha": git_sha,
            "workerImageDigest": digest,
            "jobDefinitionArn": definition_arn,
            "jobQueueArn": queue_arn,
            "renderSpecVersion": 4,
        }
    return production_arn, targets


def _finalize_v4_release(event: dict[str, Any]) -> dict[str, Any]:
    git_sha, digest, font_manifest_sha256, identity = _v4_request_identity(event)
    probe = _load_probe(_required_string(event, "probeRunId").lower())
    _verify_probe_request_identity(
        probe,
        git_sha=git_sha,
        digest=digest,
        font_manifest_sha256=font_manifest_sha256,
        identity=identity,
    )
    if probe.get("state") == "finalized":
        return {
            "releaseId": probe.get("finalized_release_id"),
            "status": "canary_ready",
            "idempotent": True,
        }
    if probe.get("state") not in {"job_submitted", "evidence_verified"}:
        raise RuntimeError("Editor release probe is not ready for evidence verification")
    _verify_isolated_v4_job(probe)

    artifact_uri = _probe_artifact_uri(probe)
    stored_manifest_version = (
        str(probe.get("manifest_s3_version_id") or "") or None
    )
    manifest, manifest_sha256, manifest_version = _read_versioned_json(
        artifact_uri,
        maximum_bytes=64_000,
        version_id=stored_manifest_version,
    )
    if manifest.get("probeIdentity") != {
        "nonce": probe["nonce"],
        "batchJobId": probe["isolated_batch_job_id"],
        "probeRunId": str(probe["id"]),
    }:
        raise RuntimeError("Editor release manifest probe identity differs")
    _verify_manifest(
        manifest,
        git_sha=git_sha,
        digest=digest,
        document_version=3,
        subtitle_editing_capable=True,
        render_spec_version=4,
        caption_render_spec_version=4,
        font_manifest_sha256=font_manifest_sha256,
    )
    matrix_contract = _artifact_contract(manifest, "browser-parity/matrix.json")
    browser_matrix, matrix_sha256, matrix_uri = _read_browser_parity_matrix(
        artifact_uri=artifact_uri,
        manifest=manifest,
        version_id=matrix_contract["versionId"],
    )
    if matrix_sha256 != matrix_contract["sha256"]:
        raise RuntimeError("Editor release matrix artifact checksum differs")
    if probe.get("state") == "job_submitted":
        probe = _rpc("attach_editor_release_probe_evidence_v4", {
            "p_probe_id": str(probe["id"]),
            "p_nonce": str(probe["nonce"]),
            "p_artifact_uri": artifact_uri,
            "p_manifest_s3_version_id": manifest_version,
            "p_manifest_sha256": manifest_sha256,
            "p_matrix_uri": matrix_uri,
            "p_matrix_s3_version_id": matrix_contract["versionId"],
            "p_matrix_sha256": matrix_sha256,
        })
    elif (
        probe.get("artifact_uri") != artifact_uri
        or probe.get("manifest_s3_version_id") != manifest_version
        or probe.get("manifest_sha256") != manifest_sha256
        or probe.get("matrix_uri") != matrix_uri
        or probe.get("matrix_s3_version_id") != matrix_contract["versionId"]
        or probe.get("matrix_sha256") != matrix_sha256
    ):
        raise RuntimeError("Stored editor release evidence identity differs")

    report_json = _required_string(event, "browserParityReportJson")
    report_sha256 = _required_string(
        event,
        "browserParityReportSha256",
    ).lower()
    report = _read_inline_browser_parity_report(report_json, report_sha256)
    release_identity = {
        "probeRunId": str(probe["id"]),
        "nonce": str(probe["nonce"]),
        "batchJobId": str(probe["isolated_batch_job_id"]),
        "gitSha": git_sha,
        "imageDigest": digest,
        "githubRunId": identity["runId"],
        "githubRunAttempt": identity["runAttempt"],
        "workflowRef": identity["workflowRef"],
        "releaseRef": identity["ref"],
    }
    _verify_browser_parity_report(
        report,
        matrix=browser_matrix,
        matrix_uri=matrix_uri,
        matrix_sha256=matrix_sha256,
        manifest_sha256=manifest_sha256,
        git_sha=git_sha,
        digest=digest,
        font_manifest_sha256=font_manifest_sha256,
        release_identity=release_identity,
    )

    production_arn, project_targets = _register_v4_production_definitions(
        git_sha=git_sha,
        digest=digest,
        font_manifest_sha256=font_manifest_sha256,
    )
    check_sources = manifest.get("checkSources") or {}
    required_checks = sorted(
        _REQUIRED_CHECKS | _V4_REQUIRED_CHECKS | {_BROWSER_PARITY_CHECK}
    )
    release_checks = [
        {
            "checkName": name,
            "artifactUri": matrix_uri if name == _BROWSER_PARITY_CHECK else artifact_uri,
            "details": (
                {
                    "source": "actual-chromium-vs-isolated-linux-worker",
                    "caseCount": report["caseCount"],
                    "maximumDomErrorPixels": report["maximumDomErrorPixels"],
                    "maximumPixelErrorPixels": report["maximumPixelErrorPixels"],
                    "report": report,
                }
                if name == _BROWSER_PARITY_CHECK
                else {"source": check_sources.get(name, "isolated-probe")}
            ),
        }
        for name in required_checks
    ]
    result = _rpc("finalize_editor_render_v4_release", {
        "p_probe_id": str(probe["id"]),
        "p_nonce": str(probe["nonce"]),
        "p_production_job_definition_arn": production_arn,
        "p_project_targets": project_targets,
        "p_release_checks": release_checks,
        "p_browser_parity_report_sha256": report_sha256,
        "p_workflow_run_url": identity["workflowRunUrl"],
    })
    log_event(
        "editor_release_registered",
        release_id=result.get("releaseId"),
        probe_run_id=probe.get("id"),
        git_sha=git_sha,
        image_digest=digest,
        isolated_batch_job_id=probe.get("isolated_batch_job_id"),
        render_spec_version=4,
        caption_render_spec_version=4,
        font_manifest_sha256=font_manifest_sha256,
    )
    return {
        **result,
        "productionJobDefinitionArn": production_arn,
        "projectTargets": project_targets,
    }


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    action = str(event.get("action") or "").strip()
    if action == "startProbe":
        return _start_v4_probe(event)
    if action == "finalizeRelease":
        return _finalize_v4_release(event)
    if action:
        raise ValueError("Unsupported editor release registrar action")
    return _legacy_handler(event, context)
