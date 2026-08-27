from __future__ import annotations

from types import SimpleNamespace

import pytest

from shorts_worker.config import Settings, normalize_database_url
from shorts_worker.errors import InvalidYouTubeUrl, ShortsMakerError
from shorts_worker.schemas import (
    AI_CLIP_FALLBACK_SECONDS,
    AI_CLIP_MAX_SECONDS,
    AI_CLIP_MIN_SECONDS,
    HighlightCandidate,
    HighlightClip,
    OutputLanguage,
    SelectionResponse,
    SubtitleSegment,
)
from shorts_worker.selector import (
    TranscriptSelector,
    _two_line_title,
    clip_count_for_duration,
    deterministic_fallback,
    minimum_clip_count,
    normalize_clips,
    overlap_seconds,
)
from shorts_worker.url_validation import validate_youtube_url
from shorts_worker.worker_pipeline import edit_timeline_clip


@pytest.mark.parametrize("separator", ["\v", "\x85", "\x1e"])
def test_selector_does_not_promote_python_only_title_breaks(separator: str) -> None:
    title = _two_line_title(
        f"브라우저에서는 한 줄{separator}제목으로 보는 충분히 긴 문장",
        OutputLanguage.KO,
    )

    assert title.count("\n") == 1
    assert title != "브라우저에서는 한 줄\n제목으로 보는 충분히 긴 문장"


@pytest.mark.parametrize(
    ("url", "video_id"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ],
)
def test_supported_youtube_urls_are_normalized(url: str, video_id: str) -> None:
    normalized, parsed_id = validate_youtube_url(url)
    assert parsed_id == video_id
    assert normalized == f"https://www.youtube.com/watch?v={video_id}"


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
        "javascript:alert(1)",
        "https://user:secret@youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=too-short",
    ],
)
def test_non_allowlisted_or_malformed_urls_are_rejected(url: str) -> None:
    with pytest.raises(InvalidYouTubeUrl):
        validate_youtube_url(url)


@pytest.mark.parametrize(
    ("duration", "expected"),
    [
        (239.9, 3),
        (240, 5),
        (599.9, 5),
        (600, 8),
        (1_199.9, 8),
        (1_200, 10),
        (1_799.9, 10),
        (1_800, 12),
        (2_699.9, 12),
        (2_700, 15),
        (3_600, 15),
    ],
)
def test_clip_count_boundaries(duration: float, expected: int) -> None:
    assert clip_count_for_duration(duration) == expected


@pytest.mark.parametrize(
    ("target", "minimum"),
    [(3, 3), (5, 4), (8, 6), (10, 7), (12, 8), (15, 10)],
)
def test_minimum_clip_count_is_sixty_five_percent_with_small_job_buffer(
    target: int, minimum: int
) -> None:
    assert minimum_clip_count(target) == minimum
    assert minimum >= (target + 1) // 2 + 1
    assert minimum <= target


def test_minimum_clip_count_handles_non_positive_values() -> None:
    assert minimum_clip_count(0) == 0
    assert minimum_clip_count(-1) == 0


def test_selection_prompt_uses_the_same_sixty_five_percent_minimum() -> None:
    selector = TranscriptSelector(Settings())
    messages = selector._selection_messages(
        video_title="최대 개수 프롬프트 검증",
        duration_seconds=3_600,
        transcript=[SubtitleSegment(start=0, end=10, text="자막")],
        required_count=15,
    )

    assert "최종 쇼츠 개수는 10개부터 15개 사이" in messages[0]["content"]
    assert "최소 쇼츠 수: 10" in messages[1]["content"]
    assert "최대 쇼츠 수: 15" in messages[1]["content"]


def test_videos_over_sixty_minutes_are_rejected() -> None:
    with pytest.raises(ShortsMakerError, match="60분"):
        clip_count_for_duration(3_600.01)


