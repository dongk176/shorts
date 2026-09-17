import hashlib
import json
import re
from pathlib import Path

import pytest

from shorts_worker.comment_generator import CommentClipInput, CommentGenerator
from shorts_worker.config import Settings
from shorts_worker.localized_selection import LocalizedSelectionError, repair_instruction
from shorts_worker.prompt_language import PROMPT_TRANSLATIONS
from shorts_worker.schemas import OutputLanguage, SubtitleSegment
from shorts_worker.selector import (
    TranscriptSelector,
)


def messages(language):
    transcript = [SubtitleSegment(
        start=0, end=54, text="원본 내용 {transcript}를 번역하지 않는다.",
    )]
    return {
        "selection": TranscriptSelector(Settings())._selection_messages(
            video_title="원본 제목", duration_seconds=54, transcript=transcript,
            required_count=1, output_language=language,
        ),
        "comments": CommentGenerator._messages([CommentClipInput(
            clip_index=1, hook_title="원본 제목", reason="", duration_seconds=54,
            transcript=transcript, output_language=language,
        )]),
    }


@pytest.mark.parametrize("language", list(OutputLanguage))
def test_original_titles_and_untranslated_comments_are_byte_identical(language):
    # Captured before this change at 120f112; changing Korean requires explicit rule review.
    hashes = json.loads(Path(__file__).with_name("fixtures").joinpath(
        "prompt_original_hashes.json",
    ).read_text())
    for stage, value in messages(language).items():
        if stage == "comments" and language in {OutputLanguage.KO, OutputLanguage.EN}:
            continue
        digest = hashlib.sha256(json.dumps(
            value, ensure_ascii=False, separators=(",", ":"),
        ).encode()).hexdigest()
        assert digest == hashes[language][stage]


def test_title_instructions_do_not_add_money_processing():
    for language in (OutputLanguage.EN, OutputLanguage.JA):
        system = messages(language)["selection"][0]["content"]
        assert "currency" not in system and "通貨" not in system


def test_feedback_keeps_error_context_without_examples_or_unrelated_money_rules():
    for language in [OutputLanguage.EN, OutputLanguage.JA]:
        feedback = repair_instruction(language, LocalizedSelectionError("candidate_validation"))
        assert not re.search(r"example|for instance|例えば|例文|예시|모범", feedback, re.I)
        assert '"failure": "candidate_validation"' in feedback
        assert '"accepted_ranges"' in feedback
        assert not re.search(r"monetary|currenc|金額|通貨", feedback, re.I)


def test_english_comments_preserve_numeric_rules_fields_and_raw_source():
    baseline = messages(OutputLanguage.KO)["comments"]
    system, user = (m["content"] for m in messages(OutputLanguage.EN)["comments"])
    assert not re.search("[가-힣]", system)
    assert "원본 내용 {transcript}를 번역하지 않는다." in user
    assert "원본 제목" in user
    assert re.findall(r"\d+%", system) == re.findall(r"\d+%", baseline[0]["content"])
    assert "4~50" in system and "4~50" in baseline[0]["content"]
    for field in ("outputLanguage", "targetCommentCount", "clipIndex", "comments"):
        assert field in system


def test_translations_add_no_demonstrations_or_additional_prompt_turns():
    assert set(PROMPT_TRANSLATIONS) == {"en", "ja"}
    for language, templates in PROMPT_TRANSLATIONS.items():
        assert not re.search(r"example|demonstration|例えば|例文|예시|모범", json.dumps(
            templates, ensure_ascii=False,
        ), re.I)
        for stage in messages(OutputLanguage(language)).values():
            assert [item["role"] for item in stage] == ["system", "user"]


def test_mixed_language_batches_retain_the_existing_per_clip_language_rules():
    clips = [CommentClipInput(
        clip_index=index, hook_title="원본", reason="", duration_seconds=30,
        transcript=[], output_language=lang,
    ) for index, lang in enumerate((OutputLanguage.EN, OutputLanguage.JA), start=1)]
    system = CommentGenerator._messages(clips)[0]["content"]
    assert "쇼츠 1: outputLanguage=en" in system
    assert "쇼츠 2: outputLanguage=ja" in system
