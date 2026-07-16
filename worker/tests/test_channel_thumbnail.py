from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image

from shorts_worker import channel_thumbnail


class FakeResponse:
    def __init__(self, payload: bytes, *, final_url: str) -> None:
        self.payload = payload
        self.final_url = final_url
        self.headers = {
            "Content-Type": "image/png",
            "Content-Length": str(len(payload)),
        }

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def geturl(self) -> str:
        return self.final_url

    def read(self, limit: int) -> bytes:
        return self.payload[:limit]


def _png_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (240, 120), "#2166d1").save(output, format="PNG")
    return output.getvalue()


def test_downloads_and_normalizes_youtube_channel_thumbnail(
    tmp_path: Path,
    monkeypatch,
) -> None:
    url = "https://yt3.ggpht.com/channel-avatar"
    monkeypatch.setattr(
        channel_thumbnail,
        "urlopen",
        lambda *_args, **_kwargs: FakeResponse(_png_bytes(), final_url=url),
    )

    output = channel_thumbnail.download_channel_thumbnail(url, tmp_path / "avatar.png")

    assert output == tmp_path / "avatar.png"
    with Image.open(output) as image:
        assert image.size == (128, 128)
        assert image.convert("RGB").getpixel((64, 64)) == (33, 102, 209)


def test_rejects_untrusted_or_redirected_channel_thumbnail_urls(
    tmp_path: Path,
    monkeypatch,
) -> None:
    calls = 0

    def redirected(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return FakeResponse(_png_bytes(), final_url="https://example.com/avatar.png")

    monkeypatch.setattr(channel_thumbnail, "urlopen", redirected)

    assert channel_thumbnail.download_channel_thumbnail(
        "https://example.com/avatar.png", tmp_path / "blocked.png"
    ) is None
    assert calls == 0
    assert channel_thumbnail.download_channel_thumbnail(
        "https://yt3.googleusercontent.com/avatar", tmp_path / "redirected.png"
    ) is None
    assert calls == 1
    assert not (tmp_path / "redirected.png").exists()
