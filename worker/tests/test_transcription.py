from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from shorts_worker.config import Settings
from shorts_worker.errors import TranscriptionError
from shorts_worker.subtitles import AudioTranscriber, _transcript_quality_issue


def _install_openai(
    monkeypatch: pytest.MonkeyPatch,
    create,
) -> list[dict[str, object]]:
    client_calls: list[dict[str, object]] = []

    class OpenAI:
        def __init__(self, **kwargs) -> None:
            client_calls.append(kwargs)
            self.audio = SimpleNamespace(
                transcriptions=SimpleNamespace(create=create)
            )

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=OpenAI))
    return client_calls


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "openai_api_key": "test-key",
        "openai_transcribe_model": "gpt-4o-mini-transcribe",
        "openai_transcribe_chunk_seconds": 30,
        "openai_transcribe_max_workers": 4,
    }
    values.update(overrides)
    return Settings(**values)


def test_audio_is_split_into_thirty_second_mono_16khz_chunks(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    captured: list[str] = []

    def fake_run(args: list[str], **_kwargs):
        captured.extend(args)
        output = Path(args[-1])
        output.parent.mkdir(parents=True, exist_ok=True)
        (output.parent / "audio_0000.m4a").write_bytes(b"audio")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr("shorts_worker.subtitles.run_command", fake_run)
    chunks = AudioTranscriber(_settings())._extract_chunks(
        tmp_path / "source.mp4", tmp_path / "audio"
    )

    assert [chunk.name for chunk in chunks] == ["audio_0000.m4a"]
    assert captured[captured.index("-ac") + 1] == "1"
    assert captured[captured.index("-ar") + 1] == "16000"
    assert captured[captured.index("-segment_time") + 1] == "30"


def test_parallel_transcription_restores_order_offsets_silence_and_usage(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunks = [tmp_path / f"audio_{index:04d}.m4a" for index in range(3)]
    for chunk in chunks:
        chunk.write_bytes(b"audio")
    responses = {
        "audio_0000.m4a": ("첫 청크", 0.03, 1, 2),
        "audio_0001.m4a": ("", 0.0, 3, 4),
        "audio_0002.m4a": ("마지막 청크", 0.01, 5, 6),
    }

    def create(**kwargs):
        chunk_name = Path(kwargs["file"].name).name
        text, delay, input_tokens, output_tokens = responses[chunk_name]
        time.sleep(delay)
        return {
            "text": text,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            },
        }

    client_calls = _install_openai(monkeypatch, create)
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args: chunks)
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda path, **_kwargs: {
            "format": {
                "duration": {
                    "audio_0000.m4a": "30",
                    "audio_0001.m4a": "30",
                    "audio_0002.m4a": "5",
                }[path.name]
            }
        },
    )

    result = transcriber.transcribe(tmp_path / "source.mp4", tmp_path / "work")

    assert client_calls[0]["max_retries"] == 0
    assert [segment.text for segment in result.segments] == ["첫 청크", "마지막 청크"]
    assert result.segments[0].start == 0
    assert result.segments[0].end == 30
    assert result.segments[1].start == 60
    assert result.segments[1].end == 65
    assert result.chunk_count == 3
    assert result.silent_chunk_count == 1
    assert result.input_tokens == 9
    assert result.output_tokens == 12
    assert result.failed_chunk_count == 0
    assert result.skipped_chunk_count == 0
    assert result.failed_audio_seconds == 0


