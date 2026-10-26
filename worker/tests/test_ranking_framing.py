from __future__ import annotations

import json
import math
import shutil
from uuid import uuid4

import pytest
from PIL import Image, ImageChops, ImageDraw, ImageStat

from shorts_worker.ranking_pipeline import (
    LAYOUT,
    RankingFailure,
    RankingPipeline,
    ranking_framing,
    ranking_video_filter,
)


@pytest.mark.parametrize(
    "value",
    [
        {"top": 0.7, "bottom": 0, "zoom": 1, "panY": 0},
        {"top": 0.5, "bottom": 0.5, "zoom": 1, "panY": 0},
        {"top": 0, "bottom": 0, "zoom": float("nan"), "panY": 0},
        {"top": 0, "bottom": 0, "zoom": 1, "panY": True},
        {"top": "0;bad", "bottom": 0, "zoom": 1, "panY": 0},
        {"top": 0, "bottom": 0, "zoom": 1, "panY": 0, "command": "bad"},
    ],
)
def test_framing_rejects_invalid_values(value):
    with pytest.raises(RankingFailure):
        ranking_framing(value)


def test_framing_preserves_stable_filter_and_does_not_scale_to_removed_region():
    stable = ranking_video_filter()
    assert stable == ranking_video_filter({"top": 0, "bottom": 0, "zoom": 1, "panY": 0})
    mask = ranking_video_filter({"top": 0.25, "bottom": 0.2, "zoom": 1, "panY": 0})
    assert "drawbox" in mask
    assert "*1.0000000000" in mask
    assert "0.550" not in mask


@pytest.mark.render
def test_framing_render_matches_preview_geometry_and_preserves_scale(tmp_path, monkeypatch):
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg/ffprobe required")
    monkeypatch.setenv("RANKING_STORAGE_ROOT", str(tmp_path))
    project = tmp_path / str(uuid4())
    project.mkdir()
    pipeline = RankingPipeline(project)
    source_id = str(uuid4())
    directory = project / source_id
    directory.mkdir()
    image = Image.new("RGB", (720, 1280))
    draw = ImageDraw.Draw(image)
    for i, color in enumerate(["red", "yellow", "green", "blue", "magenta"]):
        draw.rectangle((0, i * 256, 719, (i + 1) * 256 - 1), fill=color)
    draw.rectangle((420, 610, 500, 690), fill="white")
    image.save(directory / "pattern.png")
    pipeline.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-loop",
            "1",
            "-i",
            str(directory / "pattern.png"),
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-t",
            "2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-y",
            str(directory / "source.mp4"),
        ]
    )
    (project / "sources.json").write_text(json.dumps([{"id": source_id}]))
    settings = [
        None,
        {"top": 0.25, "bottom": 0.2, "zoom": 1, "panY": 0},
        {"top": 0.25, "bottom": 0.2, "zoom": 1.35, "panY": -0.5},
    ]
    spec = {
        "title": "프레임 검증",
        "subtitle": "실제 렌더",
        "descending": False,
        "rankCount": 3,
        "clips": [
            {
                "rank": i + 1,
                "sourceId": source_id,
                "start": 0.5,
                "end": 1.5,
                "label": "장면",
                **({"framing": framing} if framing else {}),
            }
            for i, framing in enumerate(settings)
        ],
    }
    result = pipeline.render(spec, str(uuid4()))
    output = project / result["fileName"]
    info = pipeline.probe(output)
    assert (info["width"], info["height"], info["hasAudio"]) == (720, 1280, True)
    assert info["duration"] == pytest.approx(3, abs=0.1)
    frames = []
    for i in range(3):
        frame = project / f"frame-{i}.png"
        pipeline.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-ss",
                str(i + 0.5),
                "-i",
                str(output),
                "-frames:v",
                "1",
                "-y",
                str(frame),
            ]
        )
        frames.append(Image.open(frame).convert("RGB"))
    header = LAYOUT["headerHeight"]
    assert max(frames[1].getpixel((600, header + 80))) < 12
    assert max(frames[1].getpixel((600, 1240))) < 12
    assert max(frames[0].getpixel((600, header + 80))) > 200
    # The unchanged interior/white marker proves cuts did not magnify or recenter.
    region = (350, header + 250, 690, header + 800)
    difference = ImageChops.difference(frames[0].crop(region), frames[1].crop(region))
    assert max(ImageStat.Stat(difference).mean) < 2
    for i, framing in enumerate(settings[1:], 1):
        zoom = framing["zoom"]
        target_h = 1280 - header
        scale = max(720 / 720, target_h / 1280) * zoom
        scaled_w, scaled_h = math.ceil(720 * scale / 2) * 2, math.ceil(1280 * scale / 2) * 2
        crop_x = (scaled_w - 720) / 2
        crop_y = (scaled_h - target_h) * (1 - framing["panY"]) / 2
        # Expected browser affine transform, calculated independently of FFmpeg filters.
        expected_center = (460 * scaled_w / 720 - crop_x, 650 * scaled_h / 1280 - crop_y + header)
        expected_side = 81 * scale
        pixels = frames[i]
        marker = [
            (x, y)
            for y in range(header + 150, 1100)
            for x in range(300, 700)
            if min(pixels.getpixel((x, y))) > 225
        ]
        assert marker
        box = (
            min(x for x, _ in marker),
            min(y for _, y in marker),
            max(x for x, _ in marker),
            max(y for _, y in marker),
        )
        assert (box[0] + box[2]) / 2 == pytest.approx(expected_center[0], abs=3)
        assert (box[1] + box[3]) / 2 == pytest.approx(expected_center[1], abs=3)
        assert box[2] - box[0] + 1 == pytest.approx(expected_side, abs=4)
        assert box[3] - box[1] + 1 == pytest.approx(expected_side, abs=4)

    # drawbox interprets zero height as full-frame: tiny cuts must never black out the clip.
    tiny = project / "tiny-mask.png"
    pipeline.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(directory / "source.mp4"),
            "-vf",
            ranking_video_filter({"top": 1e-12, "bottom": 1e-12, "zoom": 1, "panY": 0}),
            "-frames:v",
            "1",
            "-y",
            str(tiny),
        ]
    )
    with Image.open(tiny) as tiny_image:
        assert tiny_image.getpixel((360, 450))[1] > 80
