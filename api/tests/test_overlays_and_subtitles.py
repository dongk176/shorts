from __future__ import annotations

from pathlib import Path

from PIL import Image

from app.overlays import create_ass_subtitles, create_title_panel, wrap_korean_title
from app.schemas import SubtitleSegment, TemplateId
from app.subtitles import parse_subtitle_text


def test_korean_title_wraps_to_at_most_two_lines() -> None:
    lines = wrap_korean_title("사람들이 가장 많이 놓치는 결정적인 핵심 장면입니다")
    assert 1 <= len(lines) <= 2
    assert all(line.strip() for line in lines)
    assert sum(len(line.rstrip("…")) for line in lines) <= 30


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
