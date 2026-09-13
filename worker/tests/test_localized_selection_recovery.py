import json
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from shorts_worker.config import Settings
from shorts_worker.localized_selection import (
    LocalizedSelectionError,
    validate_candidates,
)
from shorts_worker.schemas import OutputLanguage, SubtitleSegment
from shorts_worker.selector import TranscriptSelector, _two_line_title


def candidate(index=0):
    return dict(start_seconds=index * 55, end_seconds=index * 55 + 40,
                hook_title_line1="働き方が変わる", hook_title_line2="新しい仕事の形",
                reason="仕事の進め方が変わった場面です。", hook_score=25,
                completeness_score=18, impact_score=16, shareability_score=15, density_score=9)


def response(items):
    return SimpleNamespace(usage=None, choices=[SimpleNamespace(
        finish_reason="stop", message=SimpleNamespace(content=json.dumps({"clips": items})),
    )])


@pytest.mark.parametrize("bad,code", [
    ({"reason": "원문을 그대로 쓴 선정 이유"}, "language"),
    ({"hook_title_line1": ""}, "schema"),
    ({"end_seconds": float("nan")}, "invalid_range"),
])
def test_one_invalid_candidate_does_not_discard_other_titles(bad, code):
    payload = {"clips": [candidate(), {**candidate(1), **bad}, candidate(2)]}
    result = validate_candidates(payload, language="ja", source="15만 원입니다.")
    assert [c.start_seconds for c in result.clips] == [0, 110]
    assert result.rejected[0]["code"] == code
    assert result.rejected[0]["candidate_index"] == 2
    assert "원문" not in json.dumps(result.rejected, ensure_ascii=False)


@pytest.mark.parametrize("title", [
    "月15万円稼げる", "月15万も稼げる", "月150万ウォン稼ぐ", "短い",
    "この新しいサービスなら画像生成まで無料で試せる",
])
def test_title_content_is_preserved_without_money_or_eighteen_character_rejection(title):
    client = MagicMock()
    client.chat.completions.create.return_value = response([
        {**candidate(), "hook_title_line1": title},
    ])
    with patch("openai.OpenAI", return_value=client):
        clips = TranscriptSelector(Settings())._select_with_gemini(
            messages=[{"role": "user", "content": "15만 원입니다."}],
            output_language=OutputLanguage.JA, source_language="ko",
        )
    assert clips[0].hook_title.splitlines()[0] == title
    client.chat.completions.create.assert_called_once()
    assert _two_line_title(clips[0].hook_title, OutputLanguage.JA, relaxed_titles=True) == (
        clips[0].hook_title
    )


def test_proper_name_line_and_exact_five_character_punctuation_are_preserved():
    payload = {"clips": [{**candidate(), "hook_title_line1": "ChatGPT"}]}
    assert validate_candidates(payload, language="ja", source="").clips
    title = "驚きだよ！\n新しい仕事の形"
    assert _two_line_title(title, OutputLanguage.JA) == title


def test_single_repair_requests_only_rejected_candidates_and_keeps_good_titles():
    good = candidate()
    invalid = {**candidate(1), "reason": "한국어 이유입니다"}
    client = MagicMock()
    client.chat.completions.create.side_effect = [
        response([good, invalid]), response([candidate(1)]),
    ]
    original = deepcopy(good)
    with patch("openai.OpenAI", return_value=client):
        clips = TranscriptSelector(Settings())._select_with_gemini(
            messages=[{"role": "user", "content": "원문"}],
            output_language=OutputLanguage.JA, source_language="ko",
        )
    assert len(clips) == 2
    assert clips[0].hook_title == original["hook_title_line1"] + "\n" + original["hook_title_line2"]
    repair = client.chat.completions.create.call_args_list[1].kwargs["messages"][-1]["content"]
    assert '"candidate_index": 2' in repair and '"accepted_ranges"' in repair
    assert "한국어 이유" not in repair
    assert client.chat.completions.create.call_count == 2


def test_failed_repair_keeps_already_valid_candidates():
    client = MagicMock()
    client.chat.completions.create.side_effect = [
        response([candidate(), {**candidate(1), "reason": "한국어"}]), TimeoutError(),
    ]
    with (patch("openai.OpenAI", return_value=client),
          pytest.raises(LocalizedSelectionError) as error):
        TranscriptSelector(Settings())._select_with_gemini(
            messages=[], output_language=OutputLanguage.JA, source_language="ko",
        )
    assert len(error.value.attempt.clips) == 1
    assert error.value.code == "repair_provider_error"


