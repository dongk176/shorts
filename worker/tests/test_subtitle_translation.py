from copy import deepcopy
from types import SimpleNamespace

import pytest

from shorts_worker.caption_templates import (
    compile_caption_render_spec,
    create_caption_ass,
    reflow_caption_cues_for_clips,
)
from shorts_worker.errors import SubtitleTranslationError
from shorts_worker.schemas import SubtitleSegment, VideoAspectRatio
from shorts_worker.subtitle_translation import (
    SubtitleTranslator,
    translated_words,
    translation_required,
    translation_segments,
    validate_translation,
)


@pytest.mark.parametrize(
    "source,target,expected",
    [
        (None, "en", False),
        ("ko", "ko", False),
        ("en", "en", False),
        ("ja", "ja", False),
        ("ko", "ja", True),
        ("ja", "en", True),
        ("en", "ko", True),
        ("und", "en", True),
    ],
)
def test_translation_scope(monkeypatch, source, target, expected):
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_WORKER", "true")
    assert translation_required(source, target) is expected
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_WORKER", "false")
    assert translation_required(source, target) is False


def test_translation_reuses_overlapping_edit_windows():
    segments = [SubtitleSegment(start=i, end=i + 1, text="말") for i in range(200)]
    picked = translation_segments(segments, [(10, 80), (50, 110)])
    assert "".join(s.text.replace(" ", "") for s in picked) == "말" * 100
    assert picked[0].start == 10 and picked[-1].end == 110
    assert all(a.end == b.start for a, b in zip(picked, picked[1:], strict=False))


def test_translation_joins_split_word_without_changing_saved_transcript():
    segments = [
        SubtitleSegment(start=450.267, end=455.867, text="間違ってたら申し"),
        SubtitleSegment(start=455.867, end=462.421, text="訳ないです。"),
    ]
    original = [s.model_dump() for s in segments]
    picked = translation_segments(segments, [(440, 480)], priority_windows=[(445, 475)])
    assert [s.model_dump() for s in picked] == [{
        "start": 450.267, "end": 462.421, "text": "間違ってたら申し訳ないです。",
    }]
    assert [s.model_dump() for s in segments] == original


@pytest.mark.parametrize(
    "first,second",
    [
        ((0, 1, "Finished."), (1, 2, "Next sentence.")),
        ((0, 1, "unfinished"), (1.3, 2, "sentence")),
        ((0, 1, "unfinished"), (0.9, 2, "overlap")),
        ((0, 14, "unfinished"), (14, 16, "too long")),
        ((0, 1, "あ" * 160), (1, 2, "続き")),
    ],
)
def test_translation_keeps_complete_separated_or_large_phrases(first, second):
    segments = [SubtitleSegment(start=s, end=e, text=t) for s, e, t in [first, second]]
    assert translation_segments(segments, [(0, 20)]) == segments


def test_translation_keeps_punctuation_with_its_unfinished_phrase():
    segments = [
        SubtitleSegment(start=471.867, end=479.968, text="ニンニクが"),
        SubtitleSegment(start=479.968, end=480, text="。"),
        SubtitleSegment(start=480.099, end=481.033, text="があるって感じです。"),
    ]
    picked = translation_segments(segments, [(450, 500)])
    assert len(picked) == 1
    assert "".join(picked[0].text.split()) == "ニンニクが。があるって感じです。"
    assert (picked[0].start, picked[0].end) == (471.867, 481.033)


@pytest.mark.parametrize("boundary", [1, 1.1, 1.2])
def test_translation_does_not_join_context_or_other_clip_across_boundary(boundary):
    segments = [
        SubtitleSegment(start=0, end=1, text="first fragment"),
        SubtitleSegment(start=1.2, end=2, text="second fragment"),
    ]
    assert translation_segments(segments, [(0, 3)], priority_windows=[(boundary, 3)]) == segments
    assert translation_segments(segments, [(0, boundary), (boundary, 3)]) == segments


@pytest.mark.parametrize(
    "language,text",
    [
        ("en", "It costs 30 million KRW and weighs 10.5 kg."),
        ("ja", "価格は3000万ウォンで、重さは10.5kgです。"),
    ],
)
def test_translation_preserves_currency_value_and_decimal(language, text):
    assert validate_translation(
        {"segments": [{"id": 0, "text": text}]},
        {0: "가격은 3천만 원이고 무게는 10.5kg입니다."},
        language,
    ) == {0: text}


@pytest.mark.parametrize(
    "payload",
    [
        {"segments": []},
        {"segments": [{"id": 1, "text": "It is 3000 KRW."}]},
    ],
)
def test_translation_recovers_missing_ids(payload):
    with pytest.raises(ValueError):
        validate_translation(payload, {0: "3000원입니다."}, "en")


