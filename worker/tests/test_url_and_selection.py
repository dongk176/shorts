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
    clip_count_for_duration,
    deterministic_fallback,
    normalize_clips,
    overlap_seconds,
)
from shorts_worker.url_validation import validate_youtube_url


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


def test_videos_over_sixty_minutes_are_rejected() -> None:
    with pytest.raises(ShortsMakerError, match="60분"):
        clip_count_for_duration(3_600.01)


def test_invalid_clip_times_are_clamped_to_supported_range() -> None:
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
    assert clips[0].start_seconds == 0
    assert AI_CLIP_MIN_SECONDS <= clips[0].end_seconds - clips[0].start_seconds <= 60
    assert clips[0].end_seconds <= 100


def test_overlapping_clips_are_repositioned_to_five_seconds_or_less() -> None:
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


def test_valid_ai_clip_count_is_not_filled_to_maximum() -> None:
    clips = normalize_clips(
        [
            HighlightClip(start_seconds=0, end_seconds=50, hook_title="첫 후보"),
            HighlightClip(start_seconds=60, end_seconds=110, hook_title="둘째 후보"),
            HighlightClip(start_seconds=120, end_seconds=170, hook_title="셋째 후보"),
        ],
        video_title="가변 개수 검증",
        duration_seconds=600,
        required_count=8,
    )

    assert len(clips) == 3


def test_ai_clip_lengths_are_clamped_to_thirty_through_sixty_seconds() -> None:
    clips = normalize_clips(
        [
            HighlightClip(start_seconds=10, end_seconds=20, hook_title="짧은 후보"),
            HighlightClip(start_seconds=100, end_seconds=145, hook_title="정상 후보"),
            HighlightClip(start_seconds=200, end_seconds=290, hook_title="긴 후보"),
        ],
        video_title="길이 검증",
        duration_seconds=400,
        required_count=3,
    )
    assert [clip.end_seconds - clip.start_seconds for clip in clips] == [
        AI_CLIP_MIN_SECONDS,
        45,
        AI_CLIP_MAX_SECONDS,
    ]


def test_deterministic_fallback_uses_forty_five_seconds() -> None:
    clips = deterministic_fallback(
        "fallback 영상",
        180,
        1,
    )

    assert len(clips) == 1
    assert clips[0].end_seconds - clips[0].start_seconds == AI_CLIP_FALLBACK_SECONDS
    assert 0 <= clips[0].start_seconds < clips[0].end_seconds <= 180


def test_gemini_defaults_match_ai_talk(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_TEXT_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_TRANSCRIBE_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_HIGHLIGHT_FALLBACK_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_TRANSCRIBE_CHUNK_SECONDS", raising=False)
    monkeypatch.delenv("OPENAI_TRANSCRIBE_MAX_WORKERS", raising=False)

    settings = Settings(gemini_api_key=None, openai_api_key=None)

    assert settings.gemini_text_model == "gemini-2.5-flash-lite"
    assert (
        settings.gemini_openai_base_url
        == "https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    assert settings.openai_transcribe_model == "gpt-4o-mini-transcribe"
    assert settings.openai_highlight_fallback_model == "gpt-5-nano"
    assert settings.openai_transcribe_chunk_seconds == 30
    assert settings.openai_transcribe_max_workers == 4


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
            self.beta = SimpleNamespace(
                chat=SimpleNamespace(completions=FakeCompletions())
            )

    monkeypatch.setattr("openai.OpenAI", FakeOpenAI)
    settings = Settings(
        openai_api_key=None,
        gemini_api_key="gemini-test-key",
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
    assert (
        client_options["base_url"]
        == "https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    assert request["model"] == "gemini-2.5-flash-lite"
    assert request["response_format"] is SelectionResponse
    assert "중요한 테스트 자막" in request["messages"][1]["content"]
    assert "타임스탬프 자막" in request["messages"][1]["content"]
    assert "탑티어 숏폼 기획자" in request["messages"][0]["content"]
    assert "쇼츠용 킬러 구간" in request["messages"][0]["content"]
    assert (
        "1. **길이 및 완결성**: 각 구간은 30~60초 사이로 구성하되, "
        "**가급적 45~60초 분량을 우선적으로 확보**하여 시청자가 맥락을 깊이 있게 "
        "이해할 수 있도록 할 것. 단순히 30초에 맞춰 성급하게 자르는 것을 엄격히 금지함."
        in request["messages"][0]["content"]
    )
    assert (
        "군더더기 없이 직관적이고 타격감 있는 구어체 단어"
        in request["messages"][0]["content"]
    )
    assert "자연스러운 일본어 구어체" in request["messages"][0]["content"]
    assert "공백 포함 5~18자" in request["messages"][0]["content"]
    assert "hook_title_line1" in request["messages"][0]["content"]
    assert "reason에는 이 구간이 쇼츠로 매력적인 이유" in request["messages"][0]["content"]
    assert "reason은 자연스러운 일본어" in request["messages"][0]["content"]
    assert "예시" not in request["messages"][0]["content"]
    assert clips[0].hook_title == "Gemini가 고른\n핵심 장면의 반전"
    assert clips[0].reason == "테스트 후보"

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
    selector = TranscriptSelector(
        Settings(openai_api_key="openai-test-key", gemini_api_key=None)
    )
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


def test_gemini_success_does_not_call_openai_nano(monkeypatch) -> None:
    selector = TranscriptSelector(
        Settings(openai_api_key="openai-test-key", gemini_api_key="gemini-test-key")
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


def test_gemini_error_uses_openai_nano(monkeypatch) -> None:
    selector = TranscriptSelector(
        Settings(openai_api_key="openai-test-key", gemini_api_key="gemini-test-key")
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
        Settings(openai_api_key="openai-test-key", gemini_api_key="gemini-test-key")
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


def test_fallback_title_removes_subtitle_speaker_markers() -> None:
    clips = normalize_clips(
        [],
        video_title="원본 제목을 쓰면 안 됨",
        duration_seconds=120,
        required_count=1,
        transcript=[
            SubtitleSegment(start=0, end=80, text=">> 야, 지금 바로 가야지! >> 그래")
        ],
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
        Settings(openai_api_key="openai-test-key", gemini_api_key="gemini-test-key")
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