def test_one_chunk_api_failure_is_retried_once_then_uses_partial_transcript(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunks = [tmp_path / f"audio_{index:04d}.m4a" for index in range(2)]
    for chunk in chunks:
        chunk.write_bytes(b"audio")
    call_counts = {chunk.name: 0 for chunk in chunks}

    def create(**kwargs):
        name = Path(kwargs["file"].name).name
        call_counts[name] += 1
        if name == "audio_0001.m4a":
            raise RuntimeError("provider unavailable")
        return {"text": "성공한 청크"}

    _install_openai(monkeypatch, create)
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args: chunks)
    monkeypatch.setattr(transcriber, "_normalize_retry_chunk", lambda chunk: chunk)
    monkeypatch.setattr("shorts_worker.subtitles.time.sleep", lambda *_args: None)
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda *_args, **_kwargs: {"format": {"duration": "30"}},
    )

    result = transcriber.transcribe(tmp_path / "source.mp4", tmp_path / "work")

    assert [segment.text for segment in result.segments] == ["성공한 청크"]
    assert call_counts == {"audio_0000.m4a": 1, "audio_0001.m4a": 2}
    assert result.chunk_count == 2
    assert result.failed_chunk_count == 1
    assert result.failed_audio_seconds == 30


def test_transcript_quality_guard_rejects_impossible_repetition_but_allows_normal_text() -> None:
    repeated = "일로와 " * 500

    issue = _transcript_quality_issue(repeated, 30)

    assert issue is not None
    assert issue.reason in {"impossible_text_rate", "excessive_repetition"}
    assert _transcript_quality_issue(
        "게임 초반에는 시야를 확보하고 팀원과 함께 움직이는 것이 중요합니다.",
        30,
    ) is None


def test_degenerate_transcript_is_retried_once_and_clean_retry_is_used(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunk = tmp_path / "audio_0000.m4a"
    chunk.write_bytes(b"audio")
    responses = iter([{"text": "어어 " * 500}, {"text": "정상적인 재시도 결과"}])
    call_count = 0

    def create(**_kwargs):
        nonlocal call_count
        call_count += 1
        return next(responses)

    _install_openai(monkeypatch, create)
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args: [chunk])
    monkeypatch.setattr(transcriber, "_normalize_retry_chunk", lambda path: path)
    monkeypatch.setattr("shorts_worker.subtitles.time.sleep", lambda *_args: None)
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda *_args, **_kwargs: {"format": {"duration": "30"}},
    )

    result = transcriber.transcribe(tmp_path / "source.mp4", tmp_path / "work")

    assert call_count == 2
    assert [segment.text for segment in result.segments] == ["정상적인 재시도 결과"]
    assert result.failed_chunk_count == 0
    assert result.quality_rejected_chunk_count == 0


def test_repeated_retry_is_rejected_and_other_chunks_remain_usable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunks = [tmp_path / f"audio_{index:04d}.m4a" for index in range(2)]
    for chunk in chunks:
        chunk.write_bytes(b"audio")
    call_counts = {chunk.name: 0 for chunk in chunks}

    def create(**kwargs):
        name = Path(kwargs["file"].name).name
        call_counts[name] += 1
        if name == "audio_0001.m4a":
            return {"text": "일로와 " * 500}
        return {"text": "사용 가능한 청크"}

    _install_openai(monkeypatch, create)
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args: chunks)
    monkeypatch.setattr(transcriber, "_normalize_retry_chunk", lambda path: path)
    monkeypatch.setattr("shorts_worker.subtitles.time.sleep", lambda *_args: None)
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda *_args, **_kwargs: {"format": {"duration": "30"}},
    )

    result = transcriber.transcribe(tmp_path / "source.mp4", tmp_path / "work")

    assert [segment.text for segment in result.segments] == ["사용 가능한 청크"]
    assert call_counts == {"audio_0000.m4a": 1, "audio_0001.m4a": 2}
    assert result.failed_chunk_count == 1
    assert result.quality_rejected_chunk_count == 1
    assert result.failed_audio_seconds == 30


