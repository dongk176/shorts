from __future__ import annotations

import os
import re
import shutil
import subprocess
from fractions import Fraction
from pathlib import Path

import pytest
from PIL import Image, ImageChops

from shorts_worker.caption_templates import (
    CAPTION_ACCENT,
    CAPTION_FONT_FAMILY,
    CAPTION_FONT_PATH,
    CAPTION_POP_SPACED_GAP_PX,
    CAPTION_WORD_SEPARATOR,
    VIDEO_HEIGHTS,
    VIDEO_Y,
    _ass_timestamp,
    _font,
    _measure,
    caption_layout,
    caption_safe_area,
    compile_caption_render_spec,
    create_caption_ass,
    prepare_caption_fonts,
)
from shorts_worker.config import Settings
from shorts_worker.errors import CaptionCompileError
from shorts_worker.media import probe_media
from shorts_worker.renderer import VideoRenderer, caption_video_layout
from shorts_worker.schemas import TemplateId, VideoAspectRatio
from shorts_worker.subtitles import TranscriptWord


def _word(
    text: str,
    start: float,
    end: float,
    *,
    space_before: bool = False,
) -> TranscriptWord:
    return TranscriptWord(
        text=text,
        start=start,
        end=end,
        provider="elevenlabs",
        space_before=space_before,
    )


def _compile(
    words: list[TranscriptWord],
    template_id: str = "highlight",
    *,
    clip_end: float = 1.0,
    ratio: VideoAspectRatio = VideoAspectRatio.FULL_VERTICAL,
) -> dict[str, object]:
    return compile_caption_render_spec(
        words,
        template_id=template_id,
        clip_start=0.0,
        clip_end=clip_end,
        video_aspect_ratio=ratio,
    )


@pytest.mark.parametrize("ratio", list(VideoAspectRatio))
def test_caption_safe_area_matches_renderer_video_rect(
    ratio: VideoAspectRatio,
) -> None:
    snapshot_layout = caption_layout(ratio)
    layout = caption_video_layout({"layout": snapshot_layout})
    assert layout.video_height == VIDEO_HEIGHTS[ratio]
    safe = caption_safe_area(ratio)
    assert safe["x"] == 120
    assert safe["width"] == 840
    assert layout.video_y == VIDEO_Y[ratio]
    if ratio is VideoAspectRatio.LANDSCAPE:
        assert snapshot_layout["title"] == {
            "x": 0, "y": 0, "width": 1080, "height": 432
        }
        assert safe == {"x": 120, "y": 1088, "width": 840, "height": 140}
        assert safe["y"] == layout.video_y + layout.video_height + 48
    elif ratio is VideoAspectRatio.FULL_VERTICAL:
        assert snapshot_layout["title"] == {
            "x": 0, "y": 96, "width": 1080, "height": 300
        }
        assert safe == {"x": 120, "y": 1430, "width": 840, "height": 140}
    else:
        assert safe["y"] >= layout.video_y
        assert safe["y"] + safe["height"] <= layout.video_y + layout.video_height
        assert safe["y"] + safe["height"] == (
            layout.video_y
            + layout.video_height
            - max(64, round(layout.video_height * 0.08))
        )


def test_approved_font_is_same_pretendard_face_for_measurement_and_libass(
    tmp_path: Path,
) -> None:
    assert CAPTION_FONT_PATH.name == "Pretendard-Bold.woff2"
    assert _font(72).getname() == ("Pretendard", "Bold")
    font_directory = prepare_caption_fonts(tmp_path / "fonts")
    ttf_path = font_directory / "Pretendard-Bold.ttf"
    assert ttf_path.is_file()
    assert _font(72).getlength("자막 Test") > 0

    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg is required")
    spec = _compile([_word("자막", 0.0, 0.25)], "basic", clip_end=0.3)
    ass_path = create_caption_ass(spec, tmp_path / "caption.ass")
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "verbose",
            "-f",
            "lavfi",
            "-i",
            "color=black:size=1080x1920:rate=30:duration=0.1",
            "-vf",
            f"subtitles=filename='{ass_path}':fontsdir='{font_directory}'",
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
        env={**os.environ, "XDG_CACHE_HOME": str(tmp_path / "font-cache")},
    )
    assert result.returncode == 0, result.stderr[-2000:]
    font_lines = [line for line in result.stderr.splitlines() if "fontselect" in line]
    assert font_lines, result.stderr[-2000:]
    assert any("Pretendard" in line for line in font_lines), font_lines
    assert not any("Pretendard" in line and "Noto" in line for line in font_lines)


