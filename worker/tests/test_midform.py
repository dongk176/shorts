from pathlib import Path

import pytest

from shorts_worker.media import media_duration, probe_media, run_command
from shorts_worker.midform import (
    edit_ranges,
    from_words,
    normalize_segments,
    render,
    select_segments,
    silence_ranges,
    transcribe,
)


@pytest.mark.parametrize("start,end", [(-1, 3), (0, float("nan")), (0, 11), (5, 4)])
def test_reject_out_of_source_and_nonfinite_ranges(start, end):
    with pytest.raises(ValueError):
        normalize_segments([{"start": start, "end": end}], 10)


def test_reject_overlapping_edit_ranges():
    with pytest.raises(ValueError):
        normalize_segments([{"start": 0, "end": 3}, {"start": 2, "end": 5}], 10)


def test_diarization_overlap_uses_wide_view():
    rows = from_words(
        [
            {"text": "첫", "start": 0, "end": 1, "type": "word", "speaker_id": "a"},
            {"text": "동시", "start": 0.5, "end": 1.5, "type": "word", "speaker_id": "b"},
            {"text": "다음", "start": 2, "end": 3, "type": "word", "speaker_id": "b"},
        ],
        10,
    )
    assert rows[0]["speaker"] == "overlap"
    assert rows[1]["speaker"] == "b"
    ranges = edit_ranges(rows, [], False, {"overlap": "left", "b": "right"})
    assert ranges[0]["position"] == "wide"
    assert ranges[1]["position"] == "right"


def test_silence_subtraction_only_when_enabled():
    rows = normalize_segments([{"start": 0, "end": 10, "text": "hello"}], 10)
    assert len(edit_ranges(rows, [[3, 6]], False, {})) == 1
    cut = edit_ranges(rows, [[3, 6]], True, {})
    assert [(r["start"], r["end"]) for r in cut] == [(0, 3), (6, 10)]
    rows[0]["keep"] = False
    with pytest.raises(ValueError):
        edit_ranges(rows, [], False, {})


def test_duration_cap_and_invalid_crop():
    rows = normalize_segments([{"start": 0, "end": 1300, "speaker": "a"}], 1300)
    with pytest.raises(ValueError):
        edit_ranges(rows, [], False, {})
    rows[0]["end"] = 5
    with pytest.raises(ValueError):
        edit_ranges(rows, [], False, {"a": "custom_ffmpeg"})


@pytest.mark.parametrize("target", [180, 300, 420])
def test_missing_ai_key_produces_bounded_deterministic_edit(target):
    rows = normalize_segments([{"start": i, "end": i + 20} for i in range(0, 720, 20)], 720)
    ids, mode = select_segments(rows, target)
    assert len(ids) * 20 <= target
    assert ids == [str(i) for i in range(len(ids))]
    assert mode.startswith("수동 초안")
    assert (ids, mode) == select_segments(rows, target)


def test_scribe_request_includes_speaker_diarization(monkeypatch, tmp_path):
    import shorts_worker.midform as module

    calls = []

    def extract(args, timeout):
        Path(args[-1]).write_bytes(b"audio")

    class Client:
        def __init__(self, **kwargs):
            assert kwargs["timeout"] == 600

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            calls.append(kwargs)
            import httpx

            return httpx.Response(
                200,
                json={
                    "words": [
                        {"type": "word", "text": "안녕", "start": 0, "end": 1, "speaker_id": "s0"}
                    ]
                },
            )

    monkeypatch.setattr(module, "checked_run", extract)
    monkeypatch.setattr(module.httpx, "Client", Client)
    rows = transcribe(tmp_path / "source.mp4", 10, "test-key")
    assert calls[0]["data"]["diarize"] == "true"
    assert calls[0]["data"]["model_id"] == "scribe_v2"
    assert rows[0]["speaker"] == "s0"
    assert not list(tmp_path.glob("midform-audio-*"))


@pytest.mark.render
@pytest.mark.parametrize("audio", [False, True])
def test_real_ffmpeg_cuts_crop_audio_and_retimes_subtitles(tmp_path, audio):
    source = tmp_path / "source.mp4"
    args = [
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=24:duration=6",
    ]
    if audio:
        args += [
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=6",
            "-af",
            "volume=8",
            "-c:a",
            "aac",
        ]
    args += ["-c:v", "libx264", "-preset", "ultrafast", str(source)]
    assert run_command(args, timeout=30).returncode == 0
    output = tmp_path / "output.mp4"
    render(
        source,
        output,
        [
            {"start": 1, "end": 2, "text": "first", "position": "left"},
            {"start": 4, "end": 5.5, "text": "second", "position": "wide"},
        ],
        audio,
    )
    probe = probe_media(output)
    assert abs(media_duration(probe) - 2.5) < 0.12
    assert any(s["codec_type"] == "audio" for s in probe["streams"]) == audio
    stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (stream["width"], stream["height"]) == (320, 180)
    subtitles = output.with_suffix(".srt").read_text()
    assert "00:00:00,000 --> 00:00:01,000\nfirst" in subtitles
    assert "00:00:01,000 --> 00:00:02,500\nsecond" in subtitles
    assert not list(tmp_path.glob("midform-render-*"))
    if audio:
        import re

        measured = run_command(
            [
                "ffmpeg",
                "-hide_banner",
                "-i",
                str(output),
                "-vn",
                "-af",
                "astats=reset=0",
                "-f",
                "null",
                "-",
            ],
            timeout=30,
        )
        peaks = [float(v) for v in re.findall(r"Peak level dB: (-?[0-9.]+)", measured.stderr)]
        assert peaks and -30 < max(peaks) < -0.5


