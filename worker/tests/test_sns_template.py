from pathlib import Path

import pytest
from PIL import Image

from shorts_worker.config import Settings
from shorts_worker.language_test import verify_language_test_job
from shorts_worker.media import probe_media, run_command
from shorts_worker.sns_template import (
    copy_messages,
    create_overlay,
    font,
    generate_copy,
    render_sns,
    sns_layout,
    text_width,
    validate_copy,
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
    assert f"exactly {layout.body_lines} short lines" in prompt
    assert "ONE complete line" in prompt


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
