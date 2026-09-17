import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from shorts_worker.config import Settings
from shorts_worker.localized_selection import LocalizedSelectionError
from shorts_worker.schemas import LocalizedSelectionResponse, OutputLanguage
from shorts_worker.selector import TranscriptSelector


def title_response(language, *, too_long=False, empty_title=False):
    return {"clips": [{
        "start_seconds": 0, "end_seconds": 40,
        "hook_title_line1": "" if empty_title else "x" * 19 if too_long else (
            "A real title" if language == OutputLanguage.EN else "実際のタイトル"
        ),
        "hook_title_line2": (
            "Another title" if language == OutputLanguage.EN else "次のタイトルです"
        ),
        "reason": "A complete story." if language == OutputLanguage.EN else "完結した話です。",
        "hook_score": 20, "completeness_score": 15, "impact_score": 15,
        "shareability_score": 15, "density_score": 8,
    }]}


def length_error(language):
    with pytest.raises(ValidationError) as error:
        LocalizedSelectionResponse.model_validate(title_response(language, too_long=True))
    return error.value


@pytest.mark.parametrize("language", [OutputLanguage.EN, OutputLanguage.JA])
@pytest.mark.parametrize("output_limit", [None, 16384])
def test_new_source_language_empty_title_gets_one_bounded_retry(language, output_limit):
    client = MagicMock()
    def response(payload):
        return SimpleNamespace(usage=None, choices=[SimpleNamespace(
            finish_reason="stop", message=SimpleNamespace(content=json.dumps(payload)),
        )])
    client.chat.completions.create.side_effect = [
        response(title_response(language, empty_title=True)), response(title_response(language)),
    ]
    messages = [{"role": "user", "content": "원본 전사문"}]
    selector = TranscriptSelector(Settings(gemini_max_output_tokens=output_limit))
    with patch("openai.OpenAI", return_value=client):
        clips = selector._select_with_gemini(
            messages=messages, output_language=language, source_language="ko",
        )
    assert len(clips) == 1
    calls = client.chat.completions.create.call_args_list
    assert len(calls) == 2
    for call in calls:
        if output_limit is None:
            assert "max_tokens" not in call.kwargs
        else:
            assert call.kwargs["max_tokens"] == output_limit
    assert calls[1].kwargs["messages"][:1] == messages
    assert "accepted_ranges" in calls[1].kwargs["messages"][-1]["content"]
    assert messages == [{"role": "user", "content": "원본 전사문"}]


@pytest.mark.parametrize("language,source", [
    (OutputLanguage.EN, None), (OutputLanguage.JA, None), (OutputLanguage.KO, None),
])
def test_legacy_requests_do_not_get_an_extra_retry(language, source):
    client = MagicMock()
    client.beta.chat.completions.parse.side_effect = length_error(OutputLanguage.EN)
    with patch("openai.OpenAI", return_value=client), pytest.raises(ValidationError):
        TranscriptSelector(Settings())._select_with_gemini(
            messages=[], output_language=language, source_language=source,
        )
    assert client.beta.chat.completions.parse.call_count == 1


def test_second_empty_title_failure_is_propagated_without_a_loop():
    client = MagicMock()
    client.chat.completions.create.return_value = SimpleNamespace(usage=None, choices=[
        SimpleNamespace(finish_reason="stop", message=SimpleNamespace(
            content=json.dumps(title_response(OutputLanguage.JA, empty_title=True)),
        )),
    ])
    with patch("openai.OpenAI", return_value=client), pytest.raises(LocalizedSelectionError):
        TranscriptSelector(Settings())._select_with_gemini(
            messages=[], output_language=OutputLanguage.JA, source_language="ko",
        )
    assert client.chat.completions.create.call_count == 2


@pytest.mark.parametrize("error", [TimeoutError(), ValueError("wrong language")])
def test_non_length_errors_do_not_trigger_the_correction_call(error):
    client = MagicMock()
    client.chat.completions.create.side_effect = error
    with patch("openai.OpenAI", return_value=client), pytest.raises(type(error)):
        TranscriptSelector(Settings())._select_with_gemini(
            messages=[], output_language=OutputLanguage.JA, source_language="ko",
        )
    assert client.chat.completions.create.call_count == 1


def test_same_language_korean_keeps_valid_titles_without_currency_or_script_repair():
    client = MagicMock()
    client.chat.completions.create.return_value = SimpleNamespace(usage=None, choices=[
        SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=json.dumps({
            "clips": [{**title_response(OutputLanguage.EN)["clips"][0],
                       "hook_title_line1": "Apple Watch Ultra",
                       "hook_title_line2": "고른 이유는"}],
        }))),
    ])
    with patch("openai.OpenAI", return_value=client):
        result = TranscriptSelector(Settings())._select_with_gemini(
            messages=[], output_language=OutputLanguage.KO, source_language="ko",
        )
    assert result[0].hook_title == "Apple Watch Ultra\n고른 이유는"
    client.chat.completions.create.assert_called_once()