def test_translation_retries_bounded_and_never_returns_original(monkeypatch):
    translator = SubtitleTranslator(
        SimpleNamespace(
            gemini_api_key="test",
            gemini_paid_data_processing_confirmed=True,
        )
    )
    requests = []

    def bad(*args):
        requests.append(args)
        return {"segments": []}

    monkeypatch.setattr(translator, "_request", bad)
    with pytest.raises(SubtitleTranslationError, match="원본 자막으로 대체하지"):
        translator.translate(
            [SubtitleSegment(start=0, end=2, text="한국어가 남습니다.")],
            source_language="ko",
            output_language="en",
        )
    assert len(requests) == 2


def test_translated_plain_captions_remain_static_after_edit_and_cut(tmp_path):
    segments = [SubtitleSegment(start=0, end=2, text="It weighs 10.5 kg.")]
    spec = compile_caption_render_spec(
        translated_words(segments),
        template_id="basic",
        clip_start=0,
        clip_end=3,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        schema_version=4,
    )
    assert "10.5" in " ".join(w["text"] for c in spec["cues"] for w in c["words"])
    for text_edit in (None, {0: "The weight is 10.5 kg."}):
        edited = reflow_caption_cues_for_clips(
            spec["cues"],
            template_id="basic",
            safe_area=spec["safeArea"],
            clip_windows=[(5, 55, 0)],
            cue_edits=text_edit,
            schema_version=4,
        )
        assert edited
        for cue in edited:
            assert cue["events"] == [{"startFrame": cue["startFrame"], "endFrame": cue["endFrame"]}]
        ass = create_caption_ass({**spec, "cues": edited}, tmp_path / "plain.ass").read_text()
        assert "10.5" in ass
        assert "\\t(" not in ass
        assert "&H00E3E635" not in "\n".join(
            line for line in ass.splitlines() if line.startswith("Dialogue:")
        )


def test_plain_cut_does_not_remove_translated_words_by_guessed_word_times():
    spec = compile_caption_render_spec(
        translated_words([SubtitleSegment(start=0, end=2, text="We can do this.")]),
        template_id="basic",
        clip_start=0,
        clip_end=2,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        schema_version=4,
    )
    edited = reflow_caption_cues_for_clips(
        spec["cues"],
        template_id="basic",
        safe_area=spec["safeArea"],
        clip_windows=[(15, 45, 0)],
        schema_version=4,
    )
    assert [w["text"] for c in edited for w in c["words"]] == ["We", "can", "do", "this."]


@pytest.mark.parametrize("font_size", [48, 96])
def test_plain_phrase_reflow_preserves_display_time_across_cuts(font_size):
    # A rounded/extended phrase can be one frame longer than the partitioner's
    # 3.2s target. Its words intentionally share the phrase's entire envelope.
    spec = compile_caption_render_spec(
        translated_words([
            SubtitleSegment(start=0, end=2, text="무료로 모델을 직접 만들 수 있어요."),
        ]),
        template_id="basic", clip_start=0, clip_end=7,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        font_size=48, schema_version=4,
    )
    cue = spec["cues"][0]
    cue.update(startFrame=0, endFrame=97)
    cue["events"] = [{"startFrame": 0, "endFrame": 97}]
    for word in cue["words"]:
        word.update(startFrame=0, endFrame=97, speechStartFrame=0, speechEndFrame=97)
    second = deepcopy(cue)
    second.update(startFrame=97, endFrame=194)
    second["events"] = [{"startFrame": 97, "endFrame": 194}]
    for word in second["words"]:
        word.update(startFrame=97, endFrame=194, speechStartFrame=97, speechEndFrame=194)
    result = reflow_caption_cues_for_clips(
        [cue, second], template_id="basic", safe_area=spec["safeArea"],
        clip_windows=[(1, 193, 0)], font_size=font_size, schema_version=4,
    )
    assert result[0]["startFrame"] == 0
    assert result[-1]["endFrame"] == 192
    assert all(
        a["endFrame"] == b["startFrame"]
        for a, b in zip(result, result[1:], strict=False)
    )
    assert min(c["endFrame"] - c["startFrame"] for c in result) > 1
    assert [w["text"] for c in result for w in c["words"]] == [
        w["text"] for c in [cue, second] for w in c["words"]
    ]


