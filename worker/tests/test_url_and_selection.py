from __future__ import annotations

from types import SimpleNamespace

import pytest

from shorts_worker.config import Settings, normalize_database_url
from shorts_worker.errors import InvalidYouTubeUrl, ShortsMakerError
from shorts_worker.schemas import (
    ClipLengthOption,
    HighlightCandidate,
    HighlightClip,
    OutputLanguage,
    SelectionResponse,
    SubtitleSegment,
)
from shorts_worker.selector import (
    TranscriptSelector,
    clip_count_for_duration,
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
    assert 31 <= clips[0].end_seconds - clips[0].start_seconds <= 60
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


def test_clips_stay_inside_user_selected_range() -> None:
    clips = normalize_clips(
        [HighlightClip(start_seconds=10, end_seconds=50, hook_title="범위 밖 후보")],
        video_title="범위 검증",
        duration_seconds=600,
        required_count=2,
        range_start_seconds=180,
        range_end_seconds=360,
    )
    assert len(clips) == 1
    assert all(180 <= clip.start_seconds < clip.end_seconds <= 360 for clip in clips)


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


@pytest.mark.parametrize(
    ("option", "minimum", "maximum"),
    [
        (ClipLengthOption.SEC_30, 20, 30),
        (ClipLengthOption.SEC_31_60, 31, 60),
        (ClipLengthOption.SEC_61_180, 61, 180),
    ],
)
def test_clip_length_options_are_enforced(option, minimum, maximum) -> None:
    clips = normalize_clips(
        [HighlightClip(start_seconds=10, end_seconds=400, hook_title="후보")],
        video_title="길이 검증",
        duration_seconds=600,
        required_count=1,
        clip_length_option=option,
    )
    assert minimum <= clips[0].end_seconds - clips[0].start_seconds <= maximum


def test_gemini_defaults_match_ai_talk(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_TEXT_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_OPENAI_BASE_URL", raising=False)

    settings = Settings(gemini_api_key=None, openai_api_key=None)

    assert settings.gemini_text_model == "gemini-2.5-flash-lite"
    assert (
        settings.gemini_openai_base_url
        == "https://generativelanguage.googleapis.com/v1beta/openai/"
    )


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

    clips = selector._select_with_gemini(
        video_title="테스트 영상",
        duration_seconds=120,
        transcript=[SubtitleSegment(start=10, end=20, text="중요한 테스트 자막")],
        required_count=1,
        output_language=OutputLanguage.JA,
    )

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
    assert "자연스러운 일본어 구어체" in request["messages"][0]["content"]
    assert "공백 포함 5~18자" in request["messages"][0]["content"]
    assert "hook_title_line1" in request["messages"][0]["content"]
    assert "예시" not in request["messages"][0]["content"]
    assert clips[0].hook_title == "Gemini가 고른\n핵심 장면의 반전"

    selector._select_with_gemini(
        video_title="English title test",
        duration_seconds=120,
        transcript=[SubtitleSegment(start=10, end=20, text="Important transcript")],
        required_count=1,
        output_language=OutputLanguage.EN,
    )
    english_request = captured["request"]
    assert isinstance(english_request, dict)
    assert "자연스러운 영어 구어체" in english_request["messages"][0]["content"]
    assert "공백 포함 5~18자" in english_request["messages"][0]["content"]


def test_openai_key_alone_does_not_enable_gemini_selection(monkeypatch) -> None:
    selector = TranscriptSelector(
        Settings(openai_api_key="openai-test-key", gemini_api_key=None)
    )

    def unexpected_call(**_kwargs):
        raise AssertionError("Gemini must not run without GEMINI_API_KEY")

    monkeypatch.setattr(selector, "_select_with_gemini", unexpected_call)
    clips = selector.select(
        video_title="Fallback 영상",
        duration_seconds=120,
        transcript=[SubtitleSegment(start=0, end=10, text="자막")],
        required_count=1,
    )

    assert len(clips) == 1
    assert "AI를 사용할 수 없어" in clips[0].reason


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


def test_generated_title_is_not_truncated_by_the_worker() -> None:
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
    title = "아주 긴 제목도 작업 자체를 실패시키지 않고 원문을 그대로 보존해야 합니다 " * 4
    clips = normalize_clips(
        [HighlightClip(start_seconds=10, end_seconds=50, hook_title=title)],
        video_title="원본 영상",
        duration_seconds=120,
        required_count=1,
        transcript=[],
    )

    assert clips[0].hook_title.replace("\n", " ") == title.strip()
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
    assert len(clips[0].hook_title.splitlines()) == 2


def test_selector_falls_back_when_gemini_fails(monkeypatch) -> None:
    selector = TranscriptSelector(
        Settings(openai_api_key=None, gemini_api_key="gemini-test-key")
    )

    def failing_call(**_kwargs):
        raise RuntimeError("simulated Gemini failure")

    monkeypatch.setattr(selector, "_select_with_gemini", failing_call)
    clips = selector.select(
        video_title="Fallback 영상",
        duration_seconds=300,
        transcript=[SubtitleSegment(start=0, end=10, text="자막")],
        required_count=2,
    )

    assert len(clips) == 2
    assert all("AI를 사용할 수 없어" in clip.reason for clip in clips)
