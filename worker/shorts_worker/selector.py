from __future__ import annotations

import math
import re
from collections.abc import Iterable

from .config import Settings
from .errors import ShortsMakerError
from .schemas import (
    CLIP_LENGTH_RULES,
    OUTPUT_LANGUAGE_NAMES,
    ClipLengthOption,
    HighlightClip,
    OutputLanguage,
    SelectionResponse,
    SubtitleSegment,
)


def clip_count_for_duration(duration_seconds: float, *, maximum_seconds: int = 3600) -> int:
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise ValueError("영상 길이는 0보다 커야 합니다.")
    if duration_seconds > maximum_seconds:
        raise ShortsMakerError("최대 60분 길이의 영상까지만 만들 수 있습니다.")
    if duration_seconds < 4 * 60:
        return 1
    if duration_seconds < 10 * 60:
        return 2
    if duration_seconds < 20 * 60:
        return 3
    if duration_seconds < 35 * 60:
        return 4
    return 5


def overlap_seconds(left: HighlightClip, right: HighlightClip) -> float:
    return max(
        0.0,
        min(left.end_seconds, right.end_seconds) - max(left.start_seconds, right.start_seconds),
    )


FALLBACK_TITLE_LINES = {
    OutputLanguage.KO: ("놓치면 안 되는", "핵심 장면"),
    OutputLanguage.EN: ("The Moment You", "Cannot Miss"),
    OutputLanguage.JA: ("見逃せない", "重要な瞬間"),
    OutputLanguage.ZH_CN: ("不容错过的", "关键时刻"),
    OutputLanguage.ES: ("Un momento que", "debes conocer"),
    OutputLanguage.FR: ("Le moment à", "ne pas manquer"),
    OutputLanguage.DE: ("Diesen Moment", "nicht verpassen"),
    OutputLanguage.PT_BR: ("Um momento que", "você deve ver"),
}


def _clean_title_line(value: str) -> str:
    clean = re.sub(r"(?:^|\s)>>\s*", " ", value)
    clean = re.sub(
        r"\[(?:음악|박수|웃음|music|applause|laughter)\]", " ", clean, flags=re.I
    )
    return " ".join(clean.split()).strip(" -–—.,!?…\"'")


def _two_line_title(value: str, output_language: OutputLanguage) -> str:
    manual_lines = [_clean_title_line(line) for line in value.splitlines()]
    manual_lines = [line for line in manual_lines if line]
    if len(manual_lines) >= 2:
        return f"{manual_lines[0]}\n{' '.join(manual_lines[1:])}"

    clean = _clean_title_line(value)
    minimum_total = (
        10
        if output_language in {OutputLanguage.KO, OutputLanguage.JA, OutputLanguage.ZH_CN}
        else 24
    )
    if len(clean) < minimum_total:
        return "\n".join(FALLBACK_TITLE_LINES[output_language])
    spaces = [index for index, char in enumerate(clean) if char == " "]
    split_at = (
        min(spaces, key=lambda index: abs(index - len(clean) / 2))
        if spaces
        else len(clean) // 2
    )
    first = clean[:split_at].strip()
    second = clean[split_at:].strip()
    if not first or not second:
        return "\n".join(FALLBACK_TITLE_LINES[output_language])
    return f"{first}\n{second}"


def _fallback_title(
    transcript: list[SubtitleSegment],
    start: float,
    end: float,
    index: int,
    output_language: OutputLanguage,
) -> str:
    """Use the selected passage itself instead of leaking the source video title."""
    passage = " ".join(
        segment.text
        for segment in transcript
        if segment.end > start and segment.start < end
    )
    passage = " ".join(passage.split()).strip(" -–—.,!?…\"'")
    if passage:
        return _two_line_title(passage, output_language)
    first, second = FALLBACK_TITLE_LINES[output_language]
    return f"{first}\n{second} {index}"