@pytest.mark.parametrize(
    ("start", "end", "source_duration", "expected_start", "expected_end"),
    [
        (40, 80, 200, 10, 110),
        (10, 50, 200, 0, 80),
        (150, 190, 200, 120, 200),
    ],
)
def test_edit_timeline_adds_at_most_thirty_seconds_at_each_boundary(
    start: float,
    end: float,
    source_duration: float,
    expected_start: float,
    expected_end: float,
) -> None:
    clip = HighlightClip(
        start_seconds=start,
        end_seconds=end,
        hook_title="선택 구간",
    )

    timeline = edit_timeline_clip(clip, source_duration)

    assert timeline.start_seconds == expected_start
    assert timeline.end_seconds == expected_end
    assert timeline.hook_title == clip.hook_title


def test_out_of_range_ai_clip_is_rejected_and_replaced_without_its_title() -> None:
    clips = normalize_clips(
        [
            HighlightClip(
                start_seconds=-10,
                end_seconds=200,
                hook_title="원본 범위를 벗어난 후보",
            )
        ],
        video_title="검증 영상",
        duration_seconds=100,
        required_count=1,
    )
    assert len(clips) == 1
    assert clips[0].selection_provider == "deterministic"
    assert clips[0].selection_raw_start_seconds is None
    assert "원본 범위를 벗어난 후보" not in clips[0].hook_title
    assert (
        AI_CLIP_MIN_SECONDS
        <= clips[0].end_seconds - clips[0].start_seconds
        <= AI_CLIP_MAX_SECONDS
    )
    assert clips[0].end_seconds <= 100


def test_overlapping_ai_clip_is_rejected_instead_of_moving_its_title() -> None:
    candidates = [
        HighlightClip(start_seconds=10, end_seconds=50, hook_title="첫 장면"),
        HighlightClip(start_seconds=20, end_seconds=60, hook_title="둘째 장면"),
    ]
    clips = normalize_clips(
        candidates,
        video_title="겹침 검증",
        duration_seconds=180,
        required_count=2,
    )
    assert len(clips) == 2
    assert overlap_seconds(clips[0], clips[1]) <= 5.001
    assert clips[0].selection_repositioned is False
    assert clips[0].selection_provider is None
    assert clips[1].selection_provider == "deterministic"
    assert "둘째 장면" not in clips[1].hook_title


def test_viral_scores_rank_clips_without_restoring_timeline_order() -> None:
    clips = normalize_clips(
        [
            HighlightClip(
                start_seconds=200,
                end_seconds=250,
                hook_title="낮은 점수",
                viral_score=70,
            ),
            HighlightClip(
                start_seconds=500,
                end_seconds=550,
                hook_title="공동 최고 첫 후보",
                viral_score=90,
            ),
            HighlightClip(
                start_seconds=100,
                end_seconds=150,
                hook_title="공동 최고 둘째 후보",
                viral_score=90,
            ),
            HighlightClip(
                start_seconds=300,
                end_seconds=370,
                hook_title="중간 점수",
                viral_score=80,
            ),
        ],
        video_title="바이럴 순위 검증",
        duration_seconds=600,
        required_count=4,
        selection_provider="gemini",
        selection_model="gemini-3.5-flash-lite",
    )

    assert [clip.viral_score for clip in clips] == [90, 90, 80, 70]
    assert [clip.selection_candidate_index for clip in clips] == [2, 3, 4, 1]
    assert [clip.start_seconds for clip in clips] == [500, 100, 300, 200]
    assert all(
        AI_CLIP_MIN_SECONDS
        <= clip.end_seconds - clip.start_seconds
        <= AI_CLIP_MAX_SECONDS
        for clip in clips
    )
    assert all(
        overlap_seconds(left, right) <= 5.001
        for index, left in enumerate(clips)
        for right in clips[index + 1 :]
    )


def test_viral_score_component_ranges_are_strict() -> None:
    with pytest.raises(ValueError):
        HighlightCandidate(
            start_seconds=10,
            end_seconds=50,
            hook_title_line1="점수 범위",
            hook_title_line2="검증 후보",
            reason="후킹 점수가 범위를 벗어납니다.",
            hook_score=31,
            completeness_score=20,
            impact_score=20,
            shareability_score=20,
            density_score=10,
        )


