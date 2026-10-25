"""Minimal public-video attestation runtime; no account or browser material."""

import shutil
import subprocess
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

PO_TOKEN_PLAYER_CLIENT = "mweb"
PO_TOKEN_PROVIDER_HOME = Path("/opt/bgutil-ytdlp-pot-provider/server")
PO_TOKEN_PROVIDER_VERSION = "1.3.1"


def validate():
    try:
        installed = version("bgutil-ytdlp-pot-provider")
    except PackageNotFoundError as exc:
        raise RuntimeError("Public attestation provider is missing") from exc
    if installed != PO_TOKEN_PROVIDER_VERSION:
        raise RuntimeError("Public attestation version mismatch")
    node = shutil.which("node")
    script = PO_TOKEN_PROVIDER_HOME / "build" / "generate_once.js"
    if not node or not script.is_file():
        raise RuntimeError("Public attestation runtime is incomplete")
    result = subprocess.run(
        [node, str(script), "--version"],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
        shell=False,
    )
    if result.returncode or result.stdout.strip() != PO_TOKEN_PROVIDER_VERSION:
        raise RuntimeError("Public attestation runtime validation failed")
