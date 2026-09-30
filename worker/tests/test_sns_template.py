import json
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from shorts_worker.config import Settings
from shorts_worker.language_test import verify_language_test_job
from shorts_worker.media import probe_media, run_command
from shorts_worker.sns_template import (
    copy_messages,
    copy_response_format,
    create_overlay,
    draw_text,
    font,
    generate_copy,
    render_sns,
    sns_layout,
    text_width,
    validate_copy,
    validate_generated_language,
)


@pytest.mark.parametrize("ratio", ["16:9", "5:4", "1:1", "4:5", "9:16"])
@pytest.mark.parametrize("language", ["ko", "en", "ja"])
def test_copy_constraints_and_fallback(ratio, language):
    layout = sns_layout(ratio)
    source = {
        "ko": "퇴근 시간이 되자 활짝 웃으며 사무실을 나갑니다.",
        "en": "He smiles and leaves the office when work is finished.",
        "ja": "退勤時間になると笑顔でオフィスを出ます。",
    }[language]
    result = generate_copy(
        Settings(openai_api_key=None, gemini_api_key=None),
        title=source,
        reason=source,
        transcript=source,
        ratio=ratio,
        language=language,
    )
    assert len(result["body"]) == layout.body_lines
    assert len(result["hashtags"]) == (3 if layout.hashtags else 0)
    assert "\n" not in result["title"]
    assert text_width(result["title"], font(80, language), -3) <= 900
    assert all(
        text_width(line, font(72, language, 600), -1.7) <= layout.body_width
        for line in result["body"]
    )
    prompt = copy_messages(
        title=source, reason=source, transcript=source, ratio=ratio, language=language
    )[0]["content"]
    expected = {
        "ko": ("대한민국 상위 0.1%", "타격감 있는", f"반드시 {layout.body_lines}행", "반드시 1행"),
        "en": (
            "top 0.1%", "strong spoken rhythm",
            f"exactly {layout.body_lines} lines", "exactly one line",
        ),
        "ja": ("再生数上位0.1%", "端的で力のある", f"必ず{layout.body_lines}行", "必ず1行"),
    }[language]
    assert all(fragment in prompt for fragment in expected)
    inputs = json.loads(copy_messages(
        title=source, reason=source, transcript=source, ratio=ratio, language=language
    )[1]["content"])
    assert inputs["outputLanguage"] == {"ko": "한국어", "en": "English", "ja": "日本語"}[language]


def test_rejects_overflow_and_wrong_line_counts():
    with pytest.raises(ValueError):
        validate_copy({"title": "퇴근", "body": ["글" * 20], "hashtags": []}, "9:16", "ko")
    with pytest.raises(ValueError):
        validate_copy({"title": "퇴근", "body": ["첫째", "둘째"], "hashtags": []}, "9:16", "ko")
    with pytest.raises(ValueError):
        validate_copy({"title": "퇴근", "body": ["첫째"], "hashtags": ["#태그"]}, "9:16", "ko")


def test_sns_is_rejected_by_ordinary_worker(monkeypatch):
    monkeypatch.delenv("EASYCUT_SNS_TEMPLATE_WORKER", raising=False)
    with pytest.raises(Exception, match="SNS"):
        verify_language_test_job({"template_snapshot": {"snsTemplateVersion": 1}})
    monkeypatch.setenv("EASYCUT_SNS_TEMPLATE_WORKER", "true")
    with pytest.raises(Exception, match="SNS"):
        verify_language_test_job({})


