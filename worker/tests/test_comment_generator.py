from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from shorts_worker.comment_generator import (
    CommentClipInput,
    CommentGenerationResponse,
    CommentGenerator,
    CommentProviderResponseError,
    GeneratedClipComments,
    comment_target_count,
)
from shorts_worker.config import Settings
from shorts_worker.fallback_comments import FALLBACK_COMMENT_TEXTS
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


def _comment_text(clip_index: int, comment_index: int) -> str:
    return f"이 장면 반응 진짜 새롭다 {clip_index}-{comment_index}"


def _response(*clips: CommentClipInput) -> CommentGenerationResponse:
    return CommentGenerationResponse(
        clips=[
            GeneratedClipComments(
                clipIndex=clip.clip_index,
                comments=[
                    _comment_text(clip.clip_index, index + 1)
                    for index in range(clip.target_count)
                ],
            )
            for clip in clips
        ]
    )


@pytest.mark.parametrize(("duration", "expected"), [(30, 8), (60, 15)])
def test_comment_target_count_scales_with_short_duration(duration: float, expected: int) -> None:
    assert comment_target_count(duration) == expected


def test_prompt_numbers_every_short_and_requests_text_only_comments() -> None:
    messages = CommentGenerator._messages([_clip(), _clip(duration=60, clip_index=2)])

    assert "[쇼츠 1]" in messages[1]["content"]
    assert "targetCommentCount: 8" in messages[1]["content"]
    assert "[쇼츠 2]" in messages[1]["content"]
    assert "targetCommentCount: 15" in messages[1]["content"]
    assert "많은 사람이 반대로 알고 있습니다." in messages[1]["content"]
    assert "0.000~10.000" not in messages[1]["content"]
    assert "startSeconds" not in messages[0]["content"]
    assert "endSeconds" not in messages[0]["content"]
    assert "시간이나 닉네임 등 다른 정보는 만들지 않는다" in messages[0]["content"]


def test_ai_response_schema_contains_only_clip_index_and_comment_strings() -> None:
    schema = CommentGenerationResponse.model_json_schema(by_alias=True)
    clip_schema = schema["$defs"]["GeneratedClipComments"]

    assert set(clip_schema["properties"]) == {"clipIndex", "comments"}
    assert clip_schema["properties"]["comments"]["items"] == {"type": "string"}
    assert "startSeconds" not in str(schema)
    assert "endSeconds" not in str(schema)


def test_gemini_success_uses_server_generated_even_comment_slots() -> None:
    clip = _clip()
    generator = CommentGenerator(
        Settings(gemini_api_key="gemini-key", openai_api_key="openai-key")
    )
    generator._generate_with_gemini = MagicMock(return_value=_response(clip))
    generator._generate_with_openai = MagicMock()

    comments = generator.generate([clip])[1]

    assert len(comments) == 8
    assert comments[0]["startSeconds"] == 0
    assert comments[-1]["endSeconds"] == clip.duration_seconds
    assert all(
        comments[index]["startSeconds"] == comments[index - 1]["endSeconds"]
        for index in range(1, len(comments))
    )
    assert all(
        2.5 <= comment["endSeconds"] - comment["startSeconds"] <= 5.0
        for comment in comments
    )
    generator._generate_with_openai.assert_not_called()


def test_partial_gemini_response_preserves_valid_comments_and_fills_only_missing_slot() -> None:
    clip = _clip()
    ai_comments = [_comment_text(1, index + 1) for index in range(7)]
    response = {
        "clips": [
            {
                "clipIndex": 1,
                "comments": [*ai_comments, ai_comments[0], "", "짧음"],
            }
        ]
    }
    generator = CommentGenerator(
        Settings(gemini_api_key="gemini-key", openai_api_key="openai-key")
    )
    generator._generate_with_gemini = MagicMock(return_value=response)
    generator._generate_with_openai = MagicMock()

    comments = generator.generate([clip])[1]

    assert len(comments) == clip.target_count
    assert [comment["text"] for comment in comments[:7]] == ai_comments
    assert comments[7]["text"] not in ai_comments
    generator._generate_with_openai.assert_not_called()


def test_extra_comments_are_truncated_without_openai_retry() -> None:
    clip = _clip()
    extra_comments = [_comment_text(1, index + 1) for index in range(10)]
    generator = CommentGenerator(
        Settings(gemini_api_key="gemini-key", openai_api_key="openai-key")
    )
    generator._generate_with_gemini = MagicMock(
        return_value={"clips": [{"clipIndex": 1, "comments": extra_comments}]}
    )
    generator._generate_with_openai = MagicMock()

    comments = generator.generate([clip])[1]

    assert [comment["text"] for comment in comments] == extra_comments[: clip.target_count]
    generator._generate_with_openai.assert_not_called()


