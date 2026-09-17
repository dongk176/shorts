"""Compare actual first-generation and edited frames, not only job success."""
import json
import shutil
import subprocess
from copy import deepcopy
from pathlib import Path

import pytest
from PIL import Image, ImageChops, ImageStat

from shorts_worker.caption_composition import with_caption_comment_layout
from shorts_worker.caption_templates import compile_caption_render_spec
from shorts_worker.config import Settings
from shorts_worker.editor_renderer import (
    EditorDocumentRenderer,
    retime_editor_caption_spec,
    retime_editor_subtitles,
)
from shorts_worker.render_spec_v4 import compile_initial_editor_render_spec_v4
from shorts_worker.renderer import VideoRenderer
from shorts_worker.schemas import (
    CommentOverlay,
    EditorDocument,
    SubtitleSegment,
    TemplateId,
    VideoAspectRatio,
)
from shorts_worker.subtitle_translation import translated_words

pytestmark = [pytest.mark.render, pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg is required",
)]


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, timeout=120)


@pytest.mark.parametrize("language,before,after", [
    ("ko", "안녕하세요.", "여러분 반갑습니다."),
    ("en", "Hello, everyone.", "Hello, everybody."),
    ("ja", "こんにちは。", "皆さん、こんにちは。"),
])
@pytest.mark.parametrize("saved_composition,ratio", [
    (False, "16:9"), (True, "16:9"), (True, "5:4"), (True, "1:1"),
])
def test_basic_caption_edit_preserves_comment_position(
    tmp_path, language, before, after, saved_composition, ratio,
):
    clean = tmp_path / "clean.mp4"
    run("ffmpeg", "-v", "error", "-f", "lavfi", "-i",
        "color=c=0x204060:s=640x360:r=30:d=1", "-c:v", "libx264",
        "-pix_fmt", "yuv420p", str(clean))
    segments = [SubtitleSegment(start=0, end=1, text=before)]
    caption = compile_caption_render_spec(
        translated_words(segments), template_id="basic", clip_start=0, clip_end=1,
        video_aspect_ratio=VideoAspectRatio(ratio), schema_version=4,
        font_id="noto-sans-jp" if language == "ja" else "pretendard",
    )
    if saved_composition:
        caption = with_caption_comment_layout(
            caption, template_id="comment-capture", video_aspect_ratio=ratio,
        )
    title = "Math legend\nHyun Woo-jin!" if language != "ja" else "数学の伝説\nヒョン・ウジン！"
    comment = CommentOverlay.model_validate({
        "id": "comment-1", "text": "A comment stays here", "nickname": "Viewer",
        "initial": "V", "ageLabel": "1 day ago", "likeCount": 20,
        "avatarColor": "#2674C8", "startSeconds": 0, "endSeconds": 1,
    })
    initial = compile_initial_editor_render_spec_v4(
        title=title, template_id=TemplateId.COMMENT_CAPTURE,
        video_aspect_ratio=VideoAspectRatio(ratio), font_scale=1,
        comments=[comment], caption_render_spec=caption, output_language=language,
    )
    fixture = Path(__file__).parents[2] / "test-fixtures/editor-document-v3.json"
    value = json.loads(fixture.read_text())
    value["template"] = {"id": "comment-capture", "customTemplateId": None,
                         "presetVersion": 3, "snapshot": {"presetVersion": 3}}
    value["title"]["text"] = title
    value["channel"]["displayName"] = "Channel"
    value["comments"] = [comment.model_dump(by_alias=True, mode="json")]
    value["subtitles"]["segments"] = [s.model_dump() for s in segments]
    value["overlays"].update(
        textOverlays=[], layerOrder=["video", "title", "comment", "channel"], background=None,
        commentTheme="dark" if saved_composition else None,
    )
    value["overlays"]["visible"]["comment"] = True
    value["overlays"]["fonts"]["title"] = initial["title"]["font"]["fontId"]
    value["video"].update(clips=[{"id": "clip-1", "sourceStartSeconds": 0, "sourceEndSeconds": 1}],
                          aspectRatio=ratio,
                          timelineStartSeconds=0, timelineEndSeconds=1,
                          selectionStartSeconds=0, selectionEndSeconds=1)
    value["renderSpec"] = deepcopy(initial)
    value["renderSpec"]["subtitles"]["cueEdits"] = [{"cueIndex": 0, "text": after}]
    document = EditorDocument.model_validate(value)
    edited_caption = retime_editor_caption_spec(document, caption)
    rendered_text = "".join(w["text"] for c in edited_caption["cues"] for w in c["words"])
    assert rendered_text.replace(" ", "") == after.replace(" ", "")
    stored_script = retime_editor_subtitles(document, caption)
    assert "".join(s.text for s in stored_script).replace(" ", "") == after.replace(" ", "")
    assert document.subtitles.segments[0].text == before
    reopened = EditorDocument.model_validate_json(document.model_dump_json(by_alias=True))
    assert retime_editor_subtitles(reopened, caption) == stored_script
    settings = Settings(ffmpeg_threads=2, ffmpeg_timeout_seconds=120,
                        clean_clip_preset="ultrafast", clean_clip_crf=18)
    first = VideoRenderer(settings).render_clean_clip(
        clean_path=clean, output_path=tmp_path / "first.mp4", title=title,
        channel_name="Channel", template_id=TemplateId.COMMENT_CAPTURE,
        transcript=segments, subtitles_enabled=True, work_dir=tmp_path / "first-work",
        prefix="first", video_aspect_ratio=VideoAspectRatio(ratio),
        comment_overlays=[comment], comment_channel_fixed=True,
        caption_render_spec=caption, initial_render_spec=initial,
        comment_output_language=language,
    )
    edited = EditorDocumentRenderer(settings).render(
        clean_path=clean, output_path=tmp_path / "edited.mp4", document=document,
        work_dir=tmp_path / "edited-work", channel_thumbnail_path=None,
        caption_render_spec=caption, comment_output_language=language,
    )
    frames = []
    for name, video in (("first", first), ("edited", edited)):
        probe = json.loads(run(
            "ffprobe", "-v", "error", "-show_format", "-of", "json", str(video),
        ).stdout)
        assert float(probe["format"]["duration"]) == pytest.approx(1, abs=0.05)
        path = tmp_path / f"{name}.png"
        run("ffmpeg", "-v", "error", "-ss", "0.2", "-i", str(video), "-frames:v", "1", str(path))
        frames.append(Image.open(path).convert("RGB"))
    # A caption edit changes subtitle pixels but leaves the comment in its old band.
    top = caption["layout"].get("comment", caption["layout"]["channel"])["y"]
    bottom_diff = ImageChops.difference(*(frame.crop((0, top, 1080, 1920)) for frame in frames))
    assert max(ImageStat.Stat(bottom_diff).mean) < 5
    comment_masks = [
        frame.crop((0, top, 1080, 1920)).convert("L").point(lambda px: 255 if px > 100 else 0)
        for frame in frames
    ]
    visible_pixels = [mask.histogram()[255] for mask in comment_masks]
    assert min(visible_pixels) > 200
    shared_pixels = ImageChops.multiply(*comment_masks).histogram()[255]
    assert shared_pixels / max(visible_pixels) > 0.9
    area = caption["safeArea"]
    box = (area["x"], area["y"], area["x"] + area["width"], area["y"] + area["height"])
    assert ImageChops.difference(*(frame.crop(box) for frame in frames)).getbbox() is not None
    title_bottom = max(line["centerY"] + line["height"] / 2
                       for line in initial["title"]["lineBoxes"])
    assert title_bottom <= caption["layout"]["video"]["y"] - 24
    if saved_composition:
        card = caption["layout"]["comment"]
        channel = caption["layout"]["channel"]
        video_bottom = caption["layout"]["video"]["y"] + caption["layout"]["video"]["height"]
        assert card["y"] >= video_bottom
        assert card["y"] + card["height"] <= channel["y"] + channel["height"] / 2 - 27 - 24
        assert channel["y"] + channel["height"] <= 1920
        # The channel stays white and visible after subtitle editing, with the
        # same actual pixels (old code changed its font, color, and position).
        channel_box = (0, channel["y"], 1080, 1920)
        channel_frames = [frame.crop(channel_box) for frame in frames]
        assert min(sum(frame.convert("L").histogram()[200:])
                   for frame in channel_frames) > 500
        assert max(ImageStat.Stat(ImageChops.difference(*channel_frames)).mean) < 1
        # Switching subtitles off keeps the video, title, comment and channel.
        value["subtitles"]["enabled"] = False
        hidden_document = EditorDocument.model_validate(value)
        assert retime_editor_subtitles(hidden_document, caption) == stored_script
        without = EditorDocumentRenderer(settings).render(
            clean_path=clean, output_path=tmp_path / "without-captions.mp4",
            document=hidden_document, work_dir=tmp_path / "off-work",
            channel_thumbnail_path=None,
            caption_render_spec=None, caption_composition_spec=caption,
            comment_output_language=language,
        )
        off_path = tmp_path / "off.png"
        run("ffmpeg", "-v", "error", "-ss", "0.2", "-i", str(without),
            "-frames:v", "1", str(off_path))
        with Image.open(off_path) as image:
            off_frame = image.convert("RGB")
        for unchanged_box in ((0, 0, 1080, min(video_bottom, area["y"])), (0, top, 1080, 1920)):
            diff = ImageChops.difference(
                frames[1].crop(unchanged_box), off_frame.crop(unchanged_box),
            )
            assert max(ImageStat.Stat(diff).mean) < 1