def test_all_degenerate_chunks_fail_when_no_transcript_is_usable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunk = tmp_path / "audio_0000.m4a"
    chunk.write_bytes(b"audio")
    call_count = 0

    def create(**_kwargs):
        nonlocal call_count
        call_count += 1
        return {"text": "어어 " * 500}

    _install_openai(monkeypatch, create)
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args: [chunk])
    monkeypatch.setattr(transcriber, "_normalize_retry_chunk", lambda path: path)
    monkeypatch.setattr("shorts_worker.subtitles.time.sleep", lambda *_args: None)
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda *_args, **_kwargs: {"format": {"duration": "30"}},
    )

    with pytest.raises(TranscriptionError, match="비어"):
        transcriber.transcribe(tmp_path / "source.mp4", tmp_path / "work")

    assert call_count == 2


def test_tiny_tail_chunk_is_skipped_without_an_api_request(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunks = [tmp_path / f"audio_{index:04d}.m4a" for index in range(2)]
    for chunk in chunks:
        chunk.write_bytes(b"audio")
    requested: list[str] = []

    def create(**kwargs):
        requested.append(Path(kwargs["file"].name).name)
        return {"text": "성공한 청크"}

    _install_openai(monkeypatch, create)
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args: chunks)
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda path, **_kwargs: {
            "format": {
                "duration": "30" if path.name == "audio_0000.m4a" else "0.128"
            }
        },
    )

    result = transcriber.transcribe(tmp_path / "source.mp4", tmp_path / "work")

    assert requested == ["audio_0000.m4a"]
    assert result.chunk_count == 2
    assert result.skipped_chunk_count == 1
    assert result.failed_chunk_count == 0


def test_all_api_failures_still_fail_when_no_transcript_is_usable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunk = tmp_path / "audio_0000.m4a"
    chunk.write_bytes(b"audio")
    call_count = 0

    def create(**_kwargs):
        nonlocal call_count
        call_count += 1
        raise RuntimeError("provider unavailable")

    _install_openai(monkeypatch, create)
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args: [chunk])
    monkeypatch.setattr(transcriber, "_normalize_retry_chunk", lambda path: path)
    monkeypatch.setattr("shorts_worker.subtitles.time.sleep", lambda *_args: None)
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda *_args, **_kwargs: {"format": {"duration": "30"}},
    )

    with pytest.raises(TranscriptionError, match="비어"):
        transcriber.transcribe(tmp_path / "source.mp4", tmp_path / "work")

    assert call_count == 2


def test_retry_audio_is_normalized_to_mono_16khz_pcm_wav(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunk = tmp_path / "audio_0001.m4a"
    chunk.write_bytes(b"audio")
    captured: list[str] = []

    def fake_run(args: list[str], **_kwargs):
        captured.extend(args)
        Path(args[-1]).write_bytes(b"wav")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr("shorts_worker.subtitles.run_command", fake_run)

    retry_chunk = AudioTranscriber(_settings())._normalize_retry_chunk(chunk)

    assert retry_chunk.name == "audio_0001.retry.wav"
    assert captured[captured.index("-ac") + 1] == "1"
    assert captured[captured.index("-ar") + 1] == "16000"
    assert captured[captured.index("-c:a") + 1] == "pcm_s16le"


def test_all_silent_chunks_fail_transcription(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunk = tmp_path / "audio_0000.m4a"
    chunk.write_bytes(b"audio")
    _install_openai(monkeypatch, lambda **_kwargs: {"text": ""})
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args: [chunk])
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda *_args, **_kwargs: {"format": {"duration": "10"}},
    )

    with pytest.raises(TranscriptionError, match="비어"):
        transcriber.transcribe(tmp_path / "source.mp4", tmp_path / "work")


def test_missing_openai_key_fails_before_audio_extraction(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    transcriber = AudioTranscriber(_settings(openai_api_key=None))
    extract_called = False

    def extract(*_args):
        nonlocal extract_called
        extract_called = True
        return []

    monkeypatch.setattr(transcriber, "_extract_chunks", extract)

    with pytest.raises(TranscriptionError, match="OPENAI_API_KEY"):
        transcriber.transcribe(tmp_path / "source.mp4", tmp_path / "work")
    assert not extract_called
