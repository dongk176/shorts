from importlib.metadata import version


def test_youtube_runtime_dependencies_are_pinned() -> None:
    assert version("yt-dlp") == "2026.7.4"
    assert version("yt-dlp-ejs") == "0.8.0"
    assert version("bgutil-ytdlp-pot-provider") == "1.3.1"


def test_japanese_phrase_model_version_is_pinned() -> None:
    assert version("budoux") == "0.9.1"
