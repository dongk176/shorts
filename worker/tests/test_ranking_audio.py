import json
import math
import shutil
import subprocess
from array import array
from pathlib import Path
from uuid import uuid4

import pytest
from PIL import Image

from shorts_worker.ranking_pipeline import SOUNDS, RankingFailure, RankingPipeline


def test_audio_transitions_music_and_disabled_render(tmp_path, monkeypatch):
    monkeypatch.setenv("RANKING_STORAGE_ROOT", str(tmp_path))
    project = tmp_path / str(uuid4())
    project.mkdir()
    pipeline = RankingPipeline(project)
    sources = []
    for color in ["red", "blue", "green"]:
        sid = str(uuid4())
        directory = project / sid
        directory.mkdir()
        pipeline.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"color={color}:s=180x320:r=30:d=1",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:duration=1",
                # Real social videos may be full-range. Concatenation must retain
                # the limited-range transition's true black, including after BGM.
                "-vf",
                "scale=out_range=pc,setparams=range=full",
                "-color_range",
                "pc",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-t",
                "1",
                "-y",
                str(directory / "source.mp4"),
            ]
        )
        sources.append({"id": sid, **pipeline.probe(directory / "source.mp4")})
    music_id = str(uuid4())
    musicdir = project / music_id
    musicdir.mkdir()
    pipeline.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:duration=0.7",
            "-f",
            "wav",
            "-y",
            str(musicdir / "upload"),
        ]
    )
    music = pipeline.import_audio(music_id)
    assert music["kind"] == "audio"
    assert not (musicdir / "upload").exists()
    (project / "sources.json").write_text(json.dumps([*sources, music]))
    spec = {
        "title": "효과음 테스트",
        "transitionVersion": 2,
        "subtitle": "순위 사이 검정 화면",
        "rankCount": 5,
        "descending": False,
        "playbackOrder": [5, 1, 3],
        "clips": [
            {"rank": rank, "sourceId": source["id"], "label": f"장면 {rank}", "start": 0, "end": 1}
            for rank, source in zip([1, 3, 5], sources, strict=True)
        ],
    }

    def frame(output, time):
        target = project / "frame.png"
        pipeline.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-ss",
                str(time),
                "-i",
                str(output),
                "-frames:v",
                "1",
                "-y",
                str(target),
            ]
        )
        return Image.open(target).convert("RGB")

    def amplitude(output, frequency):
        raw = subprocess.check_output(
            [
                "ffmpeg",
                "-v",
                "error",
                "-ss",
                "0.2",
                "-i",
                str(output),
                "-t",
                "0.2",
                "-vn",
                "-f",
                "s16le",
                "-ac",
                "1",
                "-ar",
                "48000",
                "-",
            ],
            timeout=30,
        )
        samples = array("h", raw)
        return abs(
            sum(
                value
                * complex(
                    math.cos(i * frequency * 2 * math.pi / 48000),
                    math.sin(i * frequency * 2 * math.pi / 48000),
                )
                for i, value in enumerate(samples)
            )
        ) / len(samples)

    baseline = project / pipeline.render(spec, str(uuid4()))["fileName"]
    assert pipeline.probe(baseline)["duration"] == pytest.approx(3, abs=0.1)
    assert frame(baseline, 1.4).getpixel((360, 800))[0] > 200
    original_low = amplitude(baseline, 220)
    for sound, setting in SOUNDS.items():
        result = pipeline.render(
            {
                **spec,
                "transitionSound": sound,
                "backgroundMusic": {"sourceId": music_id, "volume": 0.3},
            },
            str(uuid4()),
        )
        output = project / result["fileName"]
        length = setting["duration"]
        assert result["duration"] == pytest.approx(3 + 2 * length, abs=0.15)
        for moment in [1 + length / 2, 2 + length * 1.5]:
            assert max(channel[1] for channel in frame(output, moment).getextrema()) <= 3
        assert frame(output, 0.5).getpixel((360, 800))[1] > 90
        assert frame(output, 1 + length + 0.5).getpixel((360, 800))[0] > 200
        assert frame(output, 2 + 2 * length + 0.5).getpixel((360, 800))[2] > 200
        assert amplitude(output, 220) > max(10, original_low * 4)
        assert amplitude(output, 1000) > 100
        if sound == "lip-bass":
            artifact = Path(__file__).resolve().parents[2] / "output/ranking-audio-test.mp4"
            artifact.parent.mkdir(exist_ok=True)
            shutil.copyfile(output, artifact)
    for invalid in ["../secret", ["kick"], 1]:
        with pytest.raises(RankingFailure):
            pipeline.validate_render({**spec, "transitionSound": invalid})
    with pytest.raises(RankingFailure):
        pipeline.validate_render(
            {**spec, "backgroundMusic": {"sourceId": str(uuid4()), "volume": 0.3}}
        )
    with pytest.raises(RankingFailure):
        pipeline.validate_render({**spec, "backgroundMusic": {"sourceId": music_id, "volume": 1.1}})


def test_transition_assets_start_promptly_and_match_preview(tmp_path):
    from shorts_worker.ranking_pipeline import ASSETS

    web_audio = Path(__file__).resolve().parents[2] / "web/public/audio/ranking"
    for setting in SOUNDS.values():
        asset = ASSETS / "ranking_audio" / f"{setting['asset']}.mp4"
        assert asset.read_bytes() == (web_audio / asset.name).read_bytes()
        raw = subprocess.check_output([
            "ffmpeg", "-v", "error", "-i", str(asset), "-vn", "-f", "s16le",
            "-ac", "1", "-ar", "48000", "-",
        ], timeout=20)
        samples = array("h", raw)
        audible = [i for i, value in enumerate(samples) if abs(value) > 328]
        assert audible[0] / 48000 < .02  # sound arrives with the first black frame
        assert setting["duration"] - audible[-1] / 48000 < .10
        if setting["id"] == "lip-bass":
            assert .8 < setting["duration"] < .9
            tail = samples[int((setting["duration"] - .04) * 48000):]
            body = samples[int(.2 * 48000):int(.4 * 48000)]
            assert sum(abs(x) for x in tail) / len(tail) < sum(abs(x) for x in body) / len(body) / 2


def test_existing_browser_jobs_keep_original_transition_timing(tmp_path, monkeypatch):
    monkeypatch.setenv("RANKING_STORAGE_ROOT", str(tmp_path))
    project = tmp_path / str(uuid4())
    project.mkdir()
    pipeline = RankingPipeline(project)
    original, _ = pipeline.audio_settings({"transitionSound": "lip-bass"})
    current, _ = pipeline.audio_settings({"transitionSound": "lip-bass", "transitionVersion": 2})
    assert original["duration"] == 40 / 30
    assert original["asset"] == "lip-bass"
    assert current["duration"] == 26 / 30
    assert current["asset"] == "lip-bass-v2"
