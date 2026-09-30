import json
from pathlib import Path

import pytest
from PIL import Image

from shorts_worker.community_template import (
    FRAMES,
    community_heading_color,
    community_layout,
    create_community_overlay,
)
from shorts_worker.config import Settings
from shorts_worker.editor_renderer import EditorDocumentRenderer
from shorts_worker.errors import RenderError
from shorts_worker.language_test import verify_language_test_job
from shorts_worker.media import probe_media, run_command
from shorts_worker.schemas import EditorDocument
from shorts_worker.sns_editor import validate_sns_editor_document
from shorts_worker.sns_template import render_sns


def snapshot():
    return {"presetVersion": 4, "snsTemplateVersion": 1, "communityTemplateVersion": 1,
            "snsLanguage": "ko", "brandColor": "#FF715E",
            "snsContent": {"title": "퇴근 1분 전", "body": ["퇴근 얘기에 살아남"],
                           "hashtags": [], "source": "edited"}}


@pytest.mark.parametrize("ratio", FRAMES)
def test_fixed_header_exact_ratios_and_brand_color(tmp_path, ratio):
    layout = community_layout(ratio)
    x, y, w, h = layout.video
    n, d = map(int, ratio.split(":"))
    assert w * d == h * n and y == 690 and y + h <= 1920
    for color in ("#FF715E", "#303E78", "#FFFFFF"):
        path = tmp_path / (color[1:] + ".png")
        create_community_overlay(path, ratio=ratio, content=snapshot()["snsContent"],
                                 language="ko", brand_color=color, channel="채널", avatar=None)
        with Image.open(path) as image:
            assert image.size == (1080, 1920)
            assert image.getpixel((0, 0)) == tuple(bytes.fromhex(color[1:])) + (255,)
            assert image.getpixel((1079, 269)) == image.getpixel((0, 0))
            heading_ink = tuple(bytes.fromhex(community_heading_color(color)[1:])) + (255,)
            assert heading_ink in set(image.crop((200, 150, 880, 255)).getdata())
            assert image.getpixel((x, y))[3] == 0  # rectangular video window
            assert image.getpixel((540, 1900)) == (255, 255, 255, 255)
            header = image.crop((0, 0, 1080, 690)).tobytes()
        reference = tmp_path / "reference.png"
        create_community_overlay(reference, ratio="9:16", content=snapshot()["snsContent"],
                                 language="ko", brand_color=color, channel="채널", avatar=None)
        with Image.open(reference) as image:
            assert image.crop((0, 0, 1080, 690)).tobytes() == header


def test_old_sns_worker_cannot_accept_community(monkeypatch):
    monkeypatch.setenv("EASYCUT_SNS_TEMPLATE_WORKER", "true")
    monkeypatch.delenv("EASYCUT_COMMUNITY_TEMPLATE_WORKER", raising=False)
    with pytest.raises(RenderError, match="커뮤니티"):
        verify_language_test_job({"template_snapshot": snapshot()})
    monkeypatch.setenv("EASYCUT_COMMUNITY_TEMPLATE_WORKER", "true")
    with pytest.raises(RenderError, match="커뮤니티"):
        verify_language_test_job({"template_snapshot": {"snsTemplateVersion": 1}})


@pytest.mark.render
@pytest.mark.parametrize("ratio", FRAMES)
def test_generation_and_editor_render_same_layout_with_audio(tmp_path, ratio):
    _, _, w, h = FRAMES[ratio]
    source = tmp_path / "source.mp4"
    assert run_command(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                        f"color=c=blue:s={w}x{h}:r=10:d=1", "-f", "lavfi", "-i",
                        "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt",
                        "yuv420p", "-c:a", "aac", "-shortest", str(source)],
                       timeout=30, cwd=tmp_path).returncode == 0
    settings = Settings(clean_clip_preset="ultrafast", ffmpeg_threads=2)
    fixture = Path(__file__).parents[1] / "shorts_worker/assets/sns_editor_probe_document.json"
    value = json.loads(fixture.read_text())
    value["template"] = {"id": "white-yellow", "customTemplateId": None,
                         "presetVersion": 4, "snapshot": snapshot()}
    value["title"]["text"] = snapshot()["snsContent"]["title"]
    value["channel"]["displayName"] = "채널"
    value["subtitles"] = {"enabled": False, "segments": []}
    value["video"] = {"aspectRatio": ratio, "timelineStartSeconds": 0,
                      "timelineEndSeconds": 1, "selectionStartSeconds": 0,
                      "selectionEndSeconds": 1,
                      "clips": [{"id": "v", "sourceStartSeconds": 0, "sourceEndSeconds": 1}]}
    document = EditorDocument.model_validate(value)
    validate_sns_editor_document(document)
    overlays = []
    for editor in (False, True):
        work = tmp_path / str(editor)
        work.mkdir()
        output = work / "output.mp4"
        if editor:
            EditorDocumentRenderer(settings).render(clean_path=source, output_path=output,
                work_dir=work, document=document, channel_thumbnail_path=None)
        else:
            render_sns(settings, clean_path=source, output_path=output, work_dir=work,
                       ratio=ratio, snapshot=snapshot(), channel="채널", avatar=None)
        info = probe_media(output, timeout=30)
        video = next(s for s in info["streams"] if s["codec_type"] == "video")
        assert (video["width"], video["height"]) == (1080, 1920)
        assert any(s["codec_type"] == "audio" for s in info["streams"])
        with Image.open(work / "sns-overlay.png") as image:
            overlays.append(image.tobytes())
    assert overlays[0] == overlays[1]


@pytest.mark.parametrize("background,expected", [
    ("#FF715E", "#FFFFFF"), ("#FF4D4F", "#FFFFFF"), ("#35E6E3", "#FFFFFF"),
    ("#3B82F6", "#FFFFFF"), ("#303E78", "#FFFFFF"), ("#FFD84D", "#000000"),
    ("#FFFFFF", "#000000"), ("bad", "#FFFFFF"),
])
def test_community_heading_prefers_white(background, expected):
    assert community_heading_color(background) == expected
