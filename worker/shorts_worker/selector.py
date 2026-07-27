from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Iterable
from typing import Any

from .config import Settings
from .errors import ShortsMakerError
from .schemas import (
    AI_CLIP_FALLBACK_SECONDS,
    AI_CLIP_MAX_SECONDS,
    AI_CLIP_MIN_SECONDS,
    MAX_HOOK_TITLE_CHARS,
    OUTPUT_LANGUAGE_NAMES,
    HighlightClip,
    OutputLanguage,
    SelectionResponse,
    SubtitleSegment,
)


def _log_selection_event(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, separators=(",", ":")), flush=True)


def clip_count_for_duration(duration_seconds: float, *, maximum_seconds: int = 3600) -> int:
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise ValueError("영상 길이는 0보다 커야 합니다.")
    if duration_seconds > maximum_seconds:
        raise ShortsMakerError("최대 60분 길이의 영상까지만 만들 수 있습니다.")
    if duration_seconds < 4 * 60:
        return 3
    if duration_seconds < 10 * 60:
        return 5
    if duration_seconds < 20 * 60:
        return 8
    if duration_seconds < 30 * 60:
        return 10
    if duration_seconds < 45 * 60:
        return 12
    return 15


def minimum_clip_count_for_duration(duration_seconds: float) -> int:
    return 1 if duration_seconds < 4 * 60 else 2