@pytest.mark.parametrize(
    "target,translated",
    [
        (
            "en",
            [
                "A 150,000 won computer earned 10 billion won.",
                "Equipment worth 500 million or 1 billion won.",
                "30 million won per day? Per day?",
            ],
        ),
        (
            "ja",
            [
                "15万ウォンのパソコンで100億ウォン稼ぎました。",
                "5億、10億ウォンの設備です。",
                "1日に3000万ウォンですか？1日？",
            ],
        ),
    ],
)
def test_natural_scales_and_unambiguous_currency_context(target, translated):
    source = {
        0: "15만 원 컴퓨터로 100억을 벌었습니다.",
        1: "5억, 10억짜리 설비입니다.",
        2: "하루에 3천만 원이요? 하루?",
    }
    assert validate_translation(
        {"segments": [{"id": i, "text": text} for i, text in enumerate(translated)]},
        source,
        target,
    ) == dict(enumerate(translated))




def test_japanese_layout_preserves_katakana_words_without_added_spaces():
    text = "15万ウォンのコンピューターです。"
    words = translated_words([SubtitleSegment(start=0, end=3, text=text)])
    assert "コンピューター" in [w.text for w in words]
    assert "".join(w.text for w in words) == text
    assert not any(w.space_before for w in words)


@pytest.mark.parametrize(
    "source,target,language",
    [
        ("삼천만 원씩 벌었어요.", "I earned 30 million won.", "en"),
        ("십오만 원짜리 컴퓨터입니다.", "15万ウォンのコンピューターです。", "ja"),
        ("육 년 전에 시작했어요.", "6年前に始めました。", "ja"),
        ("I paid fifteen dollars.", "15달러를 냈습니다.", "ko"),
        ("十五万ウォンです。", "It is 150,000 won.", "en"),
    ],
)
def test_spoken_number_spelling_is_not_a_numeric_mismatch(source, target, language):
    assert validate_translation(
        {"segments": [{"id": 0, "text": target}]}, {0: source}, language
    ) == {0: target}




def test_translation_failures_are_not_silent_audio_errors():
    from shorts_worker.errors import TranscriptionError

    assert not isinstance(SubtitleTranslationError("번역 실패"), TranscriptionError)


def test_translation_batches_keep_every_timed_fragment(monkeypatch):
    translator = SubtitleTranslator(
        SimpleNamespace(gemini_api_key="test", gemini_paid_data_processing_confirmed=True)
    )
    batches = []

    def reply(texts, *_):
        batches.append(list(texts))
        return {"segments": [{"id": key, "text": "Hello."} for key in texts]}

    monkeypatch.setattr(translator, "_request", reply)
    source = [SubtitleSegment(start=i, end=i + 1, text="안녕하세요.") for i in range(35)]
    result = translator.translate(source, source_language="ko", output_language="en")
    assert list(map(len, batches)) == [16, 16, 3]
    assert [i for batch in batches for i in batch] == list(range(35))
    assert [(s.start, s.end) for s in result] == [(s.start, s.end) for s in source]




@pytest.mark.parametrize(
    "source,translated,language",
    [
        ("冷やし胡椒そば四百九十八円。", "차가운 후추 소바 498엔.", "ko"),
        ("冷やし胡椒そば四百九十八円。", "Chilled pepper soba costs 498 yen.", "en"),
        ("五百円です。", "500엔입니다.", "ko"),
        ("一万二千三百四十五円です。", "It costs 12,345 yen.", "en"),
        ("二〇二六円です。", "가격은 2026엔입니다.", "ko"),
        ("１万５千円です。", "It costs 15,000 yen.", "en"),
        ("1.5万円です。", "It costs 15,000 yen.", "en"),
        ("1,500円です。", "가격은 1500엔입니다.", "ko"),
        ("一億二千万ウォンです。", "금액은 1.2억 원입니다.", "ko"),
        ("三百ドルです。", "It costs 300 dollars.", "en"),
        ("가격은 498엔입니다.", "四百九十八円です。", "ja"),
    ],
)
def test_japanese_written_amounts_keep_currency_and_value(source, translated, language):
    assert validate_translation(
        {"segments": [{"id": 0, "text": translated}]}, {0: source}, language
    ) == {0: translated}




