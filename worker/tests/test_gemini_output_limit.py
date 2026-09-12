from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from shorts_worker.comment_generator import CommentGenerator
from shorts_worker.config import Settings


@pytest.mark.parametrize("value,expected", [
    (None, None), ("", None), ("  ", None), ("16384", 16384),
    ("invalid", 16384), ("0", 1024), ("999999", 65536),
])
def test_optional_output_limit_has_bounded_settings(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv("GEMINI_MAX_OUTPUT_TOKENS", raising=False)
    else:
        monkeypatch.setenv("GEMINI_MAX_OUTPUT_TOKENS", value)
    assert Settings().gemini_max_output_tokens == expected


@pytest.mark.parametrize("limit", [None, 16384])
def test_comment_limit_is_only_sent_to_configured_gemini_client(limit):
    client = MagicMock()
    client.chat.completions.create.return_value = SimpleNamespace(choices=[
        SimpleNamespace(message=SimpleNamespace(content='{"clips": []}')),
    ])
    generator = CommentGenerator(Settings(gemini_max_output_tokens=limit))
    with patch("openai.OpenAI", return_value=client):
        assert generator._generate_with_gemini([]) == {"clips": []}
        assert client.chat.completions.create.call_args.kwargs.get("max_tokens") == limit
        if limit is None:
            assert "max_tokens" not in client.chat.completions.create.call_args.kwargs
        generator._generate_with_openai([])
        assert "max_tokens" not in client.chat.completions.create.call_args.kwargs