def test_korean_unspaced_tokens_restore_an_eojeol_but_japanese_words_stay_intact() -> None:
    korean = _compile([
        _word("안", 0.0, 0.1),
        _word("녕", 0.1, 0.2),
        _word("하세요", 0.2, 0.5, space_before=True),
    ], "pop")
    korean_words = [
        word["text"]
        for cue in korean["cues"]
        for word in cue["words"]
    ]
    assert korean_words == ["안녕", "하세요"]

    japanese = _compile([
        _word("こんにちは", 0.0, 0.25),
        _word("世界", 0.25, 0.5),
    ], "pop")
    japanese_words = [
        word["text"]
        for cue in japanese["cues"]
        for word in cue["words"]
    ]
    assert japanese_words == ["こんにちは", "世界"]


def test_korean_sentence_punctuation_prevents_cross_sentence_merge() -> None:
    spec = _compile([
        _word("안녕!", 0.0, 0.3),
        _word("하세요", 0.3, 0.6),
    ], "basic", clip_end=1.0)

    rendered_words = [
        word["text"]
        for cue in spec["cues"]
        for word in cue["words"]
    ]
    assert rendered_words == ["안녕!", "하세요"]


@pytest.mark.parametrize("template_id", ["basic", "highlight"])
def test_sentence_templates_are_always_one_line_and_fit_safe_width(
    template_id: str,
) -> None:
    words = [
        _word("영상", 0.0, 0.2),
        _word("안쪽", 0.2, 0.4, space_before=True),
        _word("하단에", 0.4, 0.6, space_before=True),
        _word("보이는", 0.6, 0.8, space_before=True),
        _word("자막입니다", 0.8, 1.0, space_before=True),
    ]
    spec = _compile(words, template_id, clip_end=1.1)
    safe = spec["safeArea"]
    for cue in spec["cues"]:
        assert len(cue["lines"]) == 1
        serialized = cue["words"]
        for line in cue["lines"]:
            text = "".join(
                ((CAPTION_WORD_SEPARATOR if position and serialized[index]["spaceBefore"] else "")
                 + serialized[index]["text"])
                for position, index in enumerate(line)
            )
            rendered_width = _measure(text, cue["fontSize"]) * cue["scaleX"] / 100
            assert rendered_width <= safe["width"] - 14 + 1


@pytest.mark.parametrize("template_id", ["basic", "highlight", "pop"])
def test_unbreakable_long_unit_fails_instead_of_overflowing(template_id: str) -> None:
    with pytest.raises(CaptionCompileError, match="안전영역"):
        _compile([_word("W" * 120, 0.0, 0.8)], template_id)


def test_project_3204_pop_phrase_is_split_to_one_line_instead_of_failing() -> None:
    words = [
        _word("파이터를", 0.0, 0.35),
        _word("많이", 0.35, 0.6, space_before=True),
        _word("달아놓으셔가지고", 0.6, 1.2, space_before=True),
        _word("하지만", 1.2, 1.5, space_before=True),
        _word("뻔해버리면", 1.5, 1.85, space_before=True),
        _word("당해버리는,", 1.85, 2.3, space_before=True),
    ]
    spec = _compile(words, "pop", clip_end=2.4)
    assert len(spec["cues"]) >= 2
    assert all(len(cue["words"]) <= 3 for cue in spec["cues"])
    assert all(
        max(word["centerX"] for word in cue["words"])
        - min(word["centerX"] for word in cue["words"])
        <= spec["safeArea"]["width"]
        for cue in spec["cues"]
    )


def test_caption_display_leads_provider_timing_by_four_frames() -> None:
    spec = _compile([_word("먼저", 0.5, 0.8)], "basic", clip_end=1.0)
    word = spec["cues"][0]["words"][0]
    assert spec["timingLeadFrames"] == 4
    assert word["startFrame"] == round(0.5 * 30) - 4
    assert word["endFrame"] == round(0.8 * 30)


def test_caption_word_spacing_is_compact_in_sentence_and_pop_templates(
    tmp_path: Path,
) -> None:
    assert _measure(CAPTION_WORD_SEPARATOR, 72) < _measure(" ", 72)
    sentence = _compile([
        _word("가로", 0.0, 0.2),
        _word("여백", 0.2, 0.4, space_before=True),
    ], "highlight", clip_end=0.5)
    ass = create_caption_ass(sentence, tmp_path / "compact.ass").read_text(
        encoding="utf-8"
    )
    assert f"{CAPTION_WORD_SEPARATOR}여백" in ass
    assert " 가로" not in ass

    pop = _compile([
        _word("가로", 0.0, 0.2),
        _word("여백", 0.2, 0.4, space_before=True),
    ], "pop", clip_end=0.5)
    first, second = pop["cues"][0]["words"]
    first_right = first["centerX"] + _measure(first["text"], first["fontSize"]) * 1.12 / 2
    second_left = second["centerX"] - _measure(second["text"], second["fontSize"]) * 1.12 / 2
    assert second_left - first_right == pytest.approx(
        CAPTION_POP_SPACED_GAP_PX,
        abs=0.01,
    )