@pytest.mark.parametrize(
    ("duration", "target", "minimum"),
    [
        (180, 3, 3),
        (240, 5, 4),
        (600, 8, 6),
        (1_200, 10, 7),
        (1_800, 12, 8),
        (2_700, 15, 10),
    ],
)
def test_heavily_overlapping_candidates_still_produce_a_safe_minimum(
    duration: float, target: int, minimum: int
) -> None:
    clips = normalize_clips(
        [
            HighlightClip(
                start_seconds=0,
                end_seconds=60,
                hook_title=f"겹치는 후보 {index + 1}",
            )
            for index in range(target)
        ],
        video_title="겹침 안전성 검증",
        duration_seconds=duration,
        required_count=target,
    )

    assert minimum <= len(clips) <= target
    assert all(
        AI_CLIP_MIN_SECONDS
        <= clip.end_seconds - clip.start_seconds
        <= AI_CLIP_MAX_SECONDS
        for clip in clips
    )
    assert all(
        overlap_seconds(left, right) <= 5.001
        for index, left in enumerate(clips)
        for right in clips[index + 1 :]
    )


def test_valid_ai_clips_are_backfilled_only_to_minimum() -> None:
    clips = normalize_clips(
        [
            HighlightClip(start_seconds=0, end_seconds=50, hook_title="첫 후보"),
            HighlightClip(start_seconds=60, end_seconds=110, hook_title="둘째 후보"),
            HighlightClip(start_seconds=120, end_seconds=170, hook_title="셋째 후보"),
        ],
        video_title="가변 개수 검증",
        duration_seconds=600,
        required_count=8,
        selection_provider="gemini",
        selection_model="gemini-2.5-flash-lite",
    )

    assert len(clips) == 6
    assert sum(clip.selection_provider == "gemini" for clip in clips) == 3
    assert sum(clip.selection_provider == "deterministic" for clip in clips) == 3
    assert all(
        overlap_seconds(left, right) <= 5.001
        for index, left in enumerate(clips)
        for right in clips[index + 1 :]
    )


def test_short_ai_clip_is_stably_expanded_between_thirty_and_forty_seconds() -> None:
    clips = normalize_clips(
        [
            HighlightClip(start_seconds=10, end_seconds=20, hook_title="짧은 후보"),
            HighlightClip(start_seconds=100, end_seconds=145, hook_title="정상 후보"),
            HighlightClip(start_seconds=200, end_seconds=290, hook_title="90초 후보"),
            HighlightClip(start_seconds=400, end_seconds=600, hook_title="최대 초과 후보"),
        ],
        video_title="길이 검증",
        duration_seconds=700,
        required_count=4,
        selection_provider="gemini",
        selection_model="gemini-2.5-flash-lite",
    )
    durations = [clip.end_seconds - clip.start_seconds for clip in clips]
    assert AI_CLIP_MIN_SECONDS <= durations[0] <= 40
    assert durations[1:] == [45, 90, AI_CLIP_MAX_SECONDS]
    assert clips[0].start_seconds < 10
    assert clips[0].end_seconds > 20
    assert [clip.selection_raw_duration_seconds for clip in clips] == [10, 45, 90, 200]
    assert [clip.selection_candidate_index for clip in clips] == [1, 2, 3, 4]
    assert [clip.selection_length_adjustment for clip in clips] == [
        "min_clamp",
        "none",
        "none",
        "max_clamp",
    ]
    assert {clip.selection_provider for clip in clips} == {"gemini"}
    assert {clip.selection_model for clip in clips} == {"gemini-2.5-flash-lite"}

    repeated = normalize_clips(
        [HighlightClip(start_seconds=10, end_seconds=20, hook_title="짧은 후보")],
        video_title="길이 검증",
        duration_seconds=400,
        required_count=1,
        selection_provider="gemini",
        selection_model="gemini-2.5-flash-lite",
    )
    assert repeated[0].start_seconds == clips[0].start_seconds
    assert repeated[0].end_seconds == clips[0].end_seconds


def test_short_ai_clips_receive_varied_deterministic_lengths() -> None:
    candidates = [
        HighlightClip(
            start_seconds=20 + index * 70,
            end_seconds=35 + index * 70,
            hook_title=f"짧은 후보 {index + 1}",
        )
        for index in range(6)
    ]

    clips = normalize_clips(
        candidates,
        video_title="길이 다양성 검증",
        duration_seconds=500,
        required_count=6,
        selection_provider="gemini",
        selection_model="gemini-2.5-flash-lite",
    )
    durations = [round(clip.end_seconds - clip.start_seconds, 1) for clip in clips]

    assert len(clips) == 6
    assert all(30 <= duration <= 40 for duration in durations)
    assert len(set(durations)) > 1
    assert all(clip.selection_length_adjustment == "min_clamp" for clip in clips)


