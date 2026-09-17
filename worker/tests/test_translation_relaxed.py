from types import SimpleNamespace

import pytest

from shorts_worker.schemas import SubtitleSegment
from shorts_worker.subtitle_translation import SubtitleTranslator, inspect_translation


@pytest.mark.parametrize("language,text", [
    ("en", "The product is called 삼성 갤럭시 in Korea."),
    ("en", "The sign says 発売日 next to the date."),
    ("ko", "제품 이름은 ソニー이고 이번에 출시됐어요."),
    ("ja", "韓国では삼성という名前で販売されています。"),
    ("ko", "Apple Watch Ultra"),
    ("ja", "AirPods Pro"),
])
def test_original_names_and_extra_fields_are_accepted(language, text):
    valid, issues = inspect_translation(
        {"segments": [{"id": 0, "text": text, "note": "extra"}]},
        {0: "제품을 소개합니다."}, language,
    )
    assert valid == {0: text}
    assert issues == {}


@pytest.mark.parametrize("language,text", [
    ("en", "번역하지 않고 한국어 문장이 그대로 남았습니다."),
    ("ja", "This entire sentence is still in English."),
    ("ko", "この文章は日本語のまま残っています。"),
])
def test_character_script_does_not_reject_text(language, text):
    good = {"en": "The product is ready.", "ja": "製品の準備ができました。",
            "ko": "제품이 준비됐습니다."}[language]
    valid, issues = inspect_translation(
        {"segments": [{"id": 0, "text": good}, {"id": 1, "text": text}]},
        {0: "준비됐습니다.", 1: "준비됐습니다."}, language,
    )
    assert valid == {0: good, 1: text}
    assert issues == {}


def test_warnings_keep_captions_without_retry(monkeypatch):
    translator = SubtitleTranslator(SimpleNamespace(
        gemini_api_key="test", gemini_paid_data_processing_confirmed=True,
    ))
    calls = []

    def request(texts, *_):
        calls.append(texts)
        return {"segments": [{"id": 0, "text": "It launches October 17 with 25 hours."}]}

    monkeypatch.setattr(translator, "_request", request)
    result = translator.translate_partial(
        [SubtitleSegment(start=0, end=5, text="10월 16일 출시하고 24시간입니다.")],
        source_language="ko", output_language="en",
    )
    assert len(calls) == 1
    assert len(result.segments) == 1 and not result.failures
    assert translator.metrics["warningCount"] == 1
    assert {w["reason"] for w in translator.metrics["warnings"]} == {
        "date_changed",
    }


@pytest.mark.parametrize("segments,reason", [
    ([], "missing_segment"),
    ([{"id": 0, "text": ""}], "invalid_text"),
    ([{"id": 1, "text": "Hello."}], "missing_segment"),
])
def test_only_missing_or_empty_fragments_need_recovery(segments, reason):
    valid, issues = inspect_translation(
        {"segments": segments}, {0: "$10입니다."}, "en",
    )
    assert not valid
    assert issues == {0: reason}


def test_first_usable_fragment_survives_duplicate_and_unrelated_ids():
    valid, issues = inspect_translation(
        {"segments": [{"id": 0, "text": ""}, {"id": 99, "text": "extra"},
                      {"id": 0, "text": "Valid."}, {"id": 0, "text": "Duplicate."}]},
        {0: "원문"}, "en",
    )
    assert valid == {0: "Valid."}
    assert not issues
