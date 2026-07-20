from __future__ import annotations

from pathlib import Path

from PIL import Image

from shorts_worker.config import Settings
from shorts_worker.overlays import (
    COMMENT_BODY_FONT_SIZE,
    create_ass_subtitles,
    create_channel_panel,
    create_comment_panel,
    create_custom_canvas_overlays,
    create_title_panel,
    wrap_korean_title,
)
from shorts_worker.schemas import (
    CommentOverlay,
    CustomTemplateConfig,
    SubtitleSegment,
    TemplateId,
    TitleTextStyle,
)
from shorts_worker.subtitles import AudioTranscriber


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


def test_custom_title_lines_use_independent_background_colors(tmp_path: Path) -> None:
    config = CustomTemplateConfig.model_validate(
        {
            "schemaVersion": 2,
            "background": {"kind": "color", "color": "#111111"},
            "video": {
                "aspectRatio": "5:4",
                "x": 0,
                "y": 528,
                "width": 1080,
                "height": 864,
                "fit": "cover",
            },
            "title": {
                "visible": True,
                "x": 540,
                "y": 260,
                "maxWidth": 900,
                "fontSize": 72,
                "primaryColor": "#FFFFFF",
                "accentColor": "#FF4D4F",
                "primaryBackgroundColor": "#16A34A",
                "accentBackgroundColor": "#2563EB",
            },
            "subtitle": {
                "visible": False,
                "x": 540,
                "y": 1400,
                "maxWidth": 900,
                "fontSize": 48,
                "color": "#FFFFFF",
                "backgroundColor": "#000000",
            },
            "channel": {
                "visible": False,
                "x": 540,
                "y": 1700,
                "maxWidth": 800,
                "fontSize": 42,
                "color": "#FFFFFF",
                "backgroundColor": None,
            },
        }
    )
    _, title_path, _ = create_custom_canvas_overlays(
        title="첫 번째 줄\n두 번째 줄",
        channel_name="테스트 채널",
        config=config,
        directory=tmp_path,
        prefix="line-backgrounds",
    )

    with Image.open(title_path).convert("RGBA") as image:
        colors = {color for _, color in image.getcolors(maxcolors=1_000_000) or []}
        primary_points: list[tuple[int, int]] = []
        accent_points: list[tuple[int, int]] = []
        for index, pixel in enumerate(image.getdata()):
            point = (index % image.width, index // image.width)
            if pixel == (22, 163, 74, 255):
                primary_points.append(point)
            elif pixel == (37, 99, 235, 255):
                accent_points.append(point)
    assert (22, 163, 74, 255) in colors
    assert (37, 99, 235, 255) in colors
    all_background_points = primary_points + accent_points
    background_center_x = (
        min(x for x, _ in all_background_points)
        + max(x for x, _ in all_background_points)
    ) / 2
    background_center_y = (
        min(y for _, y in all_background_points)
        + max(y for _, y in all_background_points)
    ) / 2
    assert abs(background_center_x - config.title.x) <= 1
    assert abs(background_center_y - config.title.y) <= 1


def test_title_overlay_applies_colors_only_to_selected_character_range(tmp_path: Path) -> None:
    output = create_title_panel(
        "선택 색상 테스트",
        TemplateId.DARK_MINIMAL,
        tmp_path / "styled-title.png",
        title_text_styles=[
            TitleTextStyle(
                start=0,
                end=2,
                color="#00FF00",
                backgroundColor="#123456",
            )
        ],
    )
    with Image.open(output).convert("RGB") as image:
        pixels = list(image.getdata())
        assert (18, 52, 86) in pixels
        assert (0, 255, 0) in pixels


def test_explicit_empty_title_styles_remove_template_accent_background(tmp_path: Path) -> None:
    output = create_title_panel(
        "첫 번째 제목\n두 번째 제목",
        TemplateId.DARK_RED,
        tmp_path / "title-without-background.png",
        title_text_styles=[],
    )
    with Image.open(output).convert("RGB") as image:
        assert (227, 38, 38) not in list(image.getdata())
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


def test_channel_panel_uses_circular_channel_thumbnail(tmp_path: Path) -> None:
    avatar = tmp_path / "avatar.png"
    Image.new("RGB", (120, 80), (33, 102, 209)).save(avatar)
    output = create_channel_panel(
        "실제 채널",
        TemplateId.DARK_RED,
        tmp_path / "channel-with-avatar.png",
        channel_thumbnail_path=avatar,
    )
    with Image.open(output).convert("RGB") as image:
        blue_pixels = [
            (x, y)
            for y in range(image.height)
            for x in range(image.width)
            if image.getpixel((x, y)) == (33, 102, 209)
        ]
        assert blue_pixels
        assert max(x for x, _ in blue_pixels) - min(x for x, _ in blue_pixels) == 63
        assert max(y for _, y in blue_pixels) - min(y for _, y in blue_pixels) == 63
        top_left = (min(x for x, _ in blue_pixels), min(y for _, y in blue_pixels))
        assert image.getpixel(top_left) == (0, 0, 0)


def test_comment_panel_is_plain_black_with_crisp_comment_content(tmp_path: Path) -> None:
    assert COMMENT_BODY_FONT_SIZE == 35
    output = create_comment_panel(
        CommentOverlay(
            id="comment-1",
            startSeconds=0,
            endSeconds=5,
            text="댓글 테스트입니다",
            initial="소",
            avatarColor="#8B2CC4",
            nickname="소담기록24",
            likeCount=10,
            ageLabel="5개월 전",
        ),
        tmp_path / "comment.png",
        panel_height=285,
    )
    with Image.open(output).convert("RGB") as image:
        assert image.size == (1080, 285)
        assert image.getpixel((1079, 284)) == (4, 4, 4)
        assert len(image.getcolors(maxcolors=1_000_000) or []) > 20
        content_pixels = [
            (x, y)
            for y in range(image.height)
            for x in range(image.width)
            if image.getpixel((x, y)) != (4, 4, 4)
        ]
        assert min(x for x, _ in content_pixels) >= 28


def test_full_vertical_panels_keep_transparent_canvas_and_box_both_title_lines(
    tmp_path: Path,
) -> None:
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
        red_rows = sorted(
            {
                y
                for y in range(image.height)
                for x in range(image.width)
                if image.getpixel((x, y)) == (227, 38, 38, 255)
            }
        )
        assert red_rows
        assert any(
            current - previous > 1
            for previous, current in zip(red_rows, red_rows[1:], strict=False)
        )


def test_full_vertical_uses_second_line_text_color_for_both_rows(tmp_path: Path) -> None:
    output = create_title_panel(
        "첫 번째 제목\n두 번째 제목",
        TemplateId.DARK_MINIMAL,
        tmp_path / "vertical-title-color.png",
        panel_height=360,
        overlay_mode=True,
    )
    with Image.open(output).convert("RGBA") as image:
        pixels = list(image.getdata())
        assert (240, 68, 68, 255) in pixels
        assert (255, 255, 255, 255) not in pixels


def test_full_vertical_paper_uses_different_colors_for_each_title_row(tmp_path: Path) -> None:
    output = create_title_panel(
        "첫 번째 제목\n두 번째 제목",
        TemplateId.PAPER,
        tmp_path / "vertical-paper-title-color.png",
        panel_height=360,
        overlay_mode=True,
    )
    with Image.open(output).convert("RGBA") as image:
        pixels = list(image.getdata())
        assert (17, 17, 17, 255) in pixels
        assert (213, 43, 43, 255) in pixels


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


def test_gpt4o_mini_transcription_uses_supported_json_response(tmp_path: Path) -> None:
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
    transcriber = AudioTranscriber(Settings(openai_transcribe_model="gpt-4o-mini-transcribe"))
    result = transcriber._transcribe_chunk(
        client,
        index=0,
        chunk=chunk,
        duration=10,
        offset=5,
    )

    assert len(calls) == 1
    assert calls[0]["model"] == "gpt-4o-mini-transcribe"
    assert calls[0]["response_format"] == "json"
    assert result.segments[0].start == 5
    assert result.segments[-1].end == 15