def test_deterministic_fallback_uses_forty_five_seconds() -> None:
    clips = deterministic_fallback(
        "fallback 영상",
        180,
        1,
    )

    assert len(clips) == 1
    assert clips[0].end_seconds - clips[0].start_seconds == AI_CLIP_FALLBACK_SECONDS
    assert 0 <= clips[0].start_seconds < clips[0].end_seconds <= 180
    assert clips[0].selection_provider == "deterministic"
    assert clips[0].selection_raw_start_seconds is None
    assert clips[0].selection_raw_end_seconds is None
    assert clips[0].selection_raw_duration_seconds is None


def test_gemini_defaults_match_ai_talk(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_TEXT_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_TRANSCRIBE_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_HIGHLIGHT_FALLBACK_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_COMMENT_FALLBACK_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_COMMENT_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_TRANSCRIBE_CHUNK_SECONDS", raising=False)
    monkeypatch.delenv("OPENAI_TRANSCRIBE_MAX_WORKERS", raising=False)

    settings = Settings(gemini_api_key=None, openai_api_key=None)

    assert settings.gemini_text_model == "gemini-3.5-flash-lite"
    assert (
        settings.gemini_openai_base_url
        == "https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    assert settings.openai_transcribe_model == "gpt-4o-mini-transcribe"
    assert settings.openai_highlight_fallback_model == "gpt-5-nano"
    assert settings.openai_comment_fallback_model == "gpt-5-nano"
    assert settings.gemini_comment_model == "gemini-2.5-flash-lite"
    assert settings.openai_transcribe_chunk_seconds == 30
    assert settings.openai_transcribe_max_workers == 4


def test_gemini_requires_paid_data_processing_confirmation(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_PAID_DATA_PROCESSING_CONFIRMED", raising=False)
    unconfirmed = Settings(gemini_api_key="gemini-test-key")
    confirmed = Settings(
        gemini_api_key="gemini-test-key",
        gemini_paid_data_processing_confirmed=True,
    )

    assert unconfirmed.gemini_enabled is False
    assert confirmed.gemini_enabled is True


def test_worker_database_url_removes_web_only_options() -> None:
    value = normalize_database_url(
        "postgresql://user:pass@example.com/db?pgbouncer=true&sslmode=require"
        "&connection_limit=1&schema=shorts_mvp"
    )

    assert value == "postgresql://user:pass@example.com/db?sslmode=require"


def test_gemini_selector_requests_structured_highlights(monkeypatch) -> None:
    captured: dict[str, object] = {}
    parsed = SelectionResponse(
        clips=[
            HighlightCandidate(
                start_seconds=12,
                end_seconds=48,
                hook_title_line1="Gemini가 고른",
                hook_title_line2="핵심 장면의 반전",
                reason="테스트 후보",
                hook_score=27,
                completeness_score=18,
                impact_score=17,
                shareability_score=16,
                density_score=9,
            )
        ]
    )

    class FakeCompletions:
        def parse(self, **kwargs):
            captured["request"] = kwargs
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(parsed=parsed))]
            )

    class FakeOpenAI:
        def __init__(self, **kwargs) -> None:
            captured["client"] = kwargs
            self.beta = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)
    settings = Settings(
        openai_api_key=None,
        gemini_api_key="gemini-test-key",
        gemini_paid_data_processing_confirmed=True,
        gemini_text_model="gemini-2.5-flash-lite",
    )
    selector = TranscriptSelector(settings)

    messages = selector._selection_messages(
        video_title="테스트 영상",
        duration_seconds=120,
        transcript=[SubtitleSegment(start=10, end=20, text="중요한 테스트 자막")],
        required_count=1,
        output_language=OutputLanguage.JA,
    )
    clips = selector._select_with_gemini(messages=messages)

    client_options = captured["client"]
    request = captured["request"]
    assert isinstance(client_options, dict)
    assert isinstance(request, dict)
    assert client_options["api_key"] == "gemini-test-key"
    assert client_options["base_url"] == "https://generativelanguage.googleapis.com/v1beta/openai/"
    assert request["model"] == "gemini-2.5-flash-lite"
    assert request["response_format"] is SelectionResponse
    assert "중요한 테스트 자막" in request["messages"][1]["content"]
    assert "타임스탬프 자막" in request["messages"][1]["content"]
    assert "탑티어 숏폼 기획자" in request["messages"][0]["content"]
    assert "쇼츠용 킬러 구간" in request["messages"][0]["content"]
    assert "후보를 모두 비교한 뒤 다섯 점수의 합이 높은 순서" in request["messages"][0]["content"]
    assert "영상에 등장하는 시간순으로 정렬하지 말 것" in request["messages"][0]["content"]
    assert (
        "1. **길이 및 완결성**: 각 구간의 end_seconds - start_seconds를 계산한 값이 "
        "30.000초 이상 120.000초 이하가 되도록 start_seconds와 end_seconds를 정할 것. "
        "핵심 장면이 짧은 경우에는 해당 장면이 성립하는 앞의 상황과 직후의 반응 또는 "
        "결과까지 함께 포함하여 하나의 완결된 연속 구간으로 구성할 것."
        in request["messages"][0]["content"]
    )
    assert "군더더기 없이 직관적이고 타격감 있는 구어체 단어" in request["messages"][0]["content"]
    assert "자연스러운 일본어 구어체" in request["messages"][0]["content"]
    assert "공백 포함 5~18자" in request["messages"][0]["content"]
    assert "hook_title_line1" in request["messages"][0]["content"]
    assert "reason에는 이 구간이 쇼츠로 매력적인 이유" in request["messages"][0]["content"]
    assert "reason은 자연스러운 일본어" in request["messages"][0]["content"]
    assert "예시" not in request["messages"][0]["content"]
    assert clips[0].hook_title == "Gemini가 고른\n핵심 장면의 반전"
    assert clips[0].reason == "테스트 후보"
    assert clips[0].viral_score == 87

    english_messages = selector._selection_messages(
        video_title="English title test",
        duration_seconds=120,
        transcript=[SubtitleSegment(start=10, end=20, text="Important transcript")],
        required_count=1,
        output_language=OutputLanguage.EN,
    )
    selector._select_with_gemini(messages=english_messages)
    english_request = captured["request"]
    assert isinstance(english_request, dict)
    assert "자연스러운 영어 구어체" in english_request["messages"][0]["content"]
    assert "공백 포함 5~18자" in english_request["messages"][0]["content"]


