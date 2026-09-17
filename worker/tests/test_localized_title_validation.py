from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from shorts_worker.config import Settings
from shorts_worker.schemas import (
    HighlightCandidate,
    LocalizedHighlightCandidate,
    LocalizedSelectionResponse,
    OutputLanguage,
    SubtitleSegment,
)
from shorts_worker.selector import (
    FALLBACK_TITLE_LINES,
    TranscriptSelector,
    _two_line_title,
)


def candidate(language=OutputLanguage.EN):
    return {
        "start_seconds": 0,
        "end_seconds": 45,
        "hook_title_line1": "A 150k won PC"
        if language == OutputLanguage.EN
        else "15万ウォンのPCで",
        "hook_title_line2": "Changed his life"
        if language == OutputLanguage.EN
        else "人生が変わった話",
        "reason": "He started with a 150k won computer."
        if language == OutputLanguage.EN
        else "15万ウォンのパソコンから始めた話です。",
        "hook_score": 25,
        "completeness_score": 18,
        "impact_score": 16,
        "shareability_score": 15,
        "density_score": 9,
    }


@pytest.mark.parametrize("line", ["abcd", "a" * 19, "a" * 41, "valid\nline", "valid\rline", 12345])
def test_localized_schema_rejects_invalid_lines_without_truncation(line):
    with pytest.raises(ValidationError):
        LocalizedHighlightCandidate.model_validate({**candidate(), "hook_title_line1": line})


@pytest.mark.parametrize("length", [5, 18])
def test_localized_schema_accepts_existing_length_boundaries(length):
    value = LocalizedHighlightCandidate.model_validate(
        {
            **candidate(),
            "hook_title_line1": "a" * length,
        }
    )
    assert value.hook_title_line1 == "a" * length


@pytest.mark.parametrize("language", [OutputLanguage.EN, OutputLanguage.JA])
def test_localized_provider_requests_strict_schema_and_keeps_valid_values(language):
    response = candidate(language)
    client = MagicMock()
    client.beta.chat.completions.parse.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(parsed={"clips": [response]}))],
    )
    clips = TranscriptSelector._parse_selection(client, "existing-model", [], language)
    assert (
        client.beta.chat.completions.parse.call_args.kwargs["response_format"]
        is LocalizedSelectionResponse
    )
    assert clips[0].hook_title == response["hook_title_line1"] + "\n" + response["hook_title_line2"]
    assert clips[0].reason == response["reason"]
    properties = LocalizedHighlightCandidate.model_json_schema()["properties"]
    assert properties["hook_title_line1"]["minLength"] == 5
    assert properties["hook_title_line2"]["maxLength"] == 18


@pytest.mark.parametrize("language", [OutputLanguage.EN, OutputLanguage.JA])
def test_invalid_localized_provider_uses_existing_fallback_without_extra_attempts(
    language, monkeypatch
):
    client = MagicMock()
    payload = {"clips": [{**candidate(language), "hook_title_line1": "a" * 19}]}
    client.beta.chat.completions.parse.side_effect = lambda **kwargs: SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    parsed=kwargs["response_format"].model_validate(payload),
                )
            )
        ],
    )
    monkeypatch.setattr("openai.OpenAI", MagicMock(return_value=client))
    selector = TranscriptSelector(
        Settings(
            gemini_api_key="test-key",
            gemini_paid_data_processing_confirmed=True,
            openai_api_key=None,
        )
    )
    clips = selector.select(
        video_title="원본 제목",
        duration_seconds=300,
        required_count=3,
        transcript=[SubtitleSegment(start=0, end=45, text="원본 영상의 내용")],
        output_language=language,
    )
    client.beta.chat.completions.parse.assert_called_once()
    assert len(clips) == 3
    assert all(c.selection_provider == "deterministic" for c in clips)
    assert all(5 <= len(line) <= 18 for c in clips for line in c.hook_title.splitlines())


@pytest.mark.parametrize("field", ["hook_title_line1", "reason"])
@pytest.mark.parametrize("language", [OutputLanguage.EN, OutputLanguage.JA])
def test_localized_provider_rejects_wrong_language(field, language):
    response = {**candidate(language), field: "한국어가 들어간 문구"}
    client = MagicMock()
    client.beta.chat.completions.parse.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(parsed={"clips": [response]}))],
    )
    with pytest.raises(ValueError, match="wrong language"):
        TranscriptSelector._parse_selection(client, "existing-model", [], language)


@pytest.mark.parametrize("language", [OutputLanguage.EN, OutputLanguage.JA])
@pytest.mark.parametrize("field", ["hook_title_line1", "reason"])
def test_server_keeps_title_wording_without_currency_rejection(language, field):
    response = {
        **candidate(language),
        field: "Just $150" if language == OutputLanguage.EN else "たった15万円のPC",
    }
    client = MagicMock()
    client.beta.chat.completions.parse.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(parsed={"clips": [response]}))],
    )
    source = [{"role": "user", "content": "15만 원짜리 컴퓨터로 시작해서 3천만 원을 벌었다."}]
    assert TranscriptSelector._parse_selection(client, "existing-model", source, language)


def test_title_cleanup_preserves_valid_punctuation_and_does_not_pad_short_lines():
    title = "Hey!!!\nValid second line"
    assert _two_line_title(title, OutputLanguage.EN) == title
    assert _two_line_title("Hey\nValid second line", OutputLanguage.EN) == "\n".join(
        FALLBACK_TITLE_LINES[OutputLanguage.EN],
    )


def test_legacy_schema_keeps_longer_title_lines():
    assert HighlightCandidate.model_validate(
        {**candidate(), "hook_title_line1": "a" * 25},
    ).hook_title_line1 == "a" * 25