def test_partial_translation_keeps_valid_fragments_and_retries_only_failures(monkeypatch):
    translator = SubtitleTranslator(
        SimpleNamespace(
            gemini_api_key="test",
            gemini_paid_data_processing_confirmed=True,
        )
    )
    calls = []

    def request(texts, *_):
        calls.append(dict(texts))
        return {"segments": [
            {"id": i, "text": "" if i == 3 else "Hello."}
            for i in texts
        ]}

    monkeypatch.setattr(translator, "_request", request)
    source = [SubtitleSegment(start=i, end=i + 1, text="안녕") for i in range(20)]
    result = translator.translate_partial(source, source_language="ko", output_language="en")
    assert [list(call) for call in calls] == [list(range(16)), [3], list(range(16, 20))]
    assert len(result.segments) == 19
    assert all(s.text == "Hello." for s in result.segments)
    assert result.failures == [{"id": 3, "start": 3, "end": 4, "reason": "invalid_text"}]
    assert result.outcome(5, 10, 0, 15) == {
        "policy": "translated-basic-v1",
        "status": "ready",
        "contextLimited": True,
    }
    assert result.outcome(2, 5, 0, 10)["status"] == "ready"
    assert result.outcome(2, 5, 0, 10)["partial"] is True
    assert result.outcome(3, 4, 0, 10)["status"] == "unavailable"


def test_partial_translation_repairs_missing_fragment_without_replacing_success(monkeypatch):
    translator = SubtitleTranslator(
        SimpleNamespace(
            gemini_api_key="test",
            gemini_paid_data_processing_confirmed=True,
        )
    )
    calls = []

    def request(texts, *_):
        calls.append(list(texts))
        return {
            "segments": (
                [{"id": 0, "text": "Hello."}]
                if len(calls) == 1
                else [{"id": 1, "text": "Goodbye."}]
            )
        }

    monkeypatch.setattr(translator, "_request", request)
    source = [SubtitleSegment(start=i, end=i + 1, text="안녕") for i in range(2)]
    result = translator.translate_partial(source, source_language="ko", output_language="en")
    assert calls == [[0, 1], [1]]
    assert [s.text for s in result.segments] == ["Hello.", "Goodbye."]
    assert result.failures == []


def test_partial_translation_prioritizes_clip_before_context_and_respects_deadline(monkeypatch):
    import shorts_worker.subtitle_translation as module

    clock = [0.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    translator = SubtitleTranslator(
        SimpleNamespace(
            gemini_api_key="test",
            gemini_paid_data_processing_confirmed=True,
        )
    )
    calls = []

    def request(texts, *_):
        calls.append(list(texts))
        clock[0] = 181
        return {"segments": [{"id": i, "text": "Hello."} for i in texts]}

    monkeypatch.setattr(translator, "_request", request)
    source = [SubtitleSegment(start=i, end=i + 1, text="안녕") for i in range(35)]
    result = translator.translate_partial(
        source, source_language="ko", output_language="en", priority_windows=[(20, 25)]
    )
    assert calls == [[20, 21, 22, 23, 24]]
    assert [s.start for s in result.segments] == [20, 21, 22, 23, 24]
    assert len(result.failures) == 30
    assert all(f["reason"] == "timeout" for f in result.failures)
    assert result.outcome(20, 25, 0, 35)["contextLimited"] is True


def test_partial_translation_without_provider_preserves_no_source_fallback():
    translator = SubtitleTranslator(
        SimpleNamespace(
            gemini_api_key="",
            gemini_paid_data_processing_confirmed=True,
        )
    )
    result = translator.translate_partial(
        [SubtitleSegment(start=0, end=1, text="원문")], source_language="ko", output_language="ja"
    )
    assert result.segments == []
    assert result.failures[0]["reason"] == "provider_unavailable"


@pytest.mark.parametrize(
    "source,target,source_text,target_text",
    [
        ("ko", "en", "3000원입니다.", "It costs 3000 KRW."),
        ("ko", "ja", "3000원입니다.", "価格は3000ウォンです。"),
        ("ja", "ko", "四百九十八円です。", "498엔입니다."),
        ("ja", "en", "四百九十八円です。", "It costs 498 yen."),
    ],
)
def test_partial_translation_language_matrix(monkeypatch, source, target, source_text, target_text):
    translator = SubtitleTranslator(
        SimpleNamespace(
            gemini_api_key="test",
            gemini_paid_data_processing_confirmed=True,
        )
    )
    monkeypatch.setattr(
        translator,
        "_request",
        lambda *_: {
            "segments": [{"id": 0, "text": target_text}],
        },
    )
    result = translator.translate_partial(
        [SubtitleSegment(start=2, end=5, text=source_text)],
        source_language=source,
        output_language=target,
    )
    assert result.failures == []
    assert result.segments[0].text == target_text




@pytest.mark.parametrize("text", [
    "The shade is 27N1.", "この理由で選びました。", "Apple Watch Ultra", "価格は17万円です。",
])
def test_server_preserves_ai_wording_without_currency_or_script_rejection(text):
    assert validate_translation(
        {"segments": [{"id": 0, "text": text}]}, {0: "원문"}, "ja",
    ) == {0: text}