def test_missing_gemini_key_uses_openai_nano(monkeypatch) -> None:
    selector = TranscriptSelector(Settings(openai_api_key="openai-test-key", gemini_api_key=None))
    nano_calls = 0

    def unexpected_call(**_kwargs):
        raise AssertionError("Gemini must not run without GEMINI_API_KEY")

    def nano_call(**_kwargs):
        nonlocal nano_calls
        nano_calls += 1
        return [
            HighlightClip(
                start_seconds=10,
                end_seconds=50,
                hook_title="Nano 선택\n핵심 구간",
                reason="OpenAI fallback",
            )
        ]

    monkeypatch.setattr(selector, "_select_with_gemini", unexpected_call)
    monkeypatch.setattr(selector, "_select_with_openai", nano_call)
    clips = selector.select(
        video_title="Fallback 영상",
        duration_seconds=120,
        transcript=[SubtitleSegment(start=0, end=10, text="자막")],
        required_count=1,
    )

    assert len(clips) == 1
    assert nano_calls == 1
    assert clips[0].reason == "OpenAI fallback"
    assert clips[0].selection_provider == "openai"
    assert clips[0].selection_model == "gpt-5-nano"


def test_gemini_success_does_not_call_openai_nano(monkeypatch) -> None:
    selector = TranscriptSelector(
        Settings(
            openai_api_key="openai-test-key",
            gemini_api_key="gemini-test-key",
            gemini_paid_data_processing_confirmed=True,
        )
    )

    monkeypatch.setattr(
        selector,
        "_select_with_gemini",
        lambda **_kwargs: [
            HighlightClip(
                start_seconds=10,
                end_seconds=50,
                hook_title="Gemini 선택\n핵심 구간",
                reason="Gemini success",
            )
        ],
    )
    monkeypatch.setattr(
        selector,
        "_select_with_openai",
        lambda **_kwargs: (_ for _ in ()).throw(
            AssertionError("Nano must not run after Gemini success")
        ),
    )

    clips = selector.select(
        video_title="테스트 영상",
        duration_seconds=120,
        transcript=[SubtitleSegment(start=0, end=60, text="자막")],
        required_count=1,
    )

    assert clips[0].reason == "Gemini success"
    assert clips[0].selection_provider == "gemini"
    assert clips[0].selection_model == "gemini-3.5-flash-lite"