def test_same_start_frame_events_are_contiguous_without_overlap() -> None:
    spec = _compile([
        _word("one", 0.000, 0.010),
        _word("two", 0.009, 0.080, space_before=True),
        _word("three", 0.011, 0.300, space_before=True),
    ], "highlight", clip_end=0.3)
    events = spec["cues"][0]["events"]
    assert [event["activeWordIndex"] for event in events] == [0, 1, 2]
    assert all(event["endFrame"] > event["startFrame"] for event in events)
    assert all(
        left["endFrame"] == right["startFrame"]
        for left, right in zip(events[:-1], events[1:], strict=True)
    )


def test_overlapping_fast_pop_groups_are_serialized_without_failing() -> None:
    spec = _compile([
        _word("어유,", 0.10, 0.20),
        _word("어유,", 0.12, 0.23, space_before=True),
        _word("어유.", 0.13, 0.24, space_before=True),
        _word("진짜", 0.14, 0.30, space_before=True),
    ], "pop", clip_end=0.4)
    events = [event for cue in spec["cues"] for event in cue["events"]]
    assert all(event["endFrame"] > event["startFrame"] for event in events)
    cues = spec["cues"]
    assert all(
        left["endFrame"] <= right["startFrame"]
        for left, right in zip(cues[:-1], cues[1:], strict=True)
    )


def test_pop_uses_two_frame_ease_and_keeps_word_anchor_positions(tmp_path: Path) -> None:
    spec = _compile([
        _word("pop", 0.0, 0.15),
        _word("caption", 0.15, 0.35, space_before=True),
    ], "pop", clip_end=0.4)
    cue = spec["cues"][0]
    assert cue["easeFrames"] == 2
    positions = [(word["centerX"], word["centerY"]) for word in cue["words"]]
    assert len(set(positions)) == 2
    ass = create_caption_ass(spec, tmp_path / "pop.ass").read_text(encoding="utf-8")
    assert r"\t(0,67,\fscx112\fscy112)" in ass
    for x, y in positions:
        assert f"\\pos({x},{y})" in ass


def test_pop_single_frame_word_is_immediately_full_scale(tmp_path: Path) -> None:
    spec = _compile([
        _word("짧게", 0.0, 0.01),
        _word("강조", 0.011, 0.2, space_before=True),
    ], "pop", clip_end=0.2)
    first_event = spec["cues"][0]["events"][0]
    assert first_event["endFrame"] - first_event["startFrame"] == 1

    ass = create_caption_ass(spec, tmp_path / "single-frame-pop.ass").read_text(
        encoding="utf-8",
    )
    first_dialogue = next(
        line for line in ass.splitlines() if line.startswith("Dialogue:")
    )
    assert r"\fscx112\fscy112" in first_dialogue
    assert r"\t(" not in first_dialogue


def test_ass_uses_exact_same_timestamp_at_shared_event_boundary(tmp_path: Path) -> None:
    spec = _compile([
        _word("first", 0.0, 0.1),
        _word("second", 0.1, 0.3, space_before=True),
    ], "highlight", clip_end=0.3)
    ass = create_caption_ass(spec, tmp_path / "highlight.ass").read_text(encoding="utf-8")
    dialogue_times = [
        line.split(",", 3)[1:3]
        for line in ass.splitlines()
        if line.startswith("Dialogue:")
    ]
    assert len(dialogue_times) == 2
    assert dialogue_times[0][1] == dialogue_times[1][0]


def test_ass_frame_boundaries_floor_to_the_current_30fps_frame() -> None:
    assert _ass_timestamp(1, 30) == "0:00:00.03"
    assert _ass_timestamp(2, 30) == "0:00:00.06"
    assert _ass_timestamp(5, 30) == "0:00:00.16"
    assert _ass_timestamp(8, 30) == "0:00:00.26"