@pytest.mark.render
def test_real_silence_detector_uses_audio_not_transcript_gaps(tmp_path):
    source = tmp_path / "source.wav"
    args = [
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=5",
        "-af",
        "volume=enable='between(t,1,3)':volume=0",
        str(source),
    ]
    assert run_command(args, timeout=30).returncode == 0
    found = silence_ranges(source, 5)
    assert len(found) == 1
    assert abs(found[0][0] - 1.4) < 0.1
    assert abs(found[0][1] - 2.6) < 0.1


@pytest.mark.render
def test_silence_presets_change_short_and_long_pause_removal(tmp_path):
    source = tmp_path / "pauses.wav"
    # Known 0.4s and 2s silences in an otherwise audible tone.
    result = run_command([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
        "sine=frequency=440:duration=6",
        "-af", "volume=enable='between(t,1,1.4)+between(t,3,5)':volume=0",
        str(source),
    ], timeout=30)
    assert result.returncode == 0
    found = {key: silence_ranges(source, 6, key) for key in ("aggressive", "medium", "relaxed")}
    assert len(found["aggressive"]) == 2
    assert len(found["medium"]) == len(found["relaxed"]) == 1
    totals = [sum(b-a for a,b in found[key]) for key in found]
    assert totals[0] > totals[1] > totals[2] > 0
    for cuts in found.values():
        for a,b in cuts:
            assert (1 <= a < b <= 1.5) or (3 <= a < b <= 5.1)
    with pytest.raises(ValueError):
        silence_ranges(source, 6, "arbitrary_filter")


def test_preserves_breathing_and_keeps_subtitle_timing_separate():
    rows = normalize_segments(
        [
            {"start": 0, "end": 1.7, "text": "질문?", "speaker": "a"},
            {"start": 1.95, "end": 3.6, "text": "답변.", "speaker": "b"},
            {"start": 3.6, "end": 4, "keep": False},
            {"start": 4, "end": 5, "text": "다음."},
        ],
        5,
    )
    ranges = edit_ranges(rows, [], False, {})
    assert [(r["start"], r["end"]) for r in ranges] == [(0, 3.6), (4, 5)]
    assert ranges[0]["captions"][1]["start"] == 1.95


def test_story_selection_rejects_overlap_microcuts_and_invalid_ids():
    from shorts_worker.midform import validate_plan, validate_target

    rows = normalize_segments([{"start": i, "end": i + 10} for i in range(0, 100, 10)], 100)
    assert validate_plan({"scenes": [{"start_id": "2", "end_id": "4"}]}, rows) == ["2", "3", "4"]
    for scenes in [
        [{"start_id": "2", "end_id": "2"}],
        [{"start_id": "2", "end_id": "4"}, {"start_id": "3", "end_id": "5"}],
        [{"start_id": "8", "end_id": "12"}],
    ]:
        with pytest.raises((ValueError, KeyError)):
            validate_plan({"scenes": scenes}, rows)
    for value in [True, 100, 901, -1]:
        with pytest.raises(ValueError):
            validate_target(value)
    for value in [0, 120, 600, 900]:
        validate_target(value)


def test_ai_refines_only_draft_rows_and_can_cut_inside_a_scene(monkeypatch):
    import json

    import httpx

    import shorts_worker.midform as module

    calls = []
    rows = normalize_segments(
        [{"start": i, "end": i + 10, "text": f"문장 {i}"} for i in range(0, 100, 10)], 100
    )

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            calls.append(json.loads(json.dumps(kwargs["json"])))
            plan = (
                {"title": "완결된 이야기", "scenes": [{"start_id": "2", "end_id": "4"}]}
                if len(calls) == 1
                else {"title": "짧은 이야기", "keep_ids": ["2", "4"]}
            )
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={"choices": [{"message": {"content": json.dumps(plan)}}], "usage": {}},
            )

    monkeypatch.setattr(module.httpx, "Client", Client)
    ids, mode = select_segments(rows, 600, "test-key")
    assert ids == ["2", "4"] and mode.startswith("AI")
    assert len(calls) == 2
    assert all(call["model"] == "gpt-5.4" for call in calls)
    assert all(call["reasoning_effort"] == "low" for call in calls)
    assert "600" in calls[0]["messages"][0]["content"]
    assert "문장 30" in calls[1]["messages"][-1]["content"]
    assert "문장 50" not in calls[1]["messages"][-1]["content"]
    assert "keep_ids" in calls[1]["messages"][0]["content"]


