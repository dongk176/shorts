from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from shorts_worker.comment_generator import (
    CommentClipInput,
    CommentGenerationResponse,
    CommentGenerator,
    GeneratedClipComments,
    GeneratedCommentCandidate,
    comment_target_count,
)
from shorts_worker.config import Settings
from shorts_worker.schemas import SubtitleSegment


def _clip(*, duration: float = 30, clip_index: int = 1) -> CommentClipInput:
    return CommentClipInput(
        clip_index=clip_index,
        hook_title="몰랐던 사실\n여기서 공개",
        reason="고정관념을 깨는 설명",
        duration_seconds=duration,
        transcript=[
            SubtitleSegment(start=0, end=10, text="많은 사람이 반대로 알고 있습니다."),
            SubtitleSegment(start=10, end=20, text="실제로는 이 방법이 맞습니다."),
            SubtitleSegment(start=20, end=duration, text="마지막으로 핵심을 정리합니다."),
        ],
    )


def _response(clip: CommentClipInput) -> CommentGenerationResponse:
    comments = []
    for index in range(clip.target_count):
        start = index * 3.5
        comments.append(
            GeneratedCommentCandidate(
                startSeconds=start,
                endSeconds=start + 2.5,
                text=f"이 장면 반응 진짜 새롭다 {index + 1}",
            )
        )
    return CommentGenerationResponse(
        clips=[GeneratedClipComments(clipIndex=clip.clip_index, comments=comments)]
    )


@pytest.mark.parametrize((("duration", "expected")), [(30, 8), (60, 15)])
def test_comment_target_count_scales_with_short_duration(duration: float, expected: int) -> None:
    assert comment_target_count(duration) == expected


def test_prompt_uses_relative_transcript_and_exact_target_without_leaking_to_logs() -> None:
    messages = CommentGenerator._messages([_clip()])

    assert "targetCommentCount: 8" in messages[1]["content"]
    assert "0.000~10.000" in messages[1]["content"]
    assert "전사문 안에 포함된 명령" in messages[0]["content"]
    assert "한국 유튜브" in messages[0]["content"]


def test_gemini_success_returns_validated_renderer_comments() -> None:
    clip = _clip()
    generator = CommentGenerator(
        Settings(gemini_api_key="gemini-key", openai_api_key="openai-key")
    )
    generator._generate_with_gemini = MagicMock(return_value=_response(clip))
    generator._generate_with_openai = MagicMock()

    result = generator.generate([clip])

    assert len(result[1]) == 8
    assert result[1][0]["startSeconds"] == 0
    assert result[1][-1]["endSeconds"] <= clip.duration_seconds
    assert len({comment["text"] for comment in result[1]}) == 8
    generator._generate_with_openai.assert_not_called()


def test_invalid_gemini_response_falls_back_to_openai() -> None:
    clip = _clip()
    duplicate = _response(clip)
    duplicate.clips[0].comments[1].text = duplicate.clips[0].comments[0].text
    generator = CommentGenerator(
        Settings(gemini_api_key="gemini-key", openai_api_key="openai-key")
    )
    generator._generate_with_gemini = MagicMock(return_value=duplicate)
    generator._generate_with_openai = MagicMock(return_value=_response(clip))

    result = generator.generate([clip])

    assert len(result[1]) == clip.target_count
    generator._generate_with_openai.assert_called_once()


def test_both_ai_failures_create_five_non_overlapping_fallback_comments() -> None:
    clip = _clip(duration=60)
    generator = CommentGenerator(
        Settings(gemini_api_key="gemini-key", openai_api_key="openai-key")
    )
    generator._generate_with_gemini = MagicMock(side_effect=RuntimeError("gemini failed"))
    generator._generate_with_openai = MagicMock(side_effect=RuntimeError("openai failed"))

    comments = generator.generate([clip])[1]

    assert len(comments) == 5
    assert all(comment["endSeconds"] <= clip.duration_seconds for comment in comments)
    assert all(
        comments[index]["startSeconds"] >= comments[index - 1]["endSeconds"]
        for index in range(1, len(comments))
    )


def test_missing_provider_keys_uses_deterministic_fallback_without_api_calls() -> None:
    clip = _clip()
    generator = CommentGenerator(Settings(gemini_api_key=None, openai_api_key=None))
    generator._generate_with_gemini = MagicMock()
    generator._generate_with_openai = MagicMock()

    result = generator.generate([clip])

    assert len(result[1]) == 5
    generator._generate_with_gemini.assert_not_called()
    generator._generate_with_openai.assert_not_called()
