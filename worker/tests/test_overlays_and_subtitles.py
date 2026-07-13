from __future__ import annotations

from pathlib import Path

from PIL import Image

from shorts_worker.config import Settings
from shorts_worker.overlays import (
    create_ass_subtitles,
    create_channel_panel,
    create_title_panel,
    wrap_korean_title,
)
from shorts_worker.schemas import SubtitleSegment, TemplateId
from shorts_worker.subtitles import AudioTranscriber, parse_subtitle_text


def test_korean_title_wraps_to_at_most_two_lines() -> None:
    lines = wrap_korean_title("사람들이 가장 많이 놓치는 결정적인 핵심 장면입니다")
    assert 1 <= len(lines) <= 2
    assert all(line.strip() for line in lines)
    assert sum(len(line.rstrip("…")) for line in lines) <= 40


def test_title_wrapping_preserves_user_line_break() -> None:
    assert wrap_korean_title("첫 번째 핵심\n두 번째 반전") == [
        "첫 번째 핵심",
        "두 번째 반전",
    ]


def test_korean_title_overlay_is_created(tmp_path: Path) -> None:
    output = create_title_panel(
        "지금 알아야 할 핵심 장면",
        TemplateId.DARK_RED,
        tmp_path / "title.png",
    )
    assert output.is_file()
    with Image.open(output) as image:
        assert image.size == (1080, 420)
        assert image.getbbox() is not None
        # Text introduces non-background pixels in the black template.
        assert image.getcolors(maxcolors=1_000_000) is not None
        assert len(image.getcolors(maxcolors=1_000_000) or []) > 1


def test_two_line_title_sits_near_video_and_accent_contains_text(tmp_path: Path) -> None:
    output = create_title_panel(
        "4억 투자 올인, 다\n8400만원 남아……",
        TemplateId.DARK_RED,
        tmp_path / "title-position.png",
        font_size=84,
    )
    with Image.open(output).convert("RGB") as image:
        red_pixels = [
            (x, y)
            for y in range(image.height)
            for x in range(image.width)
            if image.getpixel((x, y)) == (227, 38, 38)
        ]
        assert red_pixels
        red_left = min(x for x, _ in red_pixels)
        red_top = min(y for _, y in red_pixels)
        red_right = max(x for x, _ in red_pixels)
        red_bottom = max(y for _, y in red_pixels)
        assert red_top >= 220
        assert 340 <= red_bottom <= 390

        second_line_text = [
            (x, y)
            for y in range(red_top, red_bottom + 1)
            for x in range(image.width)
            if image.getpixel((x, y)) == (255, 255, 255)
        ]
        assert second_line_text
        assert red_left < min(x for x, _ in second_line_text)
        assert max(x for x, _ in second_line_text) < red_right
        assert red_top < min(y for _, y in second_line_text)
        assert max(y for _, y in second_line_text) < red_bottom


def test_portrait_title_sits_closer_to_video(tmp_path: Path) -> None:
    output = create_title_panel(
        "첫 번째 제목\n두 번째 제목",
        TemplateId.DARK_RED,
        tmp_path / "portrait-title.png",
        panel_height=285,
    )
    with Image.open(output).convert("RGB") as image:
        visible_pixels = [
            (x, y)
            for y in range(image.height)
            for x in range(image.width)
            if image.getpixel((x, y)) != (0, 0, 0)
        ]
        assert visible_pixels
        assert max(y for _, y in visible_pixels) >= 270


def test_channel_panel_sits_near_video(tmp_path: Path) -> None:
    output = create_channel_panel(
        "디글 클래식 : Diggle Classic",
        TemplateId.DARK_RED,
        tmp_path / "channel-position.png",
    )
    with Image.open(output).convert("RGB") as image:
        visible_pixels = [
            (x, y)
            for y in range(image.height)
            for x in range(image.width)
            if image.getpixel((x, y)) != (0, 0, 0)
        ]
        assert visible_pixels
        assert min(y for _, y in visible_pixels) == 48
        assert max(y for _, y in visible_pixels) <= 120


