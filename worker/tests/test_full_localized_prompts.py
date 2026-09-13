import hashlib
import json
import re
from pathlib import Path

import pytest

from shorts_worker.comment_generator import CommentClipInput, CommentGenerator
from shorts_worker.config import Settings
from shorts_worker.language_context import CATALOG
from shorts_worker.localized_selection import LocalizedSelectionError, repair_instruction
from shorts_worker.prompt_language import LOCALIZED_SELECTION_PROMPTS
from shorts_worker.schemas import OutputLanguage, SubtitleSegment
from shorts_worker.selector import TranscriptSelector
from shorts_worker.subtitle_translation import INSTRUCTIONS


def digest(value):
    return hashlib.sha256(json.dumps(
        value, ensure_ascii=False, separators=(",", ":"),
    ).encode()).hexdigest()


def preserved_messages(language, source_language):
    transcript = [SubtitleSegment(start=0, end=54, text="원본 내용 {transcript}")]
    return {
        "selection": TranscriptSelector(Settings())._selection_messages(
            video_title="원본 제목", duration_seconds=330, transcript=transcript,
            required_count=5, output_language=language, source_language=source_language,
        ),
        "comments": CommentGenerator._messages([CommentClipInput(
            clip_index=1, hook_title="원본 제목", reason="선정 이유", duration_seconds=54,
            transcript=transcript, output_language=language, source_language=source_language,
        )]),
    }


def test_normal_and_korean_test_prompts_match_the_production_baseline():
    baseline = json.loads(Path(__file__).with_name("fixtures").joinpath(
        "full_prompt_baseline_hashes.json",
    ).read_text())
    for language in OutputLanguage:
        actual = preserved_messages(language, None)
        assert {stage: digest(value) for stage, value in actual.items()} == baseline[language]
    for source in ("ko", "ja", "en", "und"):
        actual = preserved_messages(OutputLanguage.KO, source)
        assert {stage: digest(value) for stage, value in actual.items()} == baseline[f"ko:{source}"]
    assert digest(INSTRUCTIONS["ko"]) == baseline["translation:ko"]


@pytest.mark.parametrize("language", [OutputLanguage.JA, OutputLanguage.EN])
def test_full_test_instruction_language_keeps_raw_source_and_structural_fields(language):
    transcript = [SubtitleSegment(start=0, end=54, text="원본의 15만 원 {source}")]
    messages = TranscriptSelector(Settings())._selection_messages(
        video_title="원본 제목 {title}", duration_seconds=330, transcript=transcript,
        required_count=5, output_language=language, source_language="ko",
    )
    system, user = (m["content"] for m in messages)
    assert not re.search("[가-힣]", system)
    assert "원본의 15만 원 {source}" in user
    assert "원본 제목 {title}" in user
    assert "KRW" in user
    assert not re.search("[가-힣]", user.replace(
        "원본의 15만 원 {source}", "",
    ).replace("원본 제목 {title}", ""))
    assert [m["role"] for m in messages] == ["system", "user"]
    for field in ("start_seconds", "end_seconds", "hook_title_line1", "hook_title_line2",
                  "reason", "hook_score", "completeness_score", "impact_score",
                  "shareability_score", "density_score"):
        assert field in system
    for number in ("0.1%", "30.000", "120.000", "5", "18"):
        assert number in system
    assert ("4本から5本" if language == OutputLanguage.JA else "between 4 and 5") in system


def test_all_localized_instruction_stages_are_affirmative_and_example_free():
    forbidden = re.compile(
        r"don't|do not|must not|never|avoid|example|demonstration|"
        r"例えば|例文|예시|모범|しない|せず|禁止", re.I,
    )
    for language in ("en", "ja"):
        # 'demonstrations' in the grounding instruction means source demonstrations,
        # not sample outputs. It is outside the prompt-template example check.
        selection = json.dumps(LOCALIZED_SELECTION_PROMPTS[language], ensure_ascii=False)
        assert not forbidden.search(selection)
        for instruction in (CATALOG["instructions"][language], INSTRUCTIONS[language],
                            repair_instruction(language, LocalizedSelectionError("invalid_json"))):
            assert not re.search(
                r"don't|do not|must not|never|avoid|しない|せず|禁止", instruction, re.I,
            )
            assert not re.search("[가-힣]", instruction)