def deterministic_fallback(
    video_title: str,
    duration_seconds: float,
    required_count: int,
    transcript: list[SubtitleSegment] | None = None,
    range_start_seconds: float = 0,
    range_end_seconds: float | None = None,
    clip_length_option: ClipLengthOption = ClipLengthOption.SEC_31_60,
    output_language: OutputLanguage = OutputLanguage.KO,
) -> list[HighlightClip]:
    if required_count < 1:
        return []
    range_end_seconds = duration_seconds if range_end_seconds is None else range_end_seconds
    available_duration = range_end_seconds - range_start_seconds
    _, _, target_length = CLIP_LENGTH_RULES[clip_length_option]
    clip_length = min(target_length, available_duration)
    max_start = max(range_start_seconds, range_end_seconds - clip_length)
    if required_count == 1:
        starts = [range_start_seconds + (available_duration - clip_length) / 2]
    else:
        movable = max(0.0, available_duration - clip_length)
        margin = min(15.0, movable / (required_count + 1))
        first = range_start_seconds + margin
        last = max(first, max_start - margin)
        step = (last - first) / (required_count - 1)
        starts = [first + index * step for index in range(required_count)]
    transcript = transcript or []
    return [
        HighlightClip(
            start_seconds=round(start, 3),
            end_seconds=round(min(range_end_seconds, start + clip_length), 3),
            hook_title=_fallback_title(
                transcript,
                start,
                min(range_end_seconds, start + clip_length),
                index + 1,
                output_language,
            ),
            reason="자막 또는 AI를 사용할 수 없어 영상 전체에 고르게 배치한 구간입니다.",
        )
        for index, start in enumerate(starts)
    ]


def _fits(
    start: float,
    length: float,
    accepted: Iterable[HighlightClip],
    minimum: float,
    maximum: float,
) -> bool:
    if start < minimum - 1e-6 or start + length > maximum + 1e-6:
        return False
    probe = HighlightClip(
        start_seconds=max(minimum, start),
        end_seconds=min(maximum, start + length),
        hook_title="검증",
    )
    return all(overlap_seconds(probe, other) <= 5.0001 for other in accepted)


def _find_start(
    desired: float,
    length: float,
    accepted: list[HighlightClip],
    minimum: float,
    maximum_end: float,
) -> float | None:
    maximum = max(minimum, maximum_end - length)
    desired = max(minimum, min(maximum, desired))
    positions = [desired, minimum, maximum]
    for other in accepted:
        positions.extend(
            (
                other.end_seconds - 5.0,
                other.start_seconds - length + 5.0,
            )
        )
    # One-second scan is a final deterministic placement strategy for unusual AI ranges.
    positions.extend(float(second) for second in range(int(minimum), int(maximum) + 1))
    for position in sorted(set(positions), key=lambda value: (abs(value - desired), value)):
        position = max(minimum, min(maximum, position))
        if _fits(position, length, accepted, minimum, maximum_end):
            return position
    return None


def normalize_clips(
    candidates: Iterable[HighlightClip],
    *,
    video_title: str,
    duration_seconds: float,
    required_count: int,
    transcript: list[SubtitleSegment] | None = None,
    range_start_seconds: float = 0,
    range_end_seconds: float | None = None,
    clip_length_option: ClipLengthOption = ClipLengthOption.SEC_31_60,
    output_language: OutputLanguage = OutputLanguage.KO,
) -> list[HighlightClip]:
    """Clamp invalid LLM times and enforce at most five seconds of pairwise overlap."""
    if duration_seconds <= 0 or required_count < 1:
        return []
    range_end_seconds = duration_seconds if range_end_seconds is None else range_end_seconds
    available_duration = range_end_seconds - range_start_seconds
    configured_minimum, configured_maximum, _ = CLIP_LENGTH_RULES[clip_length_option]
    minimum_length = min(configured_minimum, available_duration)
    maximum_length = min(configured_maximum, available_duration)
    accepted: list[HighlightClip] = []

    pool = list(candidates) + deterministic_fallback(
        video_title,
        duration_seconds,
        required_count,
        transcript,
        range_start_seconds,
        range_end_seconds,
        clip_length_option,
        output_language,
    )
    for candidate in pool:
        if len(accepted) >= required_count:
            break
        try:
            raw_start = float(candidate.start_seconds)
            raw_end = float(candidate.end_seconds)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(raw_start) or not math.isfinite(raw_end) or raw_end <= raw_start:
            continue
        raw_length = raw_end - raw_start
        length = max(minimum_length, min(maximum_length, raw_length))
        start = _find_start(
            raw_start, length, accepted, range_start_seconds, range_end_seconds
        )
        if start is None:
            continue
        accepted.append(
            HighlightClip(
                start_seconds=round(start, 3),
                end_seconds=round(min(range_end_seconds, start + length), 3),
                hook_title=_two_line_title(candidate.hook_title, output_language),
                reason=str(candidate.reason or ""),
            )
        )
    return sorted(accepted, key=lambda clip: clip.start_seconds)