def test_gemini_error_uses_openai_nano(monkeypatch) -> None:
    selector = TranscriptSelector(
        Settings(
            openai_api_key="openai-test-key",
            gemini_api_key="gemini-test-key",
            gemini_paid_data_processing_confirmed=True,
        )
    )
    monkeypatch.setattr(
        selector,
        "_select_with_gemini",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("Gemini unavailable")),
    )
    monkeypatch.setattr(
        selector,
        "_select_with_openai",
        lambda **_kwargs: [
            HighlightClip(
                start_seconds=20,
                end_seconds=60,
                hook_title="Nano 선택\n대체 구간",
                reason="Nano success",
            )
        ],
    )

    clips = selector.select(
        video_title="테스트 영상",
        duration_seconds=120,
        transcript=[SubtitleSegment(start=0, end=60, text="자막")],
        required_count=1,
    )

    assert clips[0].reason == "Nano success"


def test_insufficient_gemini_candidates_use_openai_nano(monkeypatch) -> None:
    selector = TranscriptSelector(
        Settings(
            openai_api_key="openai-test-key",
            gemini_api_key="gemini-test-key",
            gemini_paid_data_processing_confirmed=True,
        )
    )
    monkeypatch.setattr(
        selector,
        "_select_with_gemini",
        lambda **_kwargs: [
            HighlightClip(
                start_seconds=10,
                end_seconds=50,
                hook_title="후보 하나\n최소 미달",
                reason="Gemini",
            )
        ],
    )
    monkeypatch.setattr(
        selector,
        "_select_with_openai",
        lambda **_kwargs: [
            HighlightClip(
                start_seconds=10,
                end_seconds=50,
                hook_title="Nano 첫째\n핵심 구간",
                reason="Nano one",
            ),
            HighlightClip(
                start_seconds=70,
                end_seconds=110,
                hook_title="Nano 둘째\n핵심 구간",
                reason="Nano two",
            ),
        ],
    )

    clips = selector.select(
        video_title="긴 테스트 영상",
        duration_seconds=300,
        transcript=[SubtitleSegment(start=0, end=120, text="자막")],
        required_count=2,
    )

    assert [clip.reason for clip in clips] == ["Nano one", "Nano two"]


def test_invalid_gemini_times_use_openai_nano_without_failing_project(monkeypatch) -> None:
    selector = TranscriptSelector(
        Settings(
            openai_api_key="openai-test-key",
            gemini_api_key="gemini-test-key",
            gemini_paid_data_processing_confirmed=True,
        )
    )
    monkeypatch.setattr(
        selector,
        "_select_with_gemini",
        lambda **_kwargs: [
            HighlightClip(
                start_seconds=50,
                end_seconds=40,
                hook_title="뒤집힌 시간\n잘못된 후보",
                reason="Gemini invalid time",
            )
        ],
    )
    monkeypatch.setattr(
        selector,
        "_select_with_openai",
        lambda **_kwargs: [
            HighlightClip(
                start_seconds=10,
                end_seconds=50,
                hook_title="Nano 대체\n정상 구간",
                reason="Nano recovered",
            )
        ],
    )

    clips = selector.select(
        video_title="시간 오류 복구 영상",
        duration_seconds=120,
        transcript=[SubtitleSegment(start=0, end=60, text="자막")],
        required_count=1,
    )

    assert len(clips) == 1
    assert clips[0].reason == "Nano recovered"
    assert clips[0].selection_provider == "openai"


