"""Private, bounded background inputs resolved by owner and immutable asset ID."""

from __future__ import annotations

import hashlib
import io
import re
from pathlib import Path
from uuid import UUID

from PIL import Image

from .errors import RenderError
from .repository import WorkerRepository
from .storage import ObjectStorage

MAX_BACKGROUND_BYTES = 2 * 1024 * 1024
BACKGROUND_SIZE = (1080, 1920)


def download_owned_background(
    *,
    repository: WorkerRepository,
    storage: ObjectStorage,
    user_id: str,
    asset_id: str,
    work_dir: Path,
) -> Path:
    """Never trust a URL/key in a document or silently replace missing assets."""
    try:
        owner = str(UUID(user_id))
        identity = str(UUID(asset_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise RenderError("배경 이미지의 소유자를 확인하지 못했습니다.") from exc
    asset = repository.get_background_asset(owner, identity)
    expected_key = f"custom-backgrounds/{owner}/{identity}.webp"
    if (
        not asset
        or str(asset.get("id")) != identity
        or str(asset.get("user_id")) != owner
        or asset.get("state") != "ready"
        or asset.get("object_key") != expected_key
        or not re.fullmatch(r"[0-9a-f]{64}", str(asset.get("sha256") or ""))
        or type(asset.get("byte_size")) is not int
        or not 0 < asset["byte_size"] <= MAX_BACKGROUND_BYTES
        or (asset.get("width"), asset.get("height")) != BACKGROUND_SIZE
    ):
        raise RenderError("사용할 수 없는 배경 이미지입니다. 배경을 다시 선택해주세요.")

    body = None
    try:
        response = storage.client.get_object(Bucket=storage.bucket, Key=expected_key)
        body = response["Body"]
        if response.get("ContentLength") != asset["byte_size"]:
            raise ValueError("background length mismatch")
        raw = body.read(MAX_BACKGROUND_BYTES + 1)
        if len(raw) != asset["byte_size"] or hashlib.sha256(raw).hexdigest() != asset["sha256"]:
            raise ValueError("background content mismatch")
        with Image.open(io.BytesIO(raw)) as source:
            if (
                source.format != "WEBP"
                or source.size != BACKGROUND_SIZE
                or getattr(source, "n_frames", 1) != 1
                or source.mode != "RGB"
            ):
                raise ValueError("background normalization mismatch")
            source.load()
    except Exception as exc:
        # Do not expose bucket/key, signed URLs, or SDK response bodies.
        raise RenderError("저장된 배경 이미지를 확인하지 못했습니다.") from exc
    finally:
        if body is not None:
            body.close()

    directory = work_dir.resolve() / "background-assets"
    directory.mkdir(parents=True, exist_ok=True)
    # This path is application generated beneath the task's ephemeral root.
    # UUIDs identify immutable objects, never a user-supplied filename.
    output = directory / f"{identity}.webp"
    output.write_bytes(raw)
    return output
