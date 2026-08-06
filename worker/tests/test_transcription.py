from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
from shutil import which
from types import SimpleNamespace

import pytest

from shorts_worker.config import Settings
from shorts_worker.errors import TranscriptionError
from shorts_worker.media import media_duration, probe_media
from shorts_worker.subtitles import (
    ELEVENLABS_FALLBACK_POLICY,
    AudioTranscriber,
)


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
        "elevenlabs_api_key": "elevenlabs-test-key",
        "elevenlabs_transcribe_model": "scribe_v2",
        "openai_transcribe_model": "gpt-4o-mini-transcribe",
        "openai_transcribe_fallback_model": "whisper-1",
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


def test_selected_audio_uses_input_seek_and_duration_without_video_reencoding(
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

    AudioTranscriber(_settings())._extract_chunks(
        tmp_path / "three-hour-source.mp4",
        tmp_path / "audio",
        start_seconds=3600,
        duration_seconds=240,
    )

    assert captured[captured.index("-ss") + 1] == "3600.000"
    assert captured[captured.index("-t") + 1] == "240.000"
    assert captured.index("-ss") < captured.index("-i")
    assert "-c:v" not in captured
    assert "-vf" not in captured


@pytest.mark.skipif(
    which("ffmpeg") is None or which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_selected_audio_integration_extracts_only_requested_duration(
    tmp_path: Path,
) -> None:
    source = tmp_path / "twelve-seconds.m4a"
    generated = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:duration=12",
            "-c:a",
            "aac",
            str(source),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert generated.returncode == 0, generated.stderr

    chunks = AudioTranscriber(_settings())._extract_chunks(
        source,
        tmp_path / "selected-audio",
        start_seconds=4,
        duration_seconds=4,
    )

    extracted_duration = sum(
        media_duration(probe_media(chunk))
        for chunk in chunks
    )
    assert extracted_duration == pytest.approx(4, abs=0.15)


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


def test_stable_policy_keeps_the_existing_openai_request_shape(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunk = tmp_path / "audio_0000.m4a"
    chunk.write_bytes(b"audio")
    requests: list[dict[str, object]] = []

    def create(**kwargs):
        requests.append(kwargs)
        return {"text": "기존 경로"}

    _install_openai(monkeypatch, create)
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args: [chunk])
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda *_args, **_kwargs: {"format": {"duration": "10"}},
    )

    result = transcriber.transcribe(tmp_path / "source.mp4", tmp_path / "work")

    assert result.requested_policy == "openai_stable"
    assert result.provider == "openai"
    assert result.words == ()
    assert len(requests) == 1
    assert requests[0]["model"] == "gpt-4o-mini-transcribe"
    assert requests[0]["response_format"] == "json"
    assert "timestamp_granularities" not in requests[0]


def test_elevenlabs_policy_autodetects_multilingual_words(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunk = tmp_path / "audio_0000.m4a"
    chunk.write_bytes(b"audio")
    _install_openai(
        monkeypatch,
        lambda **_kwargs: pytest.fail("OpenAI fallback must not be called"),
    )
    calls: list[dict[str, object]] = []

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "text": "안녕하세요 hello",
                "language_code": "ko",
                "language_probability": 0.97,
                "words": [
                    {"type": "word", "text": "안녕하세요", "start": 0.1, "end": 0.8},
                    {"type": "word", "text": "hello", "start": 0.9, "end": 1.4},
                ],
            }

    def post(*args, **kwargs):
        calls.append({"args": args, **kwargs})
        return Response()

    monkeypatch.setitem(sys.modules, "httpx", SimpleNamespace(post=post))
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args: [chunk])
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda *_args, **_kwargs: {"format": {"duration": "10"}},
    )

    result = transcriber.transcribe(
        tmp_path / "source.mp4",
        tmp_path / "work",
        policy=ELEVENLABS_FALLBACK_POLICY,
    )

    assert result.provider == "elevenlabs"
    assert result.model == "scribe_v2"
    assert result.language_code == "ko"
    assert result.language_probability == pytest.approx(0.97)
    assert [word.text for word in result.words] == ["안녕하세요", "hello"]
    assert result.segments[0].text == "안녕하세요 hello"
    assert calls[0]["headers"] == {"xi-api-key": "elevenlabs-test-key"}
    assert calls[0]["data"]["model_id"] == "scribe_v2"
    assert "language_code" not in calls[0]["data"]