def test_unspaced_korean_tokens_do_not_merge_across_a_pause() -> None:
    spec = _compile([
        _word("안녕", 0.0, 0.2),
        _word("하세요", 1.0, 1.2),
    ], "highlight", clip_end=1.3)

    rendered_words = [
        word["text"]
        for cue in spec["cues"]
        for word in cue["words"]
    ]
    assert rendered_words == ["안녕", "하세요"]
    assert len(spec["cues"]) == 2


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is required")
def test_highlight_switches_on_the_exact_output_frame(tmp_path: Path) -> None:
    # The active word changes at frame 2. An ASS timestamp rounded to .07
    # leaves LEFT active on frame 2; flooring to .06 makes RIGHT active there.
    spec = _compile([
        _word("LEFT", 0.0, 6 / 30),
        # The approved four-frame lead advances the provider's frame-6
        # boundary to output frame 2.
        _word("RIGHT", 6 / 30, 0.3, space_before=True),
    ], "highlight", clip_end=0.3)
    ass_path = create_caption_ass(spec, tmp_path / "boundary.ass")
    font_directory = prepare_caption_fonts(tmp_path / "fonts")
    frames = tmp_path / "boundary-frames"
    frames.mkdir()
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=black:size=1080x1920:rate=30:duration=0.1",
            "-vf",
            f"subtitles=filename='{ass_path}':fontsdir='{font_directory}'",
            "-frames:v",
            "3",
            str(frames / "%02d.png"),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
        env={**os.environ, "XDG_CACHE_HOME": str(tmp_path / "font-cache")},
    )
    assert result.returncode == 0, result.stderr[-2000:]

    def accent_counts(path: Path) -> tuple[int, int]:
        def is_accent(pixel: tuple[int, int, int]) -> bool:
            # FFmpeg's YUV/RGB conversion turns #FF715E into approximately
            # (254, 111, 94); include antialiased interior pixels as well.
            red, green, blue = pixel
            return (
                red > 230
                and 70 < green < 160
                and 60 < blue < 140
                and red > green + 80
            )

        with Image.open(path).convert("RGB") as image:
            middle = image.width // 2
            left = sum(
                is_accent(pixel)
                for pixel in image.crop((0, 0, middle, image.height)).getdata()
            )
            right = sum(
                is_accent(pixel)
                for pixel in image.crop((middle, 0, image.width, image.height)).getdata()
            )
        return left, right

    frame_one_left, frame_one_right = accent_counts(frames / "02.png")
    frame_two_left, frame_two_right = accent_counts(frames / "03.png")
    assert frame_one_left > frame_one_right
    assert frame_two_right > frame_two_left


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is required")
def test_synthetic_highlight_has_no_empty_frame_and_stays_in_safe_area(
    tmp_path: Path,
) -> None:
    spec = _compile([
        _word("one", 0.000, 0.010),
        _word("two", 0.009, 0.100, space_before=True),
        _word("three", 0.100, 0.300, space_before=True),
    ], "highlight", clip_end=0.3)
    ass_path = create_caption_ass(spec, tmp_path / "caption.ass")
    font_directory = prepare_caption_fonts(tmp_path / "fonts")
    frames = tmp_path / "frames"
    frames.mkdir()
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=black:size=1080x1920:rate=30:duration=0.3",
            "-vf",
            f"subtitles=filename='{ass_path}':fontsdir='{font_directory}'",
            "-frames:v",
            "9",
            str(frames / "%02d.png"),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
        env={**os.environ, "XDG_CACHE_HOME": str(tmp_path / "font-cache")},
    )
    assert result.returncode == 0, result.stderr[-2000:]
    safe = spec["safeArea"]
    centers: list[tuple[float, float]] = []
    frame_paths = sorted(frames.glob("*.png"))
    assert len(frame_paths) == 9
    for frame_path in frame_paths:
        with Image.open(frame_path).convert("RGB") as image:
            difference = ImageChops.difference(
                image,
                Image.new("RGB", image.size, "black"),
            )
            bounds = difference.getbbox()
            assert bounds is not None, f"empty caption frame: {frame_path.name}"
            left, top, right, bottom = bounds
            assert safe["x"] <= left < right <= safe["x"] + safe["width"]
            assert safe["y"] <= top < bottom <= safe["y"] + safe["height"]
            centers.append(((left + right) / 2, (top + bottom) / 2))
    assert max(x for x, _ in centers) - min(x for x, _ in centers) <= 1
    assert max(y for _, y in centers) - min(y for _, y in centers) <= 1