def _expanded_short_clip_length(
    *,
    video_title: str,
    candidate_index: int | None,
    raw_start: float,
    raw_end: float,
    minimum_length: float,
    maximum_length: float,
) -> float:
    """Choose a stable 30-40 second target for an AI range shorter than 30 seconds."""
    upper = min(40.0, maximum_length)
    if upper <= minimum_length:
        return minimum_length
    seed = (
        f"{video_title}\x1f{candidate_index or 0}\x1f{raw_start:.3f}\x1f{raw_end:.3f}"
    ).encode()
    bucket_count = round((upper - minimum_length) * 10)
    bucket = int.from_bytes(hashlib.sha256(seed).digest()[:8], "big") % (bucket_count + 1)
    return round(minimum_length + bucket / 10, 1)


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
        first = manual_lines[0][: MAX_HOOK_TITLE_CHARS // 2].rstrip()
        remaining = MAX_HOOK_TITLE_CHARS - len(first) - 1
        second = " ".join(manual_lines[1:])[:remaining].rstrip()
        if first and second:
            return f"{first}\n{second}"

    # Reserve one character for the line break so generated values always fit
    # the database's 80-character constraint.
    clean = _clean_title_line(value)[: MAX_HOOK_TITLE_CHARS - 1].rstrip()
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
    output_language: OutputLanguage = OutputLanguage.KO,
) -> list[HighlightClip]:
    if required_count < 1:
        return []
    clip_length = min(AI_CLIP_FALLBACK_SECONDS, duration_seconds)
    max_start = max(0.0, duration_seconds - clip_length)
    if required_count == 1:
        starts = [(duration_seconds - clip_length) / 2]
    else:
        movable = max(0.0, duration_seconds - clip_length)
        margin = min(15.0, movable / (required_count + 1))
        first = margin
        last = max(first, max_start - margin)
        step = (last - first) / (required_count - 1)
        starts = [first + index * step for index in range(required_count)]
    transcript = transcript or []
    return [
        HighlightClip(
            start_seconds=round(start, 3),
            end_seconds=round(min(duration_seconds, start + clip_length), 3),
            hook_title=_fallback_title(
                transcript,
                start,
                min(duration_seconds, start + clip_length),
                index + 1,
                output_language,
            ),
            reason="자막 또는 AI를 사용할 수 없어 영상 전체에 고르게 배치한 구간입니다.",
            selection_provider="deterministic",
            selection_length_adjustment="none",
            selection_repositioned=False,
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
    output_language: OutputLanguage = OutputLanguage.KO,
    backfill: bool = True,
    selection_provider: str | None = None,
    selection_model: str | None = None,
) -> list[HighlightClip]:
    """Clamp invalid LLM times and enforce at most five seconds of pairwise overlap."""
    if duration_seconds <= 0 or required_count < 1:
        return []
    minimum_length = min(AI_CLIP_MIN_SECONDS, duration_seconds)
    maximum_length = min(AI_CLIP_MAX_SECONDS, duration_seconds)
    accepted: list[HighlightClip] = []
    minimum_count = minimum_clip_count_for_duration(duration_seconds)

    def accept(
        candidate: HighlightClip,
        *,
        candidate_index: int | None,
        provider: str | None,
        model: str | None,
        record_raw_selection: bool,
    ) -> None:
        if len(accepted) >= required_count:
            return
        try:
            raw_start = float(candidate.start_seconds)
            raw_end = float(candidate.end_seconds)
        except (TypeError, ValueError):
            return
        if not math.isfinite(raw_start) or not math.isfinite(raw_end) or raw_end <= raw_start:
            return
        raw_length = raw_end - raw_start
        if raw_length < minimum_length - 1e-6:
            length = _expanded_short_clip_length(
                video_title=video_title,
                candidate_index=candidate_index,
                raw_start=raw_start,
                raw_end=raw_end,
                minimum_length=minimum_length,
                maximum_length=maximum_length,
            )
            desired_start = raw_start - (length - raw_length) / 2
        else:
            length = min(maximum_length, raw_length)
            desired_start = raw_start
        start = _find_start(desired_start, length, accepted, 0, duration_seconds)
        if start is None:
            return
        rounded_start = round(start, 3)
        rounded_end = round(min(duration_seconds, start + length), 3)
        if raw_length < minimum_length - 1e-6:
            length_adjustment = "min_clamp"
        elif raw_length > maximum_length + 1e-6:
            length_adjustment = "max_clamp"
        else:
            length_adjustment = "none"
        if record_raw_selection:
            rounded_raw_start = round(raw_start, 3)
            rounded_raw_end = round(raw_end, 3)
            rounded_raw_duration = round(rounded_raw_end - rounded_raw_start, 3)
        else:
            rounded_raw_start = None
            rounded_raw_end = None
            rounded_raw_duration = None
        accepted.append(
            HighlightClip(
                start_seconds=rounded_start,
                end_seconds=rounded_end,
                hook_title=_two_line_title(candidate.hook_title, output_language),
                reason=str(candidate.reason or ""),
                selection_raw_start_seconds=rounded_raw_start,
                selection_raw_end_seconds=rounded_raw_end,
                selection_raw_duration_seconds=rounded_raw_duration,
                selection_candidate_index=candidate_index,
                selection_provider=provider,
                selection_model=model,
                selection_length_adjustment=length_adjustment,
                selection_repositioned=rounded_start != round(raw_start, 3),
            )
        )
    for candidate_index, candidate in enumerate(candidates, start=1):
        accept(
            candidate,
            candidate_index=candidate_index,
            provider=selection_provider,
            model=selection_model,
            record_raw_selection=True,
        )
    if backfill and len(accepted) < minimum_count:
        for candidate in deterministic_fallback(
            video_title, duration_seconds, minimum_count, transcript,
            output_language,
        ):
            accept(
                candidate,
                candidate_index=None,
                provider="deterministic",
                model=None,
                record_raw_selection=False,
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

    def _selection_messages(
        self,
        *,
        video_title: str,
        duration_seconds: float,
        transcript: list[SubtitleSegment],
        required_count: int,
        output_language: OutputLanguage = OutputLanguage.KO,
    ) -> list[dict[str, str]]:
        language_name = OUTPUT_LANGUAGE_NAMES[output_language]
        minimum_count = minimum_clip_count_for_duration(duration_seconds)
        system = (
            "너는 대한민국 상위 0.1% 조회수를 만들어내는 탑티어 숏폼 기획자이자 편집자야.\n\n"
            "아래 제공되는 유튜브 롱폼 대본을 분석해서, 대중의 시선을 사로잡을 쇼츠용 "
            "킬러 구간을 발췌하고 각 구간에 최적화된 2줄 후킹 제목을 만들어줘.\n\n"
            f"최종 쇼츠 개수는 {minimum_count}개부터 {required_count}개 사이에서 결정해.\n\n"
            "각 구간의 매력과 완성도를 쇼츠 개수보다 우선하고, 흥미로운 구간의 수에 "
            "따라 최종 개수를 결정할 것.\n\n"
            "[구간 선정]\n"
            "- 아래 요소 중 하나 이상이 강하게 포함된 구간을 최우선으로 찾을 것.\n\n"
            "1. 인사이트 폭격: 대중의 고정관념을 깨거나 과감하고 단호한 발언이 나오는 "
            "구간\n"
            "2. 텐션 극대화: 갈등, 반전 또는 감정이 최고조에 달해 몰입감이 압도적인 순간\n"
            "3. 공감과 실용성: 저장하고 다시 보고 싶을 만큼 직관적이고 뼈 때리는 정보가 "
            "요약된 구간\n\n"
            "[구간 분할 규칙]\n"
            "1. **길이 및 완결성**: 각 구간의 end_seconds - start_seconds를 계산한 값이 "
            "30.000초 이상 60.000초 이하가 되도록 start_seconds와 end_seconds를 정할 것. "
            "핵심 장면이 짧은 경우에는 해당 장면이 성립하는 앞의 상황과 직후의 반응 또는 "
            "결과까지 함께 포함하여 하나의 완결된 연속 구간으로 구성할 것.\n"
            "2. 흐름: 내용의 흐름에 맞춰 범위 안에서 자연스럽게 길이를 결정할 것.\n"
            "3. 경계: 선택 가능한 영상 범위 안에서 자연스러운 문장의 시작과 끝 경계에 맞출 것.\n"
            "4. 독립성: 앞부분 없이도 해당 구간만으로 이해되고, 구간 안에서 내용이 "
            "자연스럽게 마무리되도록 구성할 것.\n"
            "5. 중복 제한: 구간 사이의 시간 중복은 최대 5초로 유지할 것.\n"
            "6. 다양성: 각 쇼츠가 서로 다른 핵심 내용과 매력을 갖도록 구성할 것.\n\n"
            "[후킹 제목]\n"
            "- 형식: 각 쇼츠당 반드시 2행으로 작성할 것.\n"
            "- 글자 수: 1행과 2행을 각각 공백 포함 5~18자로 작성할 것.\n"
            "- 톤앤매너: 군더더기 없이 직관적이고 타격감 있는 구어체 단어를 사용할 것.\n"
            f"- 자연스러운 {language_name} 구어체로 작성할 것.\n"
            "- 1행은 hook_title_line1, 2행은 hook_title_line2에 줄바꿈 없는 문자열로 "
            "반환할 것.\n\n"
            "[선정 이유]\n"
            "- reason에는 이 구간이 쇼츠로 매력적인 이유를 구체적인 장면이나 발언을 "
            "근거로 1~2문장으로 작성할 것.\n"
            f"- reason은 자연스러운 {language_name}로 작성할 것.\n\n"
            "최종 응답은 요청된 Pydantic JSON 구조로만 반환할 것."
        )
        user = (
            f"영상 제목: {video_title}\n영상 길이: {duration_seconds:.3f}초\n"
            f"분석 범위: 전체 영상 0.000~{duration_seconds:.3f}초\n"
            f"최소 쇼츠 수: {minimum_count}\n최대 쇼츠 수: {required_count}"
            "\n\n타임스탬프 자막:\n"
            f"{self._transcript_text(transcript)}"
        )
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

    @staticmethod
    def _parse_selection(
        client: Any,
        model: str,
        messages: list[dict[str, str]],
    ) -> list[HighlightClip]:
        response = client.beta.chat.completions.parse(
            model=model,
            messages=messages,
            response_format=SelectionResponse,
        )
        if not response.choices:
            raise ValueError("하이라이트 후보가 비어 있습니다.")
        parsed = response.choices[0].message.parsed
        if parsed is None:
            raise ValueError("구조화 응답을 해석할 수 없습니다.")
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

    def _select_with_gemini(
        self,
        *,
        messages: list[dict[str, str]],
    ) -> list[HighlightClip]:
        from openai import OpenAI

        client = OpenAI(
            api_key=self.settings.gemini_api_key,
            base_url=self.settings.gemini_openai_base_url,
            timeout=self.settings.ai_timeout_seconds,
            max_retries=1,
        )
        return self._parse_selection(client, self.settings.gemini_text_model, messages)

    def _select_with_openai(
        self,
        *,
        messages: list[dict[str, str]],
    ) -> list[HighlightClip]:
        from openai import OpenAI

        client = OpenAI(
            api_key=self.settings.openai_api_key,
            timeout=self.settings.ai_timeout_seconds,
            max_retries=1,
        )
        return self._parse_selection(
            client,
            self.settings.openai_highlight_fallback_model,
            messages,
        )

    def select(
        self,
        *,
        video_title: str,
        duration_seconds: float,
        transcript: list[SubtitleSegment],
        required_count: int,
        output_language: OutputLanguage = OutputLanguage.KO,
    ) -> list[HighlightClip]:
        minimum_count = minimum_clip_count_for_duration(duration_seconds)
        messages = self._selection_messages(
            video_title=video_title,
            duration_seconds=duration_seconds,
            transcript=transcript,
            required_count=required_count,
            output_language=output_language,
        )

        providers = (
            (
                "gemini",
                self.settings.gemini_text_model,
                self.settings.gemini_enabled,
                self._select_with_gemini,
            ),
            (
                "openai",
                self.settings.openai_highlight_fallback_model,
                bool(self.settings.openai_api_key),
                self._select_with_openai,
            ),
        )
        for provider, model, configured, select_provider in providers:
            if not transcript:
                _log_selection_event(
                    "highlight_selection_provider",
                    provider=provider,
                    model=model,
                    status="skipped",
                    reason="transcript_empty",
                )
                continue
            if not configured:
                _log_selection_event(
                    "highlight_selection_provider",
                    provider=provider,
                    model=model,
                    status="skipped",
                    reason="not_configured",
                )
                continue
            _log_selection_event(
                "highlight_selection_provider",
                provider=provider,
                model=model,
                status="started",
            )
            try:
                candidates = select_provider(messages=messages)
                normalized = normalize_clips(
                    candidates,
                    video_title=video_title,
                    duration_seconds=duration_seconds,
                    transcript=transcript,
                    required_count=required_count,
                    output_language=output_language,
                    backfill=False,
                    selection_provider=provider,
                    selection_model=model,
                )
            except Exception as exc:
                _log_selection_event(
                    "highlight_selection_provider",
                    provider=provider,
                    model=model,
                    status="failed",
                    reason="provider_error",
                    error_type=type(exc).__name__,
                )
                continue
            if len(normalized) < minimum_count:
                _log_selection_event(
                    "highlight_selection_provider",
                    provider=provider,
                    model=model,
                    status="failed",
                    reason="insufficient_candidates",
                    clip_count=len(normalized),
                    minimum_clip_count=minimum_count,
                )
                continue
            _log_selection_event(
                "highlight_selection_provider",
                provider=provider,
                model=model,
                status="succeeded",
                clip_count=len(normalized),
            )
            _log_selection_event(
                "highlight_selection_completed",
                source=provider,
                model=model,
                clip_count=len(normalized),
            )
            return normalized

        fallback = normalize_clips(
            [],
            video_title=video_title,
            duration_seconds=duration_seconds,
            required_count=required_count,
            transcript=transcript,
            output_language=output_language,
        )
        _log_selection_event(
            "highlight_selection_completed",
            source="deterministic",
            model=None,
            clip_count=len(fallback),
        )
        return fallback
