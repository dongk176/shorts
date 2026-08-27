from __future__ import annotations

import json
import os
import re
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .errors import RenderError
from .font_manifest import canonical_editor_font_manifest

_GIT_SHA = re.compile(r"^[0-9a-f]{40}$")
_IMAGE_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_FONT_MANIFEST_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_ECS_METADATA_URI = re.compile(
    r"^http://169\.254\.170\.2/v4/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$"
)
_EMBEDDED_SOURCE_SHA_PATH = Path(__file__).resolve().parents[1] / (
    ".worker-source-git-sha"
)


def initial_render_v4_opt_in(job: dict[str, Any]) -> bool:
    """Return the exact DB capability pair, rejecting partial opt-ins."""
    render_version = job.get("initial_render_spec_version")
    caption_version = job.get("initial_caption_render_spec_version")
    if render_version is None and caption_version is None:
        return False
    if (
        type(render_version) is not int
        or type(caption_version) is not int
        or render_version != 4
        or caption_version != 4
    ):
        raise RenderError("최초 렌더 v4 기능 버전이 완전한 4/4 쌍이 아닙니다.")
    return True


def _embedded_worker_source_git_sha() -> str:
    try:
        return _EMBEDDED_SOURCE_SHA_PATH.read_text(encoding="ascii").strip()
    except OSError as exc:
        raise RenderError("워커 이미지의 소스 버전 증명을 찾지 못했습니다.") from exc


def _running_container_image_digest() -> str:
    metadata_uri = os.environ.get("ECS_CONTAINER_METADATA_URI_V4", "").strip()
    if not _ECS_METADATA_URI.fullmatch(metadata_uri):
        raise RenderError("실행 중인 컨테이너 이미지 증명 주소가 올바르지 않습니다.")
    request = urllib.request.Request(
        metadata_uri,
        headers={"Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=2) as response:  # noqa: S310
            payload = response.read(1_048_577)
    except (OSError, TimeoutError) as exc:
        raise RenderError("실행 중인 컨테이너 이미지 증명을 읽지 못했습니다.") from exc
    if len(payload) > 1_048_576:
        raise RenderError("실행 중인 컨테이너 이미지 증명이 너무 큽니다.")
    try:
        metadata = json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise RenderError("실행 중인 컨테이너 이미지 증명이 올바르지 않습니다.") from exc
    image_digest = metadata.get("ImageID") if isinstance(metadata, dict) else None
    if not isinstance(image_digest, str) or not _IMAGE_DIGEST.fullmatch(image_digest):
        raise RenderError("실행 중인 컨테이너 이미지 digest를 확인하지 못했습니다.")
    return image_digest


def verify_initial_render_v4_runtime(
    job: dict[str, Any],
    *,
    embedded_source_sha_reader: Callable[[], str] = _embedded_worker_source_git_sha,
    running_image_digest_reader: Callable[[], str] = _running_container_image_digest,
) -> dict[str, str] | None:
    """Fail closed unless a v4 job exactly matches its running worker image.

    Legacy NULL/NULL jobs intentionally skip every v4 identity requirement.
    The source SHA is embedded at image build time, while the image digest is
    read from the Fargate metadata endpoint.  Job Definition environment
    values therefore cannot claim a different image merely by overriding an
    environment variable.
    """
    if not initial_render_v4_opt_in(job):
        return None

    release_sha = os.environ.get("EDITOR_RELEASE_GIT_SHA", "").strip()
    image_digest = os.environ.get("WORKER_IMAGE_DIGEST", "").strip()
    render_version = os.environ.get("EDITOR_RENDER_SPEC_VERSION", "").strip()
    caption_version = os.environ.get(
        "EDITOR_CAPTION_RENDER_SPEC_VERSION",
        "",
    ).strip()
    font_manifest_sha256 = os.environ.get(
        "EDITOR_FONT_MANIFEST_SHA256",
        "",
    ).strip()
    if not _GIT_SHA.fullmatch(release_sha):
        raise RenderError("워커 소스 버전 환경값이 올바르지 않습니다.")
    if not _IMAGE_DIGEST.fullmatch(image_digest):
        raise RenderError("워커 이미지 digest 환경값이 올바르지 않습니다.")
    if render_version != "4" or caption_version != "4":
        raise RenderError("실행 중인 워커의 렌더 기능 버전이 4/4가 아닙니다.")
    if not _FONT_MANIFEST_SHA256.fullmatch(font_manifest_sha256):
        raise RenderError("실행 중인 워커의 폰트 명세 해시가 올바르지 않습니다.")

    embedded_source_sha = embedded_source_sha_reader().strip()
    if embedded_source_sha != release_sha:
        raise RenderError("실행 중인 워커 이미지의 소스 버전이 작업과 다릅니다.")
    running_image_digest = running_image_digest_reader().strip()
    if running_image_digest != image_digest:
        raise RenderError("실행 중인 워커 이미지 digest가 작업과 다릅니다.")
    actual_font_manifest_sha256 = str(
        canonical_editor_font_manifest().get("sha256") or ""
    )
    if actual_font_manifest_sha256 != font_manifest_sha256:
        raise RenderError("실행 중인 워커의 폰트 파일 명세가 작업과 다릅니다.")
    return {
        "sourceGitSha": release_sha,
        "imageDigest": image_digest,
        "renderSpecVersion": render_version,
        "captionRenderSpecVersion": caption_version,
        "fontManifestSha256": font_manifest_sha256,
    }
