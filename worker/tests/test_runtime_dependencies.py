from importlib.metadata import version


def test_youtube_runtime_dependencies_are_pinned() -> None:
    assert version("yt-dlp") == "2026.7.4"
    assert version("yt-dlp-ejs") == "0.8.0"
