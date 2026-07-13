from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any

from .config import Settings
from .media import media_duration, probe_media, run_command
from .schemas import SubtitleSegment

TIMING_RE = re.compile(
    r"(?P<start>\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3})\s*-->\s*"
    r"(?P<end>\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3})"
)
TAG_RE = re.compile(r"<[^>]+>|\{\\[^}]+\}")
SENTENCE_RE = re.compile(r"(?<=[.!?。！？])\s+|\n+")
ROLLING_CAPTION_GAP_SECONDS = 0.15
ROLLING_CAPTION_HISTORY_WORDS = 80


def parse_timestamp(value: str) -> float:
    parts = value.replace(",", ".").split(":")
    if len(parts) == 2:
        minutes, seconds = parts
        return int(minutes) * 60 + float(seconds)
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    raise ValueError(f"Unsupported subtitle timestamp: {value}")


def _strip_rolling_overlap(history: str, current: str) -> str:
    """Remove a cumulative auto-caption prefix already emitted in recent text."""
    history_words = history.split()
    current_words = current.split()
    for size in range(min(len(history_words), len(current_words)), 0, -1):
        if history_words[-size:] != current_words[:size]:
            continue
        overlap_characters = sum(len(word) for word in current_words[:size])
        if size >= 2 or overlap_characters >= 4:
            return " ".join(current_words[size:])
    return current


def _append_history(history: str, text: str) -> str:
    words = [*history.split(), *text.split()]
    return " ".join(words[-ROLLING_CAPTION_HISTORY_WORDS:])


def _clean_caption(lines: list[str]) -> str:
    cleaned: list[str] = []
    history = ""
    for line in lines:
        line = TAG_RE.sub("", line)
        line = html.unescape(line).replace("\ufeff", "")
        line = " ".join(line.split())
        if not line:
            continue
        new_text = _strip_rolling_overlap(history, line)
        if new_text:
            cleaned.append(new_text)
            history = _append_history(history, new_text)
    return " ".join(cleaned).strip()


def _normalize_rolling_captions(
    segments: list[SubtitleSegment],
) -> list[SubtitleSegment]:
    """Collapse the cumulative cues emitted by YouTube automatic captions."""
    normalized: list[SubtitleSegment] = []
    history = ""
    previous_end: float | None = None
    previous_raw_text: str | None = None
    for segment in segments:
        adjacent = (
            previous_end is not None
            and segment.start <= previous_end + ROLLING_CAPTION_GAP_SECONDS
        )
        if not adjacent:
            history = ""

        new_text = segment.text
        if adjacent:
            if segment.text == previous_raw_text:
                new_text = ""
            else:
                new_text = _strip_rolling_overlap(history, segment.text)

        if new_text:
            normalized.append(
                SubtitleSegment(start=segment.start, end=segment.end, text=new_text)
            )
            history = _append_history(history, new_text)

        previous_end = max(previous_end or segment.end, segment.end)
        previous_raw_text = segment.text
    return normalized


def parse_subtitle_text(content: str) -> list[SubtitleSegment]:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n\s*\n", normalized)
    segments: list[SubtitleSegment] = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        timing_index = next((index for index, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue
        match = TIMING_RE.search(lines[timing_index])
        if not match:
            continue
        try:
            start = parse_timestamp(match.group("start"))
            end = parse_timestamp(match.group("end"))
        except ValueError:
            continue
        text = _clean_caption(lines[timing_index + 1 :])
        if not text or end <= start:
            continue
        segments.append(
            SubtitleSegment(start=round(start, 3), end=round(end, 3), text=text)
        )
    return _normalize_rolling_captions(segments)


def parse_subtitle_file(path: Path) -> list[SubtitleSegment]:
    try:
        return parse_subtitle_text(path.read_text(encoding="utf-8-sig", errors="replace"))
    except OSError:
        return []


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
    """Optional OpenAI transcription hook with timestamp-preserving chunk offsets."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _extract_chunks(self, video_path: Path, audio_dir: Path) -> list[Path]:
        audio_dir.mkdir(parents=True, exist_ok=True)
        output = audio_dir / "audio_%03d.m4a"
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
                "300",
                "-reset_timestamps",
                "1",
                str(output),
            ],
            timeout=self.settings.ffmpeg_timeout_seconds,
        )
        if result.returncode != 0:
            return []
        return sorted(audio_dir.glob("audio_*.m4a"))

    @staticmethod
    def _response_dict(response: Any) -> dict[str, Any]:
        if isinstance(response, dict):
            return response
        if hasattr(response, "model_dump"):
            return response.model_dump()
        return {"text": str(getattr(response, "text", ""))}

    def _transcribe_chunk(
        self,
        client: Any,
        chunk: Path,
        duration: float,
        offset: float,
    ) -> list[SubtitleSegment]:
        response: Any
        with chunk.open("rb") as audio_file:
            if self.settings.openai_transcribe_model.startswith("whisper-"):
                response = client.audio.transcriptions.create(
                    model=self.settings.openai_transcribe_model,
                    file=audio_file,
                    response_format="verbose_json",
                    timestamp_granularities=["segment"],
                )
            else:
                response = client.audio.transcriptions.create(
                    model=self.settings.openai_transcribe_model,
                    file=audio_file,
                    response_format="json",
                )
        data = self._response_dict(response)
        raw_segments = data.get("segments") or []
        segments: list[SubtitleSegment] = []
        for raw in raw_segments:
            if not isinstance(raw, dict):
                raw = raw.model_dump() if hasattr(raw, "model_dump") else {}
            try:
                start = max(0.0, float(raw.get("start", 0)))
                end = min(duration, float(raw.get("end", duration)))
                text = " ".join(str(raw.get("text", "")).split())
                if text and end > start:
                    segments.append(
                        SubtitleSegment(start=offset + start, end=offset + end, text=text)
                    )
            except (TypeError, ValueError):
                continue
        if segments:
            return segments
        return _plain_text_segments(str(data.get("text") or ""), duration, offset)

    def transcribe(self, video_path: Path, work_dir: Path) -> list[SubtitleSegment]:
        if not self.settings.openai_api_key:
            return []
        try:
            from openai import OpenAI

            client = OpenAI(
                api_key=self.settings.openai_api_key,
                timeout=self.settings.ai_timeout_seconds,
                max_retries=1,
            )
            chunks = self._extract_chunks(video_path, work_dir / "audio")
        except Exception:
            return []

        offset = 0.0
        all_segments: list[SubtitleSegment] = []
        for chunk in chunks:
            try:
                duration = media_duration(probe_media(chunk, timeout=30))
                if duration <= 0:
                    continue
                all_segments.extend(self._transcribe_chunk(client, chunk, duration, offset))
                offset += duration
            except Exception:
                # Transcription is optional; preserve segments from successful chunks.
                try:
                    offset += media_duration(probe_media(chunk, timeout=30))
                except Exception:
                    offset += 300
        return all_segments
