from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import Settings
from .errors import TranscriptionError
from .media import media_duration, probe_media, run_command
from .schemas import SubtitleSegment

SENTENCE_RE = re.compile(r"(?<=[.!?。！？])\s+|\n+")


@dataclass(frozen=True, slots=True)
class TranscriptionResult:
    segments: list[SubtitleSegment]
    model: str
    chunk_count: int
    silent_chunk_count: int
    input_tokens: int
    output_tokens: int


@dataclass(frozen=True, slots=True)
class _ChunkTranscriptionResult:
    index: int
    segments: list[SubtitleSegment]
    silent: bool
    input_tokens: int
    output_tokens: int


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
        with chunk.open("rb") as audio_file:
            response = client.audio.transcriptions.create(
                model=self.settings.openai_transcribe_model,
                file=audio_file,
                response_format="json",
            )
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
        )

    def transcribe(self, video_path: Path, work_dir: Path) -> TranscriptionResult:
        if not self.settings.openai_api_key:
            raise TranscriptionError("OPENAI_API_KEY가 없어 필수 전사를 시작할 수 없습니다.")

        try:
            from openai import OpenAI

            client = OpenAI(
                api_key=self.settings.openai_api_key,
                timeout=self.settings.ai_timeout_seconds,
                max_retries=1,
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
        max_workers = max(
            1,
            min(self.settings.openai_transcribe_max_workers, len(chunk_specs)),
        )
        try:
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
                    for index, chunk, duration, offset in chunk_specs
                }
                for future in as_completed(futures):
                    result = future.result()
                    results[result.index] = result
        except Exception as exc:
            raise TranscriptionError("OpenAI 오디오 전사에 실패했습니다.") from exc

        ordered = [results[index] for index in range(len(chunk_specs))]
        segments = [segment for result in ordered for segment in result.segments]
        if not segments:
            raise TranscriptionError("전체 오디오 전사 결과가 비어 있습니다.")
        return TranscriptionResult(
            segments=segments,
            model=self.settings.openai_transcribe_model,
            chunk_count=len(ordered),
            silent_chunk_count=sum(result.silent for result in ordered),
            input_tokens=sum(result.input_tokens for result in ordered),
            output_tokens=sum(result.output_tokens for result in ordered),
        )