@pytest.mark.render
@pytest.mark.parametrize("ratio", ["16:9", "5:4", "1:1", "4:5", "9:16"])
def test_ffmpeg_ratios_rounding_audio_and_uncropped_vertical(tmp_path: Path, ratio):
    layout = sns_layout(ratio)
    x, y, width, height = layout.video
    num, den = map(int, ratio.split(":"))
    assert width * den == height * num
    assert y + height + 30 <= 1920
    assert (layout.text_x == x) if ratio == "9:16" else True
    source = tmp_path / "source.mp4"
    result = run_command(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=blue:s={width}x{height}:r=10:d=0.5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.5",
            "-vf",
            "drawbox=x=0:y=0:w=iw:h=30:color=red:t=fill,"
            "drawbox=x=0:y=ih-30:w=iw:h=30:color=lime:t=fill",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(source),
        ],
        timeout=30,
        cwd=tmp_path,
    )
    assert result.returncode == 0
    content = {
        "title": "퇴근 1분 전 내 모습",
        "body": ["퇴근 얘기에 살아남 ㅋㅋ"] * layout.body_lines,
        "hashtags": ["#퇴근", "#직장인", "#칼퇴"] if layout.hashtags else [],
    }
    output = tmp_path / "result.mp4"
    render_sns(
        Settings(ffmpeg_threads=2, clean_clip_preset="ultrafast"),
        clean_path=source,
        output_path=output,
        work_dir=tmp_path,
        ratio=ratio,
        snapshot={"snsContent": content, "snsLanguage": "ko", "brandColor": "#FF715E"},
        channel="퇴근연구소",
        avatar=None,
    )
    probe = probe_media(output, timeout=20)
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    assert any(s["codec_type"] == "audio" for s in probe["streams"])
    frame = tmp_path / "frame.png"
    assert (
        run_command(
            ["ffmpeg", "-v", "error", "-y", "-i", str(output), "-frames:v", "1", str(frame)],
            timeout=20,
            cwd=tmp_path,
        ).returncode
        == 0
    )
    with Image.open(frame) as image:
        assert min(image.getpixel((x, y))[:3]) > 240  # Rounded outer corner is white.
        top = image.getpixel((x + width // 2, y + 10))
        bottom = image.getpixel((x + width // 2, y + height - 10))
        assert top[0] > 180 and top[1] < 60  # Both source ends survive.
        assert bottom[1] > 180 and bottom[0] < 60
    with Image.open(tmp_path / "sns-overlay.png") as image:
        assert image.getpixel((x + width // 2, y + height // 2))[3] == 0
        assert image.getpixel((x + width - 53, y + height - 53))[3] > 0  # Volume affordance.


def test_brand_contrast_and_fixed_title_geometry(tmp_path):
    content = {"title": "퇴근", "body": ["이제 집으로"], "hashtags": []}
    for color in ("#000000", "#FFFFFF"):
        output = tmp_path / f"{color[1:]}.png"
        create_overlay(
            output, ratio="9:16", content=content, language="ko", brand_color=color, channel="채널"
        )
        with Image.open(output) as image:
            assert image.getpixel((100, 160))[:3] == (
                (0, 0, 0) if color == "#000000" else (255, 255, 255)
            )


@pytest.mark.render
def test_wide_source_fills_selected_portrait_frame(tmp_path):
    source = tmp_path / "wide.mp4"
    assert (
        run_command(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=640x360:r=10:d=0.5",
                "-c:v",
                "libx264",
                str(source),
            ],
            timeout=30,
            cwd=tmp_path,
        ).returncode
        == 0
    )
    output = tmp_path / "portrait.mp4"
    render_sns(
        Settings(ffmpeg_threads=2, clean_clip_preset="ultrafast"),
        clean_path=source,
        output_path=output,
        work_dir=tmp_path,
        ratio="9:16",
        snapshot={
            "snsContent": {"title": "제목", "body": ["본문"], "hashtags": []},
            "snsLanguage": "ko",
        },
        channel="채널",
        avatar=None,
    )
    frame = tmp_path / "frame.png"
    assert (
        run_command(
            ["ffmpeg", "-v", "error", "-y", "-i", str(output), "-frames:v", "1", str(frame)],
            timeout=30,
            cwd=tmp_path,
        ).returncode
        == 0
    )
    with Image.open(frame) as picture:
        for y in (620, 1220, 1810):
            red, green, blue = picture.getpixel((540, y))[:3]
            assert blue > 180 and red < 60 and green < 60


@pytest.mark.parametrize("language,text", [
    ("ko", "결국 역으로 9대 1 역전당함"),
    ("en", "Ag 19 py"),
    ("ja", "逆転 9対1 ゲーム"),
])
@pytest.mark.parametrize("size,weight", [(80, 700), (72, 600), (52, 700), (47, 400)])
def test_mixed_glyphs_share_baseline(language, text, size, weight):
    face = font(size, language, weight)
    image = Image.new("L", (2000, 200), 0)
    spacing = 24
    draw_text(ImageDraw.Draw(image), (20, 20), text, face, "white", spacing)
    x = 20.0
    baselines = []
    for char in text:
        advance = face.getlength(char)
        if char.strip():
            box = image.crop((int(x) - 2, 0, int(x + advance) + 3, 200)).getbbox()
            assert box is not None
            glyph_top = face.getbbox(char, anchor="ls")[1]
            baselines.append(box[1] - glyph_top)
        x += advance + spacing
    assert max(baselines) - min(baselines) <= 1
    assert abs(image.getbbox()[1] - 20) <= 1


def test_draw_empty_text_is_noop():
    image = Image.new("L", (100, 100), 0)
    draw_text(ImageDraw.Draw(image), (20, 20), "", font(72, "ko", 600), "white")
    assert image.getbbox() is None


@pytest.mark.parametrize("ratio,offset", [
    ("16:9", 150), ("5:4", 150), ("1:1", 150), ("4:5", 0), ("9:16", 0),
])
def test_sns_top_safe_area_and_content_spacing(tmp_path, ratio, offset):
    layout = sns_layout(ratio)
    path = tmp_path / "safe-area.png"
    create_overlay(path, ratio=ratio, content={
        "title": "9대 1 역전", "body": ["결국 역전당함"] * layout.body_lines,
        "hashtags": ["#스타", "#역전", "#테란"] if layout.hashtags else [],
    }, language="ko", brand_color="#DB2777", channel="도멘TV")
    with Image.open(path) as image:
        assert image.getpixel((540, 150 + offset))[:3] == (219, 39, 119)
        assert image.getpixel((540, 149 + offset))[:3] == (255, 255, 255)
        assert image.crop((0, 0, 1080, 150 + offset)).convert("RGB").getextrema() == (
            (255, 255), (255, 255), (255, 255),
        )
    assert layout.card[1] - (282 + offset) == 60
    assert layout.video[1] > 480 + offset + (layout.body_lines - 1) * 90 + 72
    assert layout.card[1] + layout.card[3] <= 1920


@pytest.mark.parametrize("ratio", ["16:9", "5:4", "1:1", "4:5", "9:16"])
@pytest.mark.parametrize("language", ["ko", "en", "ja"])
def test_provider_receives_exact_line_and_tag_counts(ratio, language, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    import openai

    layout = sns_layout(ratio)
    target = {"ko": "Korean", "en": "English", "ja": "Japanese"}[language]
    payload = {
        "title": "OK", "body": ["OK"] * layout.body_lines,
        "hashtags": ["#a", "#b", "#c"] if layout.hashtags else [],
    }
    client = MagicMock()
    client.chat.completions.create.return_value = SimpleNamespace(choices=[
        SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload))),
    ])
    monkeypatch.setattr(openai, "OpenAI", MagicMock(return_value=client))
    result = generate_copy(
        Settings(gemini_api_key="test", gemini_paid_data_processing_confirmed=True),
        title="OK", reason="OK", transcript="OK", ratio=ratio, language=language,
    )
    assert result["source"] == "ai"
    request = client.chat.completions.create.call_args.kwargs
    assert request["response_format"] == copy_response_format(ratio, language)
    schema = request["response_format"]["json_schema"]["schema"]["properties"]
    assert schema["body"]["minItems"] == schema["body"]["maxItems"] == layout.body_lines
    assert schema["hashtags"]["minItems"] == schema["hashtags"]["maxItems"] == (
        3 if layout.hashtags else 0
    )
    assert target in schema["title"]["description"]
    client.close.assert_called_once()


@pytest.mark.parametrize("language", ["en", "ja"])
def test_generated_copy_repairs_untranslated_korean(language):
    with pytest.raises(ValueError, match="not translated"):
        validate_generated_language(
            {"title": "유리하다고 안 가다", "body": ["결국 역전당함"]}, language
        )
    validate_generated_language({"title": "김 wins", "body": ["What a comeback"]}, "en")
    validate_generated_language({"title": "逆転", "body": ["まさかの大逆転"]}, "ja")