def test_fallback_title_removes_subtitle_speaker_markers() -> None:
    clips = normalize_clips(
        [],
        video_title="원본 제목을 쓰면 안 됨",
        duration_seconds=120,
        required_count=1,
        transcript=[SubtitleSegment(start=0, end=80, text=">> 야, 지금 바로 가야지! >> 그래")],
    )
    assert ">>" not in clips[0].hook_title
    assert "원본 제목" not in clips[0].hook_title


def test_generated_title_inside_database_limit_is_preserved() -> None:
    title = "AI 대장주 누가? 엔트로픽 5달 만에 오픈AI를 추월한 이유"
    clips = normalize_clips(
        [HighlightClip(start_seconds=10, end_seconds=50, hook_title=title)],
        video_title="원본 영상",
        duration_seconds=120,
        required_count=1,
        transcript=[],
    )

    assert clips[0].hook_title.replace("\n", " ") == title
    assert len(clips[0].hook_title.splitlines()) == 2


def test_title_over_eighty_characters_does_not_fail_generation() -> None:
    title = "아주 긴 제목도 작업 자체를 실패시키지 않고 안전하게 제한되어야 합니다 " * 4
    clips = normalize_clips(
        [HighlightClip(start_seconds=10, end_seconds=50, hook_title=title)],
        video_title="원본 영상",
        duration_seconds=120,
        required_count=1,
        transcript=[],
    )

    assert len(clips[0].hook_title) <= 80
    assert len(clips[0].hook_title.splitlines()) == 2


def test_long_transcript_fallback_title_does_not_fail_generation() -> None:
    transcript_text = "길이가 긴 자막에서도 안전하게 쇼츠를 완성해야 합니다. " * 20
    clips = normalize_clips(
        [],
        video_title="원본 영상",
        duration_seconds=120,
        required_count=1,
        transcript=[SubtitleSegment(start=0, end=80, text=transcript_text)],
    )

    assert len(clips) == 1
    assert clips[0].hook_title
    assert len(clips[0].hook_title) <= 80
    assert len(clips[0].hook_title.splitlines()) == 2


def test_selector_falls_back_when_gemini_fails(monkeypatch) -> None:
    selector = TranscriptSelector(
        Settings(
            openai_api_key="openai-test-key",
            gemini_api_key="gemini-test-key",
            gemini_paid_data_processing_confirmed=True,
        )
    )

    def failing_call(**_kwargs):
        raise RuntimeError("simulated Gemini failure")

    monkeypatch.setattr(selector, "_select_with_gemini", failing_call)
    monkeypatch.setattr(selector, "_select_with_openai", failing_call)
    clips = selector.select(
        video_title="Fallback 영상",
        duration_seconds=300,
        transcript=[SubtitleSegment(start=0, end=10, text="자막")],
        required_count=2,
    )

    assert len(clips) == 2
    assert all("AI를 사용할 수 없어" in clip.reason for clip in clips)


def test_selector_fallback_guarantees_minimum_for_largest_project(monkeypatch) -> None:
    selector = TranscriptSelector(
        Settings(
            openai_api_key="openai-test-key",
            gemini_api_key="gemini-test-key",
            gemini_paid_data_processing_confirmed=True,
        )
    )

    def failing_call(**_kwargs):
        raise RuntimeError("simulated provider failure")

    monkeypatch.setattr(selector, "_select_with_gemini", failing_call)
    monkeypatch.setattr(selector, "_select_with_openai", failing_call)
    clips = selector.select(
        video_title="60분 fallback 영상",
        duration_seconds=3_600,
        transcript=[SubtitleSegment(start=0, end=10, text="자막")],
        required_count=15,
    )

    assert len(clips) == 10
    assert all(
        AI_CLIP_MIN_SECONDS
        <= clip.end_seconds - clip.start_seconds
        <= AI_CLIP_MAX_SECONDS
        for clip in clips
    )
    assert all(
        overlap_seconds(left, right) <= 5.001
        for index, left in enumerate(clips)
        for right in clips[index + 1 :]
    )