def test_elevenlabs_failure_falls_back_only_for_that_chunk(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunks = [tmp_path / f"audio_{index:04d}.m4a" for index in range(2)]
    for chunk in chunks:
        chunk.write_bytes(b"audio")
    fallback_requests: list[str] = []

    def create(**kwargs):
        name = Path(kwargs["file"].name).name
        fallback_requests.append(name)
        return {
            "text": "fallback words",
            "language": "en",
            "words": [
                {"word": "fallback", "start": 0.0, "end": 0.5},
                {"word": "words", "start": 0.6, "end": 1.0},
            ],
        }

    _install_openai(monkeypatch, create)
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args: chunks)
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda *_args, **_kwargs: {"format": {"duration": "10"}},
    )
    monkeypatch.setattr("shorts_worker.subtitles.time.sleep", lambda *_args: None)

    original_elevenlabs = transcriber._transcribe_chunk_elevenlabs

    def elevenlabs(*, index, **_kwargs):
        if index == 0:
            return original_elevenlabs(
                index=index,
                chunk=chunks[index],
                duration=10,
                offset=0,
            )
        raise RuntimeError("temporary ElevenLabs failure")

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "text": "첫 청크",
                "language_code": "ko",
                "words": [
                    {"type": "word", "text": "첫", "start": 0.0, "end": 0.4},
                    {"type": "word", "text": "청크", "start": 0.5, "end": 1.0},
                ],
            }

    monkeypatch.setitem(
        sys.modules,
        "httpx",
        SimpleNamespace(post=lambda *_args, **_kwargs: Response()),
    )
    monkeypatch.setattr(transcriber, "_transcribe_chunk_elevenlabs", elevenlabs)

    result = transcriber.transcribe(
        tmp_path / "source.mp4",
        tmp_path / "work",
        policy=ELEVENLABS_FALLBACK_POLICY,
    )

    assert result.provider == "mixed"
    assert result.fallback_chunk_count == 1
    assert result.fallback_audio_seconds == 10
    assert result.fallback_reasons == ("RuntimeError",)
    assert fallback_requests == ["audio_0001.m4a"]
    assert [segment.start for segment in result.segments] == [0.0, 10.0]


def test_candidate_rejects_whisper_text_without_word_timestamps(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunk = tmp_path / "audio_0000.m4a"
    chunk.write_bytes(b"audio")
    _install_openai(
        monkeypatch,
        lambda **_kwargs: {
            "text": "시간 정보가 없는 전사",
            "segments": [{"text": "시간 정보가 없는 전사", "start": 0, "end": 1}],
        },
    )
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args, **_kwargs: [chunk])
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda *_args, **_kwargs: {"format": {"duration": "10"}},
    )
    monkeypatch.setattr(
        transcriber,
        "_transcribe_chunk_elevenlabs",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("elevenlabs failed")),
    )
    monkeypatch.setattr("shorts_worker.subtitles.time.sleep", lambda *_args: None)

    with pytest.raises(TranscriptionError, match="단어 타임스탬프"):
        transcriber.transcribe(
            tmp_path / "source.mp4",
            tmp_path / "work",
            policy=ELEVENLABS_FALLBACK_POLICY,
        )


def test_candidate_words_use_original_source_timeline(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    chunk = tmp_path / "audio_0000.m4a"
    chunk.write_bytes(b"audio")
    _install_openai(
        monkeypatch,
        lambda **_kwargs: pytest.fail("OpenAI fallback must not be called"),
    )

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "text": "원본 시간",
                "language_code": "kor",
                "words": [
                    {"type": "word", "text": "원본", "start": 0.1, "end": 0.5},
                    {"type": "word", "text": "시간", "start": 0.6, "end": 1.0},
                ],
            }

    monkeypatch.setitem(
        sys.modules,
        "httpx",
        SimpleNamespace(post=lambda *_args, **_kwargs: Response()),
    )
    transcriber = AudioTranscriber(_settings())
    monkeypatch.setattr(transcriber, "_extract_chunks", lambda *_args, **_kwargs: [chunk])
    monkeypatch.setattr(
        "shorts_worker.subtitles.probe_media",
        lambda *_args, **_kwargs: {"format": {"duration": "10"}},
    )

    result = transcriber.transcribe(
        tmp_path / "source.mp4",
        tmp_path / "work",
        start_seconds=3600,
        duration_seconds=10,
        policy=ELEVENLABS_FALLBACK_POLICY,
    )

    assert [(word.start, word.end) for word in result.words] == [
        (3600.1, 3600.5),
        (3600.6, 3601.0),
    ]
    assert result.segments[0].start == 3600.1