def test_full_vertical_panels_have_no_large_background_and_keep_line_accent(tmp_path: Path) -> None:
    title = create_title_panel(
        "세로 화면 제목\n둘째 줄 강조",
        TemplateId.DARK_RED,
        tmp_path / "vertical-title.png",
        panel_height=360,
        overlay_mode=True,
    )
    channel = create_channel_panel(
        "세로 채널",
        TemplateId.DARK_RED,
        tmp_path / "vertical-channel.png",
        panel_height=180,
        overlay_mode=True,
    )
    for output, expected_height in ((title, 360), (channel, 180)):
        with Image.open(output).convert("RGBA") as image:
            assert image.size == (1080, expected_height)
            assert image.getpixel((0, 0))[3] == 0
            assert image.getbbox() is not None
    with Image.open(title).convert("RGBA") as image:
        assert image.getpixel((100, 180))[3] == 0
        assert any(
            pixel == (227, 38, 38, 255)
            for pixel in image.getdata()
        )


def test_vtt_and_srt_cues_are_normalized() -> None:
    content = """WEBVTT

00:00:01.000 --> 00:00:03.500
<c>첫 번째 자막</c>

2
00:00:04,000 --> 00:00:06,250
두 번째 자막
"""
    segments = parse_subtitle_text(content)
    assert [(item.start, item.end, item.text) for item in segments] == [
        (1.0, 3.5, "첫 번째 자막"),
        (4.0, 6.25, "두 번째 자막"),
    ]


def test_youtube_rolling_captions_emit_each_phrase_once() -> None:
    content = """WEBVTT

00:00:00.000 --> 00:00:02.149
빼 놓을 수 없잖아요. 그런데 요즘 맛집 찾기 저만 어려운가요? 조금만

00:00:02.149 --> 00:00:02.159
맛집 찾기 저만 어려운가요? 조금만

00:00:02.159 --> 00:00:04.710
맛집 찾기 저만 어려운가요? 조금만 검색해도 광고, 광고, 또 광고.
"""
    segments = parse_subtitle_text(content)
    assert [(item.start, item.end, item.text) for item in segments] == [
        (
            0.0,
            2.149,
            "빼 놓을 수 없잖아요. 그런데 요즘 맛집 찾기 저만 어려운가요? 조금만",
        ),
        (2.159, 4.71, "검색해도 광고, 광고, 또 광고."),
    ]


def test_repeated_caption_after_a_real_gap_is_preserved() -> None:
    content = """WEBVTT

00:00:00.000 --> 00:00:01.000
정말 중요한 이야기입니다

00:00:02.000 --> 00:00:03.000
정말 중요한 이야기입니다
"""
    segments = parse_subtitle_text(content)
    assert [item.text for item in segments] == [
        "정말 중요한 이야기입니다",
        "정말 중요한 이야기입니다",
    ]


def test_ass_subtitle_keeps_two_line_marker(tmp_path: Path) -> None:
    output = create_ass_subtitles(
        [
            SubtitleSegment(
                start=1,
                end=3,
                text="한 줄에 모두 담기에는 충분히 길어서 두 줄로 나누어지는 자막 문장입니다",
            )
        ],
        clip_start=0,
        clip_end=4,
        output_path=tmp_path / "captions.ass",
    )
    assert output is not None
    content = output.read_text(encoding="utf-8")
    assert r"\N" in content
    assert r"\\N" not in content


def test_gpt4o_transcription_uses_supported_json_response(tmp_path: Path) -> None:
    chunk = tmp_path / "audio.m4a"
    chunk.write_bytes(b"fixture")
    calls: list[dict[str, object]] = []

    class Transcriptions:
        @staticmethod
        def create(**kwargs):
            calls.append(kwargs)
            return {"text": "첫 문장입니다. 두 번째 문장입니다."}

    client = type(
        "Client",
        (),
        {"audio": type("Audio", (), {"transcriptions": Transcriptions()})()},
    )()
    transcriber = AudioTranscriber(Settings(openai_transcribe_model="gpt-4o-transcribe"))
    segments = transcriber._transcribe_chunk(client, chunk, duration=10, offset=5)

    assert len(calls) == 1
    assert calls[0]["response_format"] == "json"
    assert segments[0].start == 5
    assert segments[-1].end == 15
