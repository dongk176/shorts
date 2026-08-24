from __future__ import annotations

from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from PIL import Image, ImageOps, UnidentifiedImageError

ALLOWED_CHANNEL_THUMBNAIL_HOSTS = frozenset({"yt3.ggpht.com", "yt3.googleusercontent.com"})
MAX_CHANNEL_THUMBNAIL_BYTES = 5 * 1024 * 1024
MAX_CHANNEL_THUMBNAIL_PIXELS = 16_000_000
NORMALIZED_CHANNEL_THUMBNAIL_SIZE = 128


def _is_allowed_channel_thumbnail_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        return (
            parsed.scheme == "https"
            and parsed.hostname in ALLOWED_CHANNEL_THUMBNAIL_HOSTS
            and not parsed.username
            and not parsed.password
            and parsed.port in (None, 443)
        )
    except ValueError:
        return False


def download_channel_thumbnail(url: str | None, output_path: Path) -> Path | None:
    """Download and normalize a public YouTube channel avatar, or return a safe fallback."""
    if not url or not _is_allowed_channel_thumbnail_url(url):
        return None
    output_path.unlink(missing_ok=True)
    try:
        request = Request(url, headers={"User-Agent": "ShortsMakerWorker/1.0"})
        with urlopen(request, timeout=10) as response:  # noqa: S310 - strict allowlist above
            if not _is_allowed_channel_thumbnail_url(response.geturl()):
                return None
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip()
            if not content_type.startswith("image/"):
                return None
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_CHANNEL_THUMBNAIL_BYTES:
                return None
            payload = response.read(MAX_CHANNEL_THUMBNAIL_BYTES + 1)
        if len(payload) > MAX_CHANNEL_THUMBNAIL_BYTES:
            return None
        with Image.open(BytesIO(payload)) as source:
            if source.width * source.height > MAX_CHANNEL_THUMBNAIL_PIXELS:
                return None
            source.load()
            normalized = ImageOps.fit(
                source.convert("RGB"),
                (NORMALIZED_CHANNEL_THUMBNAIL_SIZE, NORMALIZED_CHANNEL_THUMBNAIL_SIZE),
                method=Image.Resampling.LANCZOS,
            )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        normalized.save(output_path, format="PNG", optimize=True)
        return output_path
    except (
        HTTPError,
        URLError,
        OSError,
        OverflowError,
        TypeError,
        ValueError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
    ):
        output_path.unlink(missing_ok=True)
        return None
