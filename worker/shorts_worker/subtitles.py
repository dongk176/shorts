from __future__ import annotations

import json
import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import Settings
from .errors import TranscriptionError
from .media import media_duration, probe_media, run_command
from .schemas import SubtitleSegment

SENTENCE_RE = re.compile(r"(?<=[.!?。！？])\s+|\n+")
MIN_TRANSCRIBE_CHUNK_SECONDS = 1.0
TRANSCRIBE_CHUNK_MAX_ATTEMPTS = 2
TRANSCRIBE_CHUNK_RETRY_DELAY_SECONDS = 1.0
WORD_TIMESTAMP_BOUNDARY_TOLERANCE_SECONDS = 0.25
WORD_TIMESTAMP_MIN_DURATION_SECONDS = 1 / 30
OPENAI_STABLE_POLICY = "openai_stable"
ELEVENLABS_FALLBACK_POLICY = "elevenlabs_primary_openai_fallback"
SUPPORTED_TRANSCRIPTION_POLICIES = frozenset({
    OPENAI_STABLE_POLICY,
    ELEVENLABS_FALLBACK_POLICY,
})
_NO_SPACE_BEFORE = frozenset(",.!?:;)]}%。！？、，．：；）」』】》〉…")
_NO_SPACE_AFTER = frozenset("([{（「『【《〈")
_EAST_ASIAN_NO_SPACE_RE = re.compile(r"[\u3400-\u9fff\u3040-\u30ff]")


def _log_event(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, separators=(",", ":"), default=str), flush=True)


@dataclass(frozen=True, slots=True)
class TranscriptWord:
    text: str
    start: float
    end: float
    provider: str
    speaker_id: str | None = None
    space_before: bool = False

    def as_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            "text": self.text,
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "provider": self.provider,
        }
        if self.speaker_id:
            result["speakerId"] = self.speaker_id
        if self.space_before:
            result["spaceBefore"] = True
        return result


@dataclass(frozen=True, slots=True)
class TranscriptionResult:
    segments: list[SubtitleSegment]
    model: str
    chunk_count: int
    silent_chunk_count: int
    input_tokens: int
    output_tokens: int
    failed_chunk_count: int = 0
    skipped_chunk_count: int = 0
    failed_audio_seconds: float = 0.0
    requested_policy: str = OPENAI_STABLE_POLICY
    provider: str = "openai"
    words: tuple[TranscriptWord, ...] = field(default_factory=tuple)
    language_code: str | None = None
    language_probability: float | None = None
    fallback_chunk_count: int = 0
    fallback_audio_seconds: float = 0.0
    fallback_reasons: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class _ChunkTranscriptionResult:
    index: int
    segments: list[SubtitleSegment]
    silent: bool
    input_tokens: int
    output_tokens: int
    skipped: bool = False
    provider: str = "openai"
    model: str = ""
    words: tuple[TranscriptWord, ...] = field(default_factory=tuple)
    language_code: str | None = None
    language_probability: float | None = None
    fallback_reason: str | None = None


def _plain_text_segments(text: str, duration: float, offset: float) -> list[SubtitleSegment]:
    sentences = [part.strip() for part in SENTENCE_RE.split(text) if part.strip()]
    if not sentences and text.strip():
        sentences = [text.strip()]
    groups: list[str] = []
    for sentence in sentences:
        if groups and len(groups[-1]) + 1 + len(sentence) <= 50:
            groups[-1] += " " + sentence
        else:
            while len(sentence) > 50:
                groups.append(sentence[:50])
                sentence = sentence[50:]
            if sentence:
                groups.append(sentence)
    if not groups:
        return []
    step = max(0.1, duration / len(groups))
    return [
        SubtitleSegment(
            start=round(offset + index * step, 3),
            end=round(offset + min(duration, (index + 1) * step), 3),
            text=group,
        )
        for index, group in enumerate(groups)
    ]


