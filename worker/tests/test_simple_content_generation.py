import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from shorts_worker.comment_generator import CommentClipInput, CommentGenerator
from shorts_worker.config import Settings
from shorts_worker.localized_selection import request_candidates
from shorts_worker.schemas import OutputLanguage, SubtitleSegment
from shorts_worker.selector import TranscriptSelector
from shorts_worker.subtitle_translation import SubtitleTranslator


@pytest.mark.parametrize("count", [1, 4, 5])
@pytest.mark.parametrize("source", [None, "ko"])
def test_korean_comments_match_actual_production_worker_for_any_batch(count, source):
    original = Path(__file__).with_name("fixtures").joinpath(
        "production_comment_prompt_ff091cf79333.txt",
    ).read_text().rstrip("\n")
    clips = [CommentClipInput(i, "원본 제목", "이유", 20, [
        SubtitleSegment(start=0, end=20, text="이유로 골랐고 가격은 100만원, 색상은 27N1"),
    ], source_language=source) for i in range(1, count + 1)]
    system, user = CommentGenerator._messages(clips)
    assert system["content"] == original
    assert user["content"].count("100만원") == count
    assert user["content"].count("27N1") == count


@pytest.mark.parametrize("language", [OutputLanguage.EN, OutputLanguage.JA])
def test_community_instructions_are_once_per_request(language):
    def messages(count):
        return CommentGenerator._messages([
            CommentClipInput(i, "title", "reason", 20, [], language, "ko")
            for i in range(1, count + 1)
        ], culture=True)
    assert messages(1)[0] == messages(5)[0]
    assert messages(5)[0]["content"].count("outputLanguage=") == 1
    assert "clipIndex: 5" in messages(5)[1]["content"]


def completion(payload):
    return SimpleNamespace(choices=[SimpleNamespace(
        finish_reason="stop", message=SimpleNamespace(
            content=json.dumps(payload), refusal=None,
        ),
    )], usage=None)


def test_comment_request_uses_one_call_without_tools():
    client = MagicMock()
    client.chat.completions.create.return_value = completion({
        "clips": [{"clipIndex": 1, "comments": ["100万ウォンなら納得だわ"]}],
    })
    result = CommentGenerator._parse_response(client, "configured-model", [])
    assert result["clips"][0]["comments"] == ["100万ウォンなら納得だわ"]
    client.chat.completions.create.assert_called_once()
    assert "tools" not in client.chat.completions.create.call_args.kwargs


def test_title_request_uses_one_call_and_preserves_ai_wording():
    client = MagicMock()
    client.chat.completions.create.return_value = completion({"clips": [{
        "start_seconds": 0, "end_seconds": 40,
        "hook_title_line1": "100万ウォン", "hook_title_line2": "27N1を選ぶ理由",
        "reason": "元の価格と製品コードです。", "hook_score": 20,
        "completeness_score": 15, "impact_score": 15,
        "shareability_score": 15, "density_score": 8,
    }]})
    clips = request_candidates(client, "configured-model", [], "ja").clips
    assert clips[0].hook_title == "100万ウォン\n27N1を選ぶ理由"
    client.chat.completions.create.assert_called_once()
    assert "tools" not in client.chat.completions.create.call_args.kwargs


@pytest.mark.parametrize("source,target,text", [
    ("ko", "ja", "100万ウォンです。理由は色の27N1です。"),
    ("ja", "en", "It costs 15,000 yen."),
    ("en", "ko", "가격은 5달러입니다."),
])
def test_translation_uses_one_call_without_currency_processing(source, target, text):
    client = MagicMock()
    client.__enter__.return_value = client
    client.chat.completions.create.return_value = completion({"translations": {"0": text}})
    translator = SubtitleTranslator(Settings(gemini_api_key="test"))
    with patch("openai.OpenAI", return_value=client):
        response = translator._request({0: "원본"}, target, source)
    assert response == {"segments": [{"id": 0, "text": text}]}
    client.chat.completions.create.assert_called_once()
    kwargs = client.chat.completions.create.call_args.kwargs
    assert "tools" not in kwargs and "tool_choice" not in kwargs


def test_title_model_respects_existing_settings_for_language_projects():
    selector = TranscriptSelector(Settings(
        gemini_text_model="configured-model", gemini_api_key="test",
    ))
    with patch.object(selector, "_parse_selection", return_value=[]) as request:
        selector._select_with_gemini(messages=[], output_language=OutputLanguage.JA,
                                     source_language="ko")
    assert request.call_args.args[1] == "configured-model"
