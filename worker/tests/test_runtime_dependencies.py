from importlib.metadata import version


def test_youtube_runtime_dependencies_are_pinned() -> None:
    assert version("yt-dlp") == "2026.8.19"
    assert version("yt-dlp-ejs") == "0.8.0"
    assert version("bgutil-ytdlp-pot-provider") == "1.3.1"