def _response_value(value: Any, name: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(name, default)
    return getattr(value, name, default)


def _safe_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _join_word_text(current: str, token: str, *, space_before: bool = False) -> str:
    token = token.strip()
    if not token:
        return current
    if not current:
        return token
    left = current[-1]
    right = token[0]
    if right in _NO_SPACE_BEFORE or left in _NO_SPACE_AFTER:
        return current + token
    if space_before:
        return current + " " + token
    if _EAST_ASIAN_NO_SPACE_RE.fullmatch(left) and _EAST_ASIAN_NO_SPACE_RE.fullmatch(right):
        return current + token
    return current + " " + token


def _timed_transcript(
    raw_words: Any,
    *,
    offset: float,
    duration: float,
    provider: str,
) -> tuple[list[SubtitleSegment], tuple[TranscriptWord, ...]]:
    if not isinstance(raw_words, list | tuple):
        return [], ()
    words: list[TranscriptWord] = []
    previous_start = -1.0
    pending_space = False
    for raw in raw_words:
        word_type = str(_response_value(raw, "type", "word") or "word")
        raw_text = str(
            _response_value(raw, "text", _response_value(raw, "word", "")) or ""
        )
        if word_type == "spacing":
            pending_space = pending_space or any(char.isspace() for char in raw_text)
            continue
        if word_type != "word":
            continue
        leading_space = bool(raw_text[:1] and raw_text[:1].isspace())
        trailing_space = bool(raw_text[-1:] and raw_text[-1:].isspace())
        text = raw_text.strip()
        start = _safe_float(_response_value(raw, "start"))
        end = _safe_float(_response_value(raw, "end"))
        if (
            not text
            or start is None
            or end is None
            or end < start
            or start + 0.001 < previous_start
            or start > duration + WORD_TIMESTAMP_BOUNDARY_TOLERANCE_SECONDS
            or end > duration + WORD_TIMESTAMP_BOUNDARY_TOLERANCE_SECONDS
        ):
            raise TranscriptionError(
                f"{provider} 단어 타임스탬프가 올바르지 않습니다."
            )
        normalized_start = min(duration, start)
        normalized_end = min(duration, end)
        if normalized_end < normalized_start:
            raise TranscriptionError(
                f"{provider} 단어 타임스탬프가 오디오 범위를 벗어났습니다."
            )
        if normalized_end == normalized_start:
            if normalized_start >= duration:
                normalized_start = max(
                    0.0,
                    duration - WORD_TIMESTAMP_MIN_DURATION_SECONDS,
                )
                normalized_end = duration
            else:
                normalized_end = min(
                    duration,
                    normalized_start + WORD_TIMESTAMP_MIN_DURATION_SECONDS,
                )
        if normalized_end <= normalized_start:
            raise TranscriptionError(
                f"{provider} 단어 타임스탬프가 오디오 범위를 벗어났습니다."
            )
        previous_start = start
        words.append(TranscriptWord(
            text=text,
            start=round(offset + normalized_start, 3),
            end=round(offset + normalized_end, 3),
            provider=provider,
            speaker_id=(
                str(speaker) if (speaker := _response_value(raw, "speaker_id")) else None
            ),
            # Keep the provider's boundary signal even on the first word of a
            # chunk. Chunk results are flattened later, where this bit is
            # required to prevent the last Korean token of one chunk from
            # being joined to the first token of the next.
            space_before=pending_space or leading_space,
        ))
        pending_space = trailing_space
    if not words:
        return [], ()

    segments: list[SubtitleSegment] = []
    group: list[TranscriptWord] = []
    group_text = ""
    for word in words:
        proposed = _join_word_text(
            group_text,
            word.text,
            space_before=word.space_before,
        )
        sentence_end = word.text[-1:] in ".!?。！？"
        if group and len(proposed) > 50:
            segments.append(SubtitleSegment(
                start=group[0].start,
                end=group[-1].end,
                text=group_text,
            ))
            group = []
            group_text = ""
            proposed = word.text
        group.append(word)
        group_text = proposed
        if sentence_end:
            segments.append(SubtitleSegment(
                start=group[0].start,
                end=group[-1].end,
                text=group_text,
            ))
            group = []
            group_text = ""
    if group:
        segments.append(SubtitleSegment(
            start=group[0].start,
            end=group[-1].end,
            text=group_text,
        ))
    return segments, tuple(words)


class AudioTranscriber:
    """Stable OpenAI transcription plus an isolated ElevenLabs-first policy."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _extract_chunks(
        self,
        video_path: Path,
        audio_dir: Path,
        *,
        start_seconds: float = 0.0,
        duration_seconds: float | None = None,
    ) -> list[Path]:
        audio_dir.mkdir(parents=True, exist_ok=True)
        output = audio_dir / "audio_%04d.m4a"
        input_args = ["-i", str(video_path)]
        if start_seconds > 0:
            input_args = ["-ss", f"{start_seconds:.3f}", *input_args]
        duration_args = (
            ["-t", f"{duration_seconds:.3f}"]
            if duration_seconds is not None
            else []
        )
        result = run_command(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                *input_args,
                *duration_args,
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "aac",
                "-b:a",
                "48k",
                "-f",
                "segment",
                "-segment_time",
                str(self.settings.openai_transcribe_chunk_seconds),
                "-reset_timestamps",
                "1",
                str(output),
            ],
            timeout=self.settings.ffmpeg_timeout_seconds,
        )
        if result.returncode != 0:
            raise TranscriptionError("전사용 오디오를 준비하지 못했습니다.")
        chunks = sorted(audio_dir.glob("audio_*.m4a"))
        if not chunks:
            raise TranscriptionError("전사할 오디오를 찾지 못했습니다.")
        return chunks

    @staticmethod
    def _response_dict(response: Any) -> dict[str, Any]:
        if isinstance(response, dict):
            return response
        if hasattr(response, "model_dump"):
            data = response.model_dump()
            return data if isinstance(data, dict) else {}
        return {"text": str(getattr(response, "text", ""))}

    @staticmethod
    def _usage_tokens(data: dict[str, Any]) -> tuple[int, int]:
        usage = data.get("usage") or {}
        if not isinstance(usage, dict) and hasattr(usage, "model_dump"):
            usage = usage.model_dump()
        if not isinstance(usage, dict):
            return 0, 0

        def value(name: str) -> int:
            try:
                return max(0, int(usage.get(name) or 0))
            except (TypeError, ValueError):
                return 0

        return value("input_tokens"), value("output_tokens")

    def _transcribe_chunk(
        self,
        client: Any,
        *,
        index: int,
        chunk: Path,
        duration: float,
        offset: float,
    ) -> _ChunkTranscriptionResult:
        def request(audio_path: Path) -> Any:
            with audio_path.open("rb") as audio_file:
                return client.audio.transcriptions.create(
                    model=self.settings.openai_transcribe_model,
                    file=audio_file,
                    response_format="json",
                )

        try:
            response = request(chunk)
        except Exception:
            retry_chunk = self._normalize_retry_chunk(chunk)
            _log_event(
                "transcription_chunk_retrying",
                chunk_index=index,
                duration_seconds=round(duration, 3),
                media_bytes=chunk.stat().st_size,
                attempt=TRANSCRIBE_CHUNK_MAX_ATTEMPTS,
                retry_format=retry_chunk.suffix.lstrip("."),
            )
            time.sleep(TRANSCRIBE_CHUNK_RETRY_DELAY_SECONDS)
            response = request(retry_chunk)
        data = self._response_dict(response)
        text = " ".join(str(data.get("text") or "").split())
        segments = _plain_text_segments(text, duration, offset)
        input_tokens, output_tokens = self._usage_tokens(data)
        return _ChunkTranscriptionResult(
            index=index,
            segments=segments,
            silent=not segments,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            provider="openai",
            model=self.settings.openai_transcribe_model,
        )

    def _transcribe_chunk_openai_fallback(
        self,
        client: Any,
        *,
        index: int,
        chunk: Path,
        duration: float,
        offset: float,
        fallback_reason: str,
    ) -> _ChunkTranscriptionResult:
        def request(audio_path: Path) -> _ChunkTranscriptionResult:
            with audio_path.open("rb") as audio_file:
                response = client.audio.transcriptions.create(
                    model=self.settings.openai_transcribe_fallback_model,
                    file=audio_file,
                    response_format="verbose_json",
                    timestamp_granularities=["word", "segment"],
                )
            data = self._response_dict(response)
            segments, words = _timed_transcript(
                data.get("words"),
                offset=offset,
                duration=duration,
                provider="openai",
            )
            text = " ".join(str(data.get("text") or "").split())
            if text and not words:
                raise TranscriptionError("Whisper 단어 타임스탬프가 비어 있습니다.")
            if not segments:
                raw_segments = data.get("segments")
                if isinstance(raw_segments, list | tuple):
                    for raw in raw_segments:
                        segment_text = " ".join(
                            str(_response_value(raw, "text", "") or "").split()
                        )
                        start = _safe_float(_response_value(raw, "start"))
                        end = _safe_float(_response_value(raw, "end"))
                        if (
                            segment_text
                            and start is not None
                            and end is not None
                            and end > start
                        ):
                            segments.append(SubtitleSegment(
                                start=round(offset + start, 3),
                                end=round(offset + end, 3),
                                text=segment_text,
                            ))
            if not segments:
                segments = _plain_text_segments(text, duration, offset)
            input_tokens, output_tokens = self._usage_tokens(data)
            return _ChunkTranscriptionResult(
                index=index,
                segments=segments,
                silent=not segments,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                provider="openai",
                model=self.settings.openai_transcribe_fallback_model,
                words=words,
                language_code=(
                    str(language) if (language := data.get("language")) else None
                ),
                fallback_reason=fallback_reason,
            )

        try:
            return request(chunk)
        except Exception as first_error:
            retry_chunk = self._normalize_retry_chunk(chunk)
            _log_event(
                "transcription_fallback_retrying",
                provider="openai",
                model=self.settings.openai_transcribe_fallback_model,
                chunk_index=index,
                duration_seconds=round(duration, 3),
                retry_format=retry_chunk.suffix.lstrip("."),
                error_type=type(first_error).__name__,
            )
            time.sleep(TRANSCRIBE_CHUNK_RETRY_DELAY_SECONDS)
            return request(retry_chunk)

    def _transcribe_chunk_elevenlabs(
        self,
        *,
        index: int,
        chunk: Path,
        duration: float,
        offset: float,
    ) -> _ChunkTranscriptionResult:
        if not self.settings.elevenlabs_api_key:
            raise TranscriptionError("ELEVENLABS_API_KEY가 설정되지 않았습니다.")
        import httpx

        with chunk.open("rb") as audio_file:
            response = httpx.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers={"xi-api-key": self.settings.elevenlabs_api_key},
                data={
                    "model_id": self.settings.elevenlabs_transcribe_model,
                    "timestamps_granularity": "word",
                    "tag_audio_events": "false",
                    "diarize": "false",
                    "no_verbatim": "false",
                },
                files={"file": (chunk.name, audio_file, "audio/mp4")},
                timeout=self.settings.ai_timeout_seconds,
            )
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise TranscriptionError("ElevenLabs 전사 응답 형식이 올바르지 않습니다.")
        segments, words = _timed_transcript(
            data.get("words"),
            offset=offset,
            duration=duration,
            provider="elevenlabs",
        )
        text = " ".join(str(data.get("text") or "").split())
        if text and not segments:
            raise TranscriptionError("ElevenLabs 단어 타임스탬프가 비어 있습니다.")
        language_probability = _safe_float(data.get("language_probability"))
        return _ChunkTranscriptionResult(
            index=index,
            segments=segments,
            silent=not segments,
            input_tokens=0,
            output_tokens=0,
            provider="elevenlabs",
            model=self.settings.elevenlabs_transcribe_model,
            words=words,
            language_code=(
                str(language) if (language := data.get("language_code")) else None
            ),
            language_probability=language_probability,
        )

    def _transcribe_chunk_elevenlabs_with_fallback(
        self,
        openai_client: Any,
        *,
        index: int,
        chunk: Path,
        duration: float,
        offset: float,
    ) -> _ChunkTranscriptionResult:
        last_error: Exception | None = None
        for attempt in range(1, TRANSCRIBE_CHUNK_MAX_ATTEMPTS + 1):
            try:
                return self._transcribe_chunk_elevenlabs(
                    index=index,
                    chunk=chunk,
                    duration=duration,
                    offset=offset,
                )
            except Exception as exc:
                last_error = exc
                response = getattr(exc, "response", None)
                status_code = getattr(response, "status_code", None)
                provider_error_code = None
                if response is not None:
                    try:
                        error_payload = response.json()
                        detail = (
                            error_payload.get("detail")
                            if isinstance(error_payload, dict)
                            else None
                        )
                        if isinstance(detail, dict):
                            provider_error_code = detail.get("status")
                    except Exception:
                        provider_error_code = None
                _log_event(
                    "transcription_provider_attempt_failed",
                    provider="elevenlabs",
                    model=self.settings.elevenlabs_transcribe_model,
                    chunk_index=index,
                    duration_seconds=round(duration, 3),
                    attempt=attempt,
                    error_type=type(exc).__name__,
                    status_code=status_code,
                    provider_error_code=provider_error_code,
                )
                retryable = (
                    status_code is None
                    or status_code in {408, 409, 425, 429}
                    or status_code >= 500
                )
                if attempt < TRANSCRIBE_CHUNK_MAX_ATTEMPTS and retryable:
                    time.sleep(TRANSCRIBE_CHUNK_RETRY_DELAY_SECONDS)
                else:
                    break
        fallback_reason = type(last_error).__name__ if last_error else "UnknownError"
        _log_event(
            "transcription_provider_fallback",
            from_provider="elevenlabs",
            to_provider="openai",
            chunk_index=index,
            duration_seconds=round(duration, 3),
            reason=fallback_reason,
        )
        return self._transcribe_chunk_openai_fallback(
            openai_client,
            index=index,
            chunk=chunk,
            duration=duration,
            offset=offset,
            fallback_reason=fallback_reason,
        )

    def _normalize_retry_chunk(self, chunk: Path) -> Path:
        retry_chunk = chunk.with_name(f"{chunk.stem}.retry.wav")
        try:
            result = run_command(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(chunk),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "pcm_s16le",
                    str(retry_chunk),
                ],
                timeout=self.settings.ffmpeg_timeout_seconds,
            )
        except Exception:
            return chunk
        if result.returncode != 0 or not retry_chunk.is_file():
            return chunk
        return retry_chunk

    def transcribe(
        self,
        video_path: Path,
        work_dir: Path,
        *,
        start_seconds: float = 0.0,
        duration_seconds: float | None = None,
        policy: str = OPENAI_STABLE_POLICY,
    ) -> TranscriptionResult:
        if policy not in SUPPORTED_TRANSCRIPTION_POLICIES:
            raise TranscriptionError("지원하지 않는 전사 정책입니다.")
        if not self.settings.openai_api_key:
            raise TranscriptionError("OPENAI_API_KEY가 없어 필수 전사를 시작할 수 없습니다.")

        try:
            from openai import OpenAI

            openai_client = OpenAI(
                api_key=self.settings.openai_api_key,
                timeout=self.settings.ai_timeout_seconds,
                max_retries=0,
            )
            if start_seconds > 0 or duration_seconds is not None:
                chunks = self._extract_chunks(
                    video_path,
                    work_dir / "audio",
                    start_seconds=start_seconds,
                    duration_seconds=duration_seconds,
                )
            else:
                chunks = self._extract_chunks(video_path, work_dir / "audio")
            chunk_specs: list[tuple[int, Path, float, float]] = []
            # Provider timestamps are relative to each extracted audio chunk.
            # Keep the persisted transcript on the original source timeline.
            offset = max(0.0, start_seconds)
            for index, chunk in enumerate(chunks):
                duration = media_duration(probe_media(chunk, timeout=30))
                if duration <= 0:
                    raise TranscriptionError("전사 오디오 청크의 길이를 확인하지 못했습니다.")
                chunk_specs.append((index, chunk, duration, offset))
                offset += duration
        except TranscriptionError:
            raise
        except Exception as exc:
            raise TranscriptionError("OpenAI 전사를 준비하지 못했습니다.") from exc

        results: dict[int, _ChunkTranscriptionResult] = {}
        transcribable_specs: list[tuple[int, Path, float, float]] = []
        skipped_chunk_count = 0
        for index, chunk, duration, offset in chunk_specs:
            if duration >= MIN_TRANSCRIBE_CHUNK_SECONDS:
                transcribable_specs.append((index, chunk, duration, offset))
                continue
            skipped_chunk_count += 1
            results[index] = _ChunkTranscriptionResult(
                index=index,
                segments=[],
                silent=True,
                input_tokens=0,
                output_tokens=0,
                skipped=True,
            )
            _log_event(
                "transcription_chunk_skipped",
                chunk_index=index,
                duration_seconds=round(duration, 3),
                media_bytes=chunk.stat().st_size,
                reason="too_short",
            )

        failed_chunk_count = 0
        failed_audio_seconds = 0.0
        if transcribable_specs:
            max_workers = max(
                1,
                min(self.settings.openai_transcribe_max_workers, len(transcribable_specs)),
            )
            with ThreadPoolExecutor(
                max_workers=max_workers,
                thread_name_prefix=(
                    "elevenlabs-transcribe"
                    if policy == ELEVENLABS_FALLBACK_POLICY
                    else "openai-transcribe"
                ),
            ) as executor:
                futures = {
                    executor.submit(
                        (
                            self._transcribe_chunk_elevenlabs_with_fallback
                            if policy == ELEVENLABS_FALLBACK_POLICY
                            else self._transcribe_chunk
                        ),
                        openai_client,
                        index=index,
                        chunk=chunk,
                        duration=duration,
                        offset=offset,
                    ): index
                    for index, chunk, duration, offset in transcribable_specs
                }
                for future in as_completed(futures):
                    index = futures[future]
                    try:
                        result = future.result()
                    except Exception as exc:
                        _chunk_index, chunk, duration, _offset = chunk_specs[index]
                        failed_chunk_count += 1
                        failed_audio_seconds += duration
                        _log_event(
                            "transcription_chunk_skipped",
                            chunk_index=index,
                            duration_seconds=round(duration, 3),
                            media_bytes=chunk.stat().st_size,
                            reason="attempts_exhausted",
                            attempt_count=TRANSCRIBE_CHUNK_MAX_ATTEMPTS,
                            error_type=type(exc).__name__,
                        )
                        continue
                    results[result.index] = result

        ordered = [results[index] for index in sorted(results)]
        segments = [segment for result in ordered for segment in result.segments]
        if policy == ELEVENLABS_FALLBACK_POLICY and failed_chunk_count:
            raise TranscriptionError(
                "단어 타임스탬프를 포함한 전체 전사를 완료하지 못했습니다."
            )
        if not segments:
            raise TranscriptionError("전체 오디오 전사 결과가 비어 있습니다.")
        fallback_results = [result for result in ordered if result.fallback_reason]
        providers = {result.provider for result in ordered if not result.skipped}
        provider = (
            "mixed" if len(providers) > 1
            else next(iter(providers), "openai")
        )
        language_counts = Counter(
            result.language_code
            for result in ordered
            if result.language_code and not result.skipped
        )
        language_code = language_counts.most_common(1)[0][0] if language_counts else None
        language_probabilities = [
            result.language_probability
            for result in ordered
            if result.language_code == language_code
            and result.language_probability is not None
        ]
        model = self.settings.openai_transcribe_model
        if policy == ELEVENLABS_FALLBACK_POLICY:
            model = self.settings.elevenlabs_transcribe_model
            if fallback_results:
                model = (
                    f"{model}+{self.settings.openai_transcribe_fallback_model}"
                )
        return TranscriptionResult(
            segments=segments,
            model=model,
            chunk_count=len(chunk_specs),
            silent_chunk_count=sum(result.silent and not result.skipped for result in ordered),
            input_tokens=sum(result.input_tokens for result in ordered),
            output_tokens=sum(result.output_tokens for result in ordered),
            failed_chunk_count=failed_chunk_count,
            skipped_chunk_count=skipped_chunk_count,
            failed_audio_seconds=round(failed_audio_seconds, 3),
            requested_policy=policy,
            provider=provider,
            words=tuple(word for result in ordered for word in result.words),
            language_code=language_code,
            language_probability=(
                round(sum(language_probabilities) / len(language_probabilities), 4)
                if language_probabilities else None
            ),
            fallback_chunk_count=len(fallback_results),
            fallback_audio_seconds=round(sum(
                chunk_specs[result.index][2] for result in fallback_results
            ), 3),
            fallback_reasons=tuple(sorted({
                result.fallback_reason
                for result in fallback_results
                if result.fallback_reason
            })),
        )
