from __future__ import annotations

import json
import re
from unittest.mock import MagicMock

import pytest

from shorts_worker.comment_generator import CommentClipInput, CommentGenerator
from shorts_worker.config import Settings
from shorts_worker.prompt_language import (
    CULTURE_COMMENT_MODEL,
    CULTURE_COMMENT_PROFILE,
    CULTURE_COMMENT_PROMPTS,
)
from shorts_worker.schemas import OutputLanguage, SubtitleSegment


@pytest.mark.parametrize("language", [OutputLanguage.KO, OutputLanguage.EN, OutputLanguage.JA])
@pytest.mark.parametrize("profile", [None, CULTURE_COMMENT_PROFILE])
def test_only_new_release_english_japanese_comments_use_flash(language, profile):
    clip = CommentClipInput(
        clip_index=1, hook_title="원본 제목", reason="", duration_seconds=20,
        transcript=[SubtitleSegment(start=0, end=20, text="원본 전사 {source}")],
        source_language="ko", output_language=language,
    )
    generator = CommentGenerator(Settings(
        gemini_api_key="test", gemini_paid_data_processing_confirmed=True,
        gemini_comment_model="ordinary-model", language_test_comment_profile=profile,
        openai_api_key=None,
    ))
    text = {
        "ko": "이 장면이 기억에 남아요", "en": "That timing was perfect!",
        "ja": "この間の取り方が絶妙すぎる",
    }[language]
    generator._generate_with_gemini = MagicMock(return_value={
        "clips": [{"clipIndex": 1, "comments": [text]}],
    })
    generator.generate([clip])
    args, kwargs = generator._generate_with_gemini.call_args
    opted_in = profile is not None and language != OutputLanguage.KO
    assert kwargs == ({"model": CULTURE_COMMENT_MODEL} if opted_in else {})
    assert args[0] == CommentGenerator._messages([clip], culture=opted_in)
    if opted_in:
        assert not re.search("[가-힣]", args[0][0]["content"])
    assert "원본 전사 {source}" in args[0][1]["content"]


def test_normal_worker_ignores_accidental_profile_environment(monkeypatch):
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_COMMENT_PROFILE", CULTURE_COMMENT_PROFILE)
    monkeypatch.delenv("EASYCUT_LANGUAGE_TEST_WORKER", raising=False)
    assert Settings().language_test_comment_profile is None
    monkeypatch.setenv("EASYCUT_LANGUAGE_TEST_WORKER", "true")
    assert Settings().language_test_comment_profile == CULTURE_COMMENT_PROFILE


def test_culture_prompts_preserve_ratios_and_use_affirmative_instructions_without_examples():
    for templates in CULTURE_COMMENT_PROMPTS.values():
        raw = json.dumps(templates, ensure_ascii=False)
        assert not re.search(
            r"don't|do not|must not|never|avoid|example|demonstration|"
            r"例えば|例文|예시|모범|しない|せず|禁止",
            raw, re.I,
        )
        for name in ["comment_system", "regeneration_system"]:
            assert ["35%", "25%", "20%", "20%"] == re.findall(r"\d+%", templates[name])