def test_partial_repair_after_invalid_json_keeps_valid_replacements():
    malformed = response([])
    malformed.choices[0].message.content = "invalid JSON"
    client = MagicMock()
    client.chat.completions.create.side_effect = [
        malformed, response([candidate(), {**candidate(1), "reason": "한국어"}]),
    ]
    with (patch("openai.OpenAI", return_value=client),
          pytest.raises(LocalizedSelectionError) as error):
        TranscriptSelector(Settings())._select_with_gemini(
            messages=[], output_language=OutputLanguage.JA, source_language="ko",
        )
    assert len(error.value.attempt.clips) == 1
    assert error.value.attempt.clips[0].start_seconds == 0
    assert client.chat.completions.create.call_count == 2


def test_failed_configured_localized_generation_uses_regular_fallback(monkeypatch):
    selector = TranscriptSelector(Settings(gemini_api_key="test",
                                           gemini_paid_data_processing_confirmed=True))
    monkeypatch.setattr(selector, "_select_with_gemini", MagicMock(side_effect=ValueError()))
    clips = selector.select(video_title="원본", duration_seconds=300, required_count=5,
                            transcript=[SubtitleSegment(start=0, end=300, text="원문")],
                            output_language=OutputLanguage.JA, source_language="ko")
    assert len(clips) == 4
    assert all(c.selection_provider == "deterministic" for c in clips)


@pytest.mark.parametrize("language", [OutputLanguage.JA, OutputLanguage.EN])
def test_three_valid_candidates_are_kept_and_backfilled_after_both_models(language, monkeypatch):
    selector = TranscriptSelector(Settings(
        gemini_api_key="test", gemini_paid_data_processing_confirmed=True, openai_api_key="test",
    ))
    payload = [candidate(i) for i in range(3)]
    if language == OutputLanguage.EN:
        for c in payload:
            c.update(hook_title_line1="AI", hook_title_line2="Free training and image generation",
                     reason="The free image generation workflow is shown.")
    accepted = validate_candidates({"clips": payload}, language=language, source="").clips
    first = MagicMock(return_value=accepted)
    second = MagicMock(return_value=[])
    monkeypatch.setattr(selector, "_select_with_gemini", first)
    monkeypatch.setattr(selector, "_select_with_openai", second)
    clips = selector.select(
        video_title="Original", duration_seconds=330, required_count=5,
        transcript=[SubtitleSegment(start=0, end=330, text="Original transcript")],
        output_language=language, source_language=language,
    )
    first.assert_called_once()
    second.assert_called_once()
    assert len(clips) == 4
    assert {c.hook_title for c in accepted} <= {c.hook_title for c in clips}
    assert sum(c.selection_provider == "gemini" for c in clips) == 3
    assert sum(c.selection_provider == "deterministic" for c in clips) == 1
    assert all(0 <= c.start_seconds < c.end_seconds <= 330 for c in clips)


def test_missing_provider_configuration_still_uses_deterministic_fallback():
    clips = TranscriptSelector(Settings()).select(
        video_title="원본", duration_seconds=300, required_count=5,
        transcript=[SubtitleSegment(start=0, end=300, text="원문")],
        output_language=OutputLanguage.JA, source_language="ko",
    )
    assert clips and all(c.selection_provider == "deterministic" for c in clips)


def test_provider_fallback_preserves_accepted_titles_and_their_provenance(monkeypatch):
    selector = TranscriptSelector(Settings(
        gemini_api_key="test", gemini_paid_data_processing_confirmed=True, openai_api_key="test",
    ))
    accepted = validate_candidates({"clips": [candidate(), candidate(1)]},
                                   language="ja", source="").clips
    replacements = validate_candidates({"clips": [candidate(i) for i in range(5)]},
                                       language="ja", source="").clips
    replacements[0].hook_title = "別の候補の題名\n重複する区間です"
    replacements[0].viral_score = 100
    monkeypatch.setattr(selector, "_select_with_gemini", MagicMock(return_value=accepted))
    monkeypatch.setattr(selector, "_select_with_openai", MagicMock(return_value=replacements))
    clips = selector.select(
        video_title="原文", duration_seconds=300, required_count=5,
        transcript=[SubtitleSegment(start=0, end=300, text="原文")],
        output_language=OutputLanguage.JA, source_language="ko",
    )
    assert len(clips) == 5
    first = next(c for c in clips if c.start_seconds == 0)
    assert first.hook_title == accepted[0].hook_title
    assert first.selection_provider == "gemini"
    assert {c.selection_provider for c in clips} == {"gemini", "openai"}
