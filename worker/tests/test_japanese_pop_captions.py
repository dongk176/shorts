from __future__ import annotations

import pytest

import shorts_worker.caption_templates as caption_templates
from shorts_worker.caption_templates import (
    compile_caption_render_spec,
    reflow_caption_cues_for_clips,
)
from shorts_worker.schemas import VideoAspectRatio
from shorts_worker.subtitles import TranscriptWord


def _compile(texts: list[str], *, step: float = 0.08) -> dict:
    return compile_caption_render_spec(
        [
            TranscriptWord(text, 0.4 + i * step, 0.4 + (i + 1) * step, "elevenlabs",
                           space_before=text.isascii())
            for i, text in enumerate(texts)
        ],
        template_id="pop",
        clip_start=0,
        clip_end=4,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        timing_lead_frames=4,
        font_size=48,
        schema_version=4,
    )


def _reflow(spec: dict, windows: list[tuple[int, int, int]]) -> list[dict]:
    return reflow_caption_cues_for_clips(
        spec["cues"],
        template_id="pop",
        safe_area=spec["safeArea"],
        clip_windows=windows,
        font_size=48,
        schema_version=4,
    )


def _texts(cues: list[dict]) -> list[str]:
    return [word["text"] for cue in cues for word in cue["words"]]


@pytest.mark.parametrize("text", ["ジャケットがよく似合います", "ｼﾞｬｹｯﾄがよく似合います"])
def test_japanese_character_timestamps_make_a_readable_pop_phrase(text: str) -> None:
    spec = _compile(list(text))

    assert len(spec["cues"]) == 1
    assert "".join(_texts(spec["cues"])) == text
    assert spec["cues"][0]["endFrame"] - spec["cues"][0]["startFrame"] >= 30


def test_japanese_pop_keeps_existing_duration_and_sentence_boundaries() -> None:
    text = "ジャケットがよく似合います。グレーのパンツにも合わせやすいです。"
    spec = _compile(list(text))

    assert "".join(_texts(spec["cues"])) == text
    for cue in spec["cues"]:
        phrase = "".join(_texts([cue]))
        assert "。" not in phrase[:-1]
        assert cue["endFrame"] - cue["startFrame"] <= 60


@pytest.mark.parametrize("texts", [
    list("ジャケットによく合います"),
    ["These", "fast", "words", "all", "stay", "in", "the", "caption"],
    ["하나!", "둘!", "셋!", "넷!", "다섯!", "여섯!"],
])
def test_fast_spoken_words_survive_two_editor_renders(texts: list[str]) -> None:
    spec = _compile(texts, step=0.06)

    for _ in range(2):
        spec["cues"] = _reflow(spec, [(0, 120, 0)])
        assert _texts(spec["cues"]) == texts
        assert all(a["endFrame"] <= b["startFrame"]
                   for a, b in zip(spec["cues"][:-1], spec["cues"][1:], strict=True))


def test_actual_video_cut_removes_words_even_when_their_display_leads_the_cut() -> None:
    spec = _compile(["keep", "cut", "later"], step=0.2)

    # At frame 18, 'cut' begins speaking but was already being displayed.
    assert _texts(_reflow(spec, [(0, 18, 0)])) == ["keep"]
    assert _texts(_reflow(spec, [(0, 18, 0), (24, 120, 18)])) == ["keep", "later"]


@pytest.mark.parametrize("texts", [
    ["one", "two", "three", "four"],
    ["하나!", "둘!", "셋!", "넷!"],
])
def test_non_japanese_pop_retains_its_three_word_limit(texts: list[str]) -> None:
    spec = _compile(texts, step=0.3)

    assert _texts(spec["cues"]) == texts
    assert all(len(cue["words"]) <= 3 for cue in spec["cues"])


def test_japanese_duration_boundary_keeps_katakana_word_intact() -> None:
    text = "これはコーディネートの話です。"
    spec = _compile(list(text), step=0.18)
    phrases = ["".join(_texts([cue])) for cue in spec["cues"]]

    assert "".join(phrases) == text
    assert any("コーディネート" in phrase for phrase in phrases)
    assert all("コーディネー" not in phrase or "コーディネート" in phrase
               for phrase in phrases)
    original_times = {
        word["sourceWordIndexes"][0]: (word["speechStartFrame"], word["speechEndFrame"])
        for cue in spec["cues"] for word in cue["words"]
    }
    rendered = _reflow(spec, [(0, 120, 0)])
    assert {
        word["sourceWordIndexes"][0]: (word["speechStartFrame"], word["speechEndFrame"])
        for cue in rendered for word in cue["words"]
    } == original_times


def test_one_japanese_phrase_can_finish_after_two_second_target() -> None:
    text = "コーディネート"
    spec = _compile(list(text), step=0.35)

    assert len(spec["cues"]) == 1
    assert "".join(_texts(spec["cues"])) == text
    assert spec["cues"][0]["endFrame"] - spec["cues"][0]["startFrame"] > 60


def test_japanese_phrase_cannot_overflow_a_narrow_caption_area() -> None:
    text = "インターナショナルコミュニケーション"
    spec = compile_caption_render_spec(
        [TranscriptWord(char, i * .1, (i + 1) * .1, "elevenlabs")
         for i, char in enumerate(text)],
        template_id="pop", clip_start=0, clip_end=4,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        caption_max_width=180, font_id="noto-sans-jp", font_size=48, schema_version=4,
    )

    assert "".join(_texts(spec["cues"])) == text
    assert len(spec["cues"]) > 1
    area = spec["safeArea"]
    for cue in spec["cues"]:
        for event in cue["events"]:
            for position in event["positions"]:
                assert position["centerX"] - position["advanceWidth"] / 2 >= area["x"]
                assert position["centerX"] + position["advanceWidth"] / 2 <= (
                    area["x"] + area["width"]
                )


def test_real_pause_still_breaks_a_japanese_phrase() -> None:
    spec = compile_caption_render_spec(
        [TranscriptWord("ジャ", .2, .4, "elevenlabs"),
         TranscriptWord("ケット", 1.2, 1.5, "elevenlabs")],
        template_id="pop", clip_start=0, clip_end=2,
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
    )

    assert ["".join(_texts([cue])) for cue in spec["cues"]] == ["ジャ", "ケット"]


@pytest.mark.parametrize("texts", [["one", "two"], ["하나", "둘"]])
def test_non_japanese_does_not_load_the_phrase_model(monkeypatch, texts: list[str]) -> None:
    def unexpected_load():
        raise AssertionError("Japanese parser must stay unused")

    monkeypatch.setattr(caption_templates, "_japanese_phrase_parser", unexpected_load)
    assert "".join(_texts(_compile(texts)["cues"])) == "".join(texts)