def test_missing_short_uses_existing_fallback_without_discarding_other_shorts() -> None:
    first = _clip(clip_index=1)
    second = _clip(clip_index=2)
    generator = CommentGenerator(
        Settings(gemini_api_key="gemini-key", openai_api_key="openai-key")
    )
    generator._generate_with_gemini = MagicMock(return_value=_response(first))
    generator._generate_with_openai = MagicMock()

    result = generator.generate([first, second])

    assert [comment["text"] for comment in result[1]] == [
        _comment_text(1, index + 1) for index in range(first.target_count)
    ]
    assert len(result[2]) == second.target_count
    generator._generate_with_openai.assert_not_called()


@pytest.mark.parametrize("reason", ["empty_response", "invalid_json", "no_usable_comments"])
def test_unusable_gemini_response_calls_openai_once(reason: str) -> None:
    clip = _clip()
    generator = CommentGenerator(
        Settings(gemini_api_key="gemini-key", openai_api_key="openai-key")
    )
    generator._generate_with_gemini = MagicMock(
        side_effect=CommentProviderResponseError(reason)
    )
    generator._generate_with_openai = MagicMock(return_value=_response(clip))

    comments = generator.generate([clip])[1]

    assert len(comments) == clip.target_count
    generator._generate_with_openai.assert_called_once()


@pytest.mark.parametrize("content", [None, "", "not-json"])
def test_raw_empty_or_invalid_json_response_is_unusable(content: str | None) -> None:
    client = MagicMock()
    choice = MagicMock()
    choice.message.content = content
    client.chat.completions.create.return_value.choices = [choice]

    with pytest.raises(CommentProviderResponseError):
        CommentGenerator._parse_response(client, "model", [{"role": "user", "content": "x"}])


def test_both_ai_failures_fill_the_exact_target_from_attached_fallback_comments() -> None:
    clip = _clip(duration=60)
    generator = CommentGenerator(
        Settings(gemini_api_key="gemini-key", openai_api_key="openai-key")
    )
    generator._generate_with_gemini = MagicMock(side_effect=RuntimeError("gemini failed"))
    generator._generate_with_openai = MagicMock(side_effect=RuntimeError("openai failed"))

    comments = generator.generate([clip])[1]

    assert len(comments) == clip.target_count
    assert comments[-1]["endSeconds"] == clip.duration_seconds
    assert all(
        comments[index]["startSeconds"] >= comments[index - 1]["endSeconds"]
        for index in range(1, len(comments))
    )


def test_missing_provider_keys_uses_attached_fallback_without_api_calls() -> None:
    clip = _clip()
    generator = CommentGenerator(Settings(gemini_api_key=None, openai_api_key=None))
    generator._generate_with_gemini = MagicMock()
    generator._generate_with_openai = MagicMock()

    result = generator.generate([clip])

    assert len(result[1]) == clip.target_count
    generator._generate_with_gemini.assert_not_called()
    generator._generate_with_openai.assert_not_called()


def test_attached_fallback_catalog_is_unique_and_varies_by_short_number() -> None:
    first = _clip(clip_index=1)
    second = _clip(clip_index=2)
    generator = CommentGenerator(Settings(gemini_api_key=None, openai_api_key=None))

    result = generator.generate([first, second])
    first_texts = {comment["text"] for comment in result[1]}
    second_texts = {comment["text"] for comment in result[2]}

    assert len(FALLBACK_COMMENT_TEXTS) == 425
    assert len(set(FALLBACK_COMMENT_TEXTS)) == len(FALLBACK_COMMENT_TEXTS)
    assert len(first_texts) == first.target_count
    assert len(second_texts) == second.target_count
    assert first_texts.isdisjoint(second_texts)


def test_project_107_shape_keeps_all_valid_comments_when_one_comment_is_bad() -> None:
    clips = [
        *[_clip(duration=30, clip_index=index) for index in range(1, 8)],
        _clip(duration=60, clip_index=8),
    ]
    response = _response(*clips).model_dump(by_alias=True)
    clip_eight_comments = response["clips"][7]["comments"]
    clip_eight_comments[-1] = clip_eight_comments[0]
    generator = CommentGenerator(
        Settings(gemini_api_key="gemini-key", openai_api_key="openai-key")
    )
    generator._generate_with_gemini = MagicMock(return_value=response)
    generator._generate_with_openai = MagicMock()

    result = generator.generate(clips)

    assert [len(result[index]) for index in range(1, 8)] == [8] * 7
    assert len(result[8]) == 15
    assert [comment["text"] for comment in result[8][:14]] == clip_eight_comments[:14]
    generator._generate_with_openai.assert_not_called()