@pytest.mark.parametrize("source_rate", ["24", "24000/1001"])
@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_caption_render_forces_30fps_without_desynchronizing_audio(
    tmp_path: Path,
    source_rate: str,
) -> None:
    clean = tmp_path / "clean.mp4"
    source_duration = 1.2
    generated = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            (
                "color=0x334455:size=320x568:"
                f"rate={source_rate}:duration={source_duration}"
            ),
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=880:sample_rate=48000:duration={source_duration}",
            "-shortest",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            str(clean),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert generated.returncode == 0, generated.stderr[-1000:]
    spec = _compile(
        [_word("caption", 0.1, 1.0)],
        "basic",
        clip_end=source_duration,
    )
    output = tmp_path / "rendered.mp4"
    VideoRenderer(Settings(temp_dir=tmp_path, ffmpeg_timeout_seconds=120)).render_clean_clip(
        clean_path=clean,
        output_path=output,
        title="Caption test",
        channel_name="EasyCut",
        template_id=TemplateId.DARK_MINIMAL,
        transcript=[],
        subtitles_enabled=True,
        work_dir=tmp_path / "render-work",
        prefix="caption-30fps",
        video_aspect_ratio=VideoAspectRatio.FULL_VERTICAL,
        caption_render_spec=spec,
    )
    output_probe = probe_media(output)
    video = next(
        stream
        for stream in output_probe["streams"]
        if stream.get("codec_type") == "video"
    )
    audio = next(
        stream
        for stream in output_probe["streams"]
        if stream.get("codec_type") == "audio"
    )
    assert Fraction(video["avg_frame_rate"]) == Fraction(30, 1)
    assert int(video["width"]) == 1080
    assert int(video["height"]) == 1920
    video_start = float(video.get("start_time") or 0)
    audio_start = float(audio.get("start_time") or 0)
    video_duration = float(video["duration"])
    audio_duration = float(audio["duration"])
    assert abs(video_start - audio_start) <= 1 / 30
    # AAC packets are not frame-aligned with 30fps video. Allow one video frame
    # plus one 48kHz AAC packet while still catching cumulative conversion drift.
    assert abs(video_duration - audio_duration) <= 1 / 30 + 1024 / 48_000


@pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg and ffprobe are required",
)
def test_landscape_render_places_caption_below_video_with_a_clear_gap(
    tmp_path: Path,
) -> None:
    clean = tmp_path / "landscape-clean.mp4"
    generated = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=0x2450a4:size=320x180:rate=30:duration=0.5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=660:sample_rate=48000:duration=0.5",
            "-shortest",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(clean),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert generated.returncode == 0, generated.stderr[-1000:]
    spec = _compile(
        [_word("영상 아래 자막", 0.0, 0.45)],
        "basic",
        clip_end=0.5,
        ratio=VideoAspectRatio.LANDSCAPE,
    )
    output = tmp_path / "landscape-rendered.mp4"
    VideoRenderer(Settings(temp_dir=tmp_path, ffmpeg_timeout_seconds=120)).render_clean_clip(
        clean_path=clean,
        output_path=output,
        title="제목 안전영역\n영상에 가깝게",
        channel_name="EasyCut",
        template_id=TemplateId.DARK_MINIMAL,
        transcript=[],
        subtitles_enabled=True,
        work_dir=tmp_path / "landscape-render-work",
        prefix="landscape-caption",
        video_aspect_ratio=VideoAspectRatio.LANDSCAPE,
        caption_render_spec=spec,
    )
    frame = tmp_path / "landscape-frame.png"
    extracted = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            "0.2",
            "-i",
            str(output),
            "-frames:v",
            "1",
            str(frame),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert extracted.returncode == 0, extracted.stderr[-1000:]

    with Image.open(frame).convert("RGB") as image:
        def is_video(pixel: tuple[int, int, int]) -> bool:
            red, green, blue = pixel
            return blue > red * 1.8 and blue > green * 1.3

        assert not is_video(image.getpixel((540, 431)))
        assert is_video(image.getpixel((540, 432)))
        assert is_video(image.getpixel((540, 1039)))
        assert not is_video(image.getpixel((540, 1040)))
        assert image.crop((0, 1040, 1080, 1088)).getbbox() is None

        caption_crop = image.crop((120, 1088, 960, 1228))
        assert caption_crop.getbbox() is not None
        title_crop = image.crop((0, 96, 1080, 432))
        title_bounds = title_crop.getbbox()
        assert title_bounds is not None
        assert title_bounds[3] <= 432 - 96


def test_caption_spec_uses_approved_style_snapshot_values() -> None:
    spec = _compile([_word("caption", 0.0, 0.3)], "basic")
    assert spec["fps"] == 30
    assert spec["font"]["family"] == CAPTION_FONT_FAMILY
    assert spec["font"]["weight"] == 700
    assert re.fullmatch(r"[0-9a-f]{64}", spec["font"]["sha256"])
    assert spec["style"]["accentColor"] == CAPTION_ACCENT == "#FF715E"