@pytest.mark.parametrize(
    "content", ['{"scenes":', '{"scenes": [{"start_id": "999", "end_id": "1000"}]}']
)
def test_selection_failure_retains_billable_usage_without_credentials(
    monkeypatch, tmp_path, content
):
    import json

    import httpx

    import shorts_worker.midform as module

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, **kwargs):
            return httpx.Response(
                200,
                request=httpx.Request("POST", url),
                json={
                    "model": "gpt-5.4-mini",
                    "usage": {"prompt_tokens": 100, "completion_tokens": 50},
                    "choices": [{"message": {"content": content}, "finish_reason": "length"}],
                },
            )

    monkeypatch.setattr(module.httpx, "Client", Client)
    evidence = tmp_path / "selection.json"
    rows = normalize_segments([{"start": 0, "end": 20, "text": "대사"}], 20)
    _, mode = select_segments(rows, 300, "secret-test-key", evidence=evidence)
    assert mode.startswith("수동 초안")
    recorded = json.loads(evidence.read_text())
    assert recorded["attempts"][0]["usage"]["completion_tokens"] == 50
    assert recorded["attempts"][0]["finishReason"] == "length"
    assert recorded["errorType"] in {"JSONDecodeError", "KeyError"}
    assert "secret-test-key" not in evidence.read_text()


@pytest.mark.parametrize("ids", [[], ["0"], ["2", "2"], ["3", "2"], [2]])
def test_refinement_rejects_empty_outside_repeated_or_reordered_rows(ids):
    from shorts_worker.midform import refine_plan

    rows = normalize_segments([{"start": i, "end": i + 1} for i in range(5)], 5)
    with pytest.raises(ValueError):
        refine_plan({"keep_ids": ids}, rows, ["2", "3", "4"])


def test_refinement_bridges_tiny_cuts_only_inside_the_draft():
    from shorts_worker.midform import refine_plan

    rows = normalize_segments(
        [{"start": 0, "end": 2}, {"start": 2, "end": 2.5}, {"start": 2.5, "end": 5}], 5
    )
    ids, plan = refine_plan({"keep_ids": ["0", "2"]}, rows, ["0", "1", "2"])
    assert ids == ["0", "1", "2"] and len(plan["scenes"]) == 1
    ids, plan = refine_plan({"keep_ids": ["0", "2"]}, rows, ["0", "2"])
    assert ids == ["0", "2"] and len(plan["scenes"]) == 2


@pytest.mark.render
def test_many_short_utterances_do_not_accumulate_frame_loss(tmp_path):
    source = tmp_path / "source.mp4"
    args = [
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=30:duration=5",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=5",
        "-c:a",
        "aac",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        str(source),
    ]
    assert run_command(args, timeout=30).returncode == 0
    rows = normalize_segments(
        [{"start": i * 0.103, "end": (i + 1) * 0.103, "text": str(i)} for i in range(40)], 5
    )
    ranges = edit_ranges(rows, [], False, {})
    assert len(ranges) == 1
    output = tmp_path / "output.mp4"
    render(source, output, ranges, True)
    probe = probe_media(output)
    assert abs(media_duration(probe) - 4.12) < 0.035
    streams = probe["streams"]
    lengths = [float(s["duration"]) for s in streams if "duration" in s]
    assert max(lengths) - min(lengths) <= 0.04
    assert len(output.with_suffix(".srt").read_text().strip().split("\n\n")) == 40


def test_render_failure_preserves_previous_completed_output(monkeypatch, tmp_path):
    import shorts_worker.midform as module

    output = tmp_path / "output.mp4"
    output.write_bytes(b"previous video")
    output.with_suffix(".srt").write_text("previous subtitles")
    monkeypatch.setattr(
        module,
        "probe_media",
        lambda _: {
            "streams": [
                {"codec_type": "video", "width": 320, "height": 180, "avg_frame_rate": "30/1"}
            ]
        },
    )

    def fail(*args):
        raise ValueError("encoding failed")

    monkeypatch.setattr(module, "checked_run", fail)
    with pytest.raises(ValueError):
        render(
            tmp_path / "source.mp4",
            output,
            [{"start": 0, "end": 2, "text": "hello", "position": "wide"}],
            False,
        )
    assert output.read_bytes() == b"previous video"
    assert output.with_suffix(".srt").read_text() == "previous subtitles"
    assert not list(tmp_path.glob("midform-render-*"))