class TranscriptSelector:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @staticmethod
    def _transcript_text(segments: list[SubtitleSegment]) -> str:
        lines: list[str] = []
        total = 0
        for segment in segments:
            line = f"[{segment.start:.2f}-{segment.end:.2f}] {segment.text}"
            if total + len(line) > 100_000:
                break
            lines.append(line)
            total += len(line) + 1
        return "\n".join(lines)

    def _select_with_gemini(
        self,
        *,
        video_title: str,
        duration_seconds: float,
        transcript: list[SubtitleSegment],
        required_count: int,
        range_start_seconds: float = 0,
        range_end_seconds: float | None = None,
        clip_length_option: ClipLengthOption = ClipLengthOption.SEC_31_60,
        output_language: OutputLanguage = OutputLanguage.KO,
    ) -> list[HighlightClip]:
        from openai import OpenAI

        range_end_seconds = duration_seconds if range_end_seconds is None else range_end_seconds
        client = OpenAI(
            api_key=self.settings.gemini_api_key,
            base_url=self.settings.gemini_openai_base_url,
            timeout=self.settings.ai_timeout_seconds,
            max_retries=1,
        )
        minimum, maximum, target = CLIP_LENGTH_RULES[clip_length_option]
        language_name = OUTPUT_LANGUAGE_NAMES[output_language]
        system = (
            "너는 유튜브 트렌드를 깊이 이해하는 100만 유튜버의 전담 숏폼 기획자이자 "
            "탑티어 카피라이터입니다.\n\n"
            "제공되는 타임스탬프 영상 대본을 분석해 요청된 Pydantic JSON 구조로만 "
            "반환하세요.\n\n"
            "[구간 선정]\n"
            "제공되는 원본 영상 대본에서 시청자의 관심을 강하게 끌거나 유용한 통찰을 "
            f"주는 쇼츠용 킬러 포인트를 정확히 {required_count}개 선정하세요.\n\n"
            f"- 각 구간은 {minimum:.0f}~{maximum:.0f}초이며, 가능하면 {target:.0f}초에 "
            "가깝게 선택하세요.\n"
            "- 선택 가능한 영상 범위 안에서 자연스러운 문장 경계에 맞추세요.\n"
            "- 앞내용 없이도 이해되고 구간 안에서 내용이 자연스럽게 마무리되어야 합니다.\n"
            "- 아래 요소 중 하나 이상이 강하게 포함된 구간을 우선하세요.\n\n"
            "1. 인사이트 폭격: 대중의 고정관념을 깨거나 과감하고 단호한 발언이 나오는 "
            "구간\n"
            "2. 텐션 극대화: 갈등, 반전 또는 감정이 최고조에 달해 몰입감이 높은 순간\n"
            "3. 공감과 실용성: 저장하고 다시 보고 싶을 만큼 직관적이고 유용한 정보가 "
            "압축된 구간\n\n"
            "- 특히 첫 3초 안에 강한 발언, 질문, 갈등 또는 궁금증을 만드는 말이 등장하는 "
            "구간을 우선하세요.\n"
            "- 설명만 길거나 결론이 없는 구간은 제외하세요.\n"
            "- 비슷한 내용은 가장 강한 구간 하나만 선택하세요.\n"
            "- 구간 사이의 중복은 최대 5초로 유지하세요.\n\n"
            "[후킹 제목]\n"
            "1. 선정된 각 구간의 대본을 분석해 후킹 제목을 작성하세요.\n"
            "2. 반드시 딱 2행으로 작성하세요.\n"
            "3. 1행과 2행은 각각 공백 포함 5~18자로 작성하세요.\n"
            "4. 군더더기 없이 직관적이고 강한 인상을 주는 말투를 사용하세요.\n"
            "5. 다음 요소 중 해당 구간에 가장 적합한 요소를 제목에 반영하세요.\n"
            "- 시청자의 깊은 공감\n"
            "- 결말을 궁금하게 만드는 호기심\n"
            "- 대본의 핵심적인 반전이나 갈등\n\n"
            f"- 자연스러운 {language_name}로 작성하세요.\n"
            "- 1행은 hook_title_line1, 2행은 hook_title_line2에 줄바꿈 없는 문자열로 "
            "반환하세요.\n\n"
            f"응답 전에 클립 수가 정확히 {required_count}개인지, 각 구간의 길이와 중복 "
            "조건이 맞는지, 모든 제목이 2행이며 각 행이 5~18자인지 확인하세요.\n\n"
            "JSON 외의 설명이나 문장은 반환하지 마세요."
        )
        user = (
            f"영상 제목: {video_title}\n영상 길이: {duration_seconds:.3f}초\n"
            f"선택 가능 구간: {range_start_seconds:.3f}~{range_end_seconds:.3f}초\n"
            f"필요한 클립 수: {required_count}\n\n타임스탬프 자막:\n"
            f"{self._transcript_text(transcript)}"
        )
        response = client.beta.chat.completions.parse(
            model=self.settings.gemini_text_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format=SelectionResponse,
        )
        if not response.choices:
            raise ValueError("Gemini가 하이라이트 후보를 반환하지 않았습니다.")
        parsed = response.choices[0].message.parsed
        if parsed is None:
            raise ValueError("Gemini 구조화 응답을 해석할 수 없습니다.")
        if not isinstance(parsed, SelectionResponse):
            parsed = SelectionResponse.model_validate(parsed)
        return [
            HighlightClip(
                start_seconds=candidate.start_seconds,
                end_seconds=candidate.end_seconds,
                hook_title=f"{candidate.hook_title_line1}\n{candidate.hook_title_line2}",
                reason=candidate.reason,
            )
            for candidate in parsed.clips
        ]

    def select(
        self,
        *,
        video_title: str,
        duration_seconds: float,
        transcript: list[SubtitleSegment],
        required_count: int,
        range_start_seconds: float = 0,
        range_end_seconds: float | None = None,
        clip_length_option: ClipLengthOption = ClipLengthOption.SEC_31_60,
        output_language: OutputLanguage = OutputLanguage.KO,
    ) -> list[HighlightClip]:
        range_end_seconds = duration_seconds if range_end_seconds is None else range_end_seconds
        candidates: list[HighlightClip] = []
        if self.settings.gemini_api_key and transcript:
            try:
                candidates = self._select_with_gemini(
                    video_title=video_title,
                    duration_seconds=duration_seconds,
                    transcript=transcript,
                    required_count=required_count,
                    range_start_seconds=range_start_seconds,
                    range_end_seconds=range_end_seconds,
                    clip_length_option=clip_length_option,
                    output_language=output_language,
                )
            except Exception:
                candidates = []
        return normalize_clips(
            candidates,
            video_title=video_title,
            duration_seconds=duration_seconds,
            required_count=required_count,
            transcript=transcript,
            range_start_seconds=range_start_seconds,
            range_end_seconds=range_end_seconds,
            clip_length_option=clip_length_option,
            output_language=output_language,
        )
