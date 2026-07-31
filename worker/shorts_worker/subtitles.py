from __future__ import annotations

import json
import re
import time
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
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
TRANSCRIPT_QUALITY_MIN_RATE_CHARS = 600
TRANSCRIPT_QUALITY_MAX_CHARS_PER_SECOND = 24.0
TRANSCRIPT_QUALITY_MIN_COMPRESSION_CHARS = 400
TRANSCRIPT_QUALITY_MIN_COMPRESSION_RATIO = 0.12


def _log_event(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, **fields}, separators=(",", ":"), default=str), flush=True)


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
    quality_rejected_chunk_count: int = 0


@dataclass(frozen=True, slots=True)
class _ChunkTranscriptionResult:
    index: int
    segments: list[SubtitleSegment]
    silent: bool
    input_tokens: int
    output_tokens: int
    skipped: bool = False


@dataclass(frozen=True, slots=True)
class _TranscriptQualityIssue:
    reason: str
    character_count: int
    characters_per_second: float
    compression_ratio: float


class _TranscriptQualityError(RuntimeError):
    def __init__(self, issue: _TranscriptQualityIssue) -> None:
        super().__init__(issue.reason)
        self.issue = issue


def _transcript_quality_issue(
    text: str,
    duration: float,
) -> _TranscriptQualityIssue | None:
    compact_text = "".join(text.split())
    character_count = len(compact_text)
    if character_count < TRANSCRIPT_QUALITY_MIN_COMPRESSION_CHARS:
        return None

    encoded = compact_text.encode("utf-8")
    compression_ratio = len(zlib.compress(encoded)) / max(1, len(encoded))
    characters_per_second = character_count / max(0.1, duration)

    reason: str | None = None
    if (
        character_count >= TRANSCRIPT_QUALITY_MIN_RATE_CHARS
        and characters_per_second > TRANSCRIPT_QUALITY_MAX_CHARS_PER_SECOND
    ):
        reason = "impossible_text_rate"
    elif compression_ratio < TRANSCRIPT_QUALITY_MIN_COMPRESSION_RATIO:
        reason = "excessive_repetition"
    if reason is None:
        return None
    return _TranscriptQualityIssue(
        reason=reason,
        character_count=character_count,
        characters_per_second=round(characters_per_second, 3),
        compression_ratio=round(compression_ratio, 4),
    )


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


class AudioTranscriber:
    """Required OpenAI transcription with ordered concurrent audio chunks."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _extract_chunks(self, video_path: Path, audio_dir: Path) -> list[Path]:
        audio_dir.mkdir(parents=True, exist_ok=True)
        output = audio_dir / "audio_%04d.m4a"
        result = run_command(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(video_path),
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

        def parse_response(response: Any) -> tuple[
            list[SubtitleSegment], int, int, _TranscriptQualityIssue | None
        ]:
            data = self._response_dict(response)
            text = " ".join(str(data.get("text") or "").split())
            issue = _transcript_quality_issue(text, duration)
            segments = [] if issue else _plain_text_segments(text, duration, offset)
            input_tokens, output_tokens = self._usage_tokens(data)
            return segments, input_tokens, output_tokens, issue

        try:
            response = request(chunk)
        except Exception as exc:
            retry_reason = "provider_error"
            retry_fields: dict[str, object] = {"error_type": type(exc).__name__}
        else:
            segments, input_tokens, output_tokens, issue = parse_response(response)
            if issue is None:
                return _ChunkTranscriptionResult(
                    index=index,
                    segments=segments,
                    silent=not segments,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                )
            retry_reason = "quality_rejected"
            retry_fields = {
                "quality_reason": issue.reason,
                "character_count": issue.character_count,
                "characters_per_second": issue.characters_per_second,
                "compression_ratio": issue.compression_ratio,
            }

        retry_chunk = self._normalize_retry_chunk(chunk)
        _log_event(
            "transcription_chunk_retrying",
            chunk_index=index,
            duration_seconds=round(duration, 3),
            media_bytes=chunk.stat().st_size,
            attempt=TRANSCRIBE_CHUNK_MAX_ATTEMPTS,
            retry_format=retry_chunk.suffix.lstrip("."),
            reason=retry_reason,
            **retry_fields,
        )
        time.sleep(TRANSCRIBE_CHUNK_RETRY_DELAY_SECONDS)
        response = request(retry_chunk)
        segments, input_tokens, output_tokens, issue = parse_response(response)
        if issue is not None:
            raise _TranscriptQualityError(issue)
        return _ChunkTranscriptionResult(
            index=index,
            segments=segments,
            silent=not segments,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
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

    def transcribe(self, video_path: Path, work_dir: Path) -> TranscriptionResult:
        if not self.settings.openai_api_key:
            raise TranscriptionError("OPENAI_API_KEY가 없어 필수 전사를 시작할 수 없습니다.")

        try:
            from openai import OpenAI

            client = OpenAI(
                api_key=self.settings.openai_api_key,
                timeout=self.settings.ai_timeout_seconds,
                max_retries=0,
            )
            chunks = self._extract_chunks(video_path, work_dir / "audio")
            chunk_specs: list[tuple[int, Path, float, float]] = []
            offset = 0.0
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
        quality_rejected_chunk_count = 0
        if transcribable_specs:
            max_workers = max(
                1,
                min(self.settings.openai_transcribe_max_workers, len(transcribable_specs)),
            )
            with ThreadPoolExecutor(
                max_workers=max_workers,
                thread_name_prefix="openai-transcribe",
            ) as executor:
                futures = {
                    executor.submit(
                        self._transcribe_chunk,
                        client,
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
                        quality_issue = (
                            exc.issue if isinstance(exc, _TranscriptQualityError) else None
                        )
                        if quality_issue is not None:
                            quality_rejected_chunk_count += 1
                        _log_event(
                            "transcription_chunk_skipped",
                            chunk_index=index,
                            duration_seconds=round(duration, 3),
                            media_bytes=chunk.stat().st_size,
                            reason=(
                                "quality_rejected"
                                if quality_issue is not None
                                else "attempts_exhausted"
                            ),
                            attempt_count=TRANSCRIBE_CHUNK_MAX_ATTEMPTS,
                            error_type=type(exc).__name__,
                            **(
                                {
                                    "quality_reason": quality_issue.reason,
                                    "character_count": quality_issue.character_count,
                                    "characters_per_second": quality_issue.characters_per_second,
                                    "compression_ratio": quality_issue.compression_ratio,
                                }
                                if quality_issue is not None
                                else {}
                            ),
                        )
                        continue
                    results[result.index] = result

        ordered = [results[index] for index in sorted(results)]
        segments = [segment for result in ordered for segment in result.segments]
        if not segments:
            raise TranscriptionError("전체 오디오 전사 결과가 비어 있습니다.")
        return TranscriptionResult(
            segments=segments,
            model=self.settings.openai_transcribe_model,
            chunk_count=len(chunk_specs),
            silent_chunk_count=sum(result.silent and not result.skipped for result in ordered),
            input_tokens=sum(result.input_tokens for result in ordered),
            output_tokens=sum(result.output_tokens for result in ordered),
            failed_chunk_count=failed_chunk_count,
            skipped_chunk_count=skipped_chunk_count,
            failed_audio_seconds=round(failed_audio_seconds, 3),
            quality_rejected_chunk_count=quality_rejected_chunk_count,
        )
